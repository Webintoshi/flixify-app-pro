import Foundation

public struct PlaybackAnalyticsContext: Sendable {
    public let id: UUID
    public let startedAt: Double
    public let epoch: Int
    public init?(startedAt: Double, epoch: Int, enabled: Bool) {
        guard enabled, startedAt.isFinite, startedAt >= 0 else { return nil }
        id=UUID();self.startedAt=startedAt;self.epoch=epoch
    }
    public static func begin(item:[String:Any],startedAt:Double,epoch:Int,enabled:Bool,emit:(String,[String:Any])->Void)->Self? {
        guard let context=Self(startedAt:startedAt,epoch:epoch,enabled:enabled) else { return nil }
        emit("playback_request",item);return context
    }
    public func admit(item: [String:Any], epoch: Int, enabled: Bool, emit: @escaping (String,[String:Any])->Void) -> PlaybackAnalytics? {
        guard enabled, epoch == self.epoch else { return nil }
        return PlaybackAnalytics(item:item,now:startedAt,requestAlreadyEmitted:true,emit:emit)
    }
    public func fail(item: [String:Any], epoch: Int, enabled: Bool, reason: String, emit: (String,[String:Any])->Void) {
        guard enabled, epoch == self.epoch else { return }
        var values=item;values["reason"]=reason
        emit("playback_error",values)
        values["watch_ms"]=0;emit("playback_end",values)
    }
    public func end(item: [String:Any], epoch: Int, enabled: Bool, reason: String, emit: (String,[String:Any])->Void) {
        guard enabled, epoch == self.epoch else { return }
        var values=item;values["reason"]=reason;values["watch_ms"]=0;emit("playback_end",values)
    }
}

public final class SearchAnalyticsSession {
    public struct Ticket: Sendable {
        fileprivate let id: UUID
        fileprivate let epoch: Int
        fileprivate let length: Int
        fileprivate let enabled: Bool
    }
    private var query=""
    private var current: Ticket?
    private var completed=false
    public init() {}
    public func begin(query: String, epoch: Int, enabled: Bool) -> Ticket? {
        let value=query.trimmingCharacters(in:.whitespacesAndNewlines)
        if value == self.query { return current }
        self.query=value;completed=false
        guard !value.isEmpty else { current=nil;return nil }
        let ticket=Ticket(id:UUID(),epoch:epoch,length:min(value.count,500),enabled:enabled)
        current=ticket;return ticket
    }
    public func complete(_ ticket: Ticket, resultCount: Int, epoch: Int, enabled: Bool) -> [String:Int]? {
        guard !completed, current?.id == ticket.id, ticket.enabled, enabled, ticket.epoch == epoch, resultCount >= 0 else { return nil }
        completed=true
        return ["query_length":ticket.length,"result_count":min(resultCount,100_000)]
    }
}
