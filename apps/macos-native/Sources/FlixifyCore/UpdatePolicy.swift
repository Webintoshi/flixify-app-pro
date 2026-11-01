import Foundation
import CryptoKit

public struct NativeUpdateDescriptor: Equatable, Sendable {
    public let bundleIdentifier: String
    public let versionName: String
    public let buildNumber: Int
    public let minSystemVersion: String
    public let architectures: [String]
    public let dmgURL: URL
    public let sha256: String
    public let sizeBytes: Int
    public let notes: String
}

public enum NativeUpdatePolicy {
    public static let manifestURL = URL(string: "https://flixify.vip/downloads/flixify-macos-update.json")!
    public static let downloadPageURL = URL(string: "https://flixify.vip/indir")!
    public static let maximumDownloadBytes = 512 * 1024 * 1024

    private static func parts(_ version: String) -> [Int]? {
        guard version.count <= 32, Text.matches(version, #"^(?:0|[1-9][0-9]{0,5})(?:\.(?:0|[1-9][0-9]{0,5})){1,3}$"#) else { return nil }
        return version.split(separator: ".").compactMap { Int($0) }
    }
    public static func compareVersions(_ left: String, _ right: String) -> ComparisonResult? {
        guard let a = parts(left), let b = parts(right) else { return nil }
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0, y = index < b.count ? b[index] : 0
            if x != y { return x < y ? .orderedAscending : .orderedDescending }
        }
        return .orderedSame
    }
    public static func parse(_ data: Data) throws -> NativeUpdateDescriptor {
        guard data.count <= 16384 else { throw FlixifyError.limit }
        try StrictJSON.validate(data, uniqueKeys: true)
        guard data.count <= 16384, let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any], Set(raw.keys) == Set(["bundleIdentifier", "versionName", "buildNumber", "minSystemVersion", "architectures", "dmgUrl", "sha256", "sizeBytes", "notes"]), raw["bundleIdentifier"] as? String == "vip.flixify.mac", let version = raw["versionName"] as? String, parts(version) != nil, let system = raw["minSystemVersion"] as? String, parts(system) != nil, let build = raw["buildNumber"] as? NSNumber, ProviderParser.bool(build) == nil, build.doubleValue == Double(build.intValue), (1...Int(Int32.max)).contains(build.intValue), let architectures = raw["architectures"] as? [String], architectures.count == 2, Set(architectures) == Set(["arm64", "x86_64"]), let address = raw["dmgUrl"] as? String, address == "https://flixify.vip/downloads/Flixify-Pro-\(version)-macos-universal.dmg", let url = URL(string: address), let digest = raw["sha256"] as? String, Text.matches(digest, #"^[a-f0-9]{64}$"#), let size = raw["sizeBytes"] as? NSNumber, ProviderParser.bool(size) == nil, size.doubleValue == Double(size.intValue), (1...maximumDownloadBytes).contains(size.intValue), let notes = raw["notes"] as? String, notes.utf16.count <= 2048, !Text.matches(notes, #"[\x00-\x09\x0b-\x1f\x7f-\x9f]"#) else { throw FlixifyError.invalidData }
        guard compareVersions(system, "13.0") != .orderedAscending else { throw FlixifyError.invalidData }
        return NativeUpdateDescriptor(bundleIdentifier: "vip.flixify.mac", versionName: version, buildNumber: build.intValue, minSystemVersion: system, architectures: architectures, dmgURL: url, sha256: digest, sizeBytes: size.intValue, notes: notes)
    }
    public static func validate(_ data: Data, currentVersion: String, currentBuild: Int, currentSystemVersion: String? = nil) throws -> NativeUpdateDescriptor {
        let descriptor = try parse(data)
        guard let compared = compareVersions(descriptor.versionName, currentVersion), compared == .orderedDescending || compared == .orderedSame && descriptor.buildNumber > currentBuild else { throw FlixifyError.updateUnavailable }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let system = currentSystemVersion ?? "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"
        guard let compatible = compareVersions(system, descriptor.minSystemVersion), compatible != .orderedAscending else { throw FlixifyError.updateUnavailable }
        return descriptor
    }
    public static func verifyFile(_ url: URL, descriptor: NativeUpdateDescriptor) throws {
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        guard values.isRegularFile == true, values.isSymbolicLink != true, values.fileSize == descriptor.sizeBytes else { throw FlixifyError.invalidData }
        let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
        var hash = SHA256(), count = 0
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            count += data.count; guard count <= descriptor.sizeBytes else { throw FlixifyError.limit }; hash.update(data: data)
        }
        guard count == descriptor.sizeBytes, hash.finalize().map({ String(format: "%02x", $0) }).joined() == descriptor.sha256 else { throw FlixifyError.invalidData }
    }
}
