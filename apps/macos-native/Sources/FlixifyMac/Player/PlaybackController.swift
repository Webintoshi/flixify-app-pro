import AppKit
import Combine
import FlixifyCore
import Foundation

@MainActor
final class PlaybackController: ObservableObject {
    @Published private(set) var playing = false
    @Published private(set) var opening = true
    @Published private(set) var ended = false
    @Published private(set) var position: Double = 0
    @Published private(set) var duration: Double = 0
    @Published private(set) var seekable = false
    @Published private(set) var error: String?
    @Published private(set) var audioTracks: [PlayerTrack] = []
    @Published private(set) var subtitleTracks: [PlayerTrack] = []
    @Published private(set) var audioID: Int32 = -1
    @Published private(set) var subtitleID: Int32 = -1
    @Published private(set) var controlsVisible = true
    @Published private(set) var countdown: Int?
    @Published var volume: Double = 80
    @Published var muted = false
    @Published var rate: Double = 1
    @Published var aspect = "Otomatik"
    let session = VLCSession()
    private(set) var request: PlaybackRequest
    private var continuation = NextEpisodePolicy()
    private var timer: Timer?
    private var lastActivity = Date()
    private var lastProgress = Date.distantPast
    private var snapshotPending = false
    private var generation = UUID()
    private var closed = false
    private var started = false
    private var reportedEnd = false
    private var interactionCount = 0
    private var wantsPlay = true
    private var hasPresentedVideo = false
    private var engineFirstFrame = false
    private var recoveryPolicy: RecoveryPolicy
    private var watchdog = RecoveryWatchdog()
    private var recoveryTask: Task<Void, Never>?
    private var preferredAudio: TrackPreference?
    private var preferredSubtitle: TrackPreference?
    private var restoreAudio = false
    private var restoreSubtitle = false
    private var trackRestoreUntil = Date.distantPast
    private var observers: [NSObjectProtocol] = []
    private var measurement: PlaybackAnalytics?
    weak var window: NSWindow?
    var onPosition: (Double, Double) -> Void = { _, _ in }
    var onWatched: () -> Void = {}
    var onNext: (CatalogItem) -> Void = { _ in }
    var onRecovery: ((PlaybackRequest, Double) async -> PlaybackRequest?)?

    init(playback: PlaybackRequest) {
        request = playback
        recoveryPolicy = RecoveryPolicy(scope: playback.scope, itemKey: playback.item.key, expiresAt: playback.expiresAt)
    }

    var isLive: Bool { request.item.kind == .live }

    func start() {
        guard !started, !closed else { return }
        started = true
        load(request)
        let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.cancelContinuation() }
        })
        observers.append(center.addObserver(forName: NSApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.close() }
        })
        observers.append(center.addObserver(forName: NSWindow.willCloseNotification, object: nil, queue: .main) { [weak self] notice in
            Task { @MainActor in
                guard let self, let closing = notice.object as? NSWindow, closing === self.window else { return }
                self.close()
            }
        })
    }

    func load(_ playback: PlaybackRequest) {
        guard !closed else { return }
        measurement?.end(now:ProcessInfo.processInfo.systemUptime*1000,reason:"replaced",complete:false)
        measurement=FlixifyAnalytics.shared.playback(playback.item,context:playback.analyticsContext)
        FlixifyAnalytics.shared.screen("player")
        recoveryTask?.cancel(); recoveryTask = nil
        recoveryPolicy = RecoveryPolicy(scope: playback.scope, itemKey: playback.item.key, expiresAt: playback.expiresAt)
        wantsPlay = true
        hasPresentedVideo = false
        preferredAudio = nil; preferredSubtitle = nil
        prepare(playback, recovery: false)
    }

    private func prepare(_ playback: PlaybackRequest, recovery: Bool) {
        request = playback
        generation = UUID()
        if !recovery { continuation = NextEpisodePolicy() }
        if !NSApp.isActive { continuation.cancel() }
        countdown = nil
        reportedEnd = false
        ended = false
        opening = !hasPresentedVideo
        playing = false
        error = nil
        position = max(0, playback.resumeSeconds.isFinite ? playback.resumeSeconds : 0)
        if !recovery { duration = 0 }
        seekable = false
        if !recovery { audioTracks = []; subtitleTracks = [] }
        lastProgress = .distantPast
        snapshotPending = false
        engineFirstFrame = false
        restoreAudio = recovery && preferredAudio != nil
        restoreSubtitle = recovery && preferredSubtitle != nil
        trackRestoreUntil = .distantFuture
        watchdog = RecoveryWatchdog(position: position)
        if !recovery { activity() }
        guard playback.expiresAt > Date() else { expire(); return }
        session.load(playback.url, live: isLive, resume: playback.resumeSeconds, paused: !wantsPlay)
        session.setVolume(volume)
        session.setMuted(muted)
    }

    func updateDeadline(_ deadline: Date) {
        guard !closed else { return }
        _ = recoveryPolicy.admit(scope: request.scope, itemKey: request.item.key, expiresAt: deadline)
        request = PlaybackRequest(item: request.item, url: request.url, expiresAt: deadline,
                                  resumeSeconds: request.resumeSeconds, nextEpisode: request.nextEpisode, scope: request.scope, analyticsContext: request.analyticsContext)
    }

    func togglePlayback() {
        guard !closed, error == nil else { return }
        cancelContinuation()
        watchdog.interaction()
        if ended { wantsPlay = true; session.toggle(replay: true); ended = false }
        else { wantsPlay.toggle(); session.setPaused(!wantsPlay) }
        activity()
    }

    func seek(to seconds: Double) {
        guard !isLive, seekable, duration > 0, seconds.isFinite else { return }
        cancelContinuation()
        let value = min(duration, max(0, seconds))
        position = value
        session.seek(value)
        watchdog.interaction()
        activity()
    }

    func seek(by seconds: Double) { seek(to: position + seconds) }

    func setVolume(_ value: Double) {
        volume = min(100, max(0, value))
        session.setVolume(volume)
        if muted, volume > 0 { setMuted(false) }
        activity()
    }

    func setMuted(_ value: Bool) { muted = value; session.setMuted(value); activity() }
    func setRate(_ value: Double) { guard !isLive else { return }; rate = value; session.setRate(value); activity() }
    func selectAudio(_ id: Int32) {
        preferredAudio = TrackPreference(id: id, tracks: audioTracks)
        restoreAudio = preferredAudio != nil; trackRestoreUntil = engineFirstFrame ? Date().addingTimeInterval(4) : .distantFuture
        audioID = id; session.setAudio(id); activity()
    }
    func selectSubtitle(_ id: Int32) {
        preferredSubtitle = TrackPreference(id: id, tracks: subtitleTracks)
        restoreSubtitle = preferredSubtitle != nil; trackRestoreUntil = engineFirstFrame ? Date().addingTimeInterval(4) : .distantFuture
        subtitleID = id; session.setSubtitle(id); activity()
    }
    func setAspect(_ value: String) { aspect = value; session.setAspect(value == "Otomatik" ? nil : value); activity() }

    func activity() { lastActivity = Date(); controlsVisible = true }
    func beginInteraction() { interactionCount += 1; watchdog.interaction(); activity() }
    func endInteraction() { interactionCount = max(0, interactionCount - 1); watchdog.interaction(); activity() }
    func toolsHover(_ inside: Bool) { if inside { activity() } }

    func hideControls() {
        guard playing, countdown == nil, interactionCount == 0 else { return }
        controlsVisible = false
    }

    func cancelContinuation() { continuation.cancel(); countdown = nil; activity() }

    func chooseNext() {
        guard let next = request.nextEpisode, NextEpisodePolicy.validSuccessor(request.item, next), request.expiresAt > Date() else { return }
        if continuation.pending { guard continuation.claim(immediately: true) else { return } }
        else { continuation.cancel() }
        countdown = nil
        onNext(next)
    }

    func close() {
        guard !closed else { return }
        measurement?.end(now:ProcessInfo.processInfo.systemUptime*1000,reason:"closed",complete:false);measurement=nil
        closed = true
        generation = UUID()
        recoveryPolicy.stop()
        recoveryTask?.cancel(); recoveryTask = nil
        continuation.cancel()
        countdown = nil
        timer?.invalidate(); timer = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        sendPosition()
        session.stop()
    }

    func toggleFullscreen() { window?.toggleFullScreen(nil); activity() }

    private func tick() {
        guard !closed else { return }
        guard request.expiresAt > Date() else { expire(); return }
        if !NSApp.isActive { continuation.cancel(); countdown = nil }
        if let _ = countdown {
            countdown = continuation.remainingSeconds()
            if continuation.claim(), let next = request.nextEpisode {
                countdown = nil
                onNext(next)
            }
        }
        if playing, countdown == nil, interactionCount == 0, Date().timeIntervalSince(lastActivity) >= 2 {
            controlsVisible = false
        }
        guard !snapshotPending, error == nil, recoveryTask == nil else { return }
        snapshotPending = true
        let expected = generation
        session.snapshot { [weak self] snapshot in
            Task { @MainActor in
                guard let self else { return }
                guard !self.closed, self.generation == expected else { return }
                self.snapshotPending = false
                self.apply(snapshot)
            }
        }
    }

    private func apply(_ snapshot: VLCPlaybackSnapshot) {
        if !snapshot.resumePending, engineFirstFrame || snapshot.hasFrame || position == 0,
           snapshot.seconds.isFinite, snapshot.seconds >= 0,
           snapshot.seconds > 0 || position == 0 || (snapshot.state != .error && snapshot.state != .stopped) {
            position = snapshot.seconds
        }
        if snapshot.duration.isFinite, snapshot.duration > 0 { duration = snapshot.duration }
        seekable = !isLive && snapshot.seekable
        refreshTracks(snapshot)
        if snapshot.hasFrame, !engineFirstFrame {
            measurement?.firstFrame(now:ProcessInfo.processInfo.systemUptime*1000)
            engineFirstFrame = true; hasPresentedVideo = true
            trackRestoreUntil = Date().addingTimeInterval(4)
            watchdog.firstFrame()
            opening = false
            session.setAspect(aspect == "Otomatik" ? nil : aspect)
        }
        switch snapshot.state {
        case .playing:
            if !playing { session.setVolume(volume); session.setMuted(muted); session.setRate(rate) }
            playing = true; opening = !hasPresentedVideo; ended = false
        case .paused:
            playing = false; opening = false; controlsVisible = true
        case .ended:
            if isLive { recover(.ended); return }
            playing = false; opening = false; ended = true; controlsVisible = true
            if !reportedEnd {
                measurement?.end(now:ProcessInfo.processInfo.systemUptime*1000,reason:"completed",complete:true)
                reportedEnd = true
                if !isLive { onWatched(); sendPosition() }
                if !NSApp.isActive { continuation.cancel() }
                if continuation.begin(item: request.item, next: request.nextEpisode, duration: duration) {
                    countdown = continuation.remainingSeconds()
                }
            }
        case .error:
            recover(.decoderError); return
        case .opening, .buffering:
            opening = !hasPresentedVideo
        default: break
        }
        measurement?.sample(now:ProcessInfo.processInfo.systemUptime*1000,position:position,duration:isLive ? 0:duration,playing:snapshot.state == .playing,buffering:snapshot.state == .buffering)
        let stalled = watchdog.stalled(position: snapshot.seconds.isFinite ? snapshot.seconds : position, wantsPlay: wantsPlay,
            ready: snapshot.state == .playing || snapshot.state == .paused,
            playing: playing, ended: ended, interacting: interactionCount > 0)
        if stalled { recover(engineFirstFrame ? .stall : .startupTimeout); return }
        if Date().timeIntervalSince(lastProgress) >= 10, !isLive, duration > 0 { sendPosition() }
    }

    private func recover(_ trigger: RecoveryTrigger) {
        guard !closed, error == nil, recoveryTask == nil, RecoveryPolicy.recovers(trigger, kind: request.item.kind) else { return }
        guard recoveryPolicy.claim(scope: request.scope, itemKey: request.item.key) else { failPlayback(); return }
        let expected = generation, key = request.item.key, scope = request.scope
        sendPosition()
        playing = false
        opening = !hasPresentedVideo
        session.reset()
        recoveryTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled {
                guard self.recoveryCurrent(expected, key: key, scope: scope) else { return }
                let resume = self.isLive ? 0 : self.position
                let fresh = await self.onRecovery?(self.request, resume)
                guard !Task.isCancelled, self.recoveryCurrent(expected, key: key, scope: scope) else { return }
                if let fresh {
                    guard fresh.item.key == key, fresh.scope == scope, fresh.item.scope == scope,
                          self.recoveryPolicy.admit(scope: fresh.scope, itemKey: fresh.item.key, expiresAt: fresh.expiresAt) else {
                        self.failPlayback(); return
                    }
                    let playback = PlaybackRequest(item: fresh.item, url: fresh.url, expiresAt: fresh.expiresAt,
                        resumeSeconds: self.isLive ? 0 : self.position, nextEpisode: fresh.nextEpisode, scope: fresh.scope, analyticsContext: self.request.analyticsContext)
                    self.recoveryTask = nil
                    self.prepare(playback, recovery: true)
                    return
                }
                guard self.recoveryPolicy.claim(scope: scope, itemKey: key) else { self.failPlayback(); return }
                do { try await Task.sleep(nanoseconds: 1_500_000_000) }
                catch { return }
            }
        }
    }

    private func recoveryCurrent(_ expected: UUID, key: String, scope: String) -> Bool {
        !closed && generation == expected && request.item.key == key && request.scope == scope
            && request.expiresAt > Date() && recoveryPolicy.allows(scope: scope, itemKey: key)
    }

    private func refreshTracks(_ snapshot: VLCPlaybackSnapshot) {
        if !snapshot.audio.isEmpty || !restoreAudio { audioTracks = snapshot.audio }
        if !snapshot.subtitles.isEmpty || !restoreSubtitle { subtitleTracks = snapshot.subtitles }
        if restoreAudio, let preferredAudio {
            if let id = preferredAudio.match(snapshot.audio) {
                audioID = id
                if snapshot.audioID == id { restoreAudio = false } else { session.setAudio(id) }
            } else if Date() >= trackRestoreUntil { restoreAudio = false; audioID = snapshot.audioID }
        } else { audioID = snapshot.audioID }
        if restoreSubtitle, let preferredSubtitle {
            if let id = preferredSubtitle.match(snapshot.subtitles) {
                subtitleID = id
                if snapshot.subtitleID == id { restoreSubtitle = false } else { session.setSubtitle(id) }
            } else if Date() >= trackRestoreUntil { restoreSubtitle = false; subtitleID = snapshot.subtitleID }
        } else { subtitleID = snapshot.subtitleID }
    }

    private enum TrackPreference {
        case disabled, named(String)
        init?(id: Int32, tracks: [PlayerTrack]) {
            if id < 0 { self = .disabled }
            else if let track = tracks.first(where: { $0.id == id }) { self = .named(track.title) }
            else { return nil }
        }
        func match(_ tracks: [PlayerTrack]) -> Int32? {
            switch self {
            case .disabled: return tracks.first(where: { $0.id < 0 })?.id
            case .named(let title):
                return tracks.first(where: { $0.id >= 0 && $0.title.compare(title, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame })?.id
            }
        }
    }

    private func failPlayback() {
        FlixifyAnalytics.shared.event("playback_error",["reason":"decoder"])
        measurement?.end(now:ProcessInfo.processInfo.systemUptime*1000,reason:"decoder",complete:false)
        recoveryTask?.cancel(); recoveryTask = nil
        recoveryPolicy.stop()
        playing = false; opening = false; controlsVisible = true
        error = "Yayın açılamadı. Bağlantını kontrol edip tekrar deneyebilirsin."
        session.reset()
    }

    private func sendPosition() {
        guard !isLive, position.isFinite, duration.isFinite, duration > 0 else { return }
        lastProgress = Date()
        onPosition(position, duration)
    }

    private func expire() {
        guard error != "İzleme süren sona erdi. Paketini hesabından kontrol edebilirsin." else { return }
        FlixifyAnalytics.shared.event("playback_error",["reason":"access"])
        measurement?.end(now:ProcessInfo.processInfo.systemUptime*1000,reason:"access",complete:false)
        generation = UUID()
        recoveryPolicy.stop()
        recoveryTask?.cancel(); recoveryTask = nil
        continuation.cancel(); countdown = nil; playing = false; opening = false; controlsVisible = true
        error = "İzleme süren sona erdi. Paketini hesabından kontrol edebilirsin."
        session.reset()
    }

    deinit {
        recoveryTask?.cancel()
        timer?.invalidate()
        observers.forEach(NotificationCenter.default.removeObserver)
        session.stop()
    }
}
