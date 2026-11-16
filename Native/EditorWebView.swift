import AppKit
import WebKit

/// WebKit builds the image menu. Append editor actions without replacing the system items.
final class EditorWebView: WKWebView {
    private var pending: (point: NSPoint, items: [NSMenuItem])?
    private var tracking: (point: NSPoint, menu: NSMenu)?
    var onImageCommand: ((String, Int) -> Void)?

    func prepareImageMenu(at point: NSPoint, token: String, actions: [[String:Any]]) {
        let items = actions.enumerated().compactMap { index, action -> NSMenuItem? in
            guard let title = action["title"] as? String else { return nil }
            let item = NSMenuItem(title:title,action:#selector(imageCommand(_:)),keyEquivalent:"")
            item.target = self
            item.representedObject = token
            if action["copyFallback"] as? Bool == true { item.identifier = Self.copyFallback }
            item.tag = index
            item.state = action["checked"] as? Bool == true ? .on : .off
            return item
        }
        pending = (point,items)
        appendIfReady()
    }

    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        super.willOpenMenu(menu,with:event)
        let local = convert(event.locationInWindow,from:nil)
        tracking = (NSPoint(x:local.x,y:isFlipped ? local.y : bounds.height-local.y),menu)
        appendIfReady()
    }

    private static let copyFallback = NSUserInterfaceItemIdentifier("SimaQCopyImage")
    private func appendIfReady() {
        guard let tracking, let pending,
              abs(tracking.point.x-pending.point.x) < 3, abs(tracking.point.y-pending.point.y) < 3,
              !pending.items.isEmpty else { return }
        self.pending = nil
        tracking.menu.addItem(.separator())
        let hasCopy = tracking.menu.items.contains { $0.identifier?.rawValue == "WKMenuItemIdentifierCopyImage" }
        for item in pending.items where !(hasCopy && item.identifier == Self.copyFallback) {
            tracking.menu.addItem(item)
        }
    }

    override func didCloseMenu(_ menu: NSMenu, with event: NSEvent?) {
        tracking = nil
        pending = nil
        super.didCloseMenu(menu,with:event)
    }

    @objc private func imageCommand(_ sender: NSMenuItem) {
        guard let token = sender.representedObject as? String else { return }
        onImageCommand?(token,sender.tag)
    }
}
