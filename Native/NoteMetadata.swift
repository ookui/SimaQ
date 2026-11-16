import Foundation

/// A flat field schema can carry nested YAML verbatim within each field.
struct NoteMetadata {
    var keys: [String] = []
    var fields: [String:String] = [:]
    var header = ""
    var body: String
    var leadingComments: [String] = []

    init(_ text: String) throws {
        body = text
        let lines = text.components(separatedBy:"\n")
        func delimiter(_ line: String) -> String {
            String(line.reversed().drop(while:{ $0 == " " || $0 == "\t" }).reversed())
        }
        guard let first = lines.first, delimiter(first) == "---" else { return }
        guard let end = lines.indices.dropFirst().first(where:{ ["---","..."].contains(delimiter(lines[$0])) }) else {
            throw Self.invalid()
        }
        header = lines[...end].joined(separator:"\n")
        body = lines.dropFirst(end + 1).joined(separator:"\n")
        for line in lines[1..<end] {
            if let colon = line.firstIndex(of:":"), let first = line.first, !first.isWhitespace, first != "#" {
                let key = String(line[..<colon])
                if key.range(of:#"^[\p{L}\p{N}_@.-]+$"#,options:.regularExpression) != nil {
                    guard fields[key] == nil else { throw Self.invalid() }
                    keys.append(key); fields[key] = String(line[line.index(after:colon)...]); continue
                }
            }
            if line.isEmpty || line.hasPrefix("#") || line.first?.isWhitespace == true || line.hasPrefix("- ") {
                if let key = keys.last { fields[key,default:""] += "\n" + line }
                else if line.isEmpty || line.hasPrefix("#") { leadingComments.append(line) }
                else { throw Self.invalid() }
            } else { throw Self.invalid() }
        }
    }

    static func invalid() -> NSError {
        NSError(domain:"SimaQ.Metadata",code:1,userInfo:[NSLocalizedDescriptionKey:"无法安全转换此 YAML 的字段结构，请检查元数据。"])
    }
    func scalar(_ key: String) -> String {
        var value = (fields[key] ?? "").trimmingCharacters(in:.whitespacesAndNewlines)
        if let index = value.range(of:" #") { value = String(value[..<index.lowerBound]) }
        return value.trimmingCharacters(in:CharacterSet(charactersIn:" \"'"))
    }
    static func date(in value: String) -> String? {
        guard let range = value.range(of:#"(?<![0-9])[0-9]{4}-[0-9]{2}-[0-9]{2}(?![0-9])"#,options:.regularExpression) else { return nil }
        let day = String(value[range]), pieces = day.split(separator:"-").compactMap { Int($0) }
        let calendar = Calendar(identifier:.gregorian)
        let parts = DateComponents(year:pieces[0],month:pieces[1],day:pieces[2])
        return parts.isValidDate(in:calendar) ? day : nil
    }
    static let journalKeys = ["thesis","date","location","weather"]
    static func location(_ day: String) -> String { day.isEmpty ? "" : (day < "2011-01-01" ? "北京" : "深圳") }
    static func daily(_ day: String) -> String {
        "---\nthesis: \"reflection\"\ndate: \(day)\nlocation: \"\(location(day))\"\nweather: \"\"\n---\n\n# \(day)\n\n"
    }
}

struct DirectorySchema {
    var keys: [String]
    var defaults: [String:String] = [:]
    var kind = ""

    static func forFolder(_ path: String) -> DirectorySchema? {
        let parts = path.lowercased().split(separator:"/").map(String.init)
        func within(_ dir: String) -> Bool {
            let components = dir.split(separator:"/").map(String.init)
            return parts.indices.contains { parts[$0...].starts(with:components) }
        }
        if within("lifeos/journals") { return Self(keys:NoteMetadata.journalKeys,kind:"journal") }
        if within("lifeos/books") { return Self(keys:["authors","url","rating","completed@","updated"]) }
        if within("lifeos/articles") { return Self(keys:["thesis","updated"]) }
        if within("sources/companies") { return Self(keys:["id","updated","ticker","type"],kind:"research") }
        if within("sources/industries") { return Self(keys:["id","updated","type"],kind:"research") }
        if within("sources/macro") { return Self(keys:["id","updated","type"],kind:"macro") }
        if ["concept","pattern","framework"].contains(where:{within("mechanisms/"+$0)}) { return Self(keys:["id","updated"]) }
        if within("theses") { return Self(keys:["id","reviewed","tickers","direction"],defaults:["tickers":" []"]) }
        if within("logs") { return Self(keys:["id","type","created","updated","date","log_type","status","tags"],defaults:["type":" \"log\"","status":" \"active\"","tags":" []"],kind:"log") }
        if within("_meta") { return Self(keys:["id","type","created","updated","status","tags"],defaults:["type":" \"meta\"","status":" \"active\"","tags":" []"],kind:"meta") }
        if within("library/summary") { return Self(keys:[]) }
        return nil
    }

    func apply(_ source: NoteMetadata, stem: String, identifier: String) -> String {
        if keys.isEmpty { return source.body }
        let day = NoteMetadata.date(in:source.scalar("date")) ?? NoteMetadata.date(in:stem) ?? ""
        var header = ["---"] + source.leadingComments
        for key in keys {
            var value = source.fields[key] ?? defaults[key] ?? " \"\""
            if ["reviewed","updated"].contains(key), source.scalar(key).isEmpty {
                let alias = key == "reviewed" ? "updated" : "reviewed"
                if NoteMetadata.date(in:source.scalar(alias)) != nil { value = source.fields[alias]! }
            }
            if kind == "journal" {
                switch key {
                case "thesis" where !["reflection","life","study"].contains(source.scalar(key)): value = " \"reflection\""
                case "date": value = day.isEmpty ? " \"\"" : " " + day
                case "location" where day.isEmpty || source.scalar(key).isEmpty: value = " \"" + NoteMetadata.location(day) + "\""
                case "weather" where day.isEmpty: value = " \"\""
                default: break
                }
            }
            if key == "id", source.scalar(key).isEmpty { value = " \"" + identifier + "\"" }
            if key == "type" {
                let allowed = kind == "macro" ? ["currency","fixed-income","economy","equity","commodities","policy","multi-asset","digital-assets"] : ["deepdive","events","follow","primer","case"]
                if ["macro","research"].contains(kind), !allowed.contains(source.scalar(key)) { value = " \"\"" }
                if ["log","meta"].contains(kind) { value = " \"" + kind + "\"" }
            }
            header.append(key + ":" + value)
        }
        header.append("---")
        let next = header.joined(separator:"\n")
        return next + "\n" + (source.header.isEmpty && !source.body.isEmpty ? "\n" : "") + source.body
    }
}
