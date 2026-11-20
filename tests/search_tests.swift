import Foundation
import PDFKit
import CoreText
import CoreGraphics

@main struct SearchTests {
 static func main() throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("simaq-search-tests-" + UUID().uuidString)
  try FileManager.default.createDirectory(at:root.appendingPathComponent("归档"),withIntermediateDirectories:true)
  defer { try? FileManager.default.removeItem(at:root) }
  try "# Physical-AI\n富瀚微 physical_ai\nmetaphysical aid\n😀 physical‑AI".write(to:root.appendingPathComponent("one.md"),atomically:true,encoding:.utf8)
  try "physical ai\nphysical\n\nai".write(to:root.appendingPathComponent("归档/two.md"),atomically:true,encoding:.utf8)
  try "<html><head><title>hidden</title></head><body><h1>富瀚微</h1><script>secret</script><p>Physical&#45;AI</p></body></html>".write(to:root.appendingPathComponent("report.html"),atomically:true,encoding:.utf8)
  let pdfURL=root.appendingPathComponent("sample.pdf")
  var media=CGRect(x:0,y:0,width:300,height:300)
  let context=CGContext(pdfURL as CFURL, mediaBox:&media, nil)!
  context.beginPDFPage(nil)
  context.textPosition=CGPoint(x:30,y:150)
  CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string:"pdfneedle")),context)
  context.endPDFPage()
  context.beginPDFPage(nil)
  let bitmap=CGContext(data:nil,width:20,height:20,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
  bitmap.setFillColor(CGColor(gray:0,alpha:1)); bitmap.fill(CGRect(x:0,y:0,width:20,height:20))
  context.draw(bitmap.makeImage()!, in:CGRect(x:30,y:30,width:100,height:100)); context.endPDFPage(); context.closePDF()
  assert(PDFDocument(url:pdfURL)?.page(at:0)?.string?.contains("pdfneedle") == true)
  let s=SearchService(); s.setRoot(root)
  var ready=false; s.whenReady { ready=true }; while !ready { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  func query(_ p:[String:Any]) -> [[String:Any]] {
   var result:[[String:Any]]?; s.query(p) { result=$0 }
   let end=Date().addingTimeInterval(15)
   while result == nil && Date() < end { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
   guard let r=result else { fatalError("query timed out") }; return r
  }
  let groups=query(["q":"physical ai"])
  assert(groups.count == 3, "default \(groups)")
  let one=groups.first { $0["path"] as? String == "one.md" }!
  let hits=one["hits"] as! [[String:Any]]
  assert(hits.count == 3 && hits[0]["kind"] as? String == "heading", "heading and distinct body hits")
  let source=try String(contentsOf:root.appendingPathComponent("one.md"),encoding:.utf8) as NSString
  for hit in hits { assert(source.substring(with:NSRange(location:hit["start"] as! Int,length:hit["length"] as! Int)) == hit["match"] as! String) }
  assert(query(["q":"physical ai","exact":true]).count == 1)
  assert(query(["q":"富瀚微"]).count == 2)
  let limited=query(["q":"physical ai","hitLimit":1])
  let limitedOne=limited.first { $0["path"] as? String == "one.md" }!
  assert(limitedOne["count"] as? Int == 3 && (limitedOne["hits"] as! [[String:Any]]).count == 1)
  let expanded=query(["q":"physical ai","hitLimit":1,"hitLimits":["one.md":2]])
  assert((expanded.first { $0["path"] as? String == "one.md" }!["hits"] as! [[String:Any]]).count == 2)
  let documentLimited=query(["q":"physical ai","document":"one.md","hitLimit":2])[0]
  assert(documentLimited["count"] as? Int == 3 && (documentLimited["hits"] as! [[String:Any]]).count == 2)
  assert(query(["q":"secret"]).isEmpty)
  let pdfResult=query(["q":"pdfneedle"]); let pdfHits=pdfResult.first!["hits"] as! [[String:Any]]
  assert(pdfHits.contains { $0["page"] as? Int == 1 && $0["match"] as? String == "pdfneedle" })
  assert(PDFDocument(url:pdfURL)?.page(at:1)?.string?.isEmpty != false)
  let utf16=root.appendingPathComponent("unicode.md")
  var bytes=Data([0xff,0xfe]); bytes.append("首行\r\n编码目标".data(using:.utf16LittleEndian)!)
  try bytes.write(to:utf16); s.update(utf16)
  let utfResult=query(["q":"编码目标"]); let utfHit=(utfResult.first!["hits"] as! [[String:Any]])[0]
  assert(utfHit["start"] as? Int == 3)
  for (index, encoding, bom) in [(1,String.Encoding.utf16BigEndian,[UInt8](arrayLiteral:0xfe,0xff)), (2,.utf32LittleEndian,[0xff,0xfe,0,0]), (3,.utf32BigEndian,[0,0,0xfe,0xff])] {
   let file=root.appendingPathComponent("encoding\(index).md"); var encoded=Data(bom); encoded.append("首行\r\n编码目标".data(using:encoding)!); try encoded.write(to:file); s.update(file)
   let result=query(["q":"编码目标","document":file.lastPathComponent]); assert((((result[0]["hits"] as! [[String:Any]])[0])["start"] as? Int) == 3)
  }
  assert(query(["q":"physical ai","excludeArchive":true]).count == 2)
  let archived=query(["q":"physical ai","folder":"归档"])
  assert(archived.count == 1 && archived[0]["count"] as? Int == 1)
  assert(query(["q":"physical ai","extensions":["html"]]).count == 1)
  assert(query(["q":"Physical.AI","regex":true]).count == 3)
  assert(query(["q":"physical ai","wholeWord":true]).count == 3)
  var callbacks=0; s.query(["q":"obsolete"]) { _ in callbacks += 1 }; s.query(["q":"富瀚微"]) { _ in callbacks += 1 }
  let deadline=Date().addingTimeInterval(5); while callbacks < 2 && Date() < deadline { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }; assert(callbacks == 2)
  try "\u{FEFF}首行\r\n目标\r\n".write(to:root.appendingPathComponent("bom.md"),atomically:true,encoding:.utf8)
  s.update(root.appendingPathComponent("bom.md")); let normalized=query(["q":"目标"]); let offset=((normalized[0]["hits"] as! [[String:Any]])[0]["start"] as! Int); assert(offset == 3)
  try "body ratingtoken".write(to:root.appendingPathComponent("aaa.md"),atomically:true,encoding:.utf8)
  try "# ratingtoken title".write(to:root.appendingPathComponent("zzz.md"),atomically:true,encoding:.utf8)
  try "nothing".write(to:root.appendingPathComponent("ratingtoken.md"),atomically:true,encoding:.utf8)
  s.update(root.appendingPathComponent("aaa.md")); s.update(root.appendingPathComponent("zzz.md")); s.update(root.appendingPathComponent("ratingtoken.md"))
  let ranked=query(["q":"ratingtoken","limit":2]); assert(ranked.count == 2 && ranked[0]["path"] as? String == "ratingtoken.md" && ranked[1]["path"] as? String == "zzz.md")
  assert(ranked[0]["count"] as? Int == 0, "filename-only hit is not a document occurrence")
  s.setExcludedFolders(["归档"])
  assert(query(["q":"physical ai","folder":"归档"]).isEmpty)
  s.update(root.appendingPathComponent("归档/two.md"))
  assert(query(["q":"physical ai","document":"归档/two.md"]).isEmpty)
  s.setExcludedFolders([])
  ready=false; s.whenReady { ready=true }; while !ready { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  assert(query(["q":"physical ai","folder":"归档"]).count == 1)
  let regexRanked=query(["q":"ratingtoken","regex":true,"limit":2]); assert(regexRanked.count == 2 && regexRanked[0]["path"] as? String == "ratingtoken.md" && regexRanked[1]["path"] as? String == "zzz.md")
  try "changed one".write(to:root.appendingPathComponent("one.md"),atomically:true,encoding:.utf8)
  s.update(root.appendingPathComponent("one.md"))
  assert(query(["q":"changed"]).count == 1)
  try FileManager.default.removeItem(at:root.appendingPathComponent("one.md")); s.update(root.appendingPathComponent("one.md"))
  assert(query(["q":"changed"]).isEmpty)
  try FileManager.default.removeItem(at:root.appendingPathComponent("归档")); s.update(root.appendingPathComponent("归档"))
  ready=false; s.whenReady { ready=true }; while !ready { RunLoop.current.run(until:Date().addingTimeInterval(0.01)) }
  assert(query(["q":"physical ai","folder":"归档"]).isEmpty)
  let linked=root.appendingPathComponent("linked.md"), outside=root.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".md")
  try "staleindex".write(to:linked,atomically:true,encoding:.utf8); s.update(linked)
  assert(query(["q":"staleindex"]).count == 1)
  try "outsidesecret".write(to:outside,atomically:true,encoding:.utf8)
  defer { try? FileManager.default.removeItem(at:outside) }
  try FileManager.default.removeItem(at:linked)
  try FileManager.default.createSymbolicLink(at:linked,withDestinationURL:outside)
  s.update(linked)
  assert(query(["q":"staleindex"]).isEmpty && query(["q":"outsidesecret"]).isEmpty)
  try "alternateextension".write(to:root.appendingPathComponent("alternate.mdown"),atomically:true,encoding:.utf8)
  s.update(root.appendingPathComponent("alternate.mdown"))
  assert(query(["q":"alternateextension"]).count == 1)
  let refURL=root.appendingPathComponent("来源.md")
  let content="引文第一行\n原文 [[报告|别名]] 和 [资料](one.md)。\n结尾。\n\n`[[假链接]]`"
  try content.write(to:refURL,atomically:true,encoding:.utf8); s.update(refURL)
  func refs(_ names:[String]) -> [[String:Any]] {
    var value:[[String:Any]]?
    s.references(names:names,root:root.resolvingSymlinksInPath().path) { value=$0 }
    while value == nil { RunLoop.current.run(until:Date().addingTimeInterval(0.001)) }
    return value!
  }
  let citations=refs(["报告","one.md","假链接"])
  assert(citations.count==2 && citations.allSatisfy { ($0["text"] as? String)?.hasPrefix("引文第一行") == true && $0["line"] as? Int == 2 })
  assert(query(["q":"引文","hitLimit":5]).count == 1)
  assert(query(["q":"引文","hitLimit":5]).count == 1)
  try "来源已更新".write(to:refURL,atomically:true,encoding:.utf8); s.update(refURL)
  assert(refs(["报告","one.md"]).isEmpty && query(["q":"引文","hitLimit":5]).isEmpty)
  let mixedURL = root.appendingPathComponent("混合.md")
  let mixedText = "# 物理AI行业\n正文中的物理 AI技术、物理-ai模型、物理AId误拼"
  try mixedText.write(to:mixedURL,atomically:true,encoding:.utf8)
  s.update(mixedURL)
  let request:[String:Any] = ["q":"物理AI","hitLimit":5]
  let mixed = query(request)
  assert(mixed.count == 1 && mixed[0]["count"] as? Int == 3)
  let occurrences = mixed[0]["hits"] as! [[String:Any]]
  for h in occurrences {
    assert((mixedText as NSString).substring(with:NSRange(location:h["start"] as! Int,length:h["length"] as! Int)) == h["match"] as! String)
  }
  assert(query(["q":"物理 AI"])[0]["count"] as? Int == 3)
  assert(query(["q":"物理AI","exact":true])[0]["count"] as? Int == 1)
  assert(query(["q":"物理AI","caseSensitive":true])[0]["count"] as? Int == 2)
  assert(query(["q":"物理AI","wholeWord":true]).isEmpty)
  let variantsPath = "字形.md", variantsURL = root.appendingPathComponent(variantsPath)
  let variantsText = "# 國產替代\n😀 國產AI、国产-ai、國产 AI、國產AId。"
  try variantsText.write(to:variantsURL,atomically:true,encoding:.utf8)
  s.update(variantsURL)
  func bodyHits(_ request: [String:Any]) -> [[String:Any]] {
    query(request).first { $0["path"] as? String == variantsPath }?["hits"] as? [[String:Any]] ?? []
  }
  for q in ["国","國","国产","國產","国產"] { assert(bodyHits(["q":q]).count == 5, q) }
  for q in ["国产替代","國產替代"] {
    let h = bodyHits(["q":q]).first!
    assert(h["kind"] as? String == "heading" && h["match"] as? String == "國產替代")
  }
  let mixedForms = bodyHits(["q":"国产AI"])
  assert(mixedForms.compactMap { $0["match"] as? String } == ["國產AI","国产-ai","國产 AI"])
  for h in mixedForms {
    let range = NSRange(location:h["start"] as! Int,length:h["length"] as! Int)
    assert((variantsText as NSString).substring(with:range) == h["match"] as! String)
  }
  assert(bodyHits(["q":"国产AI","exact":true]).count == 1)
  assert(bodyHits(["q":"國產AI","caseSensitive":true]).count == 2)
  assert(bodyHits(["q":"国产","regex":true]).count == 1)
  let draft = [variantsPath:"😀 國產AI、国产AI"]
  assert(bodyHits(["q":"國產AI","document":variantsPath,"buffers":draft]).count == 2)
  assert(bodyHits(["q":"国产替代","buffers":draft]).isEmpty)
  let variantFolder = root.appendingPathComponent("半導體")
  try FileManager.default.createDirectory(at:variantFolder,withIntermediateDirectories:true)
  let variantFile = variantFolder.appendingPathComponent("國產替代.md")
  try "😀 髮、發、发。製造業。".write(to:variantFile,atomically:true,encoding:.utf8)
  s.update(variantFile)
  for q in ["国产","国产替代"] {
    let first = query(["q":q,"limit":1]).first!
    assert(first["name"] as? String == "國產替代.md" && first["count"] as? Int == 0)
  }
  assert((query(["q":"半导体"]).first!["hits"] as! [[String:Any]]).first!["match"] as? String == "半導體")
  assert(query(["q":"发"]).first!["count"] as? Int == 3)
  for q in ["制造","制造业"] {
    assert((query(["q":q]).first!["hits"] as! [[String:Any]]).first!["kind"] as? String == "body")
  }
  let live = ["混合.md":"# 原文已改写\n研究物理AI应用"]
  assert(query(["q":"物理AI","buffers":live])[0]["count"] as? Int == 1)
  assert(query(["q":"原文已改写","document":"混合.md","buffers":live]).count == 1)
  assert(query(["q":"物理AI","buffers":["混合.md":"移除关键词"]]).isEmpty)
  assert(query(["q":"物理AI","folder":"归档","buffers":live]).isEmpty)
  assert(query(request)[0]["count"] as? Int == 3, "buffer queries do not alter the saved index")
  try live["混合.md"]!.write(to:mixedURL,atomically:true,encoding:.utf8)
  s.update(mixedURL)
  assert(query(request)[0]["count"] as? Int == 1)
  let stamp = try FileManager.default.attributesOfItem(atPath:mixedURL.path)[.modificationDate]!
  try live["混合.md"]!.replacingOccurrences(of:"物理AI",with:"技术AI").write(to:mixedURL,atomically:true,encoding:.utf8)
  try FileManager.default.setAttributes([.modificationDate:stamp],ofItemAtPath:mixedURL.path)
  s.rebuild(); ready=false; s.whenReady { ready=true }
  while !ready { RunLoop.current.run(until:Date().addingTimeInterval(0.005)) }
  assert(query(request).isEmpty && query(["q":"技术AI"]).count == 1, "manual rebuild repairs stale content with unchanged size and timestamp")
  for ext in ["txt","json","svg"] {
    let path = "source." + ext, url = root.appendingPathComponent(path)
    try "diskToken".write(to:url,atomically:true,encoding:.utf8)
    s.update(url)
    assert(query(["q":"diskToken","extensions":[ext]]).count == 1)
    let buffer = [path:"draftToken"]
    assert(query(["q":"draftToken","document":path,"buffers":buffer]).count == 1)
    assert(query(["q":"diskToken","document":path,"buffers":buffer]).isEmpty)
  }
  print("search tests passed")
 }
}
