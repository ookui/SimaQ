import Foundation

struct WSLink {
    let range: NSRange, raw: String, wiki: Bool, line: Int, snippet: String
}
struct WSLinks {
    static let token = try! NSRegularExpression(pattern: #"(?m)^ {0,3}\[[^\]\n]+\]:[ \t]*|!?\[\[|\]\([ \t]*|`+|<!--"#)
    static let lines = try! NSRegularExpression(pattern: #"(?m)^.*$"#)
    static func parse(_ text: String) -> [WSLink] {
        guard text.contains("[") else { return [] }
        let ns = text as NSString, all = NSRange(location: 0, length: ns.length)
        var excluded: [NSRange] = [], starts: [Int] = [], fence: (Character, Int)?, yaml = false
        lines.enumerateMatches(in: text, range: all) { m, _, _ in
            guard let r = m?.range else { return }; starts.append(r.location)
            let line = ns.substring(with: r), trimmed = line.drop(while: { $0 == " " }), first = trimmed.first
            if r.location == 0, line == "---" { yaml = true; excluded.append(r); return }
            if yaml { excluded.append(r); if line == "---" || line == "..." { yaml = false }; return }
            if let f = fence { excluded.append(r); if first == f.0, trimmed.prefix(while: { $0 == f.0 }).count >= f.1, trimmed.drop(while: { $0 == f.0 }).trimmingCharacters(in: .whitespaces).isEmpty { fence = nil }; return }
            if line.hasPrefix("    ") || line.hasPrefix("\t") { excluded.append(r); return }
            if let c = first, c == "`" || c == "~", trimmed.prefix(while: { $0 == c }).count >= 3 { fence = (c, trimmed.prefix(while: { $0 == c }).count); excluded.append(r) }
        }
        // An opening horizontal rule without a closing YAML delimiter is ordinary Markdown.
        if yaml { return parse("\u{200b}" + text).map { WSLink(range: NSRange(location: $0.range.location-1, length: $0.range.length), raw: $0.raw, wiki: $0.wiki, line: $0.line, snippet: $0.snippet) } }
        var skipped = 0, covered = 0, line = 0, result: [WSLink] = []
        let limit = ns.length
        func unit(_ i: Int) -> unichar { i < limit ? ns.character(at:i) : 0 }
        func escaped(_ i: Int) -> Bool { var j = i; while j > 0, unit(j-1) == 92 { j -= 1 }; return (i-j)%2 == 1 }
        token.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let r = match?.range else { return }; let loc = r.location
            while skipped < excluded.count, NSMaxRange(excluded[skipped]) <= loc { skipped += 1 }
            guard loc >= covered, skipped >= excluded.count || !NSLocationInRange(loc, excluded[skipped]), !escaped(loc) else { return }
            let found = ns.substring(with: r)
            var start = NSMaxRange(r), end = start
            if found == "<!--" {
                let end = ns.range(of:"-->",range:NSRange(location:start,length:limit-start)); covered = end.location == NSNotFound ? limit : NSMaxRange(end); return
            }
            if found.hasPrefix("`") {
                var cursor = start
                while cursor < limit {
                    let close = ns.range(of: found, options: [], range: NSRange(location: cursor,length: limit-cursor))
                    if close.location == NSNotFound { break }
                    cursor = NSMaxRange(close)
                    if unit(cursor) != 96 && unit(close.location-1) != 96 { covered = cursor; break }
                }; return
            }
            let wiki = found.hasSuffix("[["), reference = !wiki && !found.hasPrefix("](")
            if !reference && !wiki {
                // Walk nested label delimiters. Escaped brackets are ordinary text.
                let lineStart = ns.lineRange(for:NSRange(location:loc,length:0)).location
                var cursor = loc, depth = 1
                while cursor > lineStart && depth > 0 {
                    cursor -= 1
                    if unit(cursor) == 93 && !escaped(cursor) { depth += 1 }
                    if unit(cursor) == 91 && !escaped(cursor) { depth -= 1 }
                }
                if depth != 0 { return }
            }
            let angle = !wiki && unit(start) == 60
            if angle { start += 1 }; end = start
            var depth = 0
            while end < limit {
                let u = unit(end)
                if u == 10 || u == 13 { break }
                if u == 92, end+1 < limit { end += 2; continue }
                if wiki { if u == 124 || (u == 93 && unit(end+1) == 93) { break } }
                else if angle { if u == 62 { break } }
                else { if u == 32 || u == 9 { break }; if u == 40 { depth += 1 }; if u == 41 { if depth == 0 { break }; depth -= 1 } }
                end += 1
            }
            guard end > start else { return }
            if wiki {
                let lr = ns.lineRange(for:NSRange(location:loc,length:0)); let close = ns.range(of:"]]",range:NSRange(location:end,length:NSMaxRange(lr)-end))
                guard close.location != NSNotFound else { return }; covered = NSMaxRange(close)
            } else {
                if angle && unit(end) != 62 { return }
                if !reference {
                    var tail = end + (angle ? 1 : 0)
                    while unit(tail) == 32 || unit(tail) == 9 { tail += 1 }
                    if unit(tail) == 34 || unit(tail) == 39 || unit(tail) == 40 {
                        let quote: unichar = unit(tail) == 40 ? 41 : unit(tail); tail += 1
                        while tail < limit && unit(tail) != 10 && (unit(tail) != quote || escaped(tail)) { tail += 1 }; tail += 1
                        while unit(tail) == 32 || unit(tail) == 9 { tail += 1 }
                    }; guard unit(tail) == 41 else { return }
                }; covered = end
            }
            while line+1 < starts.count, starts[line+1] <= loc { line += 1 }
            let range = NSRange(location:start,length:end-start)
            result.append(WSLink(range:range, raw:ns.substring(with:range), wiki:wiki, line:line+1, snippet:ns.substring(with:ns.lineRange(for:NSRange(location:loc,length:0))).trimmingCharacters(in:.whitespacesAndNewlines)))
        }; return result
    }
}

