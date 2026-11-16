import AppKit
import PDFKit
import WebKit

/// A reader has its own WebKit process/configuration and never installs the app's message bridge.
final class ReaderController: NSObject, WKNavigationDelegate, WKUIDelegate, PDFViewDelegate {
    let view = NSView()
    var onLink: ((URL, Bool) -> Void)?
    var onPosition: (([String: Any]) -> Void)?
    private let toolbar = NSStackView()
    private let content = NSView()
    private var web: WKWebView?
    private var pdf: PDFView?
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
        if canonicalURL.pathExtension.lowercased() == "pdf" {
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
    func close() {
        generation = UUID()
        if let observer = observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil; web?.stopLoading(); web?.navigationDelegate = nil; web?.uiDelegate = nil
        pdf?.delegate = nil; web = nil; pdf = nil
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
        if let p = pdf { p.autoScales = false; p.scaleFactor *= factor; recordPDFPosition() }
        if let w = web { htmlZoom = min(4, max(0.4, htmlZoom * factor)); w.pageZoom = htmlZoom; saved["zoom"] = Double(htmlZoom); onPosition?(saved) }
    }
    @objc private func copyReference() {
        guard let url = documentURL, let root = rootURL else { return }
        let base = root.path.hasSuffix("/") ? root.path : root.path + "/"
        let path = url.path.hasPrefix(base) ? String(url.path.dropFirst(base.count)) : url.lastPathComponent
        let suffix = (saved["page"] as? Int).map { "#page=\($0)" } ?? ""
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(path + suffix, forType: .string)
    }
    @objc private func printDocument() { if let p = pdf { p.print(with: NSPrintInfo.shared, autoRotate: true) } else if let w = web { w.printOperation(with: NSPrintInfo.shared).run() } }
    func action(_ name: String, payload: [String: Any]) {
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
