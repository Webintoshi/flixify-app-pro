import Foundation

public enum TrialMonotonicClock {
    private static let clock = ContinuousClock()
    private static let origin = clock.now
    public static func now() -> TimeInterval {
        let elapsed = origin.duration(to: clock.now).components
        return Double(elapsed.seconds) + Double(elapsed.attoseconds) / 1_000_000_000_000_000_000
    }
}

public struct TrialCountdown: Equatable, Sendable {
    public enum Status: String, Sendable { case none, pending, active, expired, unavailable }
    private let initialStatus: Status
    private let remainingAtAnchor: TimeInterval
    private let anchor: TimeInterval
    public init() { self.init(status: .none, remaining: 0, anchor: 0) }
    private init(status: Status, remaining: TimeInterval, anchor: TimeInterval) {
        initialStatus = status; remainingAtAnchor = remaining; self.anchor = anchor
    }
    public static func parse(_ value: Any?, at monotonicNow: TimeInterval = TrialMonotonicClock.now()) -> TrialCountdown {
        guard let raw = value as? [String: Any], let name = raw["status"] as? String, let status = Status(rawValue: name) else { return TrialCountdown() }
        guard status == .active || status == .expired else { return TrialCountdown(status: status, remaining: 0, anchor: 0) }
        guard monotonicNow.isFinite, monotonicNow >= 0,
              let server = date(raw["serverNow"]), let end = date(raw["endsAt"]) else {
            return TrialCountdown(status: .unavailable, remaining: 0, anchor: 0)
        }
        let remaining = end.timeIntervalSince(server)
        guard status == .active ? remaining > 0 && remaining <= 31 * 86400 : remaining <= 0 else {
            return TrialCountdown(status: .unavailable, remaining: 0, anchor: 0)
        }
        return TrialCountdown(status: status, remaining: status == .active ? remaining : 0, anchor: monotonicNow)
    }
    private static func date(_ value: Any?) -> Date? {
        guard let text = value as? String, text.utf8.count <= 64 else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var result = formatter.date(from: text)
        if result == nil { formatter.formatOptions = [.withInternetDateTime]; result = formatter.date(from: text) }
        guard let result, (946684800...4102444800).contains(result.timeIntervalSince1970) else { return nil }
        return result
    }
    public func status(at monotonicNow: TimeInterval = TrialMonotonicClock.now()) -> Status {
        initialStatus == .active && remainingSeconds(at: monotonicNow) == 0 ? .expired : initialStatus
    }
    public func remainingSeconds(at monotonicNow: TimeInterval = TrialMonotonicClock.now()) -> Int {
        guard initialStatus == .active, monotonicNow.isFinite else { return 0 }
        return Int(ceil(max(0, remainingAtAnchor - max(0, monotonicNow - anchor))))
    }
    public func text(at monotonicNow: TimeInterval = TrialMonotonicClock.now()) -> String {
        switch status(at: monotonicNow) {
        case .none: return ""
        case .pending: return "Deneme hazırlanıyor"
        case .unavailable: return "Deneme süresi doğrulanıyor"
        case .expired: return "Denemen sona erdi"
        case .active:
            let seconds = remainingSeconds(at: monotonicNow)
            let parts = [seconds / 3600, (seconds / 60) % 60, seconds % 60].map { $0 < 10 ? "0\($0)" : String($0) }
            return "Deneme · " + parts.joined(separator: ":")
        }
    }
}
