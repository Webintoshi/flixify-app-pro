import Foundation
import CryptoKit

struct CacheEnvelope<Value: Codable>: Codable {
    let version: Int
    let scope: String
    let savedAt: Date
    let expiresAt: Date
    let value: Value
}

struct CacheHit<Value> {
    let value: Value
    let savedAt: Date
    let stale: Bool
}

struct MetadataCache: Sendable {
    static let fresh: TimeInterval = 6 * 60 * 60
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60
    let root: URL
    let budget: Int
    init(root: URL? = nil, budget: Int = 32 * 1024 * 1024) {
        self.root = root ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("vip.flixify.mac/metadata", isDirectory: true)
        self.budget = budget
    }
    static func hash(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined() }
    func file(scope: String, name: String) -> URL { root.appendingPathComponent(Self.hash(scope + "\u{0}" + name) + ".json") }
    func read<Value: Codable>(_ type: Value.Type, scope: String, name: String, expiry: Date, now: Date) -> CacheHit<Value>? {
        let path = file(scope: scope, name: name)
        guard expiry > now, let resources = try? path.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]), resources.isRegularFile == true, resources.isSymbolicLink != true, let attributes = try? FileManager.default.attributesOfItem(atPath: path.path), let size = attributes[.size] as? NSNumber, size.intValue <= 20 * 1024 * 1024, let data = try? Data(contentsOf: path), data.count <= 20 * 1024 * 1024, let envelope = try? JSONDecoder().decode(CacheEnvelope<Value>.self, from: data), envelope.version == 1, envelope.scope == scope, envelope.savedAt <= now, now.timeIntervalSince(envelope.savedAt) < Self.maxAge, envelope.expiresAt > now else { return nil }
        return CacheHit(value: envelope.value, savedAt: envelope.savedAt, stale: now.timeIntervalSince(envelope.savedAt) >= Self.fresh)
    }
    func write<Value: Codable>(_ value: Value, scope: String, name: String, expiry: Date, now: Date) {
        guard expiry > now else { return }
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(CacheEnvelope(version: 1, scope: scope, savedAt: now, expiresAt: expiry, value: value))
            guard data.count <= min(budget, 20 * 1024 * 1024) else { return }
            let path = file(scope: scope, name: name); try data.write(to: path, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
            trim(keep: path)
        } catch { }
    }
    private func trim(keep: URL) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]) else { return }
        let entries = files.filter { $0.pathExtension == "json" }.compactMap { url -> (URL, Int, Date)? in
            guard let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]), values.isRegularFile == true else { return nil }
            return (url, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)
        }.sorted { $0.2 < $1.2 }
        var count = entries.count, size = entries.reduce(0) { $0 + $1.1 }
        for entry in entries where (count > 128 || size > budget) && entry.0 != keep {
            if (try? FileManager.default.removeItem(at: entry.0)) != nil { size -= entry.1; count -= 1 }
        }
    }
}

struct ProgressRecord: Codable { let seconds: Double; let updatedAt: Date }

struct ProgressStore: Sendable {
    let file: URL
    init(file: URL? = nil) {
        self.file = file ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("vip.flixify.mac/progress.json")
    }
    private func values() -> [String: ProgressRecord] {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: file.path), ((attrs[.size] as? NSNumber)?.intValue ?? Int.max) <= 1024 * 1024, let data = try? Data(contentsOf: file), let value = try? JSONDecoder().decode([String: ProgressRecord].self, from: data), value.count <= 2000 else { return [:] }; return value
    }
    private func key(_ item: CatalogItem) -> String { MetadataCache.hash(item.scope + ":" + item.key) }
    func position(_ item: CatalogItem) -> Double { guard item.kind == .movie || item.kind == .episode else { return 0 }; return max(0, values()[key(item)]?.seconds ?? 0) }
    func latestEpisode(_ episodes: [CatalogItem]) -> CatalogItem? {
        let records = values()
        return episodes.filter { $0.kind == .episode && (records[key($0)]?.seconds ?? 0) > 0 }.max { (records[key($0)]?.updatedAt ?? .distantPast) < (records[key($1)]?.updatedAt ?? .distantPast) }
    }
    func save(_ item: CatalogItem, seconds: Double, duration: Double, now: Date) {
        guard item.kind == .movie || item.kind == .episode, seconds.isFinite, duration.isFinite, seconds >= 0, duration > 0, !item.scope.isEmpty else { return }
        var records = values(), target = key(item)
        if seconds >= duration - 15 || seconds >= duration * 0.95 { records.removeValue(forKey: target) }
        else { records[target] = ProgressRecord(seconds: min(seconds, duration), updatedAt: now) }
        if records.count > 2000 { for entry in records.sorted(by: { $0.value.updatedAt < $1.value.updatedAt }).prefix(records.count - 2000) { records.removeValue(forKey: entry.key) } }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(records).write(to: file, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
        } catch { }
    }
}
