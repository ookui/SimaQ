import Foundation
import PDFKit
import CSQLite

/// Search offsets are UTF-16 offsets in the original Markdown, extracted HTML text,
/// or the individual PDF page. All work and database access run on one worker.
final class SearchService {
    private let queue = DispatchQueue(label: "SimaQ.search", qos: .userInitiated)
    private let lock = NSLock()
    private var generation = 0
    private var root: URL?
    private var db: OpaquePointer?
    private var ftsAvailable = false
    private var indexingEpoch = 0
    private var nextIndexingEpoch = 0
    private var readyCallbacks = [() -> Void]()
    private let markdown: Set<String> = ["md", "markdown", "mdown", "mkd"]
    private let plain: Set<String> = ["txt", "json", "svg"]
    private lazy var editable = markdown.union(plain)
    private lazy var allowed = editable.union(["html", "htm", "pdf"])
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    deinit { if let db = db { sqlite3_close(db) } }

    // One bounded UI result. All cache reads and invalidations occur on queue.
    private var lastQuery: (key: Data, rows: [[String:Any]])?
    private static let hanRuns = try! NSRegularExpression(pattern: #"\p{Han}+"#)
    private static let shortHan = try! NSRegularExpression(pattern: #"\A\p{Han}{1,2}\z"#)
    private var excludedFolders = Set<String>()
    private func excluded(_ path: String) -> Bool {
        excludedFolders.contains { path.hasPrefix($0 + "/") }
    }
    func setExcludedFolders(_ paths: [String]) {
        lock.lock(); generation += 1; lock.unlock()
        queue.async {
            self.lastQuery = nil
            self.excludedFolders = Set(paths)
            self.synchronize()
        }
    }
    func setRoot(_ root: URL, excludedFolders: [String] = []) {
        lock.lock(); generation += 1; lock.unlock()
        queue.async { [weak self] in self?.excludedFolders = Set(excludedFolders); self?.open(root.resolvingSymlinksInPath().standardizedFileURL) }
    }
    func rebuild() { queue.async {
        self.lastQuery = nil
        self.exec("UPDATE docs SET mtime=-1")
        self.synchronize()
    } }
    func whenReady(_ completion: @escaping () -> Void) { queue.async { [weak self] in guard let self = self else { return }; if self.indexingEpoch == 0 { DispatchQueue.main.async(execute: completion) } else { self.readyCallbacks.append(completion) } } }
    func update(_ url: URL) { queue.async { [weak self] in
        guard let self = self else { return }
        let normalized = url.standardizedFileURL
        var directory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: normalized.path, isDirectory: &directory)
        if normalized == self.root || directory.boolValue { self.synchronize(); return }
        self.exec("BEGIN TRANSACTION"); self.index(normalized, force: true); self.exec("COMMIT")
        if !exists { self.synchronize() }
    } }
    func query(_ payload: [String: Any], completion: @escaping ([[String: Any]]) -> Void) {
        lock.lock(); generation += 1; let ticket = generation; lock.unlock()
        queue.async { [weak self] in
            guard let self = self, self.current(ticket) else { DispatchQueue.main.async { completion([]) }; return }
            let cacheable = (payload["hitLimit"] as? Int ?? Int.max) <= 50 && payload["buffers"] == nil
            let key = cacheable ? try? JSONSerialization.data(withJSONObject:payload,options:.sortedKeys) : nil
            let result: [[String:Any]]
            if let key, let cached = self.lastQuery, cached.key == key {
                result = cached.rows
            } else {
                result = self.find(payload, ticket: ticket)
                if let key, self.current(ticket), result.count <= 200, (payload["hitLimits"] as? [String:Int] ?? [:]).values.allSatisfy({ $0 <= 200 }) {
                    self.lastQuery = (key, result)
                }
            }
            guard self.current(ticket) else { DispatchQueue.main.async { completion([]) }; return }
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.current(ticket) else { completion([]); return }
                completion(result)
            }
        }
    }
    private func current(_ ticket: Int) -> Bool {
        lock.lock(); defer { lock.unlock() }; return generation == ticket
    }
    private func open(_ url: URL) {
        if let db = db { sqlite3_close(db); self.db = nil }
        lastQuery = nil
        root = url
        let base = ProcessInfo.processInfo.environment["SIMAQ_SEARCH_INDEX_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("SimaQ/Search", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        // Stable FNV-1a hash keeps each library's private index separate.
        let hash = url.path.utf8.reduce(UInt64(14695981039346656037)) { ($0 ^ UInt64($1)) &* 1099511628211 }
        guard sqlite3_open(base.appendingPathComponent(String(hash, radix: 16) + ".sqlite").path, &db) == SQLITE_OK else { return }
        exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; CREATE TABLE IF NOT EXISTS docs(path TEXT PRIMARY KEY, mtime REAL, size INTEGER, pages BLOB NOT NULL);")
        var marker: OpaquePointer?
        let exists = sqlite3_prepare_v2(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_fts'", -1, &marker, nil) == SQLITE_OK && sqlite3_step(marker) == SQLITE_ROW
        sqlite3_finalize(marker)
        ftsAvailable = sqlite3_exec(db, "CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(content, tokenize='trigram')", nil, nil, nil) == SQLITE_OK
        var meta: OpaquePointer?
        let metaExists = sqlite3_prepare_v2(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_meta'", -1, &meta, nil) == SQLITE_OK && sqlite3_step(meta) == SQLITE_ROW
        sqlite3_finalize(meta)
        ftsAvailable = ftsAvailable && sqlite3_exec(db, "CREATE VIRTUAL TABLE IF NOT EXISTS search_meta USING fts5(name, heading, folder, tokenize='trigram')", nil, nil, nil) == SQLITE_OK
        if ftsAvailable && (!exists || !metaExists) { exec("DELETE FROM docs; DELETE FROM search_fts; DELETE FROM search_meta") }
        exec("CREATE TABLE IF NOT EXISTS note_refs(source TEXT, name TEXT, raw TEXT, wiki INTEGER, line INTEGER, paragraph TEXT); CREATE INDEX IF NOT EXISTS refs_name ON note_refs(name); CREATE INDEX IF NOT EXISTS refs_source ON note_refs(source)")
        if ftsAvailable { exec("CREATE VIRTUAL TABLE IF NOT EXISTS search_han USING fts5(grams, tokenize='ascii', detail=none)") }
        var version: OpaquePointer?
        let migrate = sqlite3_prepare_v2(db,"PRAGMA user_version",-1,&version,nil) == SQLITE_OK && sqlite3_step(version) == SQLITE_ROW && sqlite3_column_int(version,0) < 2
        sqlite3_finalize(version)
        if migrate {
            exec("BEGIN; UPDATE docs SET mtime=-1; DELETE FROM note_refs")
            if ftsAvailable { exec("DELETE FROM search_han") }
            exec("PRAGMA user_version=2; COMMIT")
        }
        synchronize()
    }
    private func exec(_ sql: String) { if let db = db { sqlite3_exec(db, sql, nil, nil, nil) } }
    private func relative(_ url: URL) -> String? {
        guard let root = root else { return nil }
        let base = root.path == "/" ? "/" : root.standardizedFileURL.path + "/", path = url.standardizedFileURL.path
        guard path.hasPrefix(base) else { return nil }
        return String(path.dropFirst(base.count))
    }
    private func safeFile(_ url: URL) -> Bool {
        guard let path = relative(url), let root else { return false }
        var current = root
        for component in path.split(separator: "/") {
            current.appendPathComponent(String(component))
            guard let info = try? current.resourceValues(forKeys: [.isSymbolicLinkKey]), info.isSymbolicLink != true else { return false }
        }
        return (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    }
    private func synchronize() {
        guard let root = root, db != nil else { return }
        nextIndexingEpoch += 1
        indexingEpoch = nextIndexingEpoch
        let epoch = indexingEpoch
        let excludedFolders = self.excludedFolders
        let allowed = self.allowed
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let keys: [URLResourceKey] = [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey]
            var urls = [URL](); var seen = Set<String>()
            let prefix = root.path == "/" ? "/" : root.path + "/"
            if let en = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles]) {
              for case let url as URL in en {
                guard let v = try? url.resourceValues(forKeys: Set(keys)) else { continue }
                if v.isDirectory == true && excludedFolders.contains(String(url.path.dropFirst(prefix.count))) { en.skipDescendants(); continue }
                if v.isSymbolicLink == true { if v.isDirectory == true { en.skipDescendants() }; continue }
                guard v.isRegularFile == true, allowed.contains(url.pathExtension.lowercased()), url.standardizedFileURL.path.hasPrefix(prefix) else { continue }
                urls.append(url); seen.insert(String(url.standardizedFileURL.path.dropFirst(prefix.count)))
              }
            }
            self?.queue.async { [weak self] in self?.indexBatch(urls, seen: seen, offset: 0, epoch: epoch, root: root) }
        }
    }
    private func indexBatch(_ urls: [URL], seen: Set<String>, offset: Int, epoch: Int, root: URL) {
        guard indexingEpoch == epoch, self.root == root else { return }
        if offset < urls.count {
            exec("BEGIN TRANSACTION")
            let end = min(offset + 10, urls.count)
            for i in offset..<end { index(urls[i], force: false) }
            exec("COMMIT")
            queue.async { [weak self] in self?.indexBatch(urls, seen: seen, offset: end, epoch: epoch, root: root) }
            return
        }
        var s: OpaquePointer?; var deleted = [String]()
        if sqlite3_prepare_v2(db, "SELECT path FROM docs", -1, &s, nil) == SQLITE_OK {
            while sqlite3_step(s) == SQLITE_ROW { if let p = sqlite3_column_text(s, 0) { let path = String(cString:p); if !seen.contains(path) { deleted.append(path) } } }
        }
        sqlite3_finalize(s)
        for path in deleted where excluded(path) || !safeFile(root.appendingPathComponent(path)) { delete(path) }
        indexingEpoch = 0
        let callbacks = readyCallbacks; readyCallbacks.removeAll()
        for callback in callbacks { DispatchQueue.main.async(execute: callback) }
    }
    private func delete(_ path: String) {
        lastQuery = nil
        var refs: OpaquePointer?
        if sqlite3_prepare_v2(db,"DELETE FROM note_refs WHERE source=?",-1,&refs,nil) == SQLITE_OK {
            sqlite3_bind_text(refs,1,path,-1,transient); sqlite3_step(refs)
        }
        sqlite3_finalize(refs)
        if ftsAvailable {
            var han: OpaquePointer?
            if sqlite3_prepare_v2(db,"DELETE FROM search_han WHERE rowid IN (SELECT rowid FROM docs WHERE path=?)",-1,&han,nil) == SQLITE_OK {
                sqlite3_bind_text(han,1,path,-1,transient); sqlite3_step(han)
            }
            sqlite3_finalize(han)
            var f: OpaquePointer?
            if sqlite3_prepare_v2(db, "DELETE FROM search_fts WHERE rowid IN (SELECT rowid FROM docs WHERE path=?)", -1, &f, nil) == SQLITE_OK { sqlite3_bind_text(f,1,path,-1,transient); sqlite3_step(f) }
            sqlite3_finalize(f)
            var m: OpaquePointer?
            if sqlite3_prepare_v2(db, "DELETE FROM search_meta WHERE rowid IN (SELECT rowid FROM docs WHERE path=?)", -1, &m, nil) == SQLITE_OK { sqlite3_bind_text(m,1,path,-1,transient); sqlite3_step(m) }
            sqlite3_finalize(m)
        }
        var s: OpaquePointer?; guard sqlite3_prepare_v2(db, "DELETE FROM docs WHERE path=?", -1, &s, nil) == SQLITE_OK else { return }
        sqlite3_bind_text(s, 1, path, -1, transient); sqlite3_step(s); sqlite3_finalize(s)
    }
    private func index(_ url: URL, force: Bool) {
        guard let path = relative(url), db != nil else { return }
        guard !excluded(path), safeFile(url), allowed.contains(url.pathExtension.lowercased()), let a = try? FileManager.default.attributesOfItem(atPath: url.path), let m = (a[.modificationDate] as? Date)?.timeIntervalSince1970, let size = (a[.size] as? NSNumber)?.int64Value else { delete(path); return }
        if !force {
            var s: OpaquePointer?
            if sqlite3_prepare_v2(db, "SELECT mtime,size FROM docs WHERE path=?", -1, &s, nil) == SQLITE_OK {
                sqlite3_bind_text(s, 1, path, -1, transient)
                let unchanged = sqlite3_step(s) == SQLITE_ROW && sqlite3_column_double(s, 0) == m && sqlite3_column_int64(s, 1) == size
                sqlite3_finalize(s); if unchanged { return }
            } else { sqlite3_finalize(s) }
        }
        let ext = url.pathExtension.lowercased()
        let pages: [String]
        if ext == "pdf" {
            guard let pdf = PDFDocument(url: url) else { delete(path); return }
            pages = (0..<pdf.pageCount).map { pdf.page(at: $0)?.string ?? "" }
        } else {
            guard let data = try? Data(contentsOf: url) else { delete(path); return }
            let marks: [([UInt8], String.Encoding)] = [([0xff,0xfe,0,0], .utf32LittleEndian), ([0,0,0xfe,0xff], .utf32BigEndian), ([0xef,0xbb,0xbf], .utf8), ([0xff,0xfe], .utf16LittleEndian), ([0xfe,0xff], .utf16BigEndian)]
            let selected = marks.first { data.starts(with:$0.0) }
            guard let raw = String(data:data.dropFirst(selected?.0.count ?? 0), encoding:selected?.1 ?? .utf8), !raw.contains("\0") else { delete(path); return }
            let normalized = raw.replacingOccurrences(of:"\r\n",with:"\n").replacingOccurrences(of:"\r",with:"\n")
            let display = normalized.hasPrefix("\u{FEFF}") ? String(normalized.dropFirst()) : normalized
            pages = [ext == "html" || ext == "htm" ? Self.htmlText(raw) : display]
        }
        guard let blob = try? JSONSerialization.data(withJSONObject: pages) else { return }
        delete(path)
        var s: OpaquePointer?
        guard sqlite3_prepare_v2(db, "INSERT OR REPLACE INTO docs(path,mtime,size,pages) VALUES(?,?,?,?)", -1, &s, nil) == SQLITE_OK else { return }
        sqlite3_bind_text(s,1,path,-1,transient); sqlite3_bind_double(s,2,m); sqlite3_bind_int64(s,3,size)
        blob.withUnsafeBytes { bytes in _ = sqlite3_bind_blob(s,4,bytes.baseAddress,Int32(bytes.count),transient) }
        sqlite3_step(s); sqlite3_finalize(s)
        if markdown.contains(ext) { indexReferences(pages[0], source:path) }
        if ftsAvailable {
            let indexedPath = ChineseSearchForms.shared.key(path)
            let content = indexedPath + "\n" + ChineseSearchForms.shared.key(pages.joined(separator:"\n"))
            var f: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT INTO search_fts(rowid,content) SELECT rowid,? FROM docs WHERE path=?", -1, &f, nil) == SQLITE_OK {
                sqlite3_bind_text(f,1,content,-1,transient); sqlite3_bind_text(f,2,path,-1,transient); sqlite3_step(f)
            }
            sqlite3_finalize(f)
            let nsContent = content as NSString
            var grams = Set<String>()
            Self.hanRuns.enumerateMatches(in:content,range:NSRange(content.startIndex...,in:content)) { match,_,_ in
                guard let match else { return }
                var previous: Unicode.Scalar?
                for scalar in nsContent.substring(with:match.range).unicodeScalars {
                    grams.insert(Self.hanKey([scalar]))
                    if let previous { grams.insert(Self.hanKey([previous,scalar])) }
                    previous = scalar
                }
            }
            var han: OpaquePointer?
            if !grams.isEmpty, sqlite3_prepare_v2(db,"INSERT INTO search_han(rowid,grams) SELECT rowid,? FROM docs WHERE path=?",-1,&han,nil) == SQLITE_OK {
                sqlite3_bind_text(han,1,grams.joined(separator:" "),-1,transient)
                sqlite3_bind_text(han,2,path,-1,transient); sqlite3_step(han)
            }
            sqlite3_finalize(han)
            var m: OpaquePointer?
            if sqlite3_prepare_v2(db, "INSERT INTO search_meta(rowid,name,heading,folder) SELECT rowid,?,?,? FROM docs WHERE path=?", -1, &m, nil) == SQLITE_OK {
                var headings = [String]()
                if markdown.contains(ext) {
                    let source = pages[0] as NSString
                    let headingRegex = try! NSRegularExpression(pattern:"(?m)^ {0,3}#{1,6}[\\t ].*$|^.+\\n {0,3}(?:=+|-+)[\\t ]*$")
                    headings = headingRegex.matches(in:pages[0],range:NSRange(location:0,length:source.length)).map { source.substring(with:$0.range) }
                }
                sqlite3_bind_text(m,1,(indexedPath as NSString).lastPathComponent,-1,transient)
                sqlite3_bind_text(m,2,ChineseSearchForms.shared.key(headings.joined(separator:"\n")),-1,transient)
                sqlite3_bind_text(m,3,(indexedPath as NSString).deletingLastPathComponent,-1,transient)
                sqlite3_bind_text(m,4,path,-1,transient); sqlite3_step(m)
            }
            sqlite3_finalize(m)
        }
    }
    private static func hanKey(_ scalars: [Unicode.Scalar]) -> String {
        scalars.map { String($0.value,radix:16) }.joined(separator:"x")
    }
    private func indexReferences(_ text: String, source: String) {
        let links = WSLinks.parse(text)
        guard !links.isEmpty else { return }
        let lines = text.components(separatedBy:"\n")
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db,"INSERT INTO note_refs VALUES(?,?,?,?,?,?)",-1,&stmt,nil) == SQLITE_OK else { return }
        defer { sqlite3_finalize(stmt) }
        for link in links {
            let raw = String(link.raw.prefix { $0 != "#" })
            let unescaped = raw.replacingOccurrences(of:#"\\([\\`*_{}\[\]()#+\-.!<> ])"#,with:"$1",options:.regularExpression)
            let target = unescaped.removingPercentEncoding ?? unescaped
            guard !target.isEmpty, !target.hasPrefix("/"), URLComponents(string:target)?.scheme == nil else { continue }
            let name = (target as NSString).lastPathComponent.lowercased()
            var first = link.line-1, last = first
            guard lines.indices.contains(first) else { continue }
            func boundary(_ i: Int) -> Bool {
                let line = lines[i].trimmingCharacters(in:.whitespaces)
                return line.isEmpty || line.hasPrefix("#") || line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix(">") || line.hasPrefix("|")
            }
            if !boundary(first) {
                while first > 0 && link.line-1-first < 3 && !boundary(first-1) { first -= 1 }
                while last+1 < lines.count && last-first < 6 && !boundary(last+1) { last += 1 }
            }
            let paragraph = lines[first...last].joined(separator:" ").trimmingCharacters(in:.whitespaces)
            sqlite3_reset(stmt)
            sqlite3_bind_text(stmt,1,source,-1,transient); sqlite3_bind_text(stmt,2,name,-1,transient)
            sqlite3_bind_text(stmt,3,link.raw,-1,transient); sqlite3_bind_int(stmt,4,link.wiki ? 1 : 0)
            sqlite3_bind_int64(stmt,5,Int64(link.line)); sqlite3_bind_text(stmt,6,paragraph,-1,transient); sqlite3_step(stmt)
        }
    }
    private func matchesRoot(_ expected: String) -> Bool {
        guard !expected.isEmpty else { return false }
        return root?.path == URL(fileURLWithPath:expected,isDirectory:true).resolvingSymlinksInPath().standardizedFileURL.path
    }
    func graphLinks(root expected: String, completion: @escaping (Result<[[String:Any]],Error>) -> Void) {
        queue.async {
            var statement: OpaquePointer?
            defer { sqlite3_finalize(statement) }
            guard self.matchesRoot(expected),
                  sqlite3_prepare_v2(self.db, "SELECT DISTINCT source,raw,wiki FROM note_refs", -1, &statement, nil) == SQLITE_OK else {
                completion(.failure(NSError(domain:"SimaQ.Graph",code:1,userInfo:[NSLocalizedDescriptionKey:"链接索引不可用。"])))
                return
            }
            var links = [[String:Any]]()
            var step = sqlite3_step(statement)
            while step == SQLITE_ROW {
                links.append(["path":String(cString:sqlite3_column_text(statement,0)),
                              "raw":String(cString:sqlite3_column_text(statement,1)),
                              "wiki":sqlite3_column_int(statement,2) != 0])
                step = sqlite3_step(statement)
            }
            if step == SQLITE_DONE { completion(.success(links)) }
            else { completion(.failure(NSError(domain:"SimaQ.Graph",code:Int(step),userInfo:[NSLocalizedDescriptionKey:"读取链接索引失败。"]))) }
        }
    }
    func references(names: [String], root expected: String, completion: @escaping ([[String:Any]]) -> Void) {
        queue.async {
            var rows = [[String:Any]]()
            defer { let result = rows; DispatchQueue.main.async { completion(result) } }
            guard self.matchesRoot(expected), !names.isEmpty else { return }
            var stmt: OpaquePointer?
            let slots = names.map { _ in "?" }.joined(separator:",")
            let sql = "SELECT source,raw,wiki,line,paragraph FROM note_refs WHERE name IN (\(slots)) ORDER BY source,line"
            guard sqlite3_prepare_v2(self.db,sql,-1,&stmt,nil) == SQLITE_OK else { return }
            defer { sqlite3_finalize(stmt) }
            for (i,name) in names.enumerated() { sqlite3_bind_text(stmt,Int32(i+1),name,-1,self.transient) }
            while sqlite3_step(stmt) == SQLITE_ROW {
                func string(_ i: Int32) -> String { String(cString:sqlite3_column_text(stmt,i)) }
                let path = string(0)
                if !self.excluded(path) {
                    rows.append(["path":path,"raw":string(1),"wiki":sqlite3_column_int(stmt,2) != 0,
                                 "line":Int(sqlite3_column_int(stmt,3)),"text":string(4)])
                }
            }
        }
    }
    /// A deterministic text representation, shared with search-result navigation.
    static func htmlText(_ raw: String) -> String {
        var s = raw
        for pattern in ["(?is)<(script|style|head|template|noscript)\\b[^>]*>.*?</\\1\\s*>", "(?s)<!--.*?-->"] {
            s = s.replacingOccurrences(of: pattern, with: " ", options: .regularExpression)
        }
        s = s.replacingOccurrences(of: "(?i)<(?:br|/p|/div|/li|/h[1-6]|/tr|/section|/article)\\b[^>]*>", with: "\n", options: .regularExpression)
        s = s.replacingOccurrences(of: "(?s)<[^>]*>", with: " ", options: .regularExpression)
        let re = try! NSRegularExpression(pattern: "&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);")
        let ns = s as NSString; let matches = re.matches(in: s, range: NSRange(location: 0, length: ns.length))
        for m in matches.reversed() {
            let key = ns.substring(with: m.range(at: 1)); var value: String?
            if key.hasPrefix("#x"), let n = UInt32(key.dropFirst(2), radix: 16), let scalar = UnicodeScalar(n) { value = String(scalar) }
            else if key.hasPrefix("#"), let n = UInt32(key.dropFirst()), let scalar = UnicodeScalar(n) { value = String(scalar) }
            else { value = ["amp":"&", "lt":"<", "gt":">", "quot":"\"", "apos":"'", "nbsp":" "][key] }
            if let value = value, let range = Range(m.range, in: s) { s.replaceSubrange(range, with: value) }
        }
        return s
    }
    private func find(_ payload: [String:Any], ticket: Int) -> [[String:Any]] {
        guard let q = payload["q"] as? String, !q.isEmpty, db != nil else { return [] }
        let isRegex = payload["regex"] as? Bool ?? false, exact = payload["exact"] as? Bool ?? false
        let whole = payload["wholeWord"] as? Bool ?? false, sensitive = payload["caseSensitive"] as? Bool ?? false
        let separators = try! NSRegularExpression(pattern: #"[\s_\-‐‑‒–—―−]+"#)
        let transition = try! NSRegularExpression(pattern: #"(?<=\p{Han})(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=\p{Han})"#)
        let gap = #"[\t _\-‐‑‒–—―−]"#
        let words = exact ? [q] : separators.split(q)
        let parts = words.map { exact ? [$0] : transition.split($0) }
        var pattern = ""
        if isRegex { pattern = q }
        else {
            for (i,word) in parts.enumerated() {
                if i > 0 {
                    let boundary = String(words[i-1].suffix(1)) + String(words[i].prefix(1))
                    let mixed = transition.firstMatch(in:boundary,range:NSRange(boundary.startIndex...,in:boundary)) != nil
                    pattern += gap + (mixed ? "*" : "+")
                }
                pattern += word.map(ChineseSearchForms.shared.literalPattern).joined(separator:gap + "*")
            }
        }
        guard !pattern.isEmpty else { return [] }
        if whole {
            pattern = #"(?<![\p{L}\p{N}])(?:"# + pattern + #")(?![\p{L}\p{N}])"#
        } else if !isRegex {
            // Latin words can abut Chinese prose, but “AI” must not match “aid”.
            let wordChar = #"[\p{Latin}\p{N}\p{M}]"#
            if words.first?.range(of:"^[A-Za-z0-9]",options:.regularExpression) != nil { pattern = "(?<!" + wordChar + ")" + pattern }
            if words.last?.range(of:"[A-Za-z0-9]$",options:.regularExpression) != nil { pattern += "(?!" + wordChar + ")" }
        }
        guard let regex = try? NSRegularExpression(pattern: pattern, options: sensitive ? [] : [.caseInsensitive]) else { return [] }
        let folder = (payload["folder"] as? String ?? "").trimmingCharacters(in: CharacterSet(charactersIn:"/"))
        let exts = Set((payload["extensions"] as? [String] ?? []).map { $0.lowercased().trimmingCharacters(in: CharacterSet(charactersIn:".")) })
        let document = payload["document"] as? String
        let exclude = payload["excludeArchive"] as? Bool ?? false
        let limit = max(1, min(payload["limit"] as? Int ?? 100, 1000))
        let hitLimit = max(1, payload["hitLimit"] as? Int ?? Int.max)
        let hitLimits = payload["hitLimits"] as? [String:Int] ?? [:]
        let tokens = isRegex ? [] : parts.flatMap { $0 }.map(ChineseSearchForms.shared.key)
        let token = tokens.filter { $0.unicodeScalars.count >= 3 }.max { $0.unicodeScalars.count < $1.unicodeScalars.count }
        let hanToken = tokens.first { Self.shortHan.firstMatch(in:$0,range:NSRange($0.startIndex...,in:$0)) != nil }
        let shortLiteral = token == nil && hanToken != nil
        let useFTS = ftsAvailable && !isRegex && (token != nil || shortLiteral) && document == nil
        let buffers = payload["buffers"] as? [String:String] ?? [:]
        var groups = [(Int,String,[String:Any])]()
        func included(_ path:String) -> Bool {
            guard !excluded(path) else { return false }
            if let document = document, path != document { return false }
            if !folder.isEmpty && path != folder && !path.hasPrefix(folder + "/") { return false }
            if !exts.isEmpty && !exts.contains((path as NSString).pathExtension.lowercased()) { return false }
            if exclude && path.split(separator:"/").dropLast().contains(where: { ["archive", "archives", "_archive", "_archives", "归档"].contains($0.lowercased()) }) { return false }
            return true
        }
        func match(_ path: String, pages: [String]) -> (Int,String,[String:Any])? {
            let documentHitLimit = max(1, hitLimits[path] ?? hitLimit)
            let name = (path as NSString).lastPathComponent
            var hits = [[String:Any]](); var score = 0, hitCount = 0
            func add(_ text: String, _ kind: String, _ page: Int? = nil, headings: Bool = false) {
                let ns = text as NSString
                regex.enumerateMatches(in:text, range:NSRange(location:0,length:ns.length)) { result, _, _ in
                    guard let r = result?.range, r.length > 0 else { return }
                    var actual = kind
                    if headings && (hits.count < documentHitLimit || score < 3) {
                        let line = ns.lineRange(for:r); let lineText = ns.substring(with:line)
                        let nextStart = NSMaxRange(line)
                        let nextLine = nextStart < ns.length ? ns.substring(with: ns.lineRange(for:NSRange(location:nextStart,length:0))) : ""
                        if lineText.range(of:"^ {0,3}#{1,6}\\s", options:.regularExpression) != nil || nextLine.range(of:"^ {0,3}(?:=+|-+)\\s*$", options:.regularExpression) != nil { actual = "heading" }
                    }
                    hitCount += 1
                    score = max(score, actual == "name" ? 4 : actual == "heading" ? 3 : actual == "path" ? 2 : 1)
                    guard hits.count < documentHitLimit else { return }
                    let left = max(0,r.location - 40), right = min(ns.length,r.location + r.length + 40)
                    var h: [String:Any] = ["kind":actual,"start":r.location,"length":r.length,"before":ns.substring(with:NSRange(location:left,length:r.location-left)),"match":ns.substring(with:r),"after":ns.substring(with:NSRange(location:r.location+r.length,length:right-r.location-r.length))]
                    if kind == "body" && ["htm","html"].contains((path as NSString).pathExtension.lowercased()) {
                        let needle = ns.substring(with:r)
                        var occurrence = 0, cursor = 0
                        while cursor < r.location {
                            let prior = ns.range(of:needle,options:.literal,range:NSRange(location:cursor,length:r.location-cursor))
                            if prior.location == NSNotFound { break }
                            occurrence += 1
                            cursor = NSMaxRange(prior)
                        }
                        h["occurrence"] = occurrence
                    }
                    if let page = page { h["page"] = page }
                    hits.append(h)
                }
            }
            add(name,"name")
            let parent = (path as NSString).deletingLastPathComponent
            if !parent.isEmpty { add(parent,"path") }
            let metadataHits = hits
            hits.removeAll(keepingCapacity:true)
            hitCount = 0
            let pdf = (path as NSString).pathExtension.lowercased() == "pdf"
            let md = markdown.contains((path as NSString).pathExtension.lowercased())
            for (i,text) in pages.enumerated() { add(text,"body",pdf ? i+1 : nil, headings:md) }
            let contentCount = hitCount
            if contentCount == 0 { hits = metadataHits }
            guard !hits.isEmpty else { return nil }
            return (score,path,["path":path,"name":name,"count":contentCount,"hits":hits])
        }
        for (path,text) in buffers where included(path) && editable.contains((path as NSString).pathExtension.lowercased()) {
            if let result = match(path,pages:[text]) { groups.append(result) }
        }
        var visited = Set(buffers.keys)
        let stages = useFTS ? [4,3,2,1] : [0]
        for stage in stages {
            let sql: String
            if useFTS && shortLiteral && stage == 1 {
                sql = "SELECT docs.path,docs.pages FROM search_han JOIN docs ON docs.rowid=search_han.rowid WHERE search_han MATCH ?"
            } else if useFTS && shortLiteral {
                let table = "search_meta"
                let column = [1:"content",2:"folder",3:"heading",4:"name"][stage]!
                sql = "SELECT docs.path,docs.pages FROM \(table) JOIN docs ON docs.rowid=\(table).rowid WHERE instr(\(table).\(column),?)>0"
            } else if stage == 4 || stage == 3 || stage == 2 { sql = "SELECT docs.path,docs.pages FROM search_meta JOIN docs ON docs.rowid=search_meta.rowid WHERE search_meta MATCH ?" }
            else if stage == 1 { sql = "SELECT docs.path,docs.pages FROM search_fts JOIN docs ON docs.rowid=search_fts.rowid WHERE search_fts MATCH ?" }
            else { sql = document != nil ? "SELECT path,pages FROM docs WHERE path=?" : "SELECT path,pages FROM docs" }
            var stmt: OpaquePointer?; guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
            defer { sqlite3_finalize(stmt) }
            if useFTS && shortLiteral, let hanToken { sqlite3_bind_text(stmt,1,stage == 1 ? Self.hanKey(Array(hanToken.unicodeScalars)) : hanToken,-1,transient) }
            else if useFTS, let token = token {
                let phrase = "\"" + token.replacingOccurrences(of:"\"",with:"\"\"") + "\""
                let column = stage == 4 ? "name : " : stage == 3 ? "heading : " : stage == 2 ? "folder : " : ""
                sqlite3_bind_text(stmt,1,column + phrase,-1,transient)
            } else if let document = document { sqlite3_bind_text(stmt,1,document,-1,transient) }
            var filled = groups.filter { $0.0 >= stage }.count
            while (stage == 0 || filled < limit) && sqlite3_step(stmt) == SQLITE_ROW {
                if !current(ticket) { return [] }
                guard let p = sqlite3_column_text(stmt,0) else { continue }; let path = String(cString:p)
                guard included(path) else { continue }
                guard visited.insert(path).inserted, let bytes = sqlite3_column_blob(stmt,1) else { continue }
                let data = Data(bytes:bytes,count:Int(sqlite3_column_bytes(stmt,1)))
                guard let pages = (try? JSONSerialization.jsonObject(with:data)) as? [String],
                      let result = match(path,pages:pages) else { continue }
                groups.append(result)
                if result.0 >= stage { filled += 1 }
            }
            if stage != 0 && filled >= limit { break }
        }
        groups.sort { $0.0 != $1.0 ? $0.0 > $1.0 : $0.1.localizedStandardCompare($1.1) == .orderedAscending }
        return groups.prefix(limit).map { $0.2 }
    }
}

/// The index uses one scalar per group. The matcher uses the whole group on
/// the original text so even variants with different UTF-16 widths locate correctly.
private struct ChineseSearchForms {
    static let shared = ChineseSearchForms()
    private let representatives: [Unicode.Scalar:Unicode.Scalar]
    private let alternatives: [Unicode.Scalar:String]

    private init() {
        let ideographs = (0...0x10ffff).compactMap(Unicode.Scalar.init).filter { $0.properties.isIdeographic }
        var parents = [Unicode.Scalar:Unicode.Scalar]()
        func representative(_ scalar: Unicode.Scalar) -> Unicode.Scalar {
            var root = scalar
            while let parent = parents[root] { root = parent }
            return root
        }
        // Use the system's ICU character mappings. Separating characters prevents
        // phrase transliteration from changing how a substring is indexed.
        let transform = StringTransform("Traditional-Simplified")
        for start in stride(from: 0, to: ideographs.count, by: 4096) {
            let batch = ideographs[start..<min(start + 4096, ideographs.count)]
            let input = batch.map(String.init).joined(separator:"\n")
            guard let converted = input.applyingTransform(transform, reverse:false) else { continue }
            for (source, form) in zip(batch, converted.split(separator:"\n", omittingEmptySubsequences:false)) {
                guard form.unicodeScalars.count == 1, let target = form.unicodeScalars.first,
                      target != source else { continue }
                // A few system mappings are reciprocal. Merge both sets once.
                let a = representative(source), b = representative(target)
                if a != b { parents[a] = b }
            }
        }
        var keys = [Unicode.Scalar:Unicode.Scalar]()
        var groups = [Unicode.Scalar:String]()
        for variant in parents.keys {
            let key = representative(variant)
            keys[variant] = key
            groups[key, default:String(key)].unicodeScalars.append(variant)
        }
        representatives = keys
        alternatives = groups
    }

    func key(_ text: String) -> String {
        let scalars = text.unicodeScalars
        guard let first = scalars.firstIndex(where: { !$0.isASCII && representatives[$0] != nil }) else { return text }
        var result = String(scalars[..<first])
        for scalar in scalars[first...] { result.unicodeScalars.append(representatives[scalar] ?? scalar) }
        return result
    }

    func literalPattern(_ text: String) -> String {
        var result = "", literal = ""
        for scalar in text.unicodeScalars {
            if let group = alternatives[representatives[scalar] ?? scalar] {
                result += NSRegularExpression.escapedPattern(for:literal) + "[" + group + "]"
                literal = ""
            } else {
                literal.unicodeScalars.append(scalar)
            }
        }
        return result + NSRegularExpression.escapedPattern(for:literal)
    }
}

private extension NSRegularExpression {
    func split(_ text: String) -> [String] {
        let ns = text as NSString; let matches = self.matches(in:text, range:NSRange(location:0,length:ns.length)); var start = 0; var parts = [String]()
        for match in matches { if match.range.location > start { parts.append(ns.substring(with:NSRange(location:start,length:match.range.location-start))) }; start = NSMaxRange(match.range) }
        if start < ns.length { parts.append(ns.substring(from:start)) }; return parts
    }
}
