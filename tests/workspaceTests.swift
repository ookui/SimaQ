import AppKit
import UniformTypeIdentifiers

@main struct WorkspaceTests {
    static func main() throws {
        let fm = FileManager.default, root = fm.temporaryDirectory.appendingPathComponent("simaq-ws-tests-"+UUID().uuidString), vault = root.appendingPathComponent("Vault")
        try fm.createDirectory(at:vault,withIntermediateDirectories:true); defer { try? fm.removeItem(at:root) }
        let ws = Workspace(stateHome:root.appendingPathComponent("state")); try ws.open(vault)
        typealias Row = [String:Any]
        func call(_ name:String, _ args:Row = [:]) throws -> Row { try ws.call(name,args) as! Row }
        func rows(_ name:String, _ args:Row = [:]) throws -> [Row] { try ws.call(name,args) as! [Row] }
        func assertThat(_ value: @autoclosure () throws -> Bool, _ message:String) throws {
            if try !value() { throw NSError(domain:"WorkspaceTests",code:1,userInfo:[NSLocalizedDescriptionKey:message]) }
        }
        func fails(_ name:String,_ args:Row) throws { do { _ = try ws.call(name,args) } catch { return }; try assertThat(false,"expected error: \(name) \(args)") }
        for p in ["笔记","报告","归档","引用"] { _ = try call("newFolder",["path":p]) }
        func add(_ p:String,_ body:String) throws { _ = try call("newFile",["path":p,"text":body]) }
        let src = "笔记/甲.md", target = "报告/中 文 (1).md", body = "---\r\n# yaml\r\n---\n# 标题\r正文\r\n[x](<../报告/中 文 (1).md#第一节> \"标题\")\r\n[引用]: ../报告/中%20文%20%281%29.md\r\n`[跳过](<../报告/中 文 (1).md>)`\r\n```md\n[源](abc.md)\n```\n"
        let original = Data([239,187,191])+Data(body.utf8); try original.write(to:ws.fileURL(src)); try add(target,"# 阅读摘录\n[[甲#段落|回到原笔记]]\n")
        let doc = try call("read",["path":src]); let normalized = doc["text"] as! String
        let saved = try call("save",["path":src,"text":normalized,"version":doc["version"]!]); try assertThat(saved["version"] as? String == doc["version"] as? String,"no-op version"); try assertThat(Data(contentsOf:ws.fileURL(src)) == original,"byte equality")
        let local = normalized.replacingOccurrences(of:"正文",with:"新正文"); _ = try call("save",["path":src,"text":local,"version":doc["version"]!]); try assertThat(Data(contentsOf:ws.fileURL(src)) == Data([239,187,191])+Data(body.replacingOccurrences(of:"正文",with:"新正文").utf8),"localized edit preserves mixed endings")
        let conflict = try call("save",["path":src,"text":"stale","version":doc["version"]!]); try assertThat(conflict["conflict"] as? Bool == true && conflict["text"] as? String == local,"external conflict")
        _ = try call("draft",["path":src,"text":"draft","version":doc["version"]!]); let restarted = Workspace(stateHome:root.appendingPathComponent("state")); try restarted.open(vault)
        try assertThat((try restarted.call("recovery",["path":src]) as! [Row]).first?["text"] as? String == "draft","recovery after reopen"); _ = try call("clearDraft",["path":src]); try assertThat(try rows("recovery").isEmpty,"draft cleared")
        let backlink = try rows("backlinks",["path":target]); try assertThat(backlink.count == 2,"inline + reference links only")
        let newTarget = "归档/新报告.md", preview = try call("move",["path":target,"to":newTarget]); try assertThat((preview["changes"] as! [Row]).count == 2,"move preview")
        let moved = try call("move",["path":target,"to":newTarget,"token":preview["token"]!,"commit":true]); try assertThat(moved["committed"] as? Bool == true,"move commit")
        let edited = try call("read",["path":src])["text"] as! String
        try assertThat(edited.contains("[x](<../归档/新报告.md#第一节> \"标题\")") && edited.contains("`[跳过](<../报告/中 文 (1).md>)`"),"label, fragment, code span")
        let relocate = "归档/深/甲.md"; _ = try call("newFolder",["path":"归档/深"]); let rp = try call("move",["path":src,"to":relocate]); _ = try call("move",["path":src,"to":relocate,"commit":true,"token":rp["token"]!]); try assertThat((try call("read",["path":relocate])["text"] as! String).contains("../新报告.md"),"outgoing relative links rewritten")
        try add("引用/A.md","[[重复#标题|原文]]\n"); try add("报告/重复.md",""); try add("笔记/重复.md","")
        let refRows:[Row] = [
            ["path":"报告/重复.md","raw":"重复","wiki":true,"line":1],
            ["path":"引用/A.md","raw":"重复","wiki":true,"line":2],
            ["path":"引用/A.md","raw":"../报告/重复.md","wiki":false,"line":3],
            ["path":"引用/A.md","raw":"../报告/重复.md","wiki":false,"line":3]
        ]
        func footer(_ candidates:[Row]) throws -> (Int,[Row]) {
            let result = try call("referenceParagraphs",["path":"报告/重复.md","root":ws.root!.path,"candidates":candidates])
            return (result["pageCount"] as! Int,result["rows"] as! [Row])
        }
        let (refPages,refs) = try footer(refRows)
        try assertThat(refPages == 1 && refs.count == 1 && refs[0]["line"] as? Int == 3,"footer omits self, ambiguous aliases and duplicate lines")
        func citation(_ source:String,_ line:Int) -> Row {
            ["path":source,"raw":source == relocate ? "../../报告/重复.md" : "../报告/重复.md","wiki":false,"line":line]
        }
        let sources = ["引用/A.md","笔记/重复.md",newTarget,relocate]
        let many = sources.flatMap { source in (1...6).map { citation(source,$0) } }
        let (allPages,diverse) = try footer(many)
        try assertThat(allPages == 4 && diverse.compactMap { $0["path"] as? String } == Array(sources.prefix(3)), "three excerpts across distinct sources with accurate total")
        let (_,samePage) = try footer(Array(many.prefix(6)))
        try assertThat(samePage.compactMap { $0["line"] as? Int } == [1,2,3], "three excerpts maximum for a single source")
        let ra:Row = ["path":"报告/重复.md","to":"报告/改名.md"], ambiguous = try call("rename",ra)["ambiguous"] as! [Row]; try assertThat(ambiguous.count == 1,"ambiguous wiki reported")
        var choice = ra; choice["choices"] = [ambiguous[0]["id"] as! String:"报告/重复.md"]; choice["commit"] = true; _ = try call("rename",choice); try assertThat((try call("read",["path":"引用/A.md"])["text"] as! String).contains("[[改名#标题|原文]]"),"wiki alias and heading")
        try fm.moveItem(at:ws.fileURL(newTarget),to:ws.fileURL("归档/最新.md")); let broken = try rows("dangling"); try assertThat(broken.count == 2,"external rename detected")
        try assertThat((broken[0]["candidates"] as! [String]).first == "归档/最新.md","renamed file identified by filesystem identity")
        let first = broken[0]; _ = try call("repair",["path":first["path"]!,"id":first["id"]!,"to":"归档/最新.md","version":first["version"]!]); try assertThat(try rows("dangling").count == 1,"confirmed repair")
        try fails("read",["path":"../escape"]); try fm.createSymbolicLink(at:vault.appendingPathComponent("outside"),withDestinationURL:root); try fails("newFile",["path":"outside/escape.md"])
        try fails("newFile",["path":relocate]); try fails("asset",["path":relocate,"filename":"图.png","folder":"../../../outside","data":"AQID"])
        let a:Row = ["path":relocate,"filename":"图 像.png","data":"AQID"]; let a1 = try call("asset",a), a2 = try call("asset",a)
        try assertThat(a1["link"] as? String == "assets/图%20像.png" && a2["link"] as? String == "assets/图%20像-2.png","attachment names and relative paths")
        let png = try Data(contentsOf: URL(fileURLWithPath:"Web/brand-q.png"))
        try png.write(to:ws.fileURL("笔记/Pasted image 1.png"))
        let imageURL = URL(string:"simaq-asset://workspace/%E7%AC%94%E8%AE%B0/Pasted%20image%201.png")!
        let (bytes,mime) = try AssetHandler.image(imageURL,workspace:ws)
        try assertThat(bytes == png && mime == "image/png","PNG asset resolves through an encoded path")
        let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320"><rect width="720" height="320" fill="teal"/></svg>"#.utf8)
        try svg.write(to:ws.fileURL("笔记/向量 图.svg"))
        let svgURL = URL(string:"simaq-asset://workspace/笔记/向量%20图.svg".addingPercentEncoding(withAllowedCharacters:.urlFragmentAllowed.union(CharacterSet(charactersIn:"%")))!)!
        let (svgBytes,svgMIME) = try AssetHandler.image(svgURL,workspace:ws)
        try assertThat(svgBytes == svg && svgMIME == "image/svg+xml","full SVG served from encoded image path")
        let clipboard = AssetHandler.clipboardItem(bytes,type:.png)
        try assertThat(clipboard.data(forType:.png) == png,"copy image supplies original PNG bytes")
        try assertThat(clipboard.data(forType:.tiff)?.isEmpty == false, "bitmap paste available for TIFF consumers")
        let resized = "<img src=\"\(imageURL.absoluteString)\" width=\"360\">"
        let embedded = try AssetHandler.embedImages(resized,workspace:ws)
        try assertThat(embedded == "<img src=\"data:image/png;base64,\(png.base64EncodedString())\" width=\"360\">","HTML export preserves PNG and display width")
        let utf16 = Data([0xff,0xfe])+"甲\r\n乙".data(using:.utf16LittleEndian)!; try utf16.write(to:ws.fileURL("编码.md")); let u = try call("read",["path":"编码.md"]); _ = try call("save",["path":"编码.md","text":"甲\n三","version":u["version"]!]); try assertThat(Data(contentsOf:ws.fileURL("编码.md")) == Data([0xff,0xfe])+"甲\r\n三".data(using:.utf16LittleEndian)!,"UTF-16 BOM")
        for folder in ["LifeOS","LifeOS/journals","LifeOS/journals/2010","LifeOS/books","Sources","Sources/companies","Custom"] {
            _ = try call("newFolder",["path":folder])
        }
        let diaryFolder = "LifeOS/journals", past = "2010-10-13"
        try add(diaryFolder + "/README.md","# Guide")
        try add(diaryFolder + "/2010/memory.md","---\ndate: '2010-10-13'\n---\n# Memory\n")
        try add(diaryFolder + "/another-2022-01-01.md","---\ndate: 2010-10-13\n---\n# Second\n")
        try add(diaryFolder + "/undated.md","# Undated\n")
        let diaryArgs: Row = ["folder":diaryFolder,"root":ws.root!.path]
        func dayArgs(_ day: String) -> Row { diaryArgs.merging(["day":day]) { _,new in new } }
        let history = try rows("journals",diaryArgs)
        try assertThat(history.count == 3 && history.filter { $0["date"] as? String == past }.count == 2 && history.last?["date"] as? String == "", "multiple journals on YAML date, undated entries and README exclusion")
        try assertThat(try call("openJournal",dayArgs(past))["path"] as? String == history.first?["path"] as? String,"reuse titled journal with matching date")
        try fails("openJournal",dayArgs("2025-02-29"))
        try fails("openJournal",["folder":"Custom","root":ws.root!.path,"day":"2024-02-29"])
        try fails("openJournal",["folder":diaryFolder,"root":"/wrong","day":"2024-02-29"])
        let previewDay = try call("openJournal",dayArgs("2024-02-29"))
        let daily = previewDay["path"] as! String, template = previewDay["text"] as! String
        let candidate = try ws.fileURL(daily)
        try assertThat(previewDay["pending"] as? Bool == true && !fm.fileExists(atPath:candidate.path),"preview is memory-only")
        for day in ["2024-02-29","2024-03-01","2024-03-02"] { _ = try call("openJournal",dayArgs(day)) }
        try assertThat(rows("journals",diaryArgs).count == history.count, "browsing days adds no files or calendar dots")
        var journalSave = dayArgs("2024-02-29")
        journalSave["path"] = daily
        journalSave["text"] = template + "  "
        try fails("createJournal",journalSave)
        try assertThat(!fm.fileExists(atPath:candidate.path),"untouched or whitespace-only preview remains unsaved")
        journalSave["text"] = template + "A journal entry.\n"
        _ = try call("createJournal",journalSave)
        let dailyText = try call("read",["path":daily])["text"] as! String
        try assertThat(dailyText == journalSave["text"] as! String && rows("journals",diaryArgs).count == history.count+1,"first edit creates exactly the edited file")
        journalSave["text"] = template + "Different draft"
        try assertThat(call("createJournal",journalSave)["conflict"] as? Bool == true && call("read",["path":daily])["text"] as? String == dailyText,"first save never overwrites a concurrent entry")
        try assertThat(call("openJournal",dayArgs("2024-02-29"))["pending"] == nil,"later opens use saved journal")
        try assertThat(dailyText.contains("date: 2024-02-29\nlocation: \"深圳\"\nweather: \"\"") && dailyText.contains("# 2024-02-29"),"leap day, local location convention, no invented weather")
        let movedDiary = "LifeOS/books/2024-02-29.md", moveArgs: Row = ["path":daily,"to":movedDiary,"updateLinks":false]
        let plain = try call("move",moveArgs)
        try assertThat((plain["metadata"] as! [Row]).first?["before"] as? String == "---\nthesis: \"reflection\"\ndate: 2024-02-29\nlocation: \"深圳\"\nweather: \"\"\n---", "preview actual removed fields")
        _ = try call("move",moveArgs.merging(["commit":true,"token":plain["token"]!]) { _,v in v })
        let book = try NoteMetadata(try call("read",["path":movedDiary])["text"] as! String)
        try assertThat(book.keys == ["authors","url","rating","completed@","updated"] && book.body == (try NoteMetadata(dailyText)).body,"move-only transforms YAML with identical body")
        try add("Custom/_template.md","---\ndescription: \"\"\nauthors: []\n---\n")
        let sourceNote = "报告/legacy.md", destNote = "Custom/legacy.md", linked = "报告/data.txt"
        try add(linked,"data")
        try add(sourceNote,"---\nold: gone\ndescription: |\n  Line 1\n  ---\n  Line 3\nauthors:\n- A\n- B\n---\n# Legacy\n[Data](data.txt)\n")
        let custom: Row = ["path":sourceNote,"to":destNote]
        let beforeMove = try call("move",custom)
        try Data("---\nauthors: []\n---\n".utf8).write(to:ws.fileURL("Custom/_template.md"))
        try fails("move", custom.merging(["commit":true,"token":beforeMove["token"]!]) { _,v in v })
        try Data("---\ndescription: \"\"\nauthors: []\n---\n".utf8).write(to:ws.fileURL("Custom/_template.md"))
        _ = try call("move",custom.merging(["commit":true,"token":beforeMove["token"]!]) { _,v in v })
        let customNote = try NoteMetadata(try call("read",["path":destNote])["text"] as! String)
        try assertThat(customNote.keys == ["description","authors"] && customNote.fields["description"] == " |\n  Line 1\n  ---\n  Line 3" && customNote.fields["authors"] == "\n- A\n- B" && customNote.body.contains("../") && !customNote.body.contains("](data.txt)"), "schema and relative links committed together, array and block scalar preserved")
        let colliding = diaryFolder + "/2024-03-01.md"
        let titled = "---\ndate: 2019-04-02\n---\n# Historical note\n"
        try add(colliding,titled)
        let free = try call("openJournal",dayArgs("2024-03-01"))
        try assertThat(free["path"] as? String == diaryFolder + "/2024-03-01-2.md" && call("read",["path":colliding])["text"] as? String == titled,"occupied filename never overwrites historical journal")
        _ = try call("newFolder",["path":"Unconfigured"])
        _ = try call("move",["path":destNote,"to":"Unconfigured/old.md","commit":true,"updateLinks":false])
        try assertThat((try call("read",["path":"Unconfigured/old.md"])["text"] as! String).contains(customNote.header),"unconfigured empty directory preserves header")
        _ = try call("newFolder",["path":"Other"])
        try add("Other/sample.md","---\nauthors: Alice\nsubject: Original research\n---\n")
        _ = try call("move",["path":"Unconfigured/old.md","to":"Other/old.md","commit":true,"updateLinks":false])
        let inferred = try NoteMetadata(try call("read",["path":"Other/old.md"])["text"] as! String)
        try assertThat(inferred.keys == ["authors","subject"] && inferred.scalar("subject").isEmpty && inferred.fields["authors"] == customNote.fields["authors"],"shared field set without copying a sibling's personal values")
        let vaultPath = ws.root!.path
        let customFolder = "笔记/每日记录"
        _ = try call("newFolder",["path":customFolder])
        try fails("setJournalFolder",["root":"/wrong","folder":customFolder])
        for invalid in ["../outside",src,"missing"] {
            try fails("setJournalFolder",["root":vaultPath,"folder":invalid])
        }
        _ = try call("setJournalFolder",["root":vaultPath,"folder":customFolder])
        try fails("openJournal",dayArgs(past))
        try fails("createJournal",journalSave)
        let customDay: Row = ["root":vaultPath,"folder":customFolder,"day":past]
        let proposed = try call("openJournal",customDay)
        try assertThat(proposed["path"] as? String == customFolder + "/" + past + ".md","custom journal destination")
        _ = try call("createJournal",customDay.merging(["path":proposed["path"]!,"text":"# Custom day"]) { _,v in v })
        try assertThat(rows("journals",customDay).count == 1 && call("openJournal",customDay)["pending"] == nil,"custom calendar lists and reopens its own entry")
        try restarted.open(vault)
        try assertThat(restarted.configuredJournalFolder == customFolder,"journal folder survives reopening")
        try restarted.open(root)
        try assertThat(restarted.configuredJournalFolder == nil,"journal selection is workspace-specific")
        _ = try call("setJournalFolder",["root":vaultPath,"folder":""])
        let rootDay: Row = ["root":vaultPath,"folder":"","day":"2031-09-09"]
        let rootPreview = try call("openJournal",rootDay)
        try assertThat(rootPreview["path"] as? String == "2031-09-09.md","workspace root can be the journal directory")
        _ = try call("createJournal",rootDay.merging(["path":rootPreview["path"]!,"text":"Root entry"]) { _,v in v })
        try assertThat(call("openJournal",rootDay)["pending"] == nil,"root journal saved")
        print("Journals and directory metadata tests passed")
        let tree = try rows("tree"); try assertThat(tree.contains { $0["path"] as? String == "归档" && !($0["children"] as! [Row]).isEmpty },"nested tree")
        try ws.setExcludedFolders(["归档/深"],forRoot:ws.root!.path)
        try restarted.open(vault)
        try assertThat(restarted.excludedFolders == ["归档/深"],"workspace exclusions survive reopening")
        try assertThat(!rows("files").contains { ($0["path"] as! String).hasPrefix("归档/深/") }, "excluded descendants omitted")
        try assertThat(rows("files").contains { $0["path"] as? String == "归档/最新.md" }, "sibling folder remains visible")
        try restarted.open(root)
        try assertThat(restarted.excludedFolders == ["_Meta"],"independent workspace exclusions")
        var observed = false; ws.onChanges = { paths in if paths.contains("事件.md") { observed = true } }; try Data("外部文字".utf8).write(to:vault.appendingPathComponent("事件.md")); let stop = Date(timeIntervalSinceNow:3)
        while !observed && Date()<stop { RunLoop.main.run(until:Date(timeIntervalSinceNow:0.05)) }
        try assertThat(observed,"external write event delivered"); print("External filesystem change delivered")
        print("Workspace: file fidelity, conflicts, recovery, nested directories, moves, disambiguation, repair, traversal, assets passed")
    }
}
