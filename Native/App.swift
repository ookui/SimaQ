import AppKit
import WebKit
import UniformTypeIdentifiers
import CryptoKit

private final class WorkspaceWindow: NSWindow {
    var sidebarWidth: CGFloat = 0
    private var gestureInSidebar = false

    override func sendEvent(_ event: NSEvent) {
        if event.type == .scrollWheel {
            if event.momentumPhase.isEmpty {
                if event.phase.contains(.began) || event.phase.isEmpty {
                    let point = event.locationInWindow
                    gestureInSidebar = point.x >= 0 && point.x < sidebarWidth && contentView?.frame.contains(point) == true
                }
            } else if gestureInSidebar {
                // Forward direct movement and discrete wheel ticks. Stop the
                // sidebar at finger lift without changing document scrolling.
                return
            }
        }
        super.sendEvent(event)
    }
}

final class Host: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
    private let workspace = Workspace(stateHome: ProcessInfo.processInfo.environment["SIMAQ_TEST_HOME"].map { URL(fileURLWithPath:$0).appendingPathComponent("Workspaces") })
    private let search = SearchService()
    private let reader = ReaderController()
    private let menus = ShellMenu()
    private let io = DispatchQueue(label:"SimaQ.workspace.operations",qos:.userInitiated)
    private var web:WKWebView!
    private var window:WorkspaceWindow!
    private var exporter:DocumentExporter!
    private var data:LocalData!
    private var lastSystemLanguage = ShellMenu.language(for:nil)
    private var shellReady = false
    private var pendingFile:URL?
    private var closing = false
    private var canClose = false
    private var terminationPending = false
    private var readerPath:String?
    private var indexStartedAt = 0.0
    private var indexReadyAt = 0.0
    private var themeWatcher:DispatchSourceFileSystemObject?
    private var themeFileWatchers:[DispatchSourceFileSystemObject] = []
    private var themeUpdate:DispatchWorkItem?
    private let resources = Bundle.main.resourceURL!
    private let fm = FileManager.default
    var testPath:String? { ProcessInfo.processInfo.environment["SIMAQ_TEST_ROOT"] }
    var isolatedHome:URL? { ProcessInfo.processInfo.environment["SIMAQ_TEST_HOME"].map { URL(fileURLWithPath:$0) } }
    func applicationDidFinishLaunching(_ notification:Notification) {
        do { data = try LocalData(resources:resources,directory:isolatedHome) }
        catch { NSAlert(error:error).runModal(); NSApp.terminate(nil); return }
        if let root = testPath ?? data.recents.first, fm.fileExists(atPath:root) { try? activate(URL(fileURLWithPath:root)) }
        let config = WKWebViewConfiguration()
        config.userContentController.addScriptMessageHandler(self,contentWorld:.page,name:"simaq")
        config.setURLSchemeHandler(AssetHandler(workspace:workspace),forURLScheme:"simaq-asset")
        web = WKWebView(frame:.zero,configuration:config)
        web.navigationDelegate = self
        web.allowsMagnification = false
        let bounds = NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1440,height:900)
        window = WorkspaceWindow(contentRect:NSRect(x:0,y:0,width:min(1280,bounds.width * 0.92),height:min(850,bounds.height * 0.88)),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width:760,height:470)
        window.delegate = self
        window.center()
        if isolatedHome == nil { window.setFrameAutosaveName("SimaQ main window") }
        updateTitle()
        let canvas = NSView()
        window.contentView = canvas
        web.frame = canvas.bounds
        web.autoresizingMask = [.width,.height]
        canvas.addSubview(web)
        canvas.addSubview(reader.view)
        reader.view.isHidden = true
        exporter = DocumentExporter(window:window)
        reader.onPosition = { [weak self] state in
            guard let self, let path = self.readerPath else { return }
            self.send("readerPosition",["path":path,"state":state])
        }
        reader.onLink = { [weak self] url,newTab in self?.openReaderLink(url,newTab:newTab) }
        workspace.onChanges = { [weak self] paths in
            DispatchQueue.main.async { [weak self] in
                guard let self, let root = self.workspace.root else { return }
                for path in paths { self.search.update(root.appendingPathComponent(path)) }
                self.search.whenReady { [weak self] in self?.send("referencesChanged",[:]) }
                self.send("filesChanged",["paths":paths])
            }
        }
        menus.activate = { [weak self] id in
            switch id {
            case "app.quit": NSApp.terminate(nil)
            case "window.minimize": self?.window.miniaturize(nil)
            case "window.zoom": self?.window.zoom(nil)
            default: self?.send("command",["id":id])
            }
        }
        menus.install([],language:ShellMenu.language(for:data.read("preferences")["menuLanguage"] as? String))
        NotificationCenter.default.addObserver(self,selector:#selector(refreshSystemLanguage),name:NSLocale.currentLocaleDidChangeNotification,object:nil)
        observeThemes()
        let page = resources.appendingPathComponent("Web/index.html")
        web.loadFileURL(page,allowingReadAccessTo:page.deletingLastPathComponent())
        NSApp.setActivationPolicy(.regular)
        if let iconFile = Bundle.main.object(forInfoDictionaryKey:"CFBundleIconFile") as? String,
           let url = Bundle.main.url(forResource:iconFile,withExtension:nil),
           let icon = NSImage(contentsOf:url) {
            NSApp.applicationIconImage = icon
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps:true)
    }
    @objc private func refreshSystemLanguage() {
        let current = ShellMenu.language(for:nil)
        if current != lastSystemLanguage {
            lastSystemLanguage = current
            send("systemLanguageChanged",[:])
        }
    }
    func applicationDidBecomeActive(_ notification:Notification) { refreshSystemLanguage() }
    private func updateTitle() {
        window?.title = workspace.root.map { "SimaQ — " + $0.lastPathComponent } ?? "SimaQ"
        window?.representedURL = workspace.root
    }
    private func activate(_ url:URL) throws {
        var dir:ObjCBool = false
        guard fm.fileExists(atPath:url.path,isDirectory:&dir), dir.boolValue else { throw SQError.message("目录不存在：" + url.path) }
        try workspace.open(url)
        guard let canonical = workspace.root else {throw SQError.message("无法打开目录")}
        let startedAt = Date().timeIntervalSince1970 * 1000
        indexStartedAt = startedAt
        indexReadyAt = 0
        search.setRoot(canonical, excludedFolders:workspace.excludedFolders)
        search.whenReady { [weak self] in
            guard let self, self.indexStartedAt == startedAt else { return }
            self.indexReadyAt = Date().timeIntervalSince1970 * 1000
            self.send("indexReady",[:])
        }
        if testPath == nil { try data.remember(canonical) }
        reader.close()
        readerPath = nil
        reader.view.isHidden = true
        updateTitle()
    }
    private var boot:JSONObject {
        ["root":workspace.root?.path as Any? ?? NSNull(),"journalFolder":workspace.configuredJournalFolder as Any? ?? NSNull(),"session":workspace.root.map { data.read(data.sessionKey($0)) } ?? [:], "indexStartedAt":indexStartedAt, "indexReadyAt":indexReadyAt]
    }
    func webView(_ webView:WKWebView, decidePolicyFor action:WKNavigationAction, decisionHandler:@escaping (WKNavigationActionPolicy)->Void) {
        let allowed = resources.appendingPathComponent("Web/index.html").standardizedFileURL
        decisionHandler(action.request.url?.standardizedFileURL.path == allowed.path && action.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        web.callAsyncJavaScript("await window.SimaShell.start(); return true",arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure(let error): NSLog("SimaQ startup: %@",error.localizedDescription); self.testFailure(error)
            case .success: self.shellReady = true
                if let pendingFile = self.pendingFile { self.pendingFile = nil; self.openFinder(pendingFile) }
                self.runIntegrationIfRequested()
            }
        }
    }
    func webViewWebContentProcessDidTerminate(_ webView:WKWebView) {
        shellReady = false
        reader.view.isHidden = true
        webView.reload()
    }
    func send(_ name:String,_ payload:JSONObject) {
        guard shellReady else { return }
        web.callAsyncJavaScript("await SimaShell.event(name,payload);return true",arguments:["name":name,"payload":payload],in:nil,in:.page) { result in
            if case .failure(let error) = result { NSLog("SimaQ event: %@",error.localizedDescription) }
        }
    }
    func application(_ sender:NSApplication,open urls:[URL]) { if let url = urls.first { if shellReady { openFinder(url) } else { pendingFile = url } } }
    private func openFinder(_ url:URL) {
        let file = url.standardizedFileURL
        var dir:ObjCBool = false
        guard fm.fileExists(atPath:file.path,isDirectory:&dir) else {return}
        let parent = dir.boolValue ? file : file.deletingLastPathComponent()
        let alreadyInRoot = workspace.root.map { file.path.hasPrefix($0.path + "/") || file.path == $0.path } ?? false
        if !alreadyInRoot || dir.boolValue {
            // Drain editor writes in the old workspace before changing relative path semantics.
            web.callAsyncJavaScript("return await SimaShell.prepareClose()",arguments:[:],in:nil,in:.page) { [weak self] result in
                guard let self, case .success(let ok) = result, (ok as? Bool) != false else {return}
                do {
                    try self.activate(parent)
                    self.web.callAsyncJavaScript("await SimaShell.event('workspaceOpened',payload);if(path) await SimaShell.event('openPath',{path,newTab:true});return true",arguments:["payload":self.boot,"path":dir.boolValue ? "" : file.lastPathComponent],in:nil,in:.page,completionHandler:nil)
                } catch { NSAlert(error:error).runModal() }
            }
        } else if let root = workspace.root { send("openPath",["path":String(file.path.dropFirst(root.path.count + 1)),"newTab":true]) }
    }
    private func openReaderLink(_ url:URL,newTab:Bool) {
        if !url.isFileURL { if ["http","https","mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }; return }
        guard let root = workspace.root else {return}
        let file = url.resolvingSymlinksInPath().standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else { NSSound.beep();return }
        send("openPath",["path":String(file.path.dropFirst(root.path.count + 1)),"fragment":url.fragment ?? "","newTab":newTab])
    }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage,replyHandler:@escaping (Any?,String?)->Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.path == resources.appendingPathComponent("Web/index.html").path,
              let body = message.body as? JSONObject,let method = body["method"] as? String else { replyHandler(nil,"无效请求");return }
        let args = body["args"] as? JSONObject ?? [:]
        let reply:(Result<Any,Error>)->Void = { result in
            DispatchQueue.main.async {
                switch result { case .success(let value):replyHandler(["ok":true,"value":value],nil)
                case .failure(let error):replyHandler(["ok":false,"error":error.localizedDescription],nil) }
            }
        }
        do { try dispatch(method,args,reply) } catch { reply(.failure(error)) }
    }
    private func rect(_ args:JSONObject) {
        guard let r = args["rect"] as? [String:NSNumber], let canvas = window.contentView else {return}
        let x = CGFloat(truncating:r["x"] ?? 0), y = CGFloat(truncating:r["y"] ?? 0)
        let w = CGFloat(truncating:r["width"] ?? 0), h = CGFloat(truncating:r["height"] ?? 0)
        reader.view.frame = NSRect(x:x,y:canvas.bounds.height-y-h,width:max(0,w),height:max(0,h))
        reader.view.isHidden = readerPath == nil || w < 2 || h < 2
    }
    private func selectOpen(_ types:[UTType],folder:Bool = false)->URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = folder
        panel.canChooseFiles = !folder
        panel.allowsMultipleSelection = false
        if !folder {panel.allowedContentTypes = types}
        return panel.runModal() == .OK ? panel.url : nil
    }
    private func selectSave(_ name:String,_ type:UTType)->URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = name
        panel.allowedContentTypes = [type]
        return panel.runModal() == .OK ? panel.url : nil
    }
    private func dispatch(_ method:String,_ args:JSONObject,_ reply:@escaping (Result<Any,Error>)->Void) throws {
        func done(_ value:Any = true) { reply(.success(value)) }
        let path = args["path"] as? String ?? ""
        let cancelled:JSONObject = ["cancelled":true]
        switch method {
        case "sidebarWidth": window.sidebarWidth = CGFloat(args["width"] as? Double ?? 0); done()
        case "bootstrap": done(boot)
        case "chooseRoot","sampleRoot","openRecent":
            let selected:URL?
            if method == "sampleRoot" {selected = try data.sample()}
            else if method == "openRecent" {selected = URL(fileURLWithPath:path)}
            else {selected = selectOpen([],folder:true)}
            guard let url = selected else {done(cancelled);return}
            try activate(url);done(boot)
        case "excludedFolders": done(workspace.excludedFolders)
        case "addExcludedFolder", "removeExcludedFolder":
            guard let root = workspace.root, args["root"] as? String == root.path else { throw SQError.message("工作区已切换，请重新打开设置。") }
            var paths = Set(workspace.excludedFolders)
            if method == "addExcludedFolder" {
                let panel = NSOpenPanel()
                panel.directoryURL = root
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = true
                guard panel.runModal() == .OK else { done(paths.sorted()); return }
                let prefix = root.path == "/" ? "/" : root.path + "/"
                for url in panel.urls {
                    let full = url.standardizedFileURL.path
                    guard full.hasPrefix(prefix), full != root.path else { throw SQError.message("请选择当前工作区下的子目录。") }
                    paths.insert(String(full.dropFirst(prefix.count)))
                }
            } else { paths.remove(path) }
            try workspace.setExcludedFolders(Array(paths), forRoot:root.path)
            search.setExcludedFolders(Array(paths))
            search.whenReady { [weak self] in self?.send("indexReady",[:]) }
            done(paths.sorted())
        case "pageReferences":
            guard let expected = args["root"] as? String, workspace.root?.path == expected else { done(["pageCount":0,"rows":[] as [JSONObject]]); return }
            io.async { [self] in
                do {
                    let names = try workspace.call("referenceNames",["path":path]) as? [String] ?? []
                    search.references(names:names,root:expected) { candidates in
                        self.io.async {
                            do {
                                let result = try self.workspace.call("referenceParagraphs",["path":path,"root":expected,"candidates":candidates])
                                reply(.success(result))
                            } catch { reply(.failure(error)) }
                        }
                    }
                } catch { reply(.failure(error)) }
            }
        case "recentRoots": done(data.recents)
        case "saveSession":
            if let root = workspace.root, let session = args["session"] as? JSONObject { try data.write(data.sessionKey(root),session) }
            done()
        case "save","createJournal":
            io.async { [self] in
                do {
                    let url = try workspace.fileURL(path)
                    let result = try workspace.call(method,args)
                    if (result as? JSONObject)?["conflict"] as? Bool != true {
                        search.update(url)
                    }
                    // Enqueue the index update before the client can issue its post-save query.
                    reply(.success(result))
                } catch { reply(.failure(error)) }
            }
        case "search": search.query(args) { groups in done(groups) }
        case "indexReady": search.whenReady { done() }
        case "rebuildIndex":
            search.rebuild()
            search.whenReady { [weak self] in self?.send("indexReady",[:]) }
            done()
        case "getPrefs": done(data.read("preferences"))
        case "setPrefs": try data.write("preferences",args["prefs"] as? JSONObject ?? [:]);done()
        case "systemMenuLanguage": done(ShellMenu.language(for:nil))
        case "menus": menus.install(args["commands"] as? [JSONObject] ?? [],language:ShellMenu.language(for:args["language"] as? String));done()
        case "builtinTheme":
            let file = args["file"] as? String ?? ""
            guard ["neutral-light.css","neutral-dark.css","tana.css","tanadark.css"].contains(file) else {throw SQError.message("未知主题")}
            done(try String(contentsOf:resources.appendingPathComponent("Web/themes").appendingPathComponent(file),encoding:.utf8))
        case "themeList": done(try data.list("Themes",ext:"css",field:"css"))
        case "templateList": done(try data.list("Templates",ext:"md",field:"text"))
        case "themeFolder","templateFolder": NSWorkspace.shared.open(data.directory.appendingPathComponent(method == "themeFolder" ? "Themes":"Templates"));done()
        case "themeImport":
            guard let source = selectOpen([UTType(filenameExtension:"css")!]) else {done(cancelled);return}
            let css = try String(contentsOf:source,encoding:.utf8)
            let dest = data.directory.appendingPathComponent("Themes").appendingPathComponent(source.lastPathComponent)
            try css.write(to:dest,atomically:true,encoding:.utf8);done(["name":source.lastPathComponent,"css":css])
        case "chooseJSON":
            guard let file = selectOpen([.json]) else {done(NSNull());return}
            done(try JSONSerialization.jsonObject(with:Data(contentsOf:file)))
        case "saveJSON":
            guard let file = selectSave("SimaQ 快捷键.json",.json) else {done(cancelled);return}
            let obj:Any = args["json"] ?? [:]
            let bytes = try (obj as? String).map { Data($0.utf8) } ?? JSONSerialization.data(withJSONObject:obj,options:[.prettyPrinted,.sortedKeys])
            try bytes.write(to:file,options:.atomic);done()
        case "readerTrusted","readerTrust","readerOpen":
            guard let root = workspace.root else {throw SQError.message("请先打开资料库")}
            let url = try workspace.fileURL(path)
            // Bind script trust to these exact document bytes. Replacing a report revokes its trust.
            let isHTML = ["html","htm"].contains(url.pathExtension.lowercased())
            let digest = isHTML ? SHA256.hash(data:try Data(contentsOf:url,options:.mappedIfSafe)).map{String(format:"%02x",$0)}.joined() : ""
            var list = data.read("trusted-reports")
            if method == "readerTrust" {
                if args["trusted"] as? Bool == true {list[url.path] = digest} else {list[url.path] = nil}
                try data.write("trusted-reports",list);done();return
            }
            let trusted = isHTML && (list[url.path] as? String) == digest
            if method == "readerTrusted" {done(trusted);return}
            readerPath = path
            reader.open(url,root:root,trusted:trusted,state:args["state"] as? JSONObject ?? [:])
            rect(args);done()
        case "readerRect":rect(args);done()
        case "readerState":reader.captureState { done($0) }
        case "readerAction":reader.action(args["action"] as? String ?? "",payload:args["payload"] as? JSONObject ?? [:]);done()
        case "readerClose":readerPath = nil;reader.close();reader.view.isHidden = true;done()
        case "openExternal":
            if let value = args["url"] as? String,let url = URL(string:value),["http","https","mailto"].contains(url.scheme?.lowercased() ?? "") {NSWorkspace.shared.open(url)}
            done()
        case "copyText": NSPasteboard.general.clearContents();done(NSPasteboard.general.setString(args["text"] as? String ?? "",forType:.string))
        case "saveAs":
            guard let file = selectSave((path as NSString).lastPathComponent,UTType(filenameExtension:(path as NSString).pathExtension) ?? .plainText) else {done(cancelled);return}
            try (args["text"] as? String ?? "").write(to:file,atomically:true,encoding:.utf8)
            let local = workspace.root.flatMap { root in file.path.hasPrefix(root.path+"/") ? String(file.path.dropFirst(root.path.count+1)) : nil }
            done(["path":local as Any? ?? NSNull(),"cancelled":false] as JSONObject)
        case "wechatDraft":
            guard let title = args["title"] as? String, !title.isEmpty,
                  let html = args["html"] as? String, !html.isEmpty else {
                throw SQError.message("当前页面没有可发送的标题或正文。")
            }
            guard let plainText = args["plainText"] as? String else { throw SQError.message("缺少正文的剪贴板文本。") }
            try WeChatDraftWindow.present(title: title, html: html, plainText: plainText, missingImageCount: args["missingImageCount"] as? Int ?? 0)
            done()
        case "exportHTML","exportPDF","print":
            let stem = URL(fileURLWithPath:path).deletingPathExtension().lastPathComponent
            let content = try AssetHandler.embedImages(args["html"] as? String ?? "",workspace:workspace)
            let html = content.lowercased().contains("<html") ? content : "<!doctype html><html lang='zh'><head><meta charset='utf-8'><style>body{font:16px/1.7 -apple-system,sans-serif;max-width:52em;margin:2em auto}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:.35em .7em}img,svg{max-width:100%}pre{white-space:pre-wrap}</style></head><body>" + content + "</body></html>"
            let source = try workspace.fileURL(path)
            var destination:URL?
            if method != "print" {
                let ext = method == "exportHTML" ? "html":"pdf"
                guard let file = selectSave(stem + "." + ext,method == "exportHTML" ? .html:.pdf) else {done(cancelled);return}
                destination = file
                if method == "exportHTML" {try html.write(to:file,atomically:true,encoding:.utf8);done();return}
            }
            exporter.begin(html:html,base:source.deletingLastPathComponent(),destination:destination,printOnly:method == "print",completion:reply)
        case "quit":done();NSApp.terminate(nil)
        case "minimize":window.miniaturize(nil);done()
        case "zoom":window.zoom(nil);done()
        case "help":NSWorkspace.shared.open(resources.appendingPathComponent("Guide.html"));done()
        default:
            io.async { [workspace] in do { reply(.success(try workspace.call(method,args))) } catch {reply(.failure(error))} }
        }
    }
    private func observeThemes() {
        let folder = data.directory.appendingPathComponent("Themes")
        func watch(_ url:URL)->DispatchSourceFileSystemObject? {
            let fd = Darwin.open(url.path,O_EVTONLY)
            guard fd >= 0 else {return nil}
            let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor:fd,eventMask:[.write,.rename,.delete,.extend,.attrib],queue:.main)
            source.setEventHandler { [weak self] in
                guard let self else {return}
                self.themeUpdate?.cancel()
                let job = DispatchWorkItem { [weak self] in self?.observeThemes();self?.send("themesChanged",[:]) }
                self.themeUpdate = job
                DispatchQueue.main.asyncAfter(deadline:.now()+0.2,execute:job)
            }
            source.setCancelHandler { Darwin.close(fd) };source.resume();return source
        }
        themeWatcher?.cancel();themeFileWatchers.forEach{$0.cancel()}
        themeWatcher = watch(folder)
        themeFileWatchers = ((try? fm.contentsOfDirectory(at:folder,includingPropertiesForKeys:nil)) ?? []).filter{$0.pathExtension.lowercased()=="css"}.compactMap(watch)
    }
    func windowShouldClose(_ sender:NSWindow)->Bool {
        if canClose || !shellReady {return true}; requestClose();return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication)->Bool {true}
    func applicationShouldTerminate(_ sender:NSApplication)->NSApplication.TerminateReply {
        if canClose || !shellReady {return .terminateNow}
        terminationPending = true;requestClose();return .terminateLater
    }
    private func requestClose() {
        guard !closing else {return}
        closing = true
        web.callAsyncJavaScript("return await SimaShell.prepareClose()",arguments:[:],in:nil,in:.page) { [weak self] result in
            guard let self else {return}
            self.closing = false
            if case .success(let value) = result { self.canClose = (value as? Bool) != false }
            if self.terminationPending {self.terminationPending = false;NSApp.reply(toApplicationShouldTerminate:self.canClose)}
            else if self.canClose {self.window.performClose(nil)}
        }
    }
    private func testFailure(_ error:Error) {
        guard let output = ProcessInfo.processInfo.environment["SIMAQ_TEST_OUTPUT"] else { return }
        try? Data((error.localizedDescription+" "+String(describing:(error as NSError).userInfo)).utf8).write(to:URL(fileURLWithPath:output))
        exit(1)
    }
    private func runIntegrationIfRequested() {
        guard isolatedHome != nil, let script = ProcessInfo.processInfo.environment["SIMAQ_TEST_SCRIPT"],let output = ProcessInfo.processInfo.environment["SIMAQ_TEST_OUTPUT"] else {return}
        do {
            let source = try String(contentsOfFile:script,encoding:.utf8)
            web.callAsyncJavaScript(source,arguments:[:],in:nil,in:.page) { result in
                do {
                    let object = try result.get()
                    let bytes = try JSONSerialization.data(withJSONObject:object,options:[.prettyPrinted,.sortedKeys,.fragmentsAllowed])
                    try bytes.write(to:URL(fileURLWithPath:output),options:.atomic);exit(0)
                } catch { self.testFailure(error) }
            }
        } catch { testFailure(error) }
    }
}
