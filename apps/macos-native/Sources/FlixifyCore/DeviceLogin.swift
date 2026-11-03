import Foundation
import ImageIO

public enum DeviceLoginStatus: String, Sendable {
    case pending, authorized, slowDown = "slow_down", denied, cancelled, expired, complete
    public var terminal: Bool { self == .denied || self == .cancelled || self == .expired || self == .complete }
}

public struct DeviceLoginLifetime: Sendable {
    private let duration: TimeInterval
    private let startedAt: TimeInterval
    public init(duration: Int = 180, startedAt: TimeInterval) { self.duration = TimeInterval(min(180, max(1, duration))); self.startedAt = startedAt }
    public func remaining(at uptime: TimeInterval) -> Int { max(0, Int(ceil(duration - max(0, uptime - startedAt)))) }
    public func canPoll(at uptime: TimeInterval) -> Bool { uptime - startedAt < duration + 60 }
}

public struct DeviceLoginPresentation: Sendable {
    public let userCode: String
    public let png: Data
    public let duration: Int
    public let interval: Int
    public init(_ raw: [String: Any]) throws {
        guard let code = raw["userCode"] as? String, Text.matches(code, #"^[A-Z]{4}-[A-Z]{4}$"#),
              raw["verificationUri"] as? String == "https://flixify.vip/cihaz",
              raw["verificationUriComplete"] as? String == "https://flixify.vip/cihaz?code=" + code,
              let encoded = raw["qrPngBase64"] as? String, encoded.utf8.count <= 350_000,
              let bytes = Data(base64Encoded: encoded), bytes.count <= 256 * 1024,
              bytes.starts(with: [137, 80, 78, 71, 13, 10, 26, 10]),
              let source = CGImageSourceCreateWithData(bytes as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
              CGImageSourceGetCount(source) == 1,
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int, let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, width <= 1024, width == height,
              CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCache: false] as CFDictionary) != nil,
              raw["expiresInSeconds"] as? Int == 180, ProviderParser.date(raw["expiresAt"]) != nil,
              let interval = raw["intervalSeconds"] as? Int, (2...60).contains(interval) else { throw FlixifyError.invalidData }
        userCode = code; png = bytes; duration = 180; self.interval = interval
    }
}

struct DeviceLoginAttempt: Sendable {
    let epoch: UUID
    let requestID: String
    let proof: String
    let auth: UInt64
    let lifetime: DeviceLoginLifetime
    var interval: Int
    var adopted = false
    var polling = false
    var body: [String: String] { ["requestId": requestID, "deviceSecret": proof] }
}

public extension FlixifyRepositoryProtocol {
    func startDeviceLogin() async throws -> DeviceLoginPresentation { throw FlixifyError.network }
    func pollDeviceLogin() async throws -> DeviceLoginStatus { throw FlixifyError.network }
    func hasDeviceLoginSession() async -> Bool { false }
    func deviceLoginInterval() async -> Int { 2 }
    func acknowledgeDeviceLogin() async {}
    func cancelDeviceLogin() async {}
}
