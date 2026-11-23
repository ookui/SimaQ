import AppKit
import CoreServices
import CryptoKit
import Foundation

private typealias WSRow = [String: Any]
private let wsFM = FileManager.default
private let wsMarkdown = Set(["md", "markdown", "mdown", "mkd"])
private func wsError(_ message: String) -> NSError { NSError(domain: "SimaQ.Workspace", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
private func wsHash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func wsHash(_ s: String) -> String { wsHash(Data(s.utf8)) }
private func wsDir(_ path: String) -> String { (path as NSString).deletingLastPathComponent }
private func wsName(_ path: String) -> String { (path as NSString).lastPathComponent }
private func wsExt(_ path: String) -> String { (path as NSString).pathExtension.lowercased() }
private func wsStem(_ path: String) -> String { (wsName(path) as NSString).deletingPathExtension }
private func wsJoin(_ a: String, _ b: String) -> String { a.isEmpty ? b : a + "/" + b }
private func wsUnder(_ path: String, _ folder: String) -> Bool { path == folder || path.hasPrefix(folder + "/") }
private func wsRelative(_ target: String, from source: String) -> String {
    var a = wsDir(source).split(separator: "/")[...], b = target.split(separator: "/")[...]
    while let first = a.first, first == b.first { a = a.dropFirst(); b = b.dropFirst() }
    return (Array(repeating: "..", count: a.count) + b.map(String.init)).joined(separator: "/")
}
private func wsEncode(_ path: String) -> String {
    var result = ""
    for c in path {
        if c.isWhitespace || "%#?()<>[]|\\\"".contains(c) || c.asciiValue.map({ $0 < 32 }) == true {
            result += String(c).utf8.map { String(format: "%%%02X", $0) }.joined()
        } else { result.append(c) }
    }
    return result
}
private func wsNormalize(_ raw: String) -> String? {
    var parts: [Substring] = []
    for component in raw.split(separator: "/") {
        if component == "." { continue }
        if component == ".." { if parts.isEmpty { return nil }; parts.removeLast() }
        else { parts.append(component) }
    }
    return parts.joined(separator: "/")
}

// Keep the byte representation separate from the editor's LF-normalized document.
private struct WSText {
    let bytes: Data, text: String, encoding: String.Encoding, bom: Data
    let endings: [String]
    init(_ data: Data) throws {
        bytes = data
        let marks: [([UInt8], String.Encoding)] = [([0xff,0xfe,0,0], .utf32LittleEndian), ([0,0,0xfe,0xff], .utf32BigEndian), ([0xef,0xbb,0xbf], .utf8), ([0xff,0xfe], .utf16LittleEndian), ([0xfe,0xff], .utf16BigEndian)]
        let selected = marks.first { data.starts(with: $0.0) }
        encoding = selected?.1 ?? .utf8
        bom = Data(selected?.0 ?? [])
        guard let raw = String(data: data.dropFirst(bom.count), encoding: encoding), !raw.contains("\0") else { throw wsError("文件编码无法安全识别。支持 UTF-8 及带 BOM 的 UTF-16、UTF-32。") }
        var lines: [String] = [], separators: [String] = [], start = raw.startIndex
        for index in raw.indices where raw[index] == "\n" || raw[index] == "\r" || raw[index] == "\r\n" {
            lines.append(String(raw[start..<index])); separators.append(String(raw[index])); start = raw.index(after: index)
        }
        lines.append(String(raw[start...])); text = lines.joined(separator: "\n"); endings = separators
    }
    func encoded(_ next: String) throws -> Data {
        let normalized = next.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        if normalized.utf8.elementsEqual(text.utf8) { return bytes }
        let old = text.components(separatedBy: "\n"), new = normalized.components(separatedBy: "\n")
        var lead = 0, tail = 0
        while lead < min(old.count, new.count), old[lead].utf8.elementsEqual(new[lead].utf8) { lead += 1 }
        while tail < min(old.count, new.count) - lead, old[old.count-1-tail].utf8.elementsEqual(new[new.count-1-tail].utf8) { tail += 1 }
        let preferred = endings.first ?? "\n"
        let oldMiddle = old[lead..<(old.count-tail)], newMiddle = new[lead..<(new.count-tail)]
        var preserved: [Int:Int] = [:]
        // Match unchanged interior lines when several edits shift different portions of a mixed-EOL file.
        if oldMiddle.count != newMiddle.count && !oldMiddle.isEmpty && !newMiddle.isEmpty {
            let diff = newMiddle.difference(from:oldMiddle), removed = Set(diff.removals.map { change -> Int in
                if case let .remove(i,_,_) = change { return i }; return -1
            }), inserted = Set(diff.insertions.map { change -> Int in
                if case let .insert(i,_,_) = change { return i }; return -1
            })
            var oldIndex = 0
            for newIndex in 0..<newMiddle.count where !inserted.contains(newIndex) {
                while removed.contains(oldIndex) { oldIndex += 1 }; preserved[lead+newIndex] = lead+oldIndex; oldIndex += 1
            }
        }
        var output = ""
        for (i, line) in new.enumerated() {
            output += line
            guard i + 1 < new.count else { break }
            let prior = i < lead ? i : i >= new.count-tail ? old.count-(new.count-i) : min(i, max(lead, old.count-tail-1))
            let corresponding = preserved[i] ?? prior
            output += endings.indices.contains(corresponding) ? endings[corresponding] : preferred
        }
        guard let body = output.data(using: encoding) else { throw wsError("当前编码无法保存所输入的字符。") }
        return bom + body
    }
}

private extension WSLink {
    func id(_ file: String) -> String { wsHash("\(file)\u{0}\(range.location)\u{0}\(raw)") }
}

private final class WSWatchOwner { weak var workspace: Workspace?; init(_ owner: Workspace) { workspace = owner } }
private struct WSEntry { let path: String, dir: Bool }
private struct WSDocument { let data: Data, text: WSText, links: [WSLink], version: String }
private struct WSResolution { var paths: [String] = [], fragment = "", external = false }

final class Workspace {
    private let lock = NSRecursiveLock()
    private var directory: URL?, stream: FSEventStreamRef?
    private var fallbackWatch: DispatchSourceTimer?
    private var watchGeneration = UUID()
    private let stateHome: URL
    private var previousIdentityPaths: [Data:String] = [:]
    private var observedRenames: [String:String] = [:]
    private var titleCache: [String: (Date?, Int?, String)] = [:]
    private var journalCache: [String:(Date?,Int?,WSRow)] = [:]
    private var selectedJournalFolder: String?
    var configuredJournalFolder: String? {
        lock.lock(); defer { lock.unlock() }; return selectedJournalFolder
    }
    private var hiddenFolders = Set<String>()
    var excludedFolders: [String] {
        lock.lock(); defer { lock.unlock() }; return hiddenFolders.sorted()
    }
    func setExcludedFolders(_ paths: [String], forRoot expected: String) throws {
        lock.lock(); defer { lock.unlock() }
        guard try base().path == expected else { throw wsError("工作区已切换，请重新打开设置。") }
        for path in paths { _ = try fileURL(path) }
        let next = Set(paths)
        try JSONEncoder().encode(next.sorted()).write(to:stateDirectory().appendingPathComponent("excluded.json"),options:.atomic)
        hiddenFolders = next
    }
    var onChanges: (([String]) -> Void)?
    var root: URL? { lock.lock(); defer { lock.unlock() }; return directory }
    init(stateHome: URL? = nil) {
        self.stateHome = stateHome ?? wsFM.urls(for:.applicationSupportDirectory, in:.userDomainMask)[0].appendingPathComponent("SimaQ/Workspaces")
    }
    deinit { stopWatching() }
    private func stopWatching() {
        watchGeneration = UUID(); fallbackWatch?.cancel(); fallbackWatch = nil
        if let s = stream { FSEventStreamStop(s); FSEventStreamInvalidate(s); FSEventStreamRelease(s); stream = nil }
    }
    func open(_ url: URL) throws {
        lock.lock(); defer { lock.unlock() }
        let resolved: URL
        if let canonical = realpath(url.path, nil) { resolved = URL(fileURLWithPath:String(cString:canonical),isDirectory:true); free(canonical) }
        else { resolved = url.standardizedFileURL.resolvingSymlinksInPath() }
        guard try resolved.resourceValues(forKeys:[.isDirectoryKey]).isDirectory == true else { throw wsError("请选择目录。") }
        stopWatching(); directory = resolved; journalCache.removeAll(); titleCache.removeAll(); previousIdentityPaths.removeAll(); observedRenames.removeAll()
        let rules = try stateDirectory().appendingPathComponent("excluded.json")
        hiddenFolders = wsFM.fileExists(atPath:rules.path) ? Set(try JSONDecoder().decode([String].self,from:Data(contentsOf:rules))) : ["_Meta"]
        let preference = try stateDirectory().appendingPathComponent("journal-folder.json")
        selectedJournalFolder = wsFM.fileExists(atPath:preference.path)
            ? try JSONDecoder().decode(String.self,from:Data(contentsOf:preference)) : nil
        try restoreInterruptedMove()
        let box = WSWatchOwner(self)
        var ctx = FSEventStreamContext(version:0, info: Unmanaged.passUnretained(box).toOpaque(), retain: { p in
            _ = Unmanaged<WSWatchOwner>.fromOpaque(p!).retain(); return p
        }, release: { p in Unmanaged<WSWatchOwner>.fromOpaque(p!).release() }, copyDescription:nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagNoDefer | kFSEventStreamCreateFlagWatchRoot)
        stream = FSEventStreamCreate(nil, { _, opaque, count, paths, flags, _ in
            guard let opaque, let owner = Unmanaged<WSWatchOwner>.fromOpaque(opaque).takeUnretainedValue().workspace, let base = owner.root?.path else { return }
            let pointers = paths.assumingMemoryBound(to: UnsafePointer<CChar>.self)
            var changed = Set<String>()
            for i in 0..<count {
                let full = String(cString:pointers[i]); let prefix = base == "/" ? "/" : base + "/"
                if flags[i] & UInt32(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagRootChanged) != 0 || full == base { changed.insert("") }
                else if full.hasPrefix(prefix) {
                    let path = String(full.dropFirst(prefix.count)); if !path.split(separator:"/").contains(where:{ $0.hasPrefix(".") }) { changed.insert(path) }
                }
            }
            if !changed.isEmpty { owner.onChanges?(changed.sorted()) }
        }, &ctx, [resolved.path] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.15, flags)
        if let s = stream {
            FSEventStreamSetDispatchQueue(s, .main)
            if FSEventStreamStart(s) { return }
            FSEventStreamInvalidate(s); FSEventStreamRelease(s); stream = nil
        }
        // FSEvents can be unavailable for sandboxed processes and some network mounts.
        // Sample off the main queue and deliver only changed paths to the same handler.
        startPolling(resolved)
    }
    private func startPolling(_ base: URL) {
        let queue = DispatchQueue(label:"SimaQ.workspace.changeSnapshot",qos:.utility)
        let generation = watchGeneration, prefix = base.path == "/" ? "/" : base.path + "/"
        let keys: [URLResourceKey] = [.contentModificationDateKey,.fileSizeKey,.isSymbolicLinkKey]
        struct Stamp: Equatable { let date: Date?, size: Int? }
        func snapshot() -> [String:Stamp] {
            var result: [String:Stamp] = [:]
            if let it = wsFM.enumerator(at:base,includingPropertiesForKeys:keys,options:[.skipsHiddenFiles,.skipsPackageDescendants]) {
                for case let url as URL in it {
                    guard let a = try? url.resourceValues(forKeys:Set(keys)), a.isSymbolicLink != true else { it.skipDescendants(); continue }
                    result[String(url.path.dropFirst(prefix.count))] = Stamp(date:a.contentModificationDate,size:a.fileSize)
                }
            }; return result
        }
        var previous: [String:Stamp] = [:], ready = false
        let timer = DispatchSource.makeTimerSource(queue:queue); fallbackWatch = timer
        timer.schedule(deadline:.now(),repeating:.seconds(1),leeway:.milliseconds(100))
        timer.setEventHandler { [weak self] in
            let current = snapshot(), changed = ready ? Set(previous.keys).union(current.keys).filter{previous[$0] != current[$0]} : Set<String>()
            previous = current; ready = true
            if !changed.isEmpty { DispatchQueue.main.async { [weak self] in
                guard let self, self.watchGeneration == generation else { return }; self.onChanges?(changed.sorted())
            } }
        }; timer.resume()
    }
    private func base() throws -> URL { guard let directory else { throw wsError("请先打开资料库。") }; return directory }
    func fileURL(_ path: String) throws -> URL {
        lock.lock(); defer { lock.unlock() }; var url = try base()
        let components = path.split(separator:"/", omittingEmptySubsequences:false)
        guard !path.isEmpty, !path.contains("\0"), !components.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { throw wsError("需要库内相对路径。") }
        for component in components {
            url.appendPathComponent(String(component)); var statInfo = stat()
            if lstat(url.path, &statInfo) == 0, statInfo.st_mode & S_IFMT == S_IFLNK { throw wsError("此路径经过符号链接：\(path)") }
        }
        return url
    }
    private func entries(visibleOnly: Bool = false) throws -> [WSEntry] {
        let base = try self.base(), keys: [URLResourceKey] = [.isDirectoryKey,.isSymbolicLinkKey,.isRegularFileKey,.fileResourceIdentifierKey]
        guard let it = wsFM.enumerator(at:base,includingPropertiesForKeys:keys,options:[.skipsHiddenFiles,.skipsPackageDescendants]) else { throw wsError("无法读取资料库目录。") }
        var result: [WSEntry] = [], identities: [Data:String] = [:], duplicates = Set<Data>()
        let prefix = base.path == "/" ? "/" : base.path + "/"
        for case let u as URL in it {
            guard let values = try? u.resourceValues(forKeys:Set(keys)), values.isSymbolicLink != true, values.isDirectory == true || values.isRegularFile == true else { it.skipDescendants(); continue }
            let p = String(u.path.dropFirst(prefix.count))
            if visibleOnly && values.isDirectory == true && hiddenFolders.contains(p) { it.skipDescendants(); continue }
            result.append(WSEntry(path:p,dir:values.isDirectory == true))
            if let id = values.fileResourceIdentifier as? Data, values.isRegularFile == true {
                if identities[id] != nil { duplicates.insert(id) }; identities[id] = p
            }
        }
        if visibleOnly { return result }
        for id in duplicates { identities.removeValue(forKey:id) }
        for (id,new) in identities {
            if let old = previousIdentityPaths[id], old != new {
                for (original, prior) in observedRenames where prior == old { observedRenames[original] = new }; observedRenames[old] = new
            }
        }; previousIdentityPaths = identities; return result
    }
    private func tree() throws -> [WSRow] {
        let byParent = Dictionary(grouping:try entries(visibleOnly:true),by:{wsDir($0.path)})
        func rows(_ parent: String) -> [WSRow] { (byParent[parent] ?? []).sorted { a,b in a.dir == b.dir ? a.path.localizedStandardCompare(b.path) == .orderedAscending : a.dir }.map { e in
            var r: WSRow = ["path":e.path,"name":wsName(e.path),"dir":e.dir]; if e.dir { r["children"] = rows(e.path) }; return r
        } }; return rows("")
    }
    private func title(_ p: String) -> String {
        let fallback = wsStem(p)
        guard wsMarkdown.contains(wsExt(p)) || ["html","htm"].contains(wsExt(p)), let url = try? fileURL(p), let attrs = try? url.resourceValues(forKeys:[.contentModificationDateKey,.fileSizeKey]) else { return fallback }
        let stamp = attrs.contentModificationDate, size = attrs.fileSize
        if let cached = titleCache[p], cached.0 == stamp, cached.1 == size { return cached.2 }
        var value = fallback
        if let h = try? FileHandle(forReadingFrom:url) {
            defer { try? h.close() }
            if let data = try? h.read(upToCount:16384) {
                let str = String(decoding:data,as:UTF8.self), html = ["html","htm"].contains(wsExt(p))
                let pattern = html ? #"(?is)<title\b[^>]*>\s*(.*?)\s*</title>"# : #"(?m)^ {0,3}#(?:\s+)([^\n]+)"#
                if let m = try? NSRegularExpression(pattern:pattern).firstMatch(in:str,range:NSRange(str.startIndex...,in:str)), let range = Range(m.range(at:1),in:str) { value = String(str[range]).trimmingCharacters(in:.whitespacesAndNewlines) }
            }
        }; titleCache[p] = (stamp,size,value); return value
    }
    private func stateDirectory() throws -> URL {
        let url = stateHome.appendingPathComponent(wsHash(try base().path),isDirectory:true); try wsFM.createDirectory(at:url,withIntermediateDirectories:true); return url
    }
    private func draftURL(_ path: String) throws -> URL { try stateDirectory().appendingPathComponent(wsHash(path)+".draft") }
    private func coordinated<T>(_ url: URL, _ body: (URL) throws -> T) throws -> T {
        var error: NSError?, result: Result<T, Error>?
        NSFileCoordinator(filePresenter:nil).coordinate(writingItemAt:url,options:[],error:&error) { approved in result = Result { try body(approved) } }
        if let error {
            // Local file coordination may be unavailable when filecoordinationd is sandboxed.
            if result == nil && error.domain == NSCocoaErrorDomain && error.code == NSFileWriteUnknownError { return try body(url) }; throw error
        }; guard let result else { throw wsError("文件协调失败。") }; return try result.get()
    }
    private func document(_ path: String) throws -> WSDocument {
        let bytes = try Data(contentsOf:fileURL(path)), t = try WSText(bytes)
        return WSDocument(data:bytes,text:t,links:WSLinks.parse(t.text),version:wsHash(bytes))
    }
    private func save(_ path: String, text: String, version: String) throws -> WSRow {
        let file = try fileURL(path)
        return try coordinated(file) { url in
            guard wsFM.fileExists(atPath:url.path) else { return ["conflict":true,"deleted":true,"text":"","version":""] }
            let bytes = try Data(contentsOf:url), current = wsHash(bytes), doc = try WSText(bytes)
            guard current == version else { return ["conflict":true,"text":doc.text,"version":current] }
            let result = try doc.encoded(text); if bytes != result { try result.write(to:url,options:.atomic) }; return ["path":path,"version":wsHash(result)]
        }
    }
    private func resolve(_ raw: String, wiki: Bool, from source: String, files: Set<String>, lookup: ((String) -> [String])? = nil) -> WSResolution {
        let trimmed = raw.trimmingCharacters(in:.whitespacesAndNewlines)
        let parts = trimmed.split(separator:"#",maxSplits:1,omittingEmptySubsequences:false)
        let fragment = parts.count > 1 ? String(parts[1]) : ""
        let escaped = String(parts.first ?? "").replacingOccurrences(of:#"\\([\\`*_{}\[\]()#+\-.!<> ])"#,with:"$1",options:.regularExpression)
        let path = escaped.removingPercentEncoding ?? escaped
        if path.hasPrefix("/") || path.hasPrefix("//") || path.range(of:#"^[a-zA-Z][a-zA-Z0-9+.\-]*:"#,options:.regularExpression) != nil { return WSResolution(paths:[],fragment:fragment,external:true) }
        if path.isEmpty { return WSResolution(paths:[source],fragment:fragment) }
        var candidates: [String] = []
        let local = wsNormalize(wsJoin(wsDir(source),path)), rootPath = wsNormalize(path)
        func existing(_ p: String?) -> String? { guard let p else { return nil }; if files.contains(p) { return p }; if wiki, wsExt(p).isEmpty, files.contains(p+".md") { return p+".md" }; return nil }
        if let hit = existing(local) { candidates = [hit] }
        else if wiki {
            if path.contains("/"), let exact = existing(rootPath) { candidates = [exact] }
            else if !path.contains("/") {
                if let lookup { return WSResolution(paths:lookup(path),fragment:fragment) }
                candidates = files.filter { wsName($0).caseInsensitiveCompare(path) == .orderedSame || (wsMarkdown.contains(wsExt($0)) && wsStem($0).caseInsensitiveCompare(path) == .orderedSame) }.sorted()
                if candidates.isEmpty { candidates = files.filter { wsMarkdown.contains(wsExt($0)) && title($0).caseInsensitiveCompare(path) == .orderedSame }.sorted() }
            }
        }; return WSResolution(paths:candidates,fragment:fragment)
    }
    private func workspaceGraph(_ args: WSRow) throws -> WSRow {
        guard args["root"] as? String == directory?.path else { throw wsError("工作区已切换。") }
        let files = Set(try entries().filter { !$0.dir }.map(\.path))
        let folder = args["journalFolder"] as? String
        let hideJournals = args["includeJournals"] as? Bool != true
        let imageExtensions = Set(files.map(wsExt)).filter(AssetHandler.isImageExtension)
        let paths = files.filter { path in
            if imageExtensions.contains(wsExt(path)) { return false }
            if hiddenFolders.contains(where:{ wsUnder(path,$0) }) { return false }
            if hideJournals, let folder, folder.isEmpty || wsUnder(path,folder), isJournalNote(path) { return false }
            return true
        }.sorted()
        let positions = Dictionary(uniqueKeysWithValues:paths.enumerated().map { ($0.element,$0.offset) })
        // Resolve against the workspace before filtering endpoints. Hiding a folder
        // must never redirect an ambiguous wiki link to another file.
        var names = [String:[String]](), titles: [String:[String]]?
        for path in files {
            names[wsName(path).lowercased(),default:[]].append(path)
            if wsMarkdown.contains(wsExt(path)) { names[wsStem(path).lowercased(),default:[]].append(path) }
        }
        func lookup(_ value: String) -> [String] {
            let key = value.lowercased()
            if let hits = names[key] { return hits }
            if titles == nil {
                titles = Dictionary(grouping:files.filter { wsMarkdown.contains(wsExt($0)) },by:{ title($0).lowercased() })
            }
            return titles?[key] ?? []
        }
        var edges = [Int:Set<Int>]()
        let buffers = args["buffers"] as? [String:String] ?? [:]
        var links = (args["links"] as? [WSRow] ?? []).filter { buffers[$0["path"] as? String ?? ""] == nil }
        for (path,text) in buffers where positions[path] != nil {
            links += WSLinks.parse(text).map { ["path":path,"raw":$0.raw,"wiki":$0.wiki] }
        }
        for link in links {
            guard let source = link["path"] as? String, let from = positions[source], let raw = link["raw"] as? String else { continue }
            let found = resolve(raw,wiki:link["wiki"] as? Bool ?? false,from:source,files:files,lookup:lookup)
            if found.paths.count == 1, let to = positions[found.paths[0]], from != to { edges[from,default:[]].insert(to) }
        }
        return ["nodes":paths.map { ["path":$0,"title":title($0)] },
                "edges":edges.keys.sorted().flatMap { from in edges[from]!.sorted().map { [from,$0] } }]
    }
    private func isJournalNote(_ path: String) -> Bool {
        wsMarkdown.contains(wsExt(path)) && !["readme","index","_template","template"].contains(wsStem(path).lowercased())
    }
    private func reformat(_ l: WSLink, target: String, from source: String, files: Set<String>) -> String {
        let parts = l.raw.split(separator:"#",maxSplits:1,omittingEmptySubsequences:false), anchor = parts.count > 1 ? "#" + String(parts[1]) : ""
        var value = wsRelative(target,from:source)
        if l.wiki {
            if wsMarkdown.contains(wsExt(target)), wsExt(String(parts.first ?? "")).isEmpty { value = (value as NSString).deletingPathExtension }
            let short = wsName(value)
            if !String(parts.first ?? "").contains("/"), resolve(short,wiki:true,from:source,files:files).paths == [target] { value = short }
            return value + anchor
        }
        return wsEncode(value) + anchor
    }
    private func candidates(for link: WSLink, from path: String, files: Set<String>) -> [String] {
        let target = String(link.raw.split(separator:"#").first ?? "").removingPercentEncoding ?? link.raw
        let name = wsName(target).lowercased(), stem = wsStem(target).lowercased(), ext = wsExt(target)
        let words = Set(stem.lowercased().map(String.init)), parent = wsDir(path)
        let scores: [(String, Double)] = files.compactMap { p in
            guard p != path, ext.isEmpty || wsExt(p) == ext else { return nil }
            let other = wsStem(p).lowercased(), chars = Set(other.map(String.init))
            var score = Double(words.intersection(chars).count)/Double(max(1,words.union(chars).count))
            if other.contains(stem) || stem.contains(other) { score += 1 }; if wsName(p).lowercased() == name { score += 5 }; if wsDir(p) == parent { score += 0.25 }; return (p,score)
        }
        let local = wsNormalize(wsJoin(wsDir(path),target))
        let remembered = local.flatMap { observedRenames[$0] } ?? (link.wiki ? observedRenames.first(where:{ wsStem($0.key) == target })?.value : nil)
        var ranked = scores.sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }.map(\.0)
        if let remembered, files.contains(remembered) { ranked.removeAll { $0 == remembered }; ranked.insert(remembered,at:0) }
        return Array(ranked.prefix(10))
    }
    private func journalDirectory(_ folder: String) throws -> URL {
        let dir = folder.isEmpty ? try base() : try fileURL(folder)
        guard !hiddenFolders.contains(where:{ wsUnder(folder,$0) }),
              try dir.resourceValues(forKeys:[.isDirectoryKey]).isDirectory == true else {
            throw wsError("请选择当前工作区中的可见目录。")
        }
        return dir
    }
    private func checkedJournalDirectory(_ folder: String) throws -> URL {
        let dir = try journalDirectory(folder)
        let matches = selectedJournalFolder.map { $0 == folder }
            ?? (dir.pathComponents.suffix(2).map { $0.lowercased() } == ["lifeos","journals"])
        guard matches else { throw wsError("日记目录已更改，请重新打开日历。") }
        return dir
    }
    private func journalRows(_ folder: String) throws -> [WSRow] {
        let base = try self.base(), dir = try checkedJournalDirectory(folder)
        let keys: Set<URLResourceKey> = [.isDirectoryKey,.isRegularFileKey,.isSymbolicLinkKey,.contentModificationDateKey,.fileSizeKey]
        guard let urls = wsFM.enumerator(at:dir,includingPropertiesForKeys:Array(keys),options:[.skipsHiddenFiles,.skipsPackageDescendants]) else { throw wsError("无法读取日记目录。") }
        var rows: [WSRow] = []
        for case let url as URL in urls {
            let attrs = try url.resourceValues(forKeys:keys)
            let path = String(url.path.dropFirst(base.path == "/" ? 1 : base.path.count + 1))
            if attrs.isSymbolicLink == true || hiddenFolders.contains(path) { urls.skipDescendants(); continue }
            guard attrs.isRegularFile == true, isJournalNote(path) else { continue }
            if let item = journalCache[path], item.0 == attrs.contentModificationDate, item.1 == attrs.fileSize { rows.append(item.2); continue }
            let data = try Data(contentsOf:fileURL(path))
            let note = try? NoteMetadata(WSText(data).text)
            let date = note.flatMap { NoteMetadata.date(in:$0.scalar("date")) } ?? NoteMetadata.date(in:wsStem(path)) ?? ""
            let heading = note?.body.split(separator:"\n").first { $0.hasPrefix("# ") }?.dropFirst(2)
            let row: WSRow = ["path":path,"date":date,"title":heading.map(String.init) ?? wsStem(path)]
            journalCache[path] = (attrs.contentModificationDate,attrs.fileSize,row)
            rows.append(row)
        }
        return rows.sorted {
            let left = $0["date"] as! String, right = $1["date"] as! String
            return left == right ? ($0["path"] as! String) < ($1["path"] as! String) : left > right
        }
    }

    private func openJournal(_ args: WSRow) throws -> WSRow {
        guard let folder = args["folder"] as? String, let day = args["day"] as? String,
              NoteMetadata.date(in:day) == day, args["root"] as? String == directory?.path else { throw wsError("工作区或日期已改变。") }
        let matches = try journalRows(folder).filter { $0["date"] as? String == day }
        let path = wsJoin(folder,day + ".md")
        if let existing = matches.first(where:{ $0["path"] as? String == path }) ?? matches.first { return existing }
        // Resolve a proposed name only. Browsing a calendar day never reserves a file.
        for number in 1...10000 {
            let candidate = number == 1 ? path : wsJoin(folder,"\(day)-\(number).md")
            if !wsFM.fileExists(atPath:try fileURL(candidate).path) {
                return ["path":candidate,"date":day,"text":NoteMetadata.daily(day),"pending":true]
            }
        }
        throw wsError("日记目录中存在过多同名文件。")
    }

    private func createJournal(_ args: WSRow) throws -> WSRow {
        guard args["root"] as? String == directory?.path, let day = args["day"] as? String,
              NoteMetadata.date(in:day) == day, let path = args["path"] as? String, let text = args["text"] as? String else {
            throw wsError("工作区或日期已改变。")
        }
        let url = try fileURL(path)
        _ = try checkedJournalDirectory(wsDir(path))
        guard wsName(path).range(of:"^" + day + #"(-[0-9]+)?\.md$"#, options:.regularExpression) != nil else {
            throw wsError("日记路径无效。")
        }
        let meaningful = text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !meaningful.isEmpty, meaningful != NoteMetadata.daily(day).trimmingCharacters(in:.whitespacesAndNewlines) else {
            throw wsError("日记尚无编辑内容。")
        }
        let bytes = Data(text.utf8)
        do {
            try bytes.write(to:url,options:.withoutOverwriting)
            return ["path":path,"version":wsHash(bytes)]
        } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileWriteFileExistsError {
            let disk = try document(path)
            return ["conflict":true,"text":disk.text.text,"version":disk.version]
        }
    }

    private func schema(for folder: String, files: Set<String>) throws -> DirectorySchema? {
        for name in ["_template.md","template.md"] {
            let path = wsJoin(folder,name)
            if files.contains(path) {
                let template = try NoteMetadata(document(path).text.text)
                return DirectorySchema(keys:template.keys,defaults:template.fields)
            }
        }
        let root = try base()
        if var known = DirectorySchema.forFolder(root.appendingPathComponent(folder).path) {
            let templates = ["research":known.keys.contains("ticker") ? "source-company" : "source-industry",
                             "macro":"source-macro","log":"log","meta":"meta"]
            let name = templates[known.kind] ?? (known.keys.contains("reviewed") ? "thesis" : known.keys == ["id","updated"] ? "mechanism" : nil)
            if let name {
                let path = "_Meta/templates/" + name + ".md"
                if files.contains(path) {
                    let template = try NoteMetadata(document(path).text.text)
                    known.keys = template.keys
                    known.defaults = template.fields
                }
            }
            return known
        }
        // Outside the named LakeHouse folders use a consistent sibling field set.
        var example: [String]?
        for path in files.sorted() where wsDir(path) == folder && wsMarkdown.contains(wsExt(path)) && !["readme","index"].contains(wsStem(path).lowercased()) {
            guard let note = try? NoteMetadata(document(path).text.text), !note.keys.isEmpty else { return nil }
            if let example, Set(example) != Set(note.keys) { return nil }
            example = note.keys
        }
        return example.map { DirectorySchema(keys:$0) }
    }

    private func move(_ path: String, _ to: String, args: WSRow) throws -> WSRow {
        guard path != to, !wsUnder(to,path) else { throw wsError("目标与原路径相同或位于其内部。") }
        let source = try fileURL(path), dest = try fileURL(to)
        guard wsFM.fileExists(atPath:source.path), !wsFM.fileExists(atPath:dest.path) else { throw wsError("原路径不存在，或目标名称已被使用。") }
        var isDir: ObjCBool = false
        guard wsFM.fileExists(atPath:dest.deletingLastPathComponent().path,isDirectory:&isDir), isDir.boolValue else { throw wsError("目标目录不存在。") }
        let files = Set(try entries().filter{!$0.dir}.map(\.path)), choices = args["choices"] as? [String:String] ?? [:], update = args["updateLinks"] as? Bool ?? true
        func mapped(_ p: String) -> String { wsUnder(p,path) ? to + String(p.dropFirst(path.count)) : p }
        let nextFiles = Set(files.map(mapped)); var changes: [WSRow] = [], ambiguous: [WSRow] = [], writes: [WSRow] = [], fingerprint: [String] = [path,to]
        var metadata: [WSRow] = []
        // A folder move keeps its internal structure. Convert individual notes moved between folders.
        let convert = files.contains(path) && wsMarkdown.contains(wsExt(path)) && wsDir(path) != wsDir(to)
        let destination = convert ? try schema(for:wsDir(to),files:files) : nil
        for p in files.sorted() where wsMarkdown.contains(wsExt(p)) && (update || (p == path && destination != nil)) {
            let doc = try document(p), nextPath = mapped(p), edited = NSMutableString(string:doc.text.text)
            var edits: [(NSRange,String)] = []
            for link in (update ? doc.links : []) {
                let resolution = resolve(link.raw,wiki:link.wiki,from:p,files:files)
                if resolution.external || resolution.paths.isEmpty { continue }
                let id = link.id(p); var oldTarget: String
                if resolution.paths.count == 1 { oldTarget = resolution.paths[0] }
                else {
                    guard p != nextPath || resolution.paths.contains(where:{ mapped($0) != $0 }) else { continue }
                    guard let selected = choices[id], resolution.paths.contains(selected) else { ambiguous.append(["id":id,"path":p,"link":link.raw,"candidates":resolution.paths]); continue }; oldTarget = selected
                }
                let nextTarget = mapped(oldTarget)
                let stable = resolve(link.raw,wiki:link.wiki,from:nextPath,files:nextFiles).paths == [nextTarget]
                if stable { continue }
                let replacement = reformat(link,target:nextTarget,from:nextPath,files:nextFiles)
                guard replacement != link.raw else { continue }
                edits.append((link.range,replacement)); changes.append(["path":p,"targetPath":nextPath,"id":id,"before":link.raw,"after":replacement,"line":link.line])
            }
            for e in edits.reversed() { edited.replaceCharacters(in:e.0,with:e.1) }
            var nextText = edited as String
            if p == path, let destination {
                let note = try NoteMetadata(nextText)
                let revised = destination.apply(note,stem:wsStem(to),identifier:"note-" + wsHash(p + doc.version).prefix(16))
                if revised != nextText {
                    metadata.append(["path":p,"before":note.header,"after":try NoteMetadata(revised).header])
                    nextText = revised
                }
            }
            if nextText != doc.text.text {
                let newBytes = try doc.text.encoded(nextText)
                writes.append(["oldPath":p,"path":nextPath,"before":doc.data.base64EncodedString(),"after":newBytes.base64EncodedString(),"version":doc.version,"nextVersion":wsHash(newBytes)])
                fingerprint += [p,doc.version,wsHash(newBytes)]
            }
        }
        fingerprint += ambiguous.flatMap { [$0["id"] as? String ?? "",($0["candidates"] as? [String] ?? []).joined(separator:"\u{0}")] }
        let token = wsHash(fingerprint.joined(separator:"\u{0}"))
        var result: WSRow = ["metadata":metadata,"changes":changes,"ambiguous":ambiguous,"token":token,"committed":false,"path":to]
        guard args["commit"] as? Bool == true else { return result }
        if let supplied = args["token"] as? String, supplied != token { throw wsError("引用或文件已变化。请重新预览后确认。") }
        guard ambiguous.isEmpty else { return result }
        let journal: WSRow = ["path":path,"to":to,"writes":writes]; let j = try stateDirectory().appendingPathComponent("move.json")
        if wsFM.fileExists(atPath:j.path) { try restoreInterruptedMove() }
        try JSONSerialization.data(withJSONObject:journal).write(to:j,options:.atomic)
        do {
            try wsFM.moveItem(at:source,to:dest)
            for w in writes {
                let u = try fileURL(w["path"] as! String)
                try coordinated(u) { safe in
                    guard wsHash(try Data(contentsOf:safe)) == (w["version"] as? String) else { throw wsError("文件在改名期间发生变化：\(safe.lastPathComponent)") }
                    try Data(base64Encoded:w["after"] as! String)!.write(to:safe,options:.atomic)
                }
            }; try wsFM.removeItem(at:j)
        } catch { try restoreInterruptedMove(); throw error }
        result["committed"] = true; titleCache.removeAll(); return result
    }
    private func restoreInterruptedMove() throws {
        let j = try stateDirectory().appendingPathComponent("move.json"); guard wsFM.fileExists(atPath:j.path) else { return }
        guard let record = try JSONSerialization.jsonObject(with:Data(contentsOf:j)) as? WSRow, let from = record["path"] as? String, let to = record["to"] as? String, let writes = record["writes"] as? [WSRow] else { throw wsError("无法读取移动恢复记录。") }
        let source = try fileURL(from), dest = try fileURL(to)
        if !wsFM.fileExists(atPath:source.path), wsFM.fileExists(atPath:dest.path) {
            for w in writes.reversed() {
                guard let p = w["path"] as? String, let h = w["nextVersion"] as? String, let raw = w["before"] as? String, let data = Data(base64Encoded:raw) else { throw wsError("移动恢复记录不完整。") }
                let url = try fileURL(p); try coordinated(url) { safe in
                    if let disk = try? Data(contentsOf:safe), wsHash(disk) == h { try data.write(to:safe,options:.atomic) }
                }
            }; try wsFM.moveItem(at:dest,to:source)
        } else if wsFM.fileExists(atPath:source.path) && wsFM.fileExists(atPath:dest.path) { throw wsError("恢复中断的移动时，原路径和目标路径均已被占用。请先保留两个版本。") }
        try wsFM.removeItem(at:j)
    }
    func call(_ method: String, _ args: [String:Any]) throws -> Any {
        lock.lock(); defer { lock.unlock() }
        func string(_ key: String) throws -> String { guard let s = args[key] as? String else { throw wsError("缺少参数 \(key)。") }; return s }
        func path() throws -> String { try string("path") }
        switch method {
        case "setJournalFolder":
            guard try string("root") == base().path else { throw wsError("工作区已切换，请重新选择日记目录。") }
            let folder = try string("folder")
            _ = try journalDirectory(folder)
            try JSONEncoder().encode(folder).write(to:stateDirectory().appendingPathComponent("journal-folder.json"),options:.atomic)
            selectedJournalFolder = folder
            journalCache.removeAll()
            return ["folder":folder]
        case "journals": return try journalRows(string("folder"))
        case "openJournal": return try openJournal(args)
        case "createJournal": return try createJournal(args)
        case "tree": return try tree()
        case "files": return try entries(visibleOnly:true).filter{!$0.dir}.map{["path":$0.path,"name":wsName($0.path),"title":title($0.path)]}
        case "read":
            let p = try path(), bytes = try Data(contentsOf:fileURL(p)); return ["path":p,"text":try WSText(bytes).text,"version":wsHash(bytes)]
        case "save": return try save(path(),text:string("text"),version:string("version"))
        case "draft":
            let p = try path(); _ = try fileURL(p); let record: WSRow = ["path":p,"text":try string("text"),"version":try string("version")]
            try JSONSerialization.data(withJSONObject:record).write(to:draftURL(p),options:.atomic); return ["ok":true]
        case "recovery":
            let selected = args["path"] as? String
            let urls = try selected.map { [try draftURL($0)] } ?? wsFM.contentsOfDirectory(at:stateDirectory(),includingPropertiesForKeys:nil).filter{$0.pathExtension == "draft"}
            return try urls.filter{wsFM.fileExists(atPath:$0.path)}.map{try JSONSerialization.jsonObject(with:Data(contentsOf:$0))}
        case "clearDraft":
            let url = try draftURL(path()); if wsFM.fileExists(atPath:url.path) { try wsFM.removeItem(at:url) }; return ["ok":true]
        case "newFile":
            let p = try path(), data = Data((args["text"] as? String ?? "").utf8); try data.write(to:fileURL(p),options:.withoutOverwriting); return ["path":p,"version":wsHash(data)]
        case "newFolder":
            let p = try path(); try wsFM.createDirectory(at:fileURL(p),withIntermediateDirectories:false); return ["path":p]
        case "rename", "move": return try move(path(),string("to"),args:args)
        case "trash": try wsFM.trashItem(at:fileURL(path()),resultingItemURL:nil); return ["ok":true]
        case "reveal":
            let url = try fileURL(path()); DispatchQueue.main.async { NSWorkspace.shared.activateFileViewerSelecting([url]) }; return ["ok":true]
        case "asset":
            let p = try path(), name = try string("filename"), folder = args["folder"] as? String ?? "assets"; _ = try fileURL(p)
            guard wsName(name) == name, !name.isEmpty, name != ".", name != "..", let data = try Data(base64Encoded:string("data")) else { throw wsError("附件名称或内容无效。") }
            guard !folder.hasPrefix("/"), let dir = wsNormalize(wsJoin(wsDir(p),folder)) else { throw wsError("附件目录位于资料库外。") }
            if !dir.isEmpty { try wsFM.createDirectory(at:fileURL(dir),withIntermediateDirectories:true) }
            let ext = (name as NSString).pathExtension, stem = (name as NSString).deletingPathExtension
            for n in 1...10000 {
                let suffix = n == 1 ? "" : "-\(n)", candidate = wsJoin(dir,stem+suffix+(ext.isEmpty ? "" : "."+ext)), url = try fileURL(candidate)
                do { try data.write(to:url,options:.withoutOverwriting); return ["path":candidate,"link":wsEncode(wsRelative(candidate,from:p))] }
                catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileWriteFileExistsError { continue }
            }; throw wsError("附件目录中存在过多同名文件。")
        case "relativeLink":
            let p = try path(), target = try string("to"); _ = try fileURL(p); _ = try fileURL(target); return ["link":wsEncode(wsRelative(target,from:p))]
        case "resolveLink":
            let p = try path(); _ = try fileURL(p); var raw = try string("link"), wiki = args["wiki"] as? Bool ?? false
            if raw.hasPrefix("[["), raw.hasSuffix("]]") { wiki = true; raw = String(raw.dropFirst(2).dropLast(2).split(separator:"|",maxSplits:1,omittingEmptySubsequences:false).first ?? "") }
            let found = resolve(raw,wiki:wiki,from:p,files:Set(try entries().filter{!$0.dir}.map(\.path)))
            var res: WSRow = ["candidates":found.paths,"fragment":found.fragment,"external":found.external]; if found.paths.count == 1 { res["path"] = found.paths[0] }; return res
        case "workspaceGraph": return try workspaceGraph(args)
        case "referenceNames":
            let p = try path()
            return Array(Set([wsName(p),wsStem(p),title(p)].map { $0.lowercased() }))
        case "referenceParagraphs":
            let empty: WSRow = ["pageCount":0,"rows":[] as [WSRow]]
            guard args["root"] as? String == directory?.path else { return empty }
            let target = try path(), candidates = args["candidates"] as? [WSRow] ?? []
            guard !candidates.isEmpty else { return empty }
            let files = Set(try entries().filter { !$0.dir }.map(\.path))
            var pages = Set<String>(), firstRows = [WSRow](), extraRows = [WSRow]()
            var selected = [String:[Int:[WSRow]]]()
            for row in candidates {
                guard let source = row["path"] as? String, source != target, files.contains(source),
                      !hiddenFolders.contains(where:{ wsUnder(source,$0) }),
                      let raw = row["raw"] as? String, let line = row["line"] as? Int else { continue }
                let wiki = row["wiki"] as? Bool ?? false
                guard resolve(raw,wiki:wiki,from:source,files:files).paths == [target] else { continue }
                let first = pages.insert(source).inserted
                if selected[source]?[line] == nil {
                    if first && firstRows.count < 3 { firstRows.append(row) }
                    else if !first && extraRows.count < 2 { extraRows.append(row) }
                    else { continue }
                }
                selected[source,default:[:]][line,default:[]].append(["raw":raw,"wiki":wiki])
            }
            let previews: [WSRow] = (firstRows + extraRows).prefix(3).map { row in
                var preview = row
                if let source = row["path"] as? String, let line = row["line"] as? Int {
                    preview["targets"] = selected[source]?[line]
                }
                return preview
            }
            return ["pageCount":pages.count,"rows":previews] as WSRow
        case "backlinks", "dangling":
            let target = args["path"] as? String, files = Set(try entries().filter{!$0.dir}.map(\.path)); var rows: [WSRow] = []
            for p in files.sorted() where wsMarkdown.contains(wsExt(p)) {
                let doc = try document(p)
                for link in doc.links {
                    let res = resolve(link.raw,wiki:link.wiki,from:p,files:files); if res.external { continue }
                    if method == "backlinks", let target, res.paths == [target] { rows.append(["path":p,"line":link.line,"text":link.snippet]) }
                    if method == "dangling", res.paths.isEmpty { rows.append(["id":link.id(p),"path":p,"link":link.raw,"line":link.line,"version":doc.version,"candidates":candidates(for:link,from:p,files:files)]) }
                }
            }; return rows
        case "repair":
            let p = try path(), target = try string("to"), id = try string("id"), doc = try document(p), files = Set(try entries().filter{!$0.dir}.map(\.path))
            guard files.contains(target), let link = doc.links.first(where:{$0.id(p) == id}), resolve(link.raw,wiki:link.wiki,from:p,files:files).paths.isEmpty else { throw wsError("链接或修复目标已变化，请重新检查。") }
            let ns = NSMutableString(string:doc.text.text); ns.replaceCharacters(in:link.range,with:reformat(link,target:target,from:p,files:files)); return try save(p,text:ns as String,version:args["version"] as? String ?? doc.version)
        default: throw wsError("未知操作 \(method)。")
        }
    }
}
