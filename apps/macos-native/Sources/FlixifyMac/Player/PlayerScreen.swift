import AppKit
import FlixifyCore
import SwiftUI

@MainActor
struct PlayerScreen: View {
    let playback: PlaybackRequest
    let isFavorite: Bool
    let episodes: [CatalogItem]
    let liveChannels: [CatalogItem]
    let programmes: [Programme]
    let playbackRevision: UUID?
    let onRecovery: ((PlaybackRequest, Double) async -> PlaybackRequest?)?
    let onFavorite: () -> Void
    let onClose: () -> Void
    let onSelect: (CatalogItem) -> Void
    let onPosition: (Double, Double) -> Void
    let onWatched: () -> Void
    @StateObject private var controller: PlaybackController
    @StateObject private var keyboard = PlayerKeyboardMonitor()
    @State private var audioPanel = false
    @State private var subtitlesPanel = false
    @State private var episodesPanel = false
    @State private var settingsPanel = false
    @State private var guidePanel = false
    @State private var scrubbing = false
    @State private var seekDraft: Double = 0

    init(playback: PlaybackRequest, isFavorite: Bool, episodes: [CatalogItem], liveChannels: [CatalogItem],
         programmes: [Programme] = [], playbackRevision: UUID? = nil,
         onRecovery: ((PlaybackRequest, Double) async -> PlaybackRequest?)? = nil,
         onFavorite: @escaping () -> Void, onClose: @escaping () -> Void,
         onSelect: @escaping (CatalogItem) -> Void, onPosition: @escaping (Double, Double) -> Void,
         onWatched: @escaping () -> Void) {
        self.playback = playback; self.isFavorite = isFavorite; self.episodes = episodes
        self.liveChannels = liveChannels; self.programmes = programmes; self.playbackRevision = playbackRevision
        self.onRecovery = onRecovery
        self.onFavorite = onFavorite; self.onClose = onClose; self.onSelect = onSelect
        self.onPosition = onPosition; self.onWatched = onWatched
        _controller = StateObject(wrappedValue: PlaybackController(playback: playback))
    }

    private var isLive: Bool { playback.item.kind == .live }
    private var panelOpen: Bool { audioPanel || subtitlesPanel || episodesPanel || settingsPanel || guidePanel }
    private var currentProgramme: Programme? { programmes.first { $0.startsAt <= Date() && $0.endsAt > Date() } }

    var body: some View {
        ZStack {
            Color.black
            VideoSurface(controller: controller)
                .accessibilityLabel(playback.item.title)
                .accessibilityAction(named: Text(controller.playing ? "Duraklat" : "Oynat")) { controller.togglePlayback() }

            if controller.opening, controller.error == nil {
                ProgressView().controlSize(.large).tint(.white)
                    .accessibilityLabel("Yayın açılıyor")
            }

            if let error = controller.error { errorView(error) }

            if controller.controlsVisible || panelOpen || controller.countdown != nil {
                controls.transition(.opacity)
            }

            if let seconds = controller.countdown { continuationCard(seconds) }
        }
        .background(.black)
        .preferredColorScheme(.dark)
        .foregroundStyle(.white)
        .clipped()
        .onAppear {
            controller.onPosition = onPosition
            controller.onWatched = onWatched
            controller.onNext = onSelect
            controller.onRecovery = onRecovery
            controller.start()
            keyboard.install(controller: controller, handler: handleKey)
        }
        .onDisappear { keyboard.remove(); controller.close() }
        .onChange(of: playback.expiresAt) { controller.updateDeadline($0) }
        .onChange(of: playbackRevision) { _ in controller.load(playback) }
        .onChange(of: panelOpen) { open in if open { controller.beginInteraction() } else { controller.endInteraction() } }
        .onChange(of: controller.controlsVisible) { visible in
            if !visible, NSApp.keyWindow === controller.window { NSCursor.setHiddenUntilMouseMoves(true) }
        }
    }

    private var controls: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 16) {
                playerIcon("xmark", label: "Oynatıcıyı kapat", action: leave)
                Spacer()
                if isLive {
                    HStack(spacing: 7) {
                        Circle().fill(Color(red: 1, green: 53/255, blue: 69/255)).frame(width: 7, height: 7)
                        Text("CANLI").font(.system(size: 11, weight: .bold))
                    }
                    .padding(.horizontal, 11).padding(.vertical, 7)
                    .background(.black.opacity(0.45), in: Capsule())
                }
            }
            .padding(24)
            .background(LinearGradient(colors: [.black.opacity(0.65), .clear], startPoint: .top, endPoint: .bottom))

            Spacer(minLength: 0)

            VStack(alignment: .leading, spacing: 17) {
                if !isLive { seekTimeline }
                HStack(alignment: .center, spacing: 20) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(playback.item.title).font(.system(size: 23, weight: .semibold)).lineLimit(2)
                        if isLive {
                            Text(currentProgramme?.title ?? "Canlı yayın").font(.system(size: 13)).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                        } else if playback.item.kind == .episode {
                            Text("\(playback.item.season). Sezon · \(playback.item.episode). Bölüm").font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
                        }
                    }
                    Spacer(minLength: 0)
                    tools
                }
            }
            .padding(.horizontal, 28).padding(.bottom, 24).padding(.top, 35)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [.clear, .black.opacity(0.88)], startPoint: .top, endPoint: .bottom))
            .onHover(perform: controller.toolsHover)
        }
        .animation(.easeOut(duration: 0.18), value: controller.controlsVisible)
    }

    private var seekTimeline: some View {
        HStack(spacing: 13) {
            Text(time(scrubbing ? seekDraft : controller.position)).font(.system(size: 12).monospacedDigit())
            Slider(value: Binding(get: { scrubbing ? seekDraft : min(controller.position, max(1, controller.duration)) }, set: { seekDraft = $0 }),
                   in: 0...max(1, controller.duration), onEditingChanged: { editing in
                scrubbing = editing
                if editing { seekDraft = controller.position; controller.beginInteraction() }
                else { controller.seek(to: seekDraft); controller.endInteraction() }
            })
            .tint(.white)
            .disabled(!controller.seekable || controller.duration <= 0)
            .accessibilityLabel("Oynatma konumu")
            Text(time(controller.duration)).font(.system(size: 12).monospacedDigit()).foregroundStyle(.white.opacity(0.6))
        }
    }

    private var tools: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { primaryTools; volumeControl; secondaryTools }
            HStack(spacing: 5) { primaryTools; secondaryTools }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var primaryTools: some View {
        if isLive {
            playerIcon(controller.playing ? "pause.fill" : "play.fill", label: controller.playing ? "Duraklat" : "Oynat", action: controller.togglePlayback)
            playerIcon("chevron.left", label: "Önceki kanal") { switchChannel(-1) }
            playerIcon("chevron.right", label: "Sonraki kanal") { switchChannel(1) }
        }
        playerIcon(isFavorite ? "heart.fill" : "heart", label: isFavorite ? "Favorilerden çıkar" : "Favorilere ekle") { controller.activity(); onFavorite() }
        .foregroundStyle(isFavorite ? Color(red: 1, green: 53/255, blue: 69/255) : .white)
        if let _ = playback.nextEpisode {
            playerIcon("forward.end.fill", label: "Sonraki bölüm", action: controller.chooseNext)
        }
    }

    private var volumeControl: some View {
        HStack(spacing: 4) {
            playerIcon(controller.muted || controller.volume == 0 ? "speaker.slash.fill" : "speaker.wave.2.fill", label: controller.muted ? "Sesi aç" : "Sesi kapat") { controller.setMuted(!controller.muted) }
            Slider(value: Binding(get: { controller.volume }, set: { controller.setVolume($0) }), in: 0...100, onEditingChanged: { editing in
                if editing { controller.beginInteraction() } else { controller.endInteraction() }
            })
            .frame(width: 65).tint(.white).accessibilityLabel("Ses seviyesi")
        }
    }

    private var secondaryTools: some View {
        HStack(spacing: 8) {
            playerIcon("waveform", label: "Ses parçaları") { audioPanel = true }
                .popover(isPresented: $audioPanel, arrowEdge: .top) {
                    trackPanel("Ses", tracks: controller.audioTracks, selected: controller.audioID) { controller.selectAudio($0); audioPanel = false }
                }
            playerIcon("captions.bubble", label: "Altyazılar") { subtitlesPanel = true }
                .popover(isPresented: $subtitlesPanel, arrowEdge: .top) {
                    trackPanel("Altyazı", tracks: controller.subtitleTracks, selected: controller.subtitleID) { controller.selectSubtitle($0); subtitlesPanel = false }
                }
            if !episodes.isEmpty {
                playerIcon("rectangle.stack", label: "Sezonlar ve bölümler") { episodesPanel = true }
                    .popover(isPresented: $episodesPanel, arrowEdge: .top) { episodeList }
            }
            if isLive {
                playerIcon("calendar", label: "Yayın akışı") { guidePanel = true }
                    .popover(isPresented: $guidePanel, arrowEdge: .top) { programmeList }
            }
            playerIcon("slider.horizontal.3", label: "Oynatıcı ayarları") { settingsPanel = true }
                .popover(isPresented: $settingsPanel, arrowEdge: .top) { settings }
            playerIcon("arrow.up.left.and.arrow.down.right", label: "Tam ekran", action: controller.toggleFullscreen)
        }
    }

    private var episodeList: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Bölümler").font(.title3.bold())
            ScrollView {
                LazyVStack(spacing: 4) {
                    ForEach(episodes, id: \.key) { item in
                        Button {
                            episodesPanel = false; controller.cancelContinuation(); onSelect(item)
                        } label: {
                            HStack(spacing: 12) {
                                Text("\(item.season)·\(item.episode)").monospacedDigit().foregroundStyle(.secondary).frame(width: 40)
                                Text(item.title).lineLimit(2).frame(maxWidth: .infinity, alignment: .leading)
                                if item.key == playback.item.key { Image(systemName: "waveform").foregroundStyle(.red) }
                            }
                            .padding(11).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
            }
        }.padding(20).frame(width: 370, height: 370)
    }

    private var programmeList: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Yayın akışı").font(.title3.bold())
            if programmes.isEmpty {
                Text("Bu kanal için yayın bilgisi bulunamadı.").foregroundStyle(.secondary).padding(.vertical, 20)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(programmes) { programme in
                            HStack(alignment: .top, spacing: 14) {
                                Text(programme.startsAt, style: .time).font(.system(size: 12).monospacedDigit()).foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(programme.title).font(.system(size: 13, weight: .medium))
                                    if programme.id == currentProgramme?.id { Text("Şimdi yayında").font(.caption).foregroundStyle(.red) }
                                }
                            }
                        }
                    }
                }
            }
        }.padding(20).frame(width: 370, height: programmes.isEmpty ? 150 : 370)
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Oynatıcı").font(.title3.bold())
            if !isLive {
                VStack(alignment: .leading, spacing: 9) {
                    Text("Oynatma hızı").foregroundStyle(.secondary)
                    HStack(spacing: 5) {
                        ForEach([0.5, 0.75, 1, 1.25, 1.5, 2], id: \.self) { value in
                            Button("\(value.formatted())×") { controller.setRate(value) }
                                .buttonStyle(.bordered).tint(controller.rate == value ? .white : .gray)
                        }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 9) {
                Text("Görüntü oranı").foregroundStyle(.secondary)
                HStack {
                    ForEach(["Otomatik", "16:9", "4:3"], id: \.self) { value in
                        Button(value) { controller.setAspect(value) }
                            .buttonStyle(.bordered).tint(controller.aspect == value ? .white : .gray)
                    }
                }
            }
            if isLive {
                HStack(spacing: 12) {
                    Text("Ses").foregroundStyle(.secondary)
                    Slider(value: Binding(get: { controller.volume }, set: { controller.setVolume($0) }), in: 0...100).accessibilityLabel("Ses seviyesi")
                }
            }
            Text("Boşluk: duraklat / oynat\n← →: 10 saniye sar · Esc: geri").font(.caption).foregroundStyle(.secondary)
        }.padding(22).frame(width: 350)
    }

    private func trackPanel(_ title: String, tracks: [PlayerTrack], selected: Int32, action: @escaping (Int32) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.title3.bold())
            if tracks.isEmpty { Text("Kullanılabilir parça bulunamadı.").foregroundStyle(.secondary).padding(.vertical, 12) }
            else {
                ScrollView {
                    VStack(spacing: 4) {
                        ForEach(tracks) { track in
                            Button { action(track.id) } label: {
                                HStack {
                                    Text(track.title).frame(maxWidth: .infinity, alignment: .leading)
                                    if selected == track.id { Image(systemName: "checkmark") }
                                }.padding(10).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                        }
                    }
                }.frame(maxHeight: 260)
            }
        }.padding(20).frame(width: 300)
    }

    private func continuationCard(_ seconds: Int) -> some View {
        VStack {
            Spacer()
            HStack {
                Spacer()
                VStack(alignment: .leading, spacing: 12) {
                    Text("Sonraki bölüm \(seconds) saniye içinde").font(.system(size: 13)).foregroundStyle(.white.opacity(0.7))
                    Text(playback.nextEpisode?.title ?? "Sonraki bölüm").font(.headline).lineLimit(2)
                    HStack(spacing: 10) {
                        Button("Şimdi izle", action: controller.chooseNext).buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
                        Button("İptal", action: controller.cancelContinuation).buttonStyle(.bordered)
                    }
                }
                .padding(22).frame(width: 320, alignment: .leading)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .overlay(RoundedRectangle(cornerRadius: 18).stroke(.white.opacity(0.16)))
                .padding(.trailing, 28).padding(.bottom, 150)
            }
        }
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: 17) {
            Image(systemName: "play.slash").font(.system(size: 34)).foregroundStyle(.white.opacity(0.6))
            Text(error).multilineTextAlignment(.center).frame(maxWidth: 410)
            HStack(spacing: 12) {
                Button("Geri dön", action: leave).buttonStyle(.bordered)
                Button("Tekrar dene") { onSelect(playback.item) }.buttonStyle(.borderedProminent).tint(.white).foregroundStyle(.black)
            }
        }.padding(30)
    }

    private func playerIcon(_ icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 17, weight: .medium))
                .frame(width: 36, height: 36).contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(PlayerToolStyle()).help(label).accessibilityLabel(label)
    }

    private func leave() { controller.close(); onClose() }

    private func switchChannel(_ offset: Int) {
        guard isLive, !liveChannels.isEmpty,
              let index = liveChannels.firstIndex(where: { $0.key == playback.item.key }) else { return }
        let next = (index + offset + liveChannels.count) % liveChannels.count
        guard next != index else { return }
        controller.cancelContinuation(); onSelect(liveChannels[next])
    }

    private func handleKey(_ event: NSEvent) -> Bool {
        let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if modifiers.contains(.command), modifiers.contains(.control), event.charactersIgnoringModifiers?.lowercased() == "f" {
            controller.toggleFullscreen(); return true
        }
        guard !modifiers.contains(.command), !modifiers.contains(.control), !modifiers.contains(.option) else { return false }
        switch event.keyCode {
        case 49: controller.togglePlayback(); return true
        case 123: if !isLive { controller.seek(by: -10) }; return true
        case 124: if !isLive { controller.seek(by: 10) }; return true
        case 125: if isLive { switchChannel(1) } else { controller.activity() }; return true
        case 126: if isLive { switchChannel(-1) } else { controller.activity() }; return true
        case 53:
            if panelOpen { audioPanel = false; subtitlesPanel = false; episodesPanel = false; settingsPanel = false; guidePanel = false }
            else if controller.countdown != nil { controller.cancelContinuation() }
            else if controller.playing, controller.controlsVisible { controller.hideControls() }
            else if controller.window?.styleMask.contains(.fullScreen) == true { controller.toggleFullscreen() }
            else { leave() }
            return true
        default: return false
        }
    }

    private func time(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds >= 0 else { return "0:00" }
        let value = Int(seconds)
        if value >= 3600 { return String(format: "%d:%02d:%02d", value / 3600, (value / 60) % 60, value % 60) }
        return String(format: "%d:%02d", value / 60, value % 60)
    }
}

private struct PlayerToolStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(.white.opacity(configuration.isPressed ? 0.22 : 0.07), in: RoundedRectangle(cornerRadius: 10))
            .opacity(enabled ? 1 : 0.35)
    }
}
