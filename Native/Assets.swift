import AppKit
import ImageIO
import WebKit
import UniformTypeIdentifiers

final class AssetHandler: NSObject, WKURLSchemeHandler {
    let workspace: Workspace
    init(workspace: Workspace) { self.workspace = workspace }
    private static let imageTypes = ["png":"image/png","apng":"image/apng","jpg":"image/jpeg","jpeg":"image/jpeg","gif":"image/gif","svg":"image/svg+xml","webp":"image/webp","avif":"image/avif","heic":"image/heic","heif":"image/heif","jfif":"image/jpeg","tif":"image/tiff","tiff":"image/tiff","bmp":"image/bmp","ico":"image/x-icon"]
    static func isImageExtension(_ ext: String) -> Bool {
        imageTypes[ext] != nil || ext == "svgz" || ext == "heif" || UTType(filenameExtension:ext)?.conforms(to:.image) == true
    }
    static func image(_ request: URL, workspace: Workspace) throws -> (Data, String) {
        guard request.scheme == "simaq-asset", request.host == "workspace" else { throw URLError(.badURL) }
        var file = try workspace.fileURL(String(request.path.dropFirst()))
        if !FileManager.default.fileExists(atPath:file.path),
           let fallback = URLComponents(url:request,resolvingAgainstBaseURL:false)?.queryItems?.first(where: { $0.name == "fallback" })?.value {
            file = try workspace.fileURL(fallback)
        }
        let ext = file.pathExtension.lowercased()
        let type = UTType(filenameExtension:ext)
        guard let mime = imageTypes[ext] ?? (type?.conforms(to:.image) == true ? type?.preferredMIMEType : nil) else { throw URLError(.unsupportedURL) }
        return (try Data(contentsOf:file,options:.mappedIfSafe), mime)
    }
    static func clipboardItem(_ bytes: Data, type: UTType) -> NSPasteboardItem {
        let item = NSPasteboardItem()
        item.setData(bytes,forType:NSPasteboard.PasteboardType(type.identifier))
        // Offer the original encoding as well as a bitmap for apps that only paste TIFF.
        if type != .tiff, let tiff = NSImage(data:bytes)?.tiffRepresentation {
            item.setData(tiff,forType:.tiff)
        }
        return item
    }
    static func embedImages(_ html: String, workspace: Workspace) throws -> String {
        let attribute = try NSRegularExpression(pattern: #"(?i)(<img\s+[^>]*?\bsrc\s*=\s*["'])(simaq-asset://[^"']+)(["'])"#)
        let string = html as NSString
        let output = NSMutableString(string:html)
        for match in attribute.matches(in:html,range:NSRange(location:0,length:string.length)).reversed() {
            let value = match.range(at:2)
            guard let url = URL(string:string.substring(with:value)) else { throw URLError(.badURL) }
            let (bytes,mime) = try image(url,workspace:workspace)
            output.replaceCharacters(in:value,with:"data:" + mime + ";base64," + bytes.base64EncodedString())
        }
        return output as String
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        do {
            guard let request = task.request.url else { throw URLError(.badURL) }
            var (data,mime) = try Self.image(request,workspace:workspace)
            // Older WebKit versions cannot display every encoding that macOS can read.
            if URLComponents(url:request,resolvingAgainstBaseURL:false)?.queryItems?.contains(URLQueryItem(name:"preview",value:"png")) == true {
                guard let source = CGImageSourceCreateWithData(data as CFData,nil),
                      let bitmap = CGImageSourceCreateImageAtIndex(source,0,nil),
                      let png = NSBitmapImageRep(cgImage:bitmap).representation(using:.png,properties:[:])
                else { throw URLError(.cannotDecodeContentData) }
                data = png
                mime = "image/png"
            }
            task.didReceive(URLResponse(url:request,mimeType:mime,expectedContentLength:data.count,textEncodingName:nil))
            task.didReceive(data)
            task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
