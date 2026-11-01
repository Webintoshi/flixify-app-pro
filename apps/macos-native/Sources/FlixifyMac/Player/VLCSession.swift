import AppKit
import Foundation
import VLCKit

struct PlayerTrack: Identifiable, Equatable {
    let id: Int32
    let title: String
}

struct VLCPlaybackSnapshot {
    var state: VLCMediaPlayerState = .stopped
    var seconds: Double = 0
    var duration: Double = 0
    var seekable = false
    var hasVideo = false
    var hasFrame = false
    var resumePending = false
    var audio: [PlayerTrack] = []
    var subtitles: [PlayerTrack] = []
    var audioID: Int32 = -1
    var subtitleID: Int32 = -1
#if FIXTURE_QA
    var decodedVideo: Int32 = 0
    var decodedAudio: Int32 = 0
    var aspect: String?
#endif
}

/// Every engine shares this lane so a previous network connection is closed before its replacement opens.
final class VLCSession: @unchecked Sendable {
    private static let lane = DispatchQueue(label: "vip.flixify.mac.vlc", qos: .userInitiated)
    private static var active: VLCSession?
    private let player: VLCMediaPlayer
    private let eventLock = NSLock()
    private var didEnd = false
    private var didError = false
    private var didStop = false
    private var stateObserver: NSObjectProtocol?
    private var closed = false
    private var loaded = false
    private var resume: Double = 0
    private var live = false
    private var pauseIntent = false

    convenience init() { self.init(options: ["--quiet", "--no-osd", "--no-video-title-show", "--no-play-and-pause", "--extraintf="]) }

#if FIXTURE_QA
    convenience init(headless: Bool) {
        self.init(options: ["--quiet", "--no-osd", "--no-video-title-show", "--no-play-and-pause", "--extraintf="] + (headless ? ["--vout=dummy", "--aout=dummy"] : []))
    }
#endif

    private init(options: [String]) {
        player = VLCMediaPlayer(options: options)
        stateObserver = NotificationCenter.default.addObserver(forName: Notification.Name(rawValue: VLCMediaPlayerStateChanged), object: player, queue: nil) { [weak self] _ in
            guard let self else { return }
            let state = self.player.state
            self.eventLock.lock()
            if state == .ended { self.didEnd = true }
            if state == .error { self.didError = true }
            if state == .stopped { self.didStop = true }
            self.eventLock.unlock()
            if state == .stopped {
                Self.lane.async { [weak self] in
                    guard let self, self.closed else { return }
                    self.player.media = nil
                    if Self.active === self { Self.active = nil }
                    self.detach()
                }
            }
        }
    }

    @MainActor func attach(_ view: VLCVideoView) { player.drawable = view }

    func load(_ url: URL, live: Bool, resume: Double, paused: Bool = false) {
        Self.lane.async { [self] in
            guard !closed else { return }
            if let previous = Self.active, previous !== self {
                guard previous.stopAndWait() else { markError(); return }
                previous.closed = true
                previous.detach()
            }
            Self.active = self
            if loaded, !stopAndWait() { markError(); return }
            clearEvents()
            self.live = live
            self.pauseIntent = paused
            self.resume = max(0, resume.isFinite ? resume : 0)
            let media = VLCMedia(url: url)
            media.addOptions([
                "network-caching": live ? 900 : 1500,
                "live-caching": 900,
                "file-caching": 300,
                "http-reconnect": true
            ])
            player.media = media
            player.setDeinterlace(.auto, withFilter: "yadif")
            player.play()
            if pauseIntent { player.pause() }
            loaded = true
        }
    }

    func snapshot(_ completion: @escaping (VLCPlaybackSnapshot) -> Void) {
        Self.lane.async { [self] in
            guard !closed else { completion(VLCPlaybackSnapshot()); return }
            var value = VLCPlaybackSnapshot()
            value.state = player.isPlaying ? .playing : player.state
            if pauseIntent, player.isPlaying { player.pause(); value.state = .paused }
            let flags = eventFlags()
            if flags.ended { value.state = .ended }
            if flags.error { value.state = .error }
            value.seconds = max(0, (player.time.value?.doubleValue ?? 0) / 1000)
            value.duration = max(0, (player.media?.length.value?.doubleValue ?? 0) / 1000)
            value.seekable = !live && player.isSeekable
            value.hasVideo = player.hasVideoOut
            let stats = player.media?.statistics
            value.hasFrame = (stats?.decodedVideo ?? 0) > 0 || (!value.hasVideo && (stats?.decodedAudio ?? 0) > 0)
            if resume > 0, value.seekable, value.state == .playing || value.state == .paused, value.duration > 0 {
                let seconds = min(resume, max(0, value.duration - 1))
                player.time = VLCTime(number: NSNumber(value: Int64(seconds * 1000)))
                value.seconds = seconds
                resume = 0
            }
            value.resumePending = resume > 0
            value.audio = Self.tracks(player.audioTrackNames, player.audioTrackIndexes)
            value.subtitles = Self.tracks(player.videoSubTitlesNames, player.videoSubTitlesIndexes)
            value.audioID = player.currentAudioTrackIndex
            value.subtitleID = player.currentVideoSubTitleIndex
#if FIXTURE_QA
            value.decodedVideo = player.media?.statistics.decodedVideo ?? 0
            value.decodedAudio = player.media?.statistics.decodedAudio ?? 0
            if let ratio = player.videoAspectRatio { value.aspect = String(cString: ratio); free(ratio) }
#endif
            completion(value)
        }
    }

    func toggle(replay: Bool) {
        Self.lane.async { [self] in
            guard !closed else { return }
            if replay {
                guard stopAndWait() else { markError(); return }
                clearEvents()
                player.time = VLCTime(int: 0)
                resume = 0
                pauseIntent = false
                player.play()
            } else if player.isPlaying { pauseIntent = true; player.pause() }
            else { pauseIntent = false; player.play() }
        }
    }

    func setPaused(_ paused: Bool) {
        Self.lane.async { [self] in
            guard !closed else { return }
            pauseIntent = paused
            guard loaded else { return }
            if paused { player.pause() } else { player.play() }
        }
    }

    func seek(_ seconds: Double) {
        Self.lane.async { [self] in
            guard !closed, !live, player.isSeekable, seconds.isFinite else { return }
            resume = 0
            player.time = VLCTime(number: NSNumber(value: Int64(max(0, seconds) * 1000)))
        }
    }

    func setVolume(_ value: Double) {
        Self.lane.async { [self] in
            guard !closed else { return }
            player.audio?.volume = Int32(min(100, max(0, value)))
        }
    }

    func setMuted(_ muted: Bool) {
        Self.lane.async { [self] in if !closed { player.audio?.isMuted = muted } }
    }

    func setRate(_ rate: Double) {
        Self.lane.async { [self] in if !closed, !live { player.rate = Float(rate) } }
    }

    func setAudio(_ id: Int32) {
        Self.lane.async { [self] in if !closed { player.currentAudioTrackIndex = id } }
    }

    func setSubtitle(_ id: Int32) {
        Self.lane.async { [self] in if !closed { player.currentVideoSubTitleIndex = id } }
    }

    func setAspect(_ ratio: String?) {
        Self.lane.async { [self] in
            guard !closed else { return }
            if let ratio { ratio.withCString { player.videoAspectRatio = UnsafeMutablePointer(mutating: $0) } }
            else { player.videoAspectRatio = nil }
        }
    }

    func stop() {
        Self.lane.async { [self] in
            guard !closed else { return }
            closed = true
            guard stopAndWait() else { markError(); return }
            player.media = nil
            if Self.active === self { Self.active = nil }
            detach()
        }
    }

    func reset() {
        Self.lane.async { [self] in
            guard !closed else { return }
            guard stopAndWait() else { markError(); return }
            player.media = nil
            loaded = false
            if Self.active === self { Self.active = nil }
        }
    }

    private func detach() {
        let player = player
        DispatchQueue.main.async { player.drawable = nil }
    }

    private func eventFlags() -> (ended: Bool, error: Bool, stopped: Bool) {
        eventLock.lock(); defer { eventLock.unlock() }
        return (didEnd, didError, didStop)
    }

    private func clearEvents() {
        eventLock.lock(); defer { eventLock.unlock() }
        didEnd = false; didError = false; didStop = false
    }

    private func markError() {
        eventLock.lock(); defer { eventLock.unlock() }
        didError = true
    }

    private func stopAndWait() -> Bool {
        if !loaded || (player.state == .stopped && eventFlags().stopped) { return true }
        eventLock.lock(); didStop = false; eventLock.unlock()
        player.stop()
        let until = Date().addingTimeInterval(8)
        while Date() < until {
            if player.state == .stopped || eventFlags().stopped { return true }
            Thread.sleep(forTimeInterval: 0.01)
        }
        return false
    }

    private static func tracks(_ names: [Any], _ indexes: [Any]) -> [PlayerTrack] {
        zip(names, indexes).compactMap { name, value in
            guard let value = value as? NSNumber else { return nil }
            let id = value.int32Value
            let title = (name as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return PlayerTrack(id: id, title: id < 0 ? "Kapalı" : (title.isEmpty ? "Parça \(id + 1)" : title))
        }
    }

    deinit { if let stateObserver { NotificationCenter.default.removeObserver(stateObserver) } }
}
