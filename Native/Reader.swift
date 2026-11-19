import AppKit
import PDFKit
import WebKit
import ImageIO

private final class CenteredImageClipView: NSClipView {
    override func constrainBoundsRect(_ proposedBounds: NSRect) -> NSRect {
        var result = super.constrainBoundsRect(proposedBounds)
        guard let document = documentView else { return result }
        if document.frame.width < result.width {
            result.origin.x = document.frame.midX - result.width / 2
        }
        if document.frame.height < result.height {
            result.origin.y = document.frame.midY - result.height / 2
        }
        return result
    }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2, let reader = enclosingScrollView as? ImageReaderView {
            reader.toggleZoom(at: convert(event.locationInWindow, from:nil))
        } else { super.mouseDown(with:event) }
    }
}

private final class InteractiveImageView: NSImageView {
    private var grabbedPoint: NSPoint?
    override var acceptsFirstResponder: Bool { true }

    override func resetCursorRects() {
        super.resetCursorRects()
        addCursorRect(visibleRect, cursor: .openHand)
    }

    override func mouseDown(with event: NSEvent) {
        guard let reader = enclosingScrollView as? ImageReaderView else { return }
        window?.makeFirstResponder(reader)
        let point = reader.contentView.convert(event.locationInWindow, from: nil)
        if event.clickCount == 2 {
            grabbedPoint = nil
            reader.toggleZoom(at: point)
        } else {
            grabbedPoint = point
            NSCursor.closedHand.set()
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let anchor = grabbedPoint, let reader = enclosingScrollView else { return }
        let clip = reader.contentView
        let pointer = clip.convert(event.locationInWindow, from: nil)
        var bounds = clip.bounds
        bounds.origin.x += anchor.x - pointer.x
        bounds.origin.y += anchor.y - pointer.y
        clip.scroll(to: clip.constrainBoundsRect(bounds).origin)
        reader.reflectScrolledClipView(clip)
    }

    override func mouseUp(with event: NSEvent) {
        grabbedPoint = nil
        window?.invalidateCursorRects(for: self)
        if visibleRect.contains(convert(event.locationInWindow, from: nil)) { NSCursor.openHand.set() }
    }
}

final class ImageReaderView: NSScrollView {
    private let picture = InteractiveImageView()
    private var fitting = true
    private var restore: [String: Any]?
    private var imageSize = NSSize.zero

    init?(url: URL, state: [String: Any]) {
        guard let image = NSImage(contentsOf: url) else { return nil }
        super.init(frame: .zero)
        imageSize = image.size
        if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
           let width = properties[kCGImagePropertyPixelWidth] as? NSNumber,
           let height = properties[kCGImagePropertyPixelHeight] as? NSNumber {
            imageSize = NSSize(width: width.doubleValue, height: height.doubleValue)
        }
        guard imageSize.width > 0, imageSize.height > 0 else { return nil }
        contentView = CenteredImageClipView()
        picture.image = image
        picture.imageScaling = .scaleAxesIndependently
        picture.animates = true
        picture.toolTip = "Double-click to zoom / fit · ⌘ + scroll or pinch to zoom · Scroll or drag to pan · Esc to fit"
        contentView.toolTip = picture.toolTip
        picture.frame = NSRect(origin: .zero, size: imageSize)
        documentView = picture
        hasVerticalScroller = true; hasHorizontalScroller = true
        scrollerStyle = .overlay; autohidesScrollers = true
        backgroundColor = .underPageBackgroundColor
        allowsMagnification = true; minMagnification = 0.001; maxMagnification = 16
        fitting = state["fit"] as? Bool ?? true
        restore = state
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layout() {
        super.layout()
        guard contentSize.width > 0, contentSize.height > 0 else { return }
        if fitting {
            let factor = max(minMagnification, min(1, contentSize.width / imageSize.width, contentSize.height / imageSize.height))
            if abs(magnification - factor) > 0.0001 { magnification = factor }
        }
        if let state = restore {
            restore = nil
            if !fitting, let zoom = state["zoom"] as? Double { magnification = min(16, max(0.001, zoom)) }
            contentView.scroll(to: NSPoint(x: (state["scrollX"] as? Double) ?? 0, y: (state["scrollY"] as? Double) ?? 0))
            reflectScrolledClipView(contentView)
        }
        centerSmallImage()
    }
    override var acceptsFirstResponder: Bool { true }
    private func centerSmallImage() {
        contentView.setBoundsOrigin(contentView.constrainBoundsRect(contentView.bounds).origin)
        reflectScrolledClipView(contentView)
    }
    override func magnify(with event: NSEvent) {
        fitting = false; super.magnify(with: event); centerSmallImage()
    }
    override func scrollWheel(with event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            guard event.scrollingDeltaY != 0 else { return }
            zoom(event.scrollingDeltaY > 0 ? 1.1 : 1 / 1.1,
                 at:contentView.convert(event.locationInWindow,from:nil))
        } else if event.hasPreciseScrollingDeltas {
            // AppKit owns the complete trackpad gesture, including momentum.
            super.scrollWheel(with: event)
        } else {
            var dx = event.scrollingDeltaX, dy = event.scrollingDeltaY
            if event.modifierFlags.contains(.shift) && dx == 0 { dx = dy; dy = 0 }
            var bounds = contentView.bounds
            bounds.origin.x -= dx * horizontalLineScroll / magnification
            bounds.origin.y += dy * (contentView.isFlipped ? -1 : 1) * verticalLineScroll / magnification
            contentView.scroll(to: contentView.constrainBoundsRect(bounds).origin)
            reflectScrolledClipView(contentView)
        }
    }
    override func mouseDown(with event: NSEvent) {
        if event.clickCount == 2 { toggleZoom(at:contentView.convert(event.locationInWindow,from:nil)) }
        else { super.mouseDown(with:event) }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { fit() } else { super.keyDown(with:event) }
    }
    func zoom(_ factor: CGFloat, at point: NSPoint? = nil) {
        fitting = false
        setMagnification(min(maxMagnification, max(minMagnification, magnification * factor)),
                         centeredAt:point ?? NSPoint(x:contentView.bounds.midX,y:contentView.bounds.midY))
        centerSmallImage()
    }
    func toggleZoom(at point: NSPoint? = nil) {
        window?.makeFirstResponder(self)
        if fitting { zoom(max(1, magnification * 2) / magnification, at:point) }
        else { fit() }
    }
    func fit() { fitting = true; needsLayout = true; layoutSubtreeIfNeeded() }
    func actualSize() { zoom(1 / magnification) }
    func snapshot() -> [String: Any] {
        ["zoom":Double(magnification), "fit":fitting, "scrollX":Double(contentView.bounds.origin.x), "scrollY":Double(contentView.bounds.origin.y)]
    }
    func printImage() { NSPrintOperation(view: picture).run() }
}

/// A reader has its own WebKit process/configuration and never installs the app's message bridge.
final class ReaderController: NSObject, WKNavigationDelegate, WKUIDelegate, PDFViewDelegate {
    let view = NSView()
    var onLink: ((URL, Bool) -> Void)?
    var onPosition: (([String: Any]) -> Void)?
    private let toolbar = NSStackView()
    private let content = NSView()
    private var web: WKWebView?
    private var pdf: PDFView?
    private var image: ImageReaderView?
    private var imageButtons: [NSButton] = []
    private var documentURL: URL?
    private var rootURL: URL?
    private var saved: [String: Any] = [:]
    private var generation = UUID()
    private var observer: NSObjectProtocol?
    private let pageField = NSTextField(string: "")
    private let outline = NSPopUpButton()
    private var outlineDestinations: [PDFDestination] = []
    private var htmlZoom: CGFloat = 1
    private let ruleStore = WKContentRuleListStore(url: FileManager.default.temporaryDirectory.appendingPathComponent("SimaQ-reader-rules", isDirectory: true))
    private var pendingActions: [(String, [String: Any])] = []
    private var webReady = false
    private var positionTimer: Timer?

    override init() {
        super.init()
        view.wantsLayer = true
        toolbar.orientation = .horizontal
        toolbar.alignment = .centerY
        toolbar.spacing = 5
        toolbar.edgeInsets = NSEdgeInsets(top: 4, left: 8, bottom: 4, right: 8)
        for (title, selector) in [("‹", #selector(back)), ("›", #selector(forward)), ("−", #selector(zoomOut)), ("+", #selector(zoomIn)), ("复制引用", #selector(copyReference)), ("打印", #selector(printDocument))] {
            let b = NSButton(title: title, target: self, action: selector)
            b.bezelStyle = .rounded
            toolbar.addArrangedSubview(b)
        }
        for (title, selector) in [("Fit", #selector(fitImage)), ("100%", #selector(actualImageSize))] {
            let button = NSButton(title: title, target: self, action: selector)
            button.bezelStyle = .rounded; button.isHidden = true
            imageButtons.append(button); toolbar.addArrangedSubview(button)
        }
        pageField.placeholderString = "页码"
        pageField.target = self; pageField.action = #selector(goToPage)
        pageField.widthAnchor.constraint(equalToConstant: 55).isActive = true
        toolbar.addArrangedSubview(pageField)
        outline.target = self; outline.action = #selector(goToOutline)
        outline.widthAnchor.constraint(lessThanOrEqualToConstant: 220).isActive = true
        toolbar.addArrangedSubview(outline)
        view.addSubview(toolbar); view.addSubview(content)
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.topAnchor), toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor), toolbar.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor),
            content.topAnchor.constraint(equalTo: toolbar.bottomAnchor), content.leadingAnchor.constraint(equalTo: view.leadingAnchor), content.trailingAnchor.constraint(equalTo: view.trailingAnchor), content.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    func open(_ url: URL, root: URL, trusted: Bool, state: [String: Any]) {
        close()
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let canonicalURL = url.standardizedFileURL.resolvingSymlinksInPath()
        guard Self.isInside(canonicalURL, root: canonicalRoot) else { return }
        documentURL = canonicalURL; rootURL = canonicalRoot; saved = state
        let token = UUID(); generation = token
        if Self.isImage(canonicalURL) {
            pageField.isHidden = true; outline.isHidden = true
            imageButtons.forEach { $0.isHidden = false }
            if let preview = ImageReaderView(url: canonicalURL, state: state) {
                image = preview; install(preview)
                positionTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in _ = self?.state() }
            } else {
                let error = NSTextField(wrappingLabelWithString: "Unable to decode image: " + canonicalURL.lastPathComponent)
                error.alignment = .center; install(error)
            }
        } else if canonicalURL.pathExtension.lowercased() == "pdf" {
            let p = PDFView(); p.autoScales = true; p.displayMode = .singlePageContinuous
            p.delegate = self; p.document = PDFDocument(url: canonicalURL)
            pdf = p; install(p)
            if let scroll = p.documentView?.enclosingScrollView {
                scroll.scrollerStyle = .overlay
                scroll.autohidesScrollers = true
            }
            if let scale = state["zoom"] as? Double, scale > 0 { p.autoScales = false; p.scaleFactor = CGFloat(scale) }
            if let page = state["page"] as? Int, let dest = p.document?.page(at: max(0, page - 1)) { p.go(to: dest) }
            fillOutline()
            observer = NotificationCenter.default.addObserver(forName: .PDFViewPageChanged, object: p, queue: .main) { [weak self] _ in self?.recordPDFPosition() }
            recordPDFPosition()
        } else {
            pageField.isHidden = true; outline.isHidden = true
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .nonPersistent()
            config.defaultWebpagePreferences.allowsContentJavaScript = trusted
            if let url = Bundle.main.url(forResource:"document-scrollbar", withExtension:"js", subdirectory:"Web"),
               let helper = try? String(contentsOf:url, encoding:.utf8) {
                let install = """
                const style = document.createElement('style');
                style.textContent = ':root::-webkit-scrollbar { width:0 } @media print { .sima-scroll-layer { display:none !important } }';
                document.head.append(style);
                SimaScrollbar.attach(document.scrollingElement || document.documentElement);
                """
                config.userContentController.addUserScript(WKUserScript(source:helper + "\n" + install, injectionTime:.atDocumentEnd, forMainFrameOnly:true, in:.defaultClient))
            }
            // Block every network subresource, including in trusted local charts.
            let rules = "[{\"trigger\":{\"url-filter\":\"^https?://\"},\"action\":{\"type\":\"block\"}},{\"trigger\":{\"url-filter\":\"^wss?://\"},\"action\":{\"type\":\"block\"}}]"
            ruleStore?.compileContentRuleList(forIdentifier: "SimaQ.Reader.NoNetwork", encodedContentRuleList: rules) { [weak self] list, error in
                if let error = error { NSLog("Reader content rules: %@", String(describing: error)) }
                DispatchQueue.main.async {
                    guard let self = self, self.generation == token, let list = list else { return }
                    config.userContentController.add(list)
                    let w = WKWebView(frame: .zero, configuration: config)
                    w.navigationDelegate = self; w.uiDelegate = self
                    w.allowsBackForwardNavigationGestures = true
                    self.web = w; self.install(w)
                    self.positionTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in _ = self?.state() }
                    self.htmlZoom = CGFloat((state["zoom"] as? Double) ?? 1)
                    w.pageZoom = self.htmlZoom
                    w.loadFileURL(canonicalURL, allowingReadAccessTo: canonicalRoot)
                }
            }
        }
    }

    private func install(_ child: NSView) {
        content.subviews.forEach { $0.removeFromSuperview() }
        content.addSubview(child); child.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([child.topAnchor.constraint(equalTo: content.topAnchor), child.bottomAnchor.constraint(equalTo: content.bottomAnchor), child.leadingAnchor.constraint(equalTo: content.leadingAnchor), child.trailingAnchor.constraint(equalTo: content.trailingAnchor)])
    }
    static func isInside(_ url: URL, root: URL) -> Bool {
        guard url.isFileURL else { return false }
        // Resolve an existing ancestor too: resolvingSymlinksInPath on a missing
        // leaf alone does not reliably resolve a symlink in its parent.
        var ancestor = url.standardizedFileURL
        var suffix: [String] = []
        while !FileManager.default.fileExists(atPath: ancestor.path), ancestor.path != "/" {
            suffix.insert(ancestor.lastPathComponent, at: 0)
            ancestor.deleteLastPathComponent()
        }
        var resolved = ancestor.resolvingSymlinksInPath()
        for component in suffix { resolved.appendPathComponent(component) }
        let path = resolved.standardizedFileURL.path
        let base = root.standardizedFileURL.resolvingSymlinksInPath().path
        return path == base || path.hasPrefix(base.hasSuffix("/") ? base : base + "/")
    }
    static func isImage(_ url: URL) -> Bool {
        ["png","apng","jpg","jpeg","gif","webp","avif","heic","heif","tif","tiff","bmp","ico"].contains(url.pathExtension.lowercased())
    }
    func close() {
        generation = UUID()
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil; web?.stopLoading(); web?.navigationDelegate = nil; web?.uiDelegate = nil
        pdf?.delegate = nil; web = nil; pdf = nil; image = nil
        imageButtons.forEach { $0.isHidden = true }
        content.subviews.forEach { $0.removeFromSuperview() }
        positionTimer?.invalidate(); positionTimer = nil
        documentURL = nil; rootURL = nil; saved = [:]; pendingActions = []; webReady = false
        pageField.isHidden = false; outline.isHidden = false
    }
    func state() -> [String: Any] {
        captureState { _ in }
        return saved
    }
    func captureState(_ completion: @escaping ([String: Any]) -> Void) {
        if let image = image { saved = image.snapshot(); onPosition?(saved) }
        if pdf != nil { recordPDFPosition() }
        if let web = web {
            let snapshot = saved
            web.evaluateJavaScript("({scrollX:window.scrollX,scrollY:window.scrollY})") { [weak self] value, _ in
                guard let self = self, self.web === web else { completion(snapshot); return }
                guard let pos = value as? [String: Any] else { completion(self.saved); return }
                self.saved.merge(pos) { _, new in new }; self.onPosition?(self.saved)
                completion(self.saved)
            }
        } else { completion(saved) }
    }
    private func recordPDFPosition() {
        guard let p = pdf, let doc = p.document, let page = p.currentPage else { return }
        let number = doc.index(for: page) + 1
        pageField.stringValue = "\(number) / \(doc.pageCount)"
        saved["page"] = number; saved["zoom"] = Double(p.scaleFactor)
        onPosition?(saved)
    }
    private func fillOutline() {
        outline.removeAllItems(); outlineDestinations.removeAll()
        outline.addItem(withTitle: "目录")
        guard let root = pdf?.document?.outlineRoot else { return }
        func add(_ node: PDFOutline, _ depth: Int) {
            if let dest = node.destination ?? (node.action as? PDFActionGoTo)?.destination {
                outline.addItem(withTitle: String(repeating: "  ", count: depth) + (node.label ?? "未命名"))
                outlineDestinations.append(dest)
            }
            for i in 0..<node.numberOfChildren { if let child = node.child(at: i) { add(child, depth + 1) } }
        }
        for i in 0..<root.numberOfChildren { if let child = root.child(at: i) { add(child, 0) } }
    }
    @objc private func goToOutline() { let i = outline.indexOfSelectedItem - 1; if outlineDestinations.indices.contains(i) { pdf?.go(to: outlineDestinations[i]) } }
    @objc private func goToPage() { if let n = Int(pageField.stringValue.split(separator: "/").first?.trimmingCharacters(in: .whitespaces) ?? ""), let page = pdf?.document?.page(at: n - 1) { pdf?.go(to: page) } }
    @objc private func back() { if let p = pdf { p.goBack(nil) } else { web?.goBack() } }
    @objc private func forward() { if let p = pdf { p.goForward(nil) } else { web?.goForward() } }
    @objc private func zoomIn() { zoom(1.2) }
    @objc private func zoomOut() { zoom(1 / 1.2) }
    private func zoom(_ factor: CGFloat) {
        if let image = image { image.zoom(factor); _ = state() }
        if let p = pdf { p.autoScales = false; p.scaleFactor *= factor; recordPDFPosition() }
        if let w = web { htmlZoom = min(4, max(0.4, htmlZoom * factor)); w.pageZoom = htmlZoom; saved["zoom"] = Double(htmlZoom); onPosition?(saved) }
    }
    @objc private func fitImage() { image?.fit() }
    @objc private func actualImageSize() { image?.actualSize(); _ = state() }
    @objc private func copyReference() {
        guard let url = documentURL, let root = rootURL else { return }
        let base = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let path = url.path.hasPrefix(base) ? String(url.path.dropFirst(base.count)) : url.lastPathComponent
        let suffix = (saved["page"] as? Int).map { "#page=\($0)" } ?? ""
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(path + suffix, forType: .string)
    }
    @objc private func printDocument() { if let image = image { image.printImage() } else if let p = pdf { p.print(with: NSPrintInfo.shared, autoRotate: true) } else if let w = web { w.printOperation(with: NSPrintInfo.shared).run() } }
    func action(_ name: String, payload: [String: Any]) {
        if image != nil && ["locate", "anchor", "find"].contains(name) { return }
        if documentURL?.pathExtension.lowercased() != "pdf", !webReady, ["locate", "anchor", "find"].contains(name) {
            pendingActions.append((name, payload)); return
        }
        switch name {
        case "locate": locate(payload)
        case "anchor":
            let fragment = payload["fragment"] as? String ?? ""
            if let p = pdf, fragment.hasPrefix("page="), let n = Int(fragment.dropFirst(5)), let page = p.document?.page(at: n - 1) { p.go(to: page) }
            else { runJS("document.getElementById(\(js(fragment)))?.scrollIntoView()") }
        case "find":
            let q = payload["q"] as? String ?? ""
            if let p = pdf, !q.isEmpty, let selection = p.document?.findString(q, withOptions: [.caseInsensitive]).first { p.setCurrentSelection(selection, animate: true); p.go(to: selection) }
            else if !q.isEmpty { runJS("window.find(\(js(q)))") }
        case "back": back()
        case "forward": forward()
        case "zoomIn": zoomIn()
        case "zoomOut": zoomOut()
        case "fit": fitImage()
        case "actualSize": actualImageSize()
        case "print": printDocument()
        case "copyReference": copyReference()
        default: break
        }
    }
    private func locate(_ hit: [String: Any]) {
        if let p = pdf, let number = hit["page"] as? Int, number > 0, let page = p.document?.page(at: number - 1) {
            p.go(to: page)
            if let start = hit["start"] as? Int, let length = hit["length"] as? Int, start >= 0, length > 0, let text = page.string, start <= (text as NSString).length, length <= (text as NSString).length - start, let selection = page.selection(for: NSRange(location: start, length: length)) {
                p.setCurrentSelection(selection, animate: true); p.go(to: selection)
            }
        } else if web != nil {
            let match = hit["match"] as? String ?? ""
            let before = hit["before"] as? String ?? ""
            let after = hit["after"] as? String ?? ""
            let occurrence = max(0, hit["occurrence"] as? Int ?? 0)
            // Walk text nodes rather than changing the document's author-supplied markup.
            let script = """
            (()=>{const needle=\(js(match)),before=\(js(before)),after=\(js(after)); if(!needle)return; let w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT),n, nodes=[],s=''; while(n=w.nextNode()){if(!n.parentElement.closest('script,style,noscript')){nodes.push([n,s.length,s.length+n.data.length]);s+=n.data;}} let matches=[],pos=-1;
            while((pos=s.indexOf(needle,pos+1))>=0)matches.push(pos);
            if(!matches.length)return;
            function contextScore(at){
              const left=s.slice(Math.max(0,at-80),at).replace(/\\s/g,''),right=s.slice(at+needle.length,at+needle.length+80).replace(/\\s/g,'');
              const b=before.replace(/\\s/g,''),a=after.replace(/\\s/g,'');let i=0,j=0;
              while(i<left.length&&i<b.length&&left.at(-1-i)===b.at(-1-i))i++;
              while(j<right.length&&j<a.length&&right[j]===a[j])j++;
              return i+j;
            }
            const ordinal=Math.min(\(occurrence),matches.length-1);
            let at=matches[ordinal],score=contextScore(at);
            for(const pos of matches){const next=contextScore(pos);if(next>score){at=pos;score=next;}}
            let a=nodes.find(x=>x[1]<=at&&x[2]>at),b=nodes.find(x=>x[1]<at+needle.length&&x[2]>=at+needle.length);if(!a||!b)return;let r=document.createRange();r.setStart(a[0],at-a[1]);r.setEnd(b[0],at+needle.length-b[1]);let sel=window.getSelection();sel.removeAllRanges();sel.addRange(r);a[0].parentElement.scrollIntoView({block:'center'});})()
            """
            runJS(script)
        }
    }
    private func js(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value], options: [.fragmentsAllowed])
        let array = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(array.dropFirst().dropLast())
    }
    private func runJS(_ script: String) { web?.evaluateJavaScript(script, completionHandler: nil) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if let y = saved["scrollY"] as? Double { runJS("window.scrollTo(\((saved["scrollX"] as? Double) ?? 0), \(y))") }
        webReady = true
        let queued = pendingActions; pendingActions = []
        for (name, payload) in queued { action(name, payload: payload) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.navigationType == .linkActivated {
            if let current = documentURL, url.isFileURL, url.standardizedFileURL.resolvingSymlinksInPath().path == current.path, url.fragment != nil { decisionHandler(.allow); return }
            let newTab = action.modifierFlags.contains(.command) || action.targetFrame == nil
            onLink?(url, newTab); decisionHandler(.cancel); return
        }
        guard let root = rootURL, Self.isInside(url, root: root) else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func pdfViewWillClick(onLink sender: PDFView, with url: URL) { onLink?(url, NSEvent.modifierFlags.contains(.command)) }
}
