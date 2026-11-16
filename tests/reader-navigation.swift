// Optional native reader acceptance test; no SimaQ application or window is opened.
// swiftc -swift-version 5 -parse-as-library Native/Reader.swift tests/reader-navigation.swift -o /tmp/simaq-reader-navigation
import AppKit
import CoreGraphics
import PDFKit
import WebKit

private struct AcceptanceFailure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

@main struct ReaderNavigationAcceptance {
    static var checks: [String] = []
    static func check(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
        guard try condition() else { throw AcceptanceFailure(message) }
        checks.append(message)
    }
    static func spin() { RunLoop.current.run(until: Date().addingTimeInterval(0.02)) }
    static func wait(_ message: String, timeout: TimeInterval = 15, _ condition: () -> Bool) throws {
        let limit = Date().addingTimeInterval(timeout)
        while Date() < limit { if condition() { return }; spin() }
        throw AcceptanceFailure("Timed out: " + message)
    }
    static func find<T: NSView>(_ type: T.Type, in parent: NSView) -> T? {
        if let match = parent as? T { return match }
        for child in parent.subviews { if let match = find(type, in: child) { return match } }
        return nil
    }
    static func evaluate(_ web: WKWebView, _ script: String) throws -> Any? {
        var done = false, result: Any?, failure: Error?
        web.evaluateJavaScript(script) { value, error in result = value; failure = error; done = true }
        try wait("JavaScript callback") { done }
        if let failure = failure { throw failure }
        return result
    }
    static func loadedWeb(_ reader: ReaderController) throws -> WKWebView {
        try wait("HTML WKWebView created") {
            reader.view.layoutSubtreeIfNeeded()
            return find(WKWebView.self, in: reader.view) != nil
        }
        let web = find(WKWebView.self, in: reader.view)!
        try wait("HTML fixture fully loaded") {
            reader.view.layoutSubtreeIfNeeded()
            return (try? evaluate(web, "document.readyState === 'complete' && !!document.getElementById('report-root')")) as? Bool == true
        }
        return web
    }
    static func writePDF(_ url: URL) throws {
        var box = CGRect(x: 0, y: 0, width: 612, height: 792)
        guard let context = CGContext(url as CFURL, mediaBox: &box, nil) else {
            throw AcceptanceFailure("Cannot create temporary PDF")
        }
        for page in 1...3 {
            context.beginPDFPage(nil)
            context.setFillColor(CGColor(gray: CGFloat(page) / 4, alpha: 1))
            context.fill(CGRect(x: 36, y: 36, width: 540, height: 720))
            context.endPDFPage()
        }
        context.closePDF()
    }
    static func run() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("simaq-reader-navigation-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let html = root.appendingPathComponent("长报告.html"), pdfURL = root.appendingPathComponent("访谈 纪要.pdf")
        try writePDF(pdfURL)
        let paragraphs = (0..<100).map { "<p class='spacer'>长文段落 \($0)：滚动状态专用内容。</p>" }.joined(separator: "\n")
        let source = """
        <!doctype html><html><head><meta charset="utf-8"><title>local report</title>
        <style>body{margin:24px}p.spacer{height:52px;margin:0}</style></head>
        <body id="report-root"><a id="pdf-link" href="访谈%20纪要.pdf#page=2">阅读 PDF 第二页</a>
        <a id="pdf-new-tab" href="访谈%20纪要.pdf#page=2" target="_blank">新标签阅读 PDF</a>
        <p id="first-hit">前段专有前文 重复检索 前段专有后文</p>
        \(paragraphs)
        <p id="second-hit">后段专有前文 重复检索 后段专有后文</p>
        <script>window.__reportScriptRuns=(window.__reportScriptRuns||0)+1;document.title='script executed';document.body.dataset.scriptRan='yes';</script>
        </body></html>
        """
        try source.write(to: html, atomically: true, encoding: .utf8)
        let reader = ReaderController()
        reader.view.frame = NSRect(x: 0, y: 0, width: 1000, height: 700)
        defer { reader.close() }
        var links: [(URL, Bool)] = []
        reader.onLink = { url, newTab in links.append((url, newTab)) }
        var positions: [[String: Any]] = []
        reader.onPosition = { positions.append($0) }

        reader.open(html, root: root, trusted: false, state: [:])
        var web = try loadedWeb(reader)
        try check((try evaluate(web, "document.title + '|' + typeof window.__reportScriptRuns")) as? String == "local report|undefined",
                  "默认 HTML 阅读禁用作者脚本")
        try check((try evaluate(web, "typeof window.webkit?.messageHandlers?.simaq")) as? String == "undefined",
                  "独立报告 WKWebView 没有应用 RPC 桥")
        _ = try evaluate(web, "document.getElementById('pdf-link').click(); true")
        try wait("HTML DOM click reaches onLink") { links.count == 1 }
        try check(links[0].0.isFileURL && links[0].0.path == pdfURL.path && links[0].0.fragment == "page=2" && !links[0].1,
                  "实际点击报告 PDF 链接回调保留文件、page=2 与当前标签语义")
        _ = try evaluate(web, "document.getElementById('pdf-new-tab').click(); true")
        try wait("HTML target=_blank click reaches onLink") { links.count == 2 }
        try check(links[1].0.path == pdfURL.path && links[1].0.fragment == "page=2" && links[1].1,
                  "实际点击 target=_blank 链接回调保留新标签语义")
        let destination = links[0].0
        var components = URLComponents(url: destination, resolvingAgainstBaseURL: false)!
        components.fragment = nil
        reader.open(components.url!, root: root, trusted: false, state: [:])
        reader.action("anchor", payload: ["fragment": destination.fragment!])
        try wait("PDFKit reaches linked page") { (reader.state()["page"] as? Int) == 2 }
        let pdf = find(PDFView.self, in: reader.view)
        try check(pdf?.document?.pageCount == 3 && pdf?.currentPage.flatMap { pdf?.document?.index(for: $0) } == 1,
                  "报告点击所得锚点实际定位 PDFKit 第2页")

        reader.open(html, root: root, trusted: true, state: [:])
        web = try loadedWeb(reader)
        try check((try evaluate(web, "document.title + '|' + window.__reportScriptRuns + '|' + document.body.dataset.scriptRan")) as? String == "script executed|1|yes",
                  "信任后重新加载执行作者脚本一次")
        reader.open(html, root: root, trusted: false, state: [:])
        web = try loadedWeb(reader)
        try check((try evaluate(web, "document.title + '|' + typeof window.__reportScriptRuns + '|' + String(document.body.dataset.scriptRan)")) as? String == "local report|undefined|undefined",
                  "撤销信任后重载清除脚本状态并禁用作者脚本")

        _ = try evaluate(web, "window.scrollTo(0,1357); true")
        var capture: [String: Any]?
        reader.captureState { capture = $0 }
        try wait("HTML captureState completion") { capture != nil }
        let actualY = (try evaluate(web, "window.scrollY") as? NSNumber)?.doubleValue ?? -1
        let capturedY = (capture?["scrollY"] as? NSNumber)?.doubleValue ?? -2
        let publishedY = (positions.last?["scrollY"] as? NSNumber)?.doubleValue ?? -3
        try check(actualY > 1000 && abs(actualY - capturedY) < 1 && abs(actualY - publishedY) < 1,
                  "长 HTML captureState 回调与 onPosition 同步返回实际滚动位置")
        let restore = capture!
        reader.open(html, root: root, trusted: false, state: restore)
        web = try loadedWeb(reader)
        try wait("HTML scroll restoration") {
            guard let y = try? evaluate(web, "window.scrollY") as? NSNumber else { return false }
            return abs(y.doubleValue - actualY) < 1
        }
        try check(true, "重新打开长 HTML 恢复已采集滚动位置")

        reader.action("locate", payload: ["match": "重复检索", "before": "后段专有前文 ", "after": " 后段专有后文"])
        try wait("second contextual search hit selected") {
            (try? evaluate(web, "window.getSelection().anchorNode?.parentElement?.closest('p')?.id + '|' + window.getSelection().toString()")) as? String == "second-hit|重复检索"
        }
        try check(true, "重复 HTML 命中按前后文定位第二处")
        reader.action("locate", payload: ["match": "重复检索", "before": "前段专有前文 ", "after": " 前段专有后文"])
        try wait("first contextual search hit selected") {
            (try? evaluate(web, "window.getSelection().anchorNode?.parentElement?.closest('p')?.id + '|' + window.getSelection().toString()")) as? String == "first-hit|重复检索"
        }
        try check(true, "再次查找能从第二处返回第一处且不修改作者 DOM")
        try check((try evaluate(web, "document.querySelectorAll('mark').length === 0 && document.querySelectorAll('#first-hit,#second-hit').length === 2")) as? Bool == true,
                  "重复搜索定位保留报告原有标记结构")
        let report: [String: Any] = ["passed": true, "checks": checks, "fixture": "independent temporary HTML and three-page PDF", "displayedWindow": false]
        let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
        FileHandle.standardOutput.write(json)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    static func main() {
        do { try run() }
        catch {
            FileHandle.standardError.write(Data("Reader navigation acceptance failed: \(error)\n".utf8))
            exit(1)
        }
    }
}
