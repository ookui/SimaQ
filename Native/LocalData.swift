import AppKit
import Foundation
import CryptoKit

typealias JSONObject = [String: Any]

enum SQError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let message) = self { return message }; return nil }
}

final class LocalData {
    let directory: URL
    let resources: URL
    private let fm = FileManager.default
    init(resources: URL, directory: URL? = nil) throws {
        self.resources = resources
        self.directory = try directory ?? fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("SimaQ", isDirectory: true)
        for folder in ["Themes", "Templates", "Sessions"] {
            try fm.createDirectory(at: self.directory.appendingPathComponent(folder), withIntermediateDirectories: true)
        }
        let templateFolder = resources.appendingPathComponent("Templates")
        for template in (try? fm.contentsOfDirectory(at: templateFolder, includingPropertiesForKeys: nil)) ?? [] where template.pathExtension == "md" {
            let target = self.directory.appendingPathComponent("Templates").appendingPathComponent(template.lastPathComponent)
            if !fm.fileExists(atPath: target.path) { try fm.copyItem(at: template, to: target) }
        }
    }
    func read(_ key: String) -> JSONObject {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent(key + ".json")),
              let result = try? JSONSerialization.jsonObject(with: data) as? JSONObject else { return [:] }
        return result
    }
    func write(_ key: String, _ object: JSONObject) throws {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        try data.write(to: directory.appendingPathComponent(key + ".json"), options: .atomic)
    }
    func sessionKey(_ root: URL) -> String {
        "Sessions/" + SHA256.hash(data: Data(root.standardizedFileURL.path.utf8)).map { String(format:"%02x", $0) }.joined()
    }
    var recents: [String] { read("recent")["paths"] as? [String] ?? [] }
    func remember(_ root: URL) throws { try write("recent", ["paths": Array(([root.path] + recents.filter { $0 != root.path }).prefix(12))]) }
    func list(_ folder: String, ext: String, field: String) throws -> [JSONObject] {
        try fm.contentsOfDirectory(at: directory.appendingPathComponent(folder), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
            .filter { $0.pathExtension.lowercased() == ext }.sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
            .map { ["name": $0.lastPathComponent, field: try String(contentsOf: $0, encoding: .utf8)] }
    }
    func sample() throws -> URL {
        let target = directory.appendingPathComponent("SimaQ 示例资料库", isDirectory: true)
        if !fm.fileExists(atPath: target.path) { try fm.copyItem(at: resources.appendingPathComponent("Samples"), to: target) }
        return target
    }
}
