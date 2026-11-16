import AppKit
import WebKit

/// A separate browser window with no notebook bridge or filesystem access.
@MainActor
final class WeChatDraftWindow: NSWindowController, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    private static var openWindows = [WeChatDraftWindow]()
    private let browser: WKWebView
    private let status = NSTextField(wrappingLabelWithString: "")
    private let titleText: String
    private let articleHTML: String
    private let plainText: String
    private var feedbackVersion = 0
    private let script: String
    private let imageCount: Int
    private var poll: Timer?
    private var running = false

    static func present(title: String, html: String, plainText: String, missingImageCount: Int) throws {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("Web/wechat-editor.js") else {
            throw CocoaError(.fileNoSuchFile)
        }
        let controller = try WeChatDraftWindow(title: title, html: html, plainText: plainText, missing: missingImageCount,
                                               script: String(contentsOf: url, encoding: .utf8))
        openWindows.append(controller)
        controller.showWindow(nil)
        controller.browser.load(URLRequest(url: URL(string: "https://mp.weixin.qq.com/")!))
        controller.poll = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak controller] _ in
            Task { @MainActor in controller?.advance() }
        }
    }

    private init(title: String, html: String, plainText: String, missing: Int, script: String) {
        self.titleText = title
        self.articleHTML = html
        self.plainText = plainText
        self.imageCount = missing
        self.script = script + "\nreturn await fillWeChatEditor(title, html, window.location, part);"
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        browser = WKWebView(frame: .zero, configuration: config)
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1080, height: 760),
                           styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        super.init(window: win)
        win.title = "微信公众号 · " + title
        win.isReleasedWhenClosed = false
        win.center()
        win.delegate = self
        browser.navigationDelegate = self
        browser.uiDelegate = self
        status.stringValue = "请在微信公众平台扫码或选择公众号。验证完成后会继续填写文章。"
        let copyTitle = NSButton(title: "复制标题", target: self, action: #selector(copyArticleTitle))
        let copyBody = NSButton(title: "复制排版正文", target: self, action: #selector(copyArticleBody))
        let bar = NSStackView(views: [status, copyTitle, copyBody])
        bar.spacing = 12
        guard let view = win.contentView else { return }
        for item in [bar, browser] as [NSView] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 14),
            bar.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -14),
            bar.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            browser.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 8),
            browser.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }
    required init?(coder: NSCoder) { fatalError("Unsupported") }

    @objc private func copyArticleTitle() { copyArticlePart(isBody: false) }
    @objc private func copyArticleBody() { copyArticlePart(isBody: true) }

    private func copyArticlePart(isBody: Bool) {
        feedbackVersion += 1
        let version = feedbackVersion
        let name = isBody ? "正文" : "标题"
        let item = NSPasteboardItem()
        let textOK = item.setString(isBody ? plainText : titleText, forType: .string)
        let htmlOK = !isBody || item.setData(Data(("<meta charset=\"utf-8\">" + articleHTML).utf8), forType: .html)
        let board = NSPasteboard.general
        guard textOK, htmlOK else { status.stringValue = "准备复制失败，请重试。"; return }
        board.clearContents()
        guard board.writeObjects([item]) else { status.stringValue = "写入剪贴板失败，请重试。"; return }

        let pasteHint = "\(name)已复制。点选\(name)输入区，按 ⌘V 粘贴。"
        status.stringValue = pasteHint
        guard let url = browser.url, url.scheme == "https", url.host == "mp.weixin.qq.com",
              url.path == "/cgi-bin/appmsg", !browser.isLoading else { return }
        poll?.invalidate()
        poll = nil
        browser.callAsyncJavaScript(script, arguments: ["title": titleText, "html": articleHTML, "part": isBody ? "body" : "title"],
                                    in: nil, in: .defaultClient) { [weak self] result in
            guard let self, self.feedbackVersion == version else { return }
            if case .success(let value) = result, value as? String == "filled" {
                self.status.stringValue = "\(name)已复制，并已填入空白\(name)栏。"
            }
        }
    }
    private func stop(_ message: String) {
        poll?.invalidate()
        poll = nil
        status.stringValue = message
    }
    private func advance() {
        guard !running, !browser.isLoading, let url = browser.url,
              url.scheme == "https", url.host == "mp.weixin.qq.com",
              ["/cgi-bin/home", "/cgi-bin/appmsg"].contains(url.path) else { return }
        running = true
        let version = feedbackVersion
        let args: [String: Any] = ["part": "both", "title": url.path == "/cgi-bin/appmsg" ? titleText : "",
                                   "html": url.path == "/cgi-bin/appmsg" ? articleHTML : ""]
        browser.callAsyncJavaScript(script, arguments: args,
                                    in: nil, in: .defaultClient) { [weak self] result in
            guard let self else { return }
            self.running = false
            guard self.feedbackVersion == version else { return }
            switch result {
            case .success(let value):
                switch value as? String {
                case "home": self.status.stringValue = "正在打开新文章。如后台布局有变化，可手动点「文章」。"
                case "loading": self.status.stringValue = "正在等待编辑器。若输入框未被识别，可使用右侧复制按钮。"
                case "occupied": self.stop("草稿中已有内容。点击右侧按钮可填入空白栏，或复制后自行粘贴。")
                case "partial": self.stop("请核对标题和正文。需要补填时，可使用右侧复制按钮。")
                case "longTitle": self.stop("标题超出编辑器限制。请复制标题后缩短，并粘贴排版正文。")
                case "filled":
                    let note = self.imageCount > 0 ? "有 \(self.imageCount) 张图片需要在标记处补入。" : ""
                    self.stop("标题和正文已填入。" + note + "请在此设置封面、原创声明并保存草稿。")
                default: break
                }
            case .failure:
                if self.browser.url == url && !self.browser.isLoading {
                    self.status.stringValue = "可在公众号后台打开新文章，并通过右侧按钮复制标题和排版正文。"
                }
            }
        }
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url,
           url.scheme == "https", url.host == "mp.weixin.qq.com" {
            webView.load(navigationAction.request)
        }
        return nil
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        guard let window else { completionHandler(false); return }
        let alert = NSAlert()
        alert.messageText = frame.request.url?.host ?? "微信公众号"
        alert.informativeText = message
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        guard let window else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        guard (error as NSError).code != NSURLErrorCancelled else { return }
        status.stringValue = "微信公众号页面未能载入。请检查网络后重新打开发布命令。"
    }
    func windowWillClose(_ notification: Notification) {
        poll?.invalidate()
        Self.openWindows.removeAll { $0 === self }
    }
}
