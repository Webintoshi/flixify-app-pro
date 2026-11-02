import Foundation
public final class PlaybackAnalytics {
    private let item: [String:Any]
    private let emit: (String,[String:Any])->Void
    private let requested: Double
    private var last: Double
    private var watch: Double = 0
    private var bufferStarted: Double?
    private var started = false, ended = false, wasPlaying = false
    private var milestones = Set<Int>()
    public init(item: [String:Any], now: Double, requestAlreadyEmitted: Bool = false, emit: @escaping (String,[String:Any])->Void) {
        self.item=item; self.emit=emit; requested=now; last=now; if !requestAlreadyEmitted { emit("playback_request",item) }
    }
    private func values(_ key: String,_ value: Any) -> [String:Any] { var result=item; result[key]=value; return result }
    public func firstFrame(now: Double) {
        guard !started, !ended else { return }; started=true; last=now
        emit("video_start",values("startup_ms",Int(max(0,min(86_400_000,now-requested)))))
    }
    public func sample(now: Double, position: Double, duration: Double, playing: Bool, buffering: Bool) {
        guard !ended, now.isFinite else { return }
        if started, wasPlaying { watch += max(0,min(2000,now-last)) }; last=now; wasPlaying=playing && !buffering
        if started, buffering, bufferStarted == nil { bufferStarted=now }
        if let from=bufferStarted, !buffering { emit("playback_buffer",values("buffer_ms",Int(max(0,min(86_400_000,now-from))))); bufferStarted=nil }
        if started, duration.isFinite, duration>0, position.isFinite, position>=0 {
            for mark in [25,50,75] where position/duration*100>=Double(mark) && milestones.insert(mark).inserted { emit("video_progress",values("progress_percent",mark)) }
        }
    }
    public func end(now: Double, reason: String, complete: Bool) {
        guard !ended else { return }; sample(now: now,position: 0,duration: 0,playing: false,buffering: false); ended=true
        if complete, started { emit("video_complete",item) }
        var values=values("watch_ms",Int(min(86_400_000,watch))); values["reason"]=reason; emit("playback_end",values)
    }
}
