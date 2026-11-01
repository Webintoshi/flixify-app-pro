import FlixifyCore
import SwiftUI

struct RootView: View {
    @EnvironmentObject var store: AppStore
    var body: some View {
        ZStack {
            FlixTheme.background.ignoresSafeArea()
            if store.initialLoading {
                VStack(spacing: 27) { BrandLogo(width: 240); ProgressView(); Text("Yükleniyor…").foregroundStyle(FlixTheme.muted) }
            } else if store.session == nil { LoginView() }
            else if store.showWelcome, let offer = store.session?.welcomeOffer { WelcomeView(offer: offer) }
            else {
                HStack(spacing: 0) {
                    sidebar
                    VStack(spacing: 0) {
                        topBar
                        if store.route == .account { AccountView() } else { DiscoveryView() }
                    }
                }
                .disabled(store.playback != nil || store.preparingPlayback)
                .accessibilityHidden(store.playback != nil || store.preparingPlayback)
            }
            if let request = store.playback {
                PlayerScreen(playback: request, isFavorite: store.isFavorite(request.item),
                    episodes: store.activeEpisodes, liveChannels: store.liveChannels,
                    programmes: store.programmes[request.item.key] ?? [], playbackRevision: store.playbackRevision,
                    onRecovery: { current, position in await store.recoverPlayback(current: current, position: position) },
                    onFavorite: { store.toggleFavorite(request.item) }, onClose: { store.closePlayback() },
                    onSelect: { store.open($0) },
                    onPosition: { seconds, duration in store.savePosition(request.item, seconds: seconds, duration: duration) },
                    onWatched: { store.markWatched(request.item) })
                    .id(request.scope + request.item.key)
                    .zIndex(2)
                    .onAppear { PosterSound.shared.stop() }
            }
            if store.preparingPlayback {
                Color.black.opacity(0.5).ignoresSafeArea()
                VStack(spacing: 13) { ProgressView(); Text("Açılıyor…").font(.system(size: 14)) }
                    .padding(28).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 17)).zIndex(3)
            }
        }
        .foregroundStyle(FlixTheme.text).tint(FlixTheme.accent)
        .task { await store.start() }
        .sheet(isPresented: $store.showSearch) { SearchSheet() }
        .sheet(item: $store.filmDetails) { FilmDetailsView(item: $0) }
        .sheet(isPresented: Binding(get: { store.details != nil }, set: { if !$0 { store.details = nil } })) {
            if let detail = store.details { SeriesDetailsView(detail: detail) }
        }
        .alert("Flixify Pro", isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })) {
            Button("Tamam") { store.notice = nil }
        } message: { Text(store.notice ?? "") }
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 10) {
            BrandLogo(width: 159).padding(.leading, 10).padding(.bottom, 33)
            ForEach(AppRoute.allCases) { route in
                Button { store.navigate(route) } label: {
                    HStack(spacing: 14) {
                        Image(systemName: route.icon).font(.system(size: 19, weight: .regular)).frame(width: 26)
                        Text(route.title).font(.system(size: 15, weight: store.route == route ? .semibold : .regular))
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 17).frame(height: 50).contentShape(Capsule())
                        .foregroundStyle(store.route == route ? FlixTheme.text : FlixTheme.muted)
                        .background(store.route == route ? FlixTheme.text.opacity(0.09) : .clear, in: Capsule())
                        .overlay(Capsule().stroke(store.route == route ? FlixTheme.text.opacity(0.55) : .clear, lineWidth: 1))
                }.buttonStyle(.plain).accessibilityAddTraits(store.route == route ? .isSelected : [])
            }
            Spacer()
            if store.fixtureMode { Text("TEST GÖRÜNÜMÜ").font(.system(size: 10, weight: .semibold)).foregroundStyle(FlixTheme.muted).padding(.leading, 17) }
        }.padding(.horizontal, 17).padding(.top, 50).padding(.bottom, 25).frame(width: 220)
            .overlay(alignment: .trailing) { Rectangle().fill(FlixTheme.text.opacity(0.08)).frame(width: 1) }
    }
    private var topBar: some View {
        HStack {
            if let account = store.account {
                Text(account.trial ? "Deneme hesabı" : "Flixify Pro").font(.system(size: 12, weight: .medium)).foregroundStyle(FlixTheme.muted)
            }
            Spacer()
            Button { store.showSearch = true } label: { Label("Ara", systemImage: "magnifyingglass").font(.system(size: 14)).padding(.horizontal, 16).padding(.vertical, 9).background(FlixTheme.panel, in: Capsule()) }
                .buttonStyle(.plain).help("Film, dizi veya kanal ara (⌘F)")
        }.padding(.horizontal, 30).padding(.top, 22).padding(.bottom, 5)
    }
}

struct AppSettingsView: View {
    @AppStorage("posterSoundEnabled") private var sound = true
    var body: some View {
        Form {
            Toggle("Afiş geçişlerinde ses çal", isOn: $sound)
            Text("Oynatıcı: Boşluk ile duraklat/başlat, sağ/sol ile 10 saniye sar, Esc ile geri dön.").font(.system(size: 12)).foregroundStyle(.secondary)
            Divider()
            Text("Flixify Pro 1.0.0 · macOS 13 ve üzeri").font(.system(size: 12))
            Text("VideoLAN VLCKit 3.7.3 kullanır (LGPL 2.1 veya üzeri).").font(.system(size: 12)).foregroundStyle(.secondary)
            Button("Üçüncü taraf lisansları") {
                if let url = Bundle.main.url(forResource: "COPYING-VLCKit", withExtension: "txt") { NSWorkspace.shared.open(url) }
            }
        }.padding(25).frame(width: 480)
    }
}
