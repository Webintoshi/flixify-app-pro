import Foundation

public struct NextEpisodePolicy: Sendable {
    public static let countdown: TimeInterval = 5
    public private(set) var cancelled = false
    public private(set) var handled = false
    private var deadline: Date?

    public init() {}

    public static func validSuccessor(_ item: CatalogItem, _ next: CatalogItem?) -> Bool {
        guard let next, item.kind == .episode, next.kind == .episode,
              !item.scope.isEmpty, item.scope == next.scope,
              !item.seriesID.isEmpty, item.seriesID == next.seriesID,
              item.key != next.key else { return false }
        return next.season > item.season || (next.season == item.season && next.episode > item.episode)
    }

    @discardableResult
    public mutating func begin(item: CatalogItem, next: CatalogItem?, duration: Double, now: Date = Date()) -> Bool {
        guard !cancelled, !handled, deadline == nil, duration.isFinite, duration > 0,
              Self.validSuccessor(item, next) else { return false }
        deadline = now.addingTimeInterval(Self.countdown)
        return true
    }

    public var pending: Bool { deadline != nil && !cancelled && !handled }

    public func remainingSeconds(now: Date = Date()) -> Int {
        guard pending, let deadline else { return 0 }
        return max(0, Int(ceil(deadline.timeIntervalSince(now))))
    }

    @discardableResult
    public mutating func claim(now: Date = Date(), immediately: Bool = false) -> Bool {
        guard pending, let deadline, immediately || now >= deadline else { return false }
        handled = true
        self.deadline = nil
        return true
    }

    public mutating func cancel() {
        cancelled = true
        deadline = nil
    }
}
