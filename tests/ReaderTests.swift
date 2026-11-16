import AppKit
import PDFKit
import WebKit

@main struct ReaderTests {
    static func spin(_ seconds: TimeInterval) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
    static func findWeb(_ v: NSView) -> WKWebView? {
        if let w = v as? WKWebView { return w }
        for c in v.subviews { if let w = findWeb(c) { return w } }
        return nil
    }
    static func main() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let html = root.appendingPathComponent("report.html")
        try "<html><body><p id='target'>Alpha Physical-AI Beta</p><script>document.title='ran'</script></body></html>".write(to: html, atomically: true, encoding: .utf8)
        precondition(ReaderController.isInside(html, root: root))
        precondition(!ReaderController.isInside(root.deletingLastPathComponent().appendingPathComponent(root.lastPathComponent + "-other/file"), root: root))
        let escape = root.appendingPathComponent("escape")
        try FileManager.default.createSymbolicLink(at: escape, withDestinationURL: root.deletingLastPathComponent())
        precondition(!ReaderController.isInside(escape.appendingPathComponent("outside.html"), root: root))
        if CommandLine.arguments.contains("--boundary-only") {
            print("Reader filesystem boundary tests passed")
            return
        }
        _ = NSApplication.shared
        let reader = ReaderController()
        reader.open(html, root: root, trusted: false, state: [:])
        reader.action("locate", payload: ["match": "Physical-AI", "before": "Alpha ", "after": " Beta"])
        spin(3)
        guard let web = findWeb(reader.view) else { fatalError("HTML reader did not open") }
        var result: String?
        web.evaluateJavaScript("document.title + '|' + window.getSelection().toString()") { value, _ in result = value as? String }
        spin(1)
        precondition(result == "|Physical-AI", "Untrusted scripts or search selection failed: \(result ?? "nil")")
        reader.open(html, root: root, trusted: true, state: [:]); spin(3)
        guard let trustedWeb = findWeb(reader.view) else { fatalError("Trusted reader did not open") }
        result = nil
        trustedWeb.evaluateJavaScript("document.title") { value, _ in result = value as? String }
        spin(1)
        precondition(result == "ran", "Trusted local script did not run")
        var position: [String:Any]?
        trustedWeb.evaluateJavaScript("document.body.style.height='10000px';window.scrollTo(0,500)") { _, _ in
            reader.captureState { position = $0 }
        }
        spin(1)
        precondition((position?["scrollY"] as? Double) == 500, "Asynchronous HTML position capture failed")
        reader.close()
        print("Reader tests passed")
    }
}
