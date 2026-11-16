import AppKit
import WebKit

final class DocumentExporter: NSObject, WKNavigationDelegate {
    let web = WKWebView(frame:NSRect(x:0,y:0,width:820,height:1120),configuration:WKWebViewConfiguration())
    private var completion: ((Result<Any,Error>) -> Void)?
    private var destination: URL?
    private var printOnly = false
    private weak var window: NSWindow?
    init(window:NSWindow) {
        self.window = window
        super.init()
        web.configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        web.navigationDelegate = self
    }
    func begin(html:String, base:URL?, destination:URL?, printOnly:Bool, completion:@escaping (Result<Any,Error>)->Void) {
        guard self.completion == nil else { completion(.failure(SQError.message("已有导出任务正在进行"))); return }
        self.destination = destination
        self.printOnly = printOnly
        self.completion = completion
        web.loadHTMLString(html,baseURL:base)
    }
    private func finish(_ result:Result<Any,Error>) {
        let callback = completion
        completion = nil
        callback?(result)
    }
    func webView(_ webView:WKWebView,didFailProvisionalNavigation navigation:WKNavigation!,withError error:Error) { finish(.failure(error)) }
    func webView(_ webView:WKWebView,didFail navigation:WKNavigation!,withError error:Error) { finish(.failure(error)) }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo.shared
        info.horizontalPagination = .fit
        info.isHorizontallyCentered = false
        info.topMargin = 36
        info.bottomMargin = 36
        if let destination {
            info.jobDisposition = .save
            info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = destination
        }
        let operation = web.printOperation(with:info)
        operation.showsPrintPanel = printOnly
        operation.showsProgressPanel = printOnly
        if operation.run() { finish(.success(["ok":true])) }
        else { finish(.failure(SQError.message("打印或导出未完成"))) }
    }
}
