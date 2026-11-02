import AppKit
import Combine
import FlixifyCore
import Foundation

enum AppRoute: String, CaseIterable, Identifiable {
    case home, live, movies, series, favorites, account
    var id: String { rawValue }
    var title: String {
        switch self { case .home: return "Ana Sayfa"; case .live: return "Canlı TV"; case .movies: return "Filmler"; case .series: return "Diziler"; case .favorites: return "Favoriler"; case .account: return "Hesabım" }
    }
    var icon: String {
        switch self { case .home: return "house"; case .live: return "tv"; case .movies: return "film"; case .series: return "play.rectangle.on.rectangle"; case .favorites: return "heart"; case .account: return "person.crop.circle" }
    }
    var kind: MediaKind? {
        switch self { case .live: return .live; case .movies: return .movie; case .series: return .series; default: return nil }
    }
}

@MainActor final class AppStore: ObservableObject {
    @Published var route: AppRoute = .home
    @Published var session: SessionState?
    @Published var catalogs: [MediaKind: Catalog] = [:]
    @Published var catalogRevision = UUID()
    @Published var library = PersonalLibrary()
    @Published var initialLoading = true
    @Published var signingIn = false
    @Published var loadingKinds = Set<MediaKind>()
    @Published var error: String?
    @Published var searchText = ""
    @Published var category = "" { didSet { if category != oldValue, session != nil, !fixtureMode { var values:[String:Any]=["category_id":FlixifyAnalytics.opaque(category)];if let selected=catalogs.values.flatMap(\.categories).first(where:{$0.id==category}),let label=AnalyticsPolicy.catalogLabel(selected.title,maximum:80) {values["category_name"]=label};FlixifyAnalytics.shared.event("category_select",values) } } }
    @Published var country = ""
    @Published var showSearch = false
    @Published var showWelcome = false
    @Published var preparingPlayback = false
    @Published var playback: PlaybackRequest?
    @Published var playbackRevision = UUID()
    @Published var details: SeriesDetail?
    @Published var filmDetails: CatalogItem?
    @Published var programmes: [String: [Programme]] = [:]
    @Published var activeEpisodes: [CatalogItem] = []
    @Published var favoriteWrites = Set<String>()
    @Published var notice: String?

    let repository: any FlixifyRepositoryProtocol
    let fixtureMode: Bool
    private var generation = UUID()
    private var selection = UUID()
    private var inspection = UUID()
    private var refreshTask: Task<Void, Never>?
    private var loadTask: Task<Void, Never>?
    private var seriesDetails: [String: SeriesDetail] = [:]
    private var loadedScope: String?
    private var pendingAnalytics: (item:CatalogItem,context:PlaybackAnalyticsContext)?

    init(repository: any FlixifyRepositoryProtocol, fixtureMode: Bool = false) {
        self.repository = repository; self.fixtureMode = fixtureMode
    }

    var account: Account? { session?.account }
    var currentItems: [CatalogItem] {
        if route == .favorites { return library.favorites }
        if let kind = route.kind { return catalogs[kind]?.items ?? [] }
        return [MediaKind.movie, .series, .live].flatMap { catalogs[$0]?.items ?? [] }
    }
    var liveChannels: [CatalogItem] { catalogs[.live]?.items ?? [] }
    var favoriteKeys: Set<String> { Set(library.favorites.map(\.key)) }
    func isFavorite(_ item: CatalogItem) -> Bool {
        if item.kind == .episode { return library.favorites.contains { $0.kind == .series && $0.id == item.seriesID && $0.scope == item.scope } }
        return favoriteKeys.contains(item.key)
    }

    @discardableResult private func applySession(_ value: SessionState) -> Bool {
        let changed = loadedScope.map { $0 != value.sourceScope } ?? false
        if changed {
            finishPreparingAnalytics(reason:"closed",failed:false)
            generation = UUID(); selection = UUID(); inspection = UUID(); loadTask?.cancel()
            playback = nil; preparingPlayback = false; details = nil; filmDetails = nil
            catalogs = [:]; library = PersonalLibrary(); programmes = [:]; activeEpisodes = []; seriesDetails = [:]
            favoriteWrites = []; loadingKinds = []; searchText = ""; category = ""; country = ""; showSearch = false; catalogRevision = UUID()
        }
        loadedScope = value.sourceScope; session = value
        if !value.account.canPlay { route = .account }
        return changed
    }

    func start() async {
        guard initialLoading else { return }
        let lease = generation
        do {
            let restored = try await repository.restore()
            guard lease == generation else { return }
            if let restored { applySession(restored) } else { session = nil }
            showWelcome = restored?.welcomeOffer?.showPrompt == true
            if restored != nil { beginSessionWork() }
        } catch { if lease == generation { self.error = userMessage(error) } }
        if lease == generation, session == nil || account?.canPlay != true || showWelcome { initialLoading = false }
    }

    func login(code: String) async {
        guard !signingIn else { return }
        signingIn = true; error = nil
        let lease = generation, analyticsTicket = FlixifyAnalytics.shared.epoch
        do {
            let result = try await repository.login(code: code)
            guard lease == generation else { return }
            FlixifyAnalytics.shared.event("login",epoch:analyticsTicket)
            applySession(result); showWelcome = result.welcomeOffer?.showPrompt == true
            beginSessionWork()
        } catch { if lease == generation { self.error = userMessage(error) } }
        if lease == generation { signingIn = false }
    }

    func logout() async {
        finishPreparingAnalytics(reason:"closed",failed:false)
        FlixifyAnalytics.shared.event("logout")
        generation = UUID(); selection = UUID(); inspection = UUID(); loadTask?.cancel(); refreshTask?.cancel()
        playback = nil; preparingPlayback = false; details = nil; filmDetails = nil
        session = nil; loadedScope = nil; catalogs = [:]; library = PersonalLibrary(); programmes = [:]
        activeEpisodes = []; seriesDetails = [:]; favoriteWrites = []; searchText = ""; category = ""; country = ""; catalogRevision = UUID()
        showWelcome = false; showSearch = false; loadingKinds = []; notice = nil; signingIn = false; initialLoading = false; error = nil
        await repository.logout()
    }

    func navigate(_ value: AppRoute) {
        FlixifyAnalytics.shared.screen(value.rawValue)
        if playback != nil || preparingPlayback { closePlayback() }
        guard account?.canPlay == true || value == .account else { route = .account; return }
        route = value; inspection = UUID(); searchText = ""; category = ""; country = ""; error = nil
        if value == .favorites { Task { await refreshLibrary() } }
    }

    private func beginSessionWork() {
        loadTask?.cancel()
        if account?.canPlay == true {
            initialLoading = !showWelcome && catalogs.isEmpty
            loadTask = Task { await loadCatalogs(force: false) }
        } else { route = .account; initialLoading = false }
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 60_000_000_000)
                guard !Task.isCancelled, let self else { return }
                await self.refreshAccess()
            }
        }
    }

    func loadCatalogs(force: Bool) async {
        guard account?.canPlay == true else { return }
        let lease = generation, analyticsTicket = FlixifyAnalytics.shared.epoch
        loadingKinds.formUnion([.movie, .series, .live])
        await withTaskGroup(of: Void.self) { group in
            for kind in [MediaKind.movie, .series, .live] {
                group.addTask { [weak self] in
                    guard let self else { return }
                    do {
                        let catalog = try await self.repository.catalog(kind, force: force)
                        await MainActor.run {
                            guard self.generation == lease else { return }
                            self.catalogs[kind] = catalog; self.catalogRevision = UUID(); self.loadingKinds.remove(kind); self.initialLoading = false
                            if !self.fixtureMode { FlixifyAnalytics.shared.event("catalog_page_loaded",["result_count":catalog.items.count,"content_type":kind.rawValue],epoch:analyticsTicket) }
                        }
                    } catch {
                        await MainActor.run {
                            guard self.generation == lease else { return }
                            self.loadingKinds.remove(kind)
                            if self.loadingKinds.isEmpty { self.initialLoading = false }
                            if self.catalogs[kind] == nil { self.error = self.userMessage(error) }
                        }
                    }
                }
            }
            group.addTask { [weak self] in await self?.refreshLibrary(force: force) }
        }
    }

    func refreshLibrary(force: Bool = false) async {
        let lease = generation
        do {
            let value = try await repository.library(force: force)
            guard lease == generation else { return }; library = value; catalogRevision = UUID()
        } catch { if lease == generation && route == .favorites { self.error = userMessage(error) } }
    }

    func refreshAccess() async {
        let lease = generation
        do {
            let updated = try await repository.refreshSession()
            guard lease == generation else { return }
            let changed = applySession(updated)
            if changed {
                if updated.account.canPlay { loadTask = Task { await self.loadCatalogs(force: false) } }
                return
            }
            guard updated.account.canPlay, updated.account.expiresAt.map({ $0 > Date() }) ?? false else {
                if playback != nil { closePlayback(); notice = "İzleme süren sona erdi. Paketlerini Hesabım bölümünden görüntüleyebilirsin." }
                return
            }
            if let active = playback {
                let renewed = try await repository.playback(active.item)
                guard lease == generation, playback?.item.key == active.item.key else { return }
                guard renewed.scope == active.scope else { closePlayback(); return }
                playback = PlaybackRequest(item: active.item, url: active.url, expiresAt: renewed.expiresAt,
                    resumeSeconds: active.resumeSeconds, nextEpisode: active.nextEpisode, scope: active.scope, analyticsContext: active.analyticsContext)
            }
        } catch {
            guard lease == generation else { return }
            if error as? FlixifyError == .authentication { await logout(); self.error = userMessage(error) }
            else if error as? FlixifyError == .staleSource || error as? FlixifyError == .accessExpired { closePlayback() }
        }
    }

    func open(_ item: CatalogItem) {
        guard session != nil && !showWelcome else { return }
        finishPreparingAnalytics(reason:"replaced",failed:false)
        let analyticsContext=FlixifyAnalytics.shared.beginPlayback(item)
        if let analyticsContext { pendingAnalytics=(item,analyticsContext) }
        FlixifyAnalytics.shared.event("select_content",FlixifyAnalytics.item(item))
        let token = UUID(); selection = token; inspection = UUID(); let lease = generation
        preparingPlayback = true; error = nil; playback = nil
        Task {
            do {
                if item.kind == .series {
                    let value = try await repository.seriesDetail(item)
                    guard generation == lease, selection == token else { return }
                    seriesDetails[item.key] = value; activeEpisodes = value.episodes
                } else if item.kind == .episode, !item.seriesID.isEmpty {
                    activeEpisodes = seriesDetails.values.first(where: { $0.series.id == item.seriesID })?.episodes ?? []
                } else { activeEpisodes = [] }
                let request = try await repository.playback(item)
                guard generation == lease, selection == token else { return }
                pendingAnalytics=nil
                details = nil; filmDetails = nil; showSearch = false; playbackRevision = UUID()
                playback=PlaybackRequest(item:request.item,url:request.url,expiresAt:request.expiresAt,resumeSeconds:request.resumeSeconds,nextEpisode:request.nextEpisode,scope:request.scope,analyticsContext:analyticsContext)
                if request.item.kind == .live { Task { await self.fetchEPG(request.item) } }
            } catch {
                guard generation == lease, selection == token else { return }
                finishPreparingAnalytics(reason:error as? FlixifyError == .accessExpired || error as? FlixifyError == .authentication ? "access":"network",failed:true)
                if error as? FlixifyError == .accessExpired { route = .account; notice = userMessage(error) }
                else { self.error = userMessage(error) }
            }
            if generation == lease, selection == token { preparingPlayback = false }
        }
    }

    private func finishPreparingAnalytics(reason:String,failed:Bool) {
        guard let pending=pendingAnalytics else { return };pendingAnalytics=nil
        FlixifyAnalytics.shared.finishPreflight(pending.item,context:pending.context,reason:reason,failed:failed)
    }
    func closePlayback() { finishPreparingAnalytics(reason:"closed",failed:false);selection = UUID(); playback = nil; preparingPlayback = false }

    func recoverPlayback(current: PlaybackRequest, position: Double) async -> PlaybackRequest? {
        let lease = generation, token = selection
        guard let active = playback, active.scope == current.scope, active.item.key == current.item.key,
            current.expiresAt > Date() else { return nil }
        do {
            let fresh = try await repository.playback(current.item)
            guard generation == lease, selection == token, playback?.item.key == current.item.key else { return nil }
            guard fresh.scope == current.scope else { closePlayback(); return nil }
            let resumed = current.item.kind == .live ? 0 : max(0, position.isFinite ? position : 0)
            let recovered = PlaybackRequest(item: fresh.item, url: fresh.url, expiresAt: fresh.expiresAt,
                resumeSeconds: resumed, nextEpisode: fresh.nextEpisode, scope: fresh.scope, analyticsContext: current.analyticsContext)
            playback = recovered
            return recovered
        } catch {
            guard generation == lease, selection == token else { return nil }
            if error as? FlixifyError == .authentication { await logout() }
            else if error as? FlixifyError == .accessExpired || error as? FlixifyError == .staleSource { closePlayback() }
            return nil
        }
    }

    func inspect(_ item: CatalogItem) {
        guard session != nil else { return }
        let token = UUID(); inspection = token
        if item.kind == .live { Task { await fetchEPG(item) }; filmDetails = item; return }
        guard item.kind == .series else { filmDetails = item; return }
        let lease = generation
        Task {
            do {
                let value = try await repository.seriesDetail(item)
                guard lease == generation, inspection == token else { return }
                seriesDetails[item.key] = value; details = value
            } catch { if lease == generation { self.error = userMessage(error) } }
        }
    }

    func fetchEPG(_ item: CatalogItem) async {
        let lease = generation
        do { let values = try await repository.epg(item); if lease == generation { programmes[item.key] = values } }
        catch { if lease == generation { programmes[item.key] = [] } }
    }

    func toggleFavorite(_ item: CatalogItem) {
        guard session != nil else { return }
        let writeKey = item.kind == .episode ? "series:" + item.seriesID : item.key
        guard favoriteWrites.insert(writeKey).inserted else { return }
        let wanted = !isFavorite(item), lease = generation, analyticsTicket = FlixifyAnalytics.shared.epoch
        Task {
            defer { if lease == generation { favoriteWrites.remove(writeKey) } }
            do {
                let value = try await repository.setFavorite(item, favorited: wanted)
                guard lease == generation else { return }; library = value; catalogRevision = UUID()
                FlixifyAnalytics.shared.event(wanted ? "add_to_wishlist":"remove_from_wishlist",FlixifyAnalytics.item(item),epoch:analyticsTicket)
            } catch { if lease == generation { self.error = userMessage(error) } }
        }
    }

    func savePosition(_ item: CatalogItem, seconds: Double, duration: Double) {
        Task { await repository.saveProgress(item, seconds: seconds, duration: duration) }
    }
    func markWatched(_ item: CatalogItem) { Task { await repository.markWatched(item) } }

    func acknowledgeWelcome(monthly: Bool = false) async -> Bool {
        let lease = generation, accountID = account?.id, scope = loadedScope, analyticsTicket = FlixifyAnalytics.shared.epoch
        do {
            let updated = try await repository.chooseWelcome(monthly: monthly)
            guard lease == generation, accountID == updated.account.id, scope == updated.sourceScope else { return false }
            applySession(updated); showWelcome = false
            FlixifyAnalytics.shared.event(monthly ? "welcome_offer_select":"trial_select",monthly ? ["offer_id":"welcome-monthly-50-v1"]:[:],epoch:analyticsTicket)
            initialLoading = updated.account.canPlay && catalogs.isEmpty && !loadingKinds.isEmpty
            return true
        } catch { if lease == generation { self.error = userMessage(error) }; return false }
    }

    func openWebsite(_ path: String) {
        guard let url = URL(string: path), url.scheme == "https", url.host == "flixify.vip" else { return }
        var target=url
        if url.path == "/paketler", var parts=URLComponents(url:url,resolvingAgainstBaseURL:false) { var query=parts.queryItems ?? []; query.removeAll { $0.name == "from" }; query.append(URLQueryItem(name:"from",value:"macos")); parts.queryItems=query; target=parts.url ?? url }
        if NSWorkspace.shared.open(target),url.path == "/paketler" { FlixifyAnalytics.shared.event("package_open") }
    }

    func userMessage(_ error: Error) -> String {
        if let known = error as? FlixifyError { return known.localizedDescription }
        return "Bağlantı tamamlanamadı. Lütfen yeniden dene."
    }
}
