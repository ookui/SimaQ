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
        if CommandLine.arguments.contains("--images") {
            let folder = root.appendingPathComponent("Logs/images", isDirectory:true)
            try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
            let original = try Data(contentsOf:URL(fileURLWithPath:"Web/brand-q.png"))
            let bitmap = NSBitmapImageRep(data:original)!
            for (ext, type) in [("PNG", NSBitmapImageRep.FileType.png), ("jpg", .jpeg), ("gif", .gif), ("tiff", .tiff), ("bmp", .bmp)] {
                let url = folder.appendingPathComponent("图 像 # 1." + ext)
                try bitmap.representation(using:type,properties:[:])!.write(to:url)
                precondition(ReaderController.isImage(url))
                guard let preview = ImageReaderView(url:url,state:[:]) else { fatalError("Cannot decode \(ext)") }
                preview.frame = NSRect(x:0,y:0,width:640,height:480)
                preview.layoutSubtreeIfNeeded()
                func centered(_ label: String) {
                    let frame = preview.documentView!.frame, visible = preview.contentView.bounds
                    if frame.width <= visible.width { precondition(abs(frame.midX-visible.midX)<1, "\(ext) horizontal center: \(label)") }
                    if frame.height <= visible.height { precondition(abs(frame.midY-visible.midY)<1, "\(ext) vertical center: \(label)") }
                }
                centered("initial fit")
                let fitted = preview.magnification
                let click = NSEvent.mouseEvent(with:.leftMouseDown,location:NSPoint(x:200,y:150),modifierFlags:[],timestamp:0,windowNumber:0,context:nil,eventNumber:1,clickCount:2,pressure:1)!
                preview.documentView!.mouseDown(with:click)
                precondition(preview.magnification > fitted, "\(ext) double click zooms")
                preview.documentView!.mouseDown(with:click)
                precondition(abs(preview.magnification-fitted)<0.001, "\(ext) second double click fits")
                let wheels: [(CGScrollEventUnit, CGEventFlags, Int32)] = [
                    (.line, [], 1), (.line, [], -1), (.pixel, [], 10),
                    (.line, .maskCommand, 1), (.line, .maskCommand, -1),
                    (.pixel, .maskCommand, 10), (.pixel, .maskControl, 10)
                ]
                for (unit, flags, delta) in wheels {
                    let wheel = CGEvent(scrollWheelEvent2Source:nil,units:unit,wheelCount:1,wheel1:delta,wheel2:0,wheel3:0)!
                    wheel.flags = flags
                    let before = preview.magnification
                    preview.documentView!.scrollWheel(with:NSEvent(cgEvent:wheel)!)
                    if !flags.contains(.maskCommand) {
                        precondition(preview.magnification == before, "\(ext) unmodified and Control scrolling preserve zoom")
                    } else if delta > 0 {
                        precondition(preview.magnification > before, "\(ext) wheel zooms in")
                    } else {
                        precondition(preview.magnification < before, "\(ext) wheel zooms out")
                    }
                }
                preview.actualSize()
                preview.zoom(16)
                let clip = preview.contentView
                clip.scroll(to: NSPoint(x:18, y:18))
                let beforeWheel = clip.bounds.origin
                let scroll = CGEvent(scrollWheelEvent2Source:nil,units:.line,wheelCount:1,wheel1:1,wheel2:0,wheel3:0)!
                preview.documentView!.scrollWheel(with:NSEvent(cgEvent:scroll)!)
                precondition(clip.bounds.minY != beforeWheel.y && preview.magnification == 16, "Plain wheel scrolls enlarged image")
                clip.scroll(to:beforeWheel)
                let origin = clip.bounds.origin
                func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat) -> NSEvent {
                    NSEvent.mouseEvent(with:type, location:NSPoint(x:x,y:y), modifierFlags:[],
                        timestamp:0, windowNumber:0, context:nil, eventNumber:1, clickCount:1, pressure:1)!
                }
                let pic = preview.documentView!
                pic.mouseDown(with:mouse(.leftMouseDown,200,180))
                pic.mouseDragged(with:mouse(.leftMouseDragged,104,116))
                let moved = clip.bounds.origin
                precondition(abs(abs(moved.x-origin.x)*16-96)<1 && abs(abs(moved.y-origin.y)*16-64)<1, "Drag follows the pointer at 1600%")
                pic.mouseDragged(with:mouse(.leftMouseDragged,200,180))
                precondition(hypot(clip.bounds.minX-origin.x, clip.bounds.minY-origin.y)<0.1, "Reverse drag returns to the grabbed point")
                pic.mouseUp(with:mouse(.leftMouseUp,200,180))
                let released = clip.bounds.origin
                pic.mouseDragged(with:mouse(.leftMouseDragged,90,70))
                precondition(clip.bounds.origin == released, "Releasing stops pan")
                preview.actualSize();preview.zoom(0.2);centered("zoomed out")
                preview.frame = NSRect(x:0,y:0,width:900,height:700)
                preview.layoutSubtreeIfNeeded();centered("resized")
                preview.fit();centered("fit again")
                preview.zoom(2)
                let escape = NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:0,windowNumber:0,context:nil,characters:"\u{1b}",charactersIgnoringModifiers:"\u{1b}",isARepeat:false,keyCode:53)!
                preview.keyDown(with:escape)
                precondition(preview.snapshot()["fit"] as? Bool == true, "\(ext) Escape fits image")
                preview.actualSize()
                preview.zoom(2)
                precondition((preview.snapshot()["zoom"] as? Double) == 2)
                let restored = ImageReaderView(url:url,state:preview.snapshot())!
                restored.frame = preview.frame; restored.layoutSubtreeIfNeeded()
                precondition((restored.snapshot()["zoom"] as? Double) == 2)
            }
            for ext in ["apng","jpeg","webp","avif","heic","heif","tif","ico"] {
                precondition(ReaderController.isImage(folder.appendingPathComponent("asset." + ext)))
            }
            precondition(!ReaderController.isImage(html))
            let corrupt = folder.appendingPathComponent("broken.png")
            try Data("broken".utf8).write(to:corrupt)
            precondition(ImageReaderView(url:corrupt,state:[:]) == nil)
            print("Image reader: PNG/JPEG/GIF/TIFF/BMP decode, centering, double-click, Command-wheel zoom, plain-wheel handling, bidirectional drag at 1600%, resize, restore and invalid-file tests passed")
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
