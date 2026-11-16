import AppKit

final class ShellMenu: NSObject, NSMenuItemValidation {
    var activate: ((String) -> Void)?
    private func shortcut(_ binding: String) -> (String, NSEvent.ModifierFlags) {
        var modifiers = NSEvent.ModifierFlags()
        let keys = binding.lowercased().replacingOccurrences(of:"⌘",with:"cmd+").replacingOccurrences(of:"⇧",with:"shift+").replacingOccurrences(of:"⌥",with:"alt+").replacingOccurrences(of:"⌃",with:"ctrl+").split(separator:"+").map(String.init)
        for key in keys.dropLast() {
            switch key { case "cmd","command","meta","mod": modifiers.insert(.command)
            case "shift": modifiers.insert(.shift)
            case "option","alt","opt": modifiers.insert(.option)
            case "control","ctrl": modifiers.insert(.control)
            default: break }
        }
        let special = ["enter":"\r","return":"\r","backspace":"\u{8}","delete":"\u{7f}","tab":"\t","escape":"\u{1b}","space":" ","arrowleft":"\u{f702}","left":"\u{f702}","arrowright":"\u{f703}","right":"\u{f703}","up":"\u{f700}","down":"\u{f701}"]
        let last = keys.last ?? ""
        return (special[last] ?? (last.count == 1 ? last : ""), modifiers)
    }
    private var disabled = Set<String>()
    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        guard let id = item.representedObject as? String else { return true }
        if NSApp.keyWindow?.windowController is WeChatDraftWindow {
            return ["app.quit", "file.closeTab", "window.minimize", "window.zoom", "edit.undo", "edit.redo",
                    "edit.cut", "edit.copy", "edit.paste", "edit.selectAll"].contains(id)
        }
        return !disabled.contains(id)
    }
    static let supportedLanguages = ["en","zh-Hans","zh-Hant"]
    static func language(for preference: String?, preferred: [String] = Locale.preferredLanguages) -> String {
        if let preference, supportedLanguages.contains(preference) { return preference }
        return Bundle.preferredLocalizations(from:supportedLanguages, forPreferences:preferred).first ?? "en"
    }
    func install(_ commands: [JSONObject], language: String) {
        func localized(_ en: String, _ hans: String, _ hant: String) -> String {
            switch language {
            case "zh-Hans": return hans
            case "zh-Hant": return hant
            default: return en
            }
        }
        let menu = NSMenu()
        var groups: [String:NSMenu] = [:]
        func group(_ name: String, _ title: String) -> NSMenu {
            if let existing = groups[name] { return existing }
            let sub = NSMenu(title:title)
            let item = menu.addItem(withTitle:title, action:nil,keyEquivalent:"")
            item.submenu = sub
            groups[name] = sub
            return sub
        }
        let app = group("应用","SimaQ")
        app.addItem(withTitle:localized("About SimaQ","关于 SimaQ","關於 SimaQ"), action:#selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent:"")
        app.addItem(.separator())
        disabled.removeAll()
        let pasteActions: [String: Selector] = ["edit.copy":#selector(NSText.copy(_:)), "edit.cut":#selector(NSText.cut(_:)), "edit.paste":#selector(NSText.paste(_:)), "edit.selectAll":#selector(NSText.selectAll(_:))]
        for command in commands {
            guard let id = command["id"] as? String, let label = command["label"] as? String else { continue }
            guard let name = command["group"] as? String, let title = command["menu"] as? String else { continue }
            let sub = group(name,title)
            let key = shortcut(command["key"] as? String ?? "")
            let item = NSMenuItem(title:label, action:pasteActions[id] ?? #selector(performCommand(_:)), keyEquivalent:key.0)
            item.keyEquivalentModifierMask = key.1
            item.representedObject = id
            item.target = pasteActions[id] == nil ? self : nil
            if (command["enabled"] as? Bool) == false { disabled.insert(id) }
            if command["separatorBefore"] as? Bool == true { sub.addItem(.separator()) }
            if command["checked"] as? Bool == true {
                item.state = .on
                let font = NSFontManager.shared.convert(NSFont.menuFont(ofSize:0), toHaveTrait:.boldFontMask)
                item.attributedTitle = NSAttributedString(string:label, attributes:[.font:font])
            }
            sub.addItem(item)
        }
        if !commands.contains(where:{ $0["id"] as? String == "app.quit" }) { app.addItem(withTitle:localized("Quit SimaQ","退出 SimaQ","結束 SimaQ"),action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q") }
        if !commands.contains(where:{ $0["id"] as? String == "edit.copy" }) {
            let edit = group("编辑",localized("Edit","编辑","編輯"))
            for (label,key,action) in [(localized("Cut","剪切","剪下"),"x","cut:"),(localized("Copy","复制","拷貝"),"c","copy:"),(localized("Paste","粘贴","貼上"),"v","paste:"),(localized("Select All","全选","全選"),"a","selectAll:")] {
                edit.addItem(withTitle:label,action:Selector((action)),keyEquivalent:key)
            }
        }
        NSApp.mainMenu = menu
        NSApp.windowsMenu = groups["窗口"]
        NSApp.helpMenu = groups["帮助"]
    }
    @objc private func performCommand(_ sender:NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        if let window = NSApp.keyWindow, window.windowController is WeChatDraftWindow {
            switch id {
            case "file.closeTab": window.performClose(nil)
            case "window.minimize": window.performMiniaturize(nil)
            case "window.zoom": window.performZoom(nil)
            case "edit.undo": NSApp.sendAction(Selector(("undo:")), to: nil, from: sender)
            case "edit.redo": NSApp.sendAction(Selector(("redo:")), to: nil, from: sender)
            case "app.quit": activate?(id)
            default: break
            }
            return
        }
        activate?(id)
    }
}
