import Foundation
@main struct Benchmark {
 static func main() throws {
  let root=FileManager.default.temporaryDirectory.appendingPathComponent("simaq-benchmark-"+UUID().uuidString)
  try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
  defer { try? FileManager.default.removeItem(at:root) }
  let paragraph=String(repeating:"Investment research: quarterly revenue, margins and market share.\n",count:315)
  for i in 0..<10000 {
   let text = paragraph + (i == 4567 ? "\nphysical-ai 独特词条\n" : "") + (i % 10 == 0 ? "\n中等样本 moderate-marker\n" : "") + "\nwide-marker 广泛样本\n"
   try text.write(to:root.appendingPathComponent("note-\(i).md"),atomically:false,encoding:.utf8)
  }
  let s=SearchService(); let start=Date(); s.setRoot(root)
  func run(_ q:String, options:[String:Any] = [:]) -> Double {
   var done=false; let begin=Date(); var payload=options; payload["q"]=q; payload["hitLimit"]=4; payload["limit"]=60; s.query(payload) { _ in done=true }
   while !done { RunLoop.current.run(until:Date().addingTimeInterval(0.005)) }
   return Date().timeIntervalSince(begin)*1000
  }
  var ready=false; s.whenReady { ready=true }; while !ready { RunLoop.current.run(until:Date().addingTimeInterval(0.005)) }
  let build=Date().timeIntervalSince(start); let first=run("physical ai")
  for q in ["physical ai", "moderate marker", "wide marker", "广泛样本", "quarterly revenue"] {
   var times=[Double](); for _ in 0..<20 { times.append(run(q)) }; times.sort()
   print(String(format:"%@ warm p95 %.0f ms",q,times[18]))
  }
  for (name, q, options) in [("whole", "physical ai", ["wholeWord":true]), ("exact", "quarterly revenue", ["exact":true]), ("regex fallback", "physical.ai", ["regex":true]), ("two-character fallback", "目标", [:])] as [(String,String,[String:Any])] {
   var times=[Double](); for _ in 0..<20 { times.append(run(q,options:options)) }; times.sort(); print(String(format:"%@ warm p95 %.0f ms",name,times[18]))
  }
  let updateStart=Date(); try "updated phrase".write(to:root.appendingPathComponent("note-1.md"),atomically:true,encoding:.utf8); s.update(root.appendingPathComponent("note-1.md")); _=run("updated phrase")
  print("10000 Markdown files, approximately \(paragraph.utf8.count * 10000) bytes, HTML 0, PDF 0")
  print(String(format:"indexing %.2f s; first query %.0f ms; update + query %.0f ms",build,first,Date().timeIntervalSince(updateStart)*1000))
 }
}
