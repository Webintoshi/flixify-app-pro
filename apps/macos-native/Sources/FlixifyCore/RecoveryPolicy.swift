import Foundation

public enum RecoveryTrigger: Sendable {
    case decoderError, ended, startupTimeout, stall
}

public struct RecoveryPolicy: Sendable {
    public static let maximumAttempts = 2
    public private(set) var attempts = 0
    public private(set) var stopped = false
    private let scope: String
    private let itemKey: String
    private var expiresAt: Date

    public init(scope: String, itemKey: String, expiresAt: Date) {
        self.scope = scope; self.itemKey = itemKey; self.expiresAt = expiresAt
    }

    public static func recovers(_ trigger: RecoveryTrigger, kind: MediaKind) -> Bool {
        guard kind == .live || kind == .movie || kind == .episode else { return false }
        if case .ended = trigger { return kind == .live }
        return true
    }

    public mutating func allows(scope: String, itemKey: String, now: Date = Date()) -> Bool {
        guard !stopped, !self.scope.isEmpty, self.scope == scope,
              self.itemKey == itemKey, expiresAt > now else { stop(); return false }
        return true
    }

    public mutating func admit(scope: String, itemKey: String, expiresAt: Date, now: Date = Date()) -> Bool {
        guard !stopped, !self.scope.isEmpty, self.scope == scope,
              self.itemKey == itemKey, expiresAt > now else { stop(); return false }
        self.expiresAt = expiresAt
        return true
    }

    public mutating func claim(scope: String, itemKey: String, now: Date = Date()) -> Bool {
        guard allows(scope: scope, itemKey: itemKey, now: now), attempts < Self.maximumAttempts else { return false }
        attempts += 1
        return true
    }

    public mutating func stop() { stopped = true }
}

public struct RecoveryWatchdog: Sendable {
    public static let startupTimeout: TimeInterval = 30
    public static let stallTimeout: TimeInterval = 12
    private var started: Date
    private var lastProgress: Date
    private var lastPosition: Double
    private var hasFrame = false

    public init(now: Date = Date(), position: Double = 0) {
        started = now; lastProgress = now; lastPosition = position
    }

    public mutating func firstFrame(now: Date = Date()) {
        guard !hasFrame else { return }
        hasFrame = true; lastProgress = now
    }

    public mutating func interaction(now: Date = Date()) { lastProgress = now }

    public mutating func stalled(now: Date = Date(), position: Double, wantsPlay: Bool,
                                 ready: Bool, playing: Bool, ended: Bool, interacting: Bool) -> Bool {
        if !wantsPlay || ended || interacting {
            lastProgress = now; lastPosition = position
            if !hasFrame { started = now }
            return false
        }
        if !hasFrame { return now.timeIntervalSince(started) >= Self.startupTimeout }
        if (ready && !playing) || (position.isFinite && abs(position - lastPosition) >= 0.2) { lastProgress = now }
        lastPosition = position
        return now.timeIntervalSince(lastProgress) >= Self.stallTimeout
    }
}
