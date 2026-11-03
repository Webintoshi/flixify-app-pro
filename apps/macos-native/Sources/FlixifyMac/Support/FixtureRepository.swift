#if FIXTURE_QA
import FlixifyCore
import Foundation

actor FixtureRepository: FlixifyRepositoryProtocol {
    private let scope = "mac-native-fixture"
    private var favorites: [CatalogItem] = []
    private var watched = Set<String>()
    private var positions: [String: Double] = [:]
    private var acknowledged = false
    private var signedOut = false
    private var fixturePaired = false
    private var fixturePairingCancelled = false
    private var fixtureBootstrapFailed = false
    private let expiry = Date().addingTimeInterval(86_400)

    private func argument(_ name: String) -> String? {
        guard let index = CommandLine.arguments.firstIndex(of: name), CommandLine.arguments.indices.contains(index + 1) else { return nil }
        return CommandLine.arguments[index + 1]
    }
    private func art(_ name: String) -> String {
        guard !name.isEmpty else { return "" }
        guard let root = argument("--fixture-artwork") else { return "" }
        return URL(fileURLWithPath: root).appendingPathComponent(name + ".jpg").absoluteString
    }
    private func movie(_ id: String, _ title: String, _ group: String, _ image: String, _ year: Int) -> CatalogItem {
        CatalogItem(id: id, kind: .movie, title: title, categoryID: group, categoryName: group, artworkURL: art(image), extension: "mp4", scope: scope, description: "Android TV uygulamasının aynı ekran ve kontrol akışlarını doğrulayan çevrimdışı test kaydı.", releaseYear: year)
    }
    private func movies() -> [CatalogItem] {
        var items = [
            movie("100", "Fısıltı Adam", "Aksiyon", "movie-1", 2026),
            movie("103", "Telaşlı Baba", "Dram", "movie-0", 2026),
            movie("104", "Örümcek-Adam: Yepyeni Bir Gün", "Macera", "movie-2", 2026),
            movie("105", "Avengers: Endgame", "Marvel · Aksiyon", "", 2019),
            movie("106", "Harry Potter ve Felsefe Taşı", "Fantastik", "", 2001),
            movie("107", "Demir Adam", "Marvel · Aksiyon", "", 2008)
        ]
        for i in 0..<90 { items.append(movie("archive-\(i)", "Test arşivi \(i + 1)", i.isMultiple(of: 2) ? "Aksiyon" : "Fantastik", "movie-\(i % 3)", 2020)) }
        return items
    }
    private func shows() -> [CatalogItem] {
        [CatalogItem(id: "201", kind: .series, title: "Şebeke", categoryID: "Yerli", categoryName: "Yerli Diziler", artworkURL: art("series"), scope: scope, description: "Sezon ve bölüm seçimi için çevrimdışı test kaydı.", releaseYear: 2023),
         CatalogItem(id: "202", kind: .series, title: "The Boroughs", categoryID: "Fantastik", categoryName: "Fantastik Diziler", artworkURL: art("series-boroughs"), scope: scope, releaseYear: 2026),
         CatalogItem(id: "203", kind: .series, title: "Mahsun J", categoryID: "Komedi", categoryName: "Komedi Dizileri", artworkURL: art("series-mahsun"), scope: scope, releaseYear: 2026)]
    }
    private func channels() -> [CatalogItem] {
        ["TRT 1", "Kanal D", "ATV", "Show TV", "Star TV", "NOW", "TV8", "Kanal 7", "beIN Sports 1", "S Sport 1", "TLC", "TRT Haber"].enumerated().map { index, name in
            CatalogItem(id: "live-\(index)", kind: .live, title: name, categoryID: index < 8 ? "national" : "sports", categoryName: index < 8 ? "Ulusal kanallar" : "Spor", scope: scope)
        }
    }
    private func state() -> SessionState {
        let expired = CommandLine.arguments.contains("--fixture-expired")
        return SessionState(account: Account(id: "fixture-account", codeSuffix: "TEST", packageTitle: "Çevrimdışı doğrulama", expiresAt: expired ? Date().addingTimeInterval(-3600) : expiry, canPlay: !expired), welcomeOffer: WelcomeOffer(state: expired ? "not_eligible" : acknowledged ? "dismissed" : "pending", eligible: !expired, movies: movies().count, live: channels().count, series: shows().count), sourceScope: expired ? "" : scope)
    }
    func restore() async throws -> SessionState? {
        if CommandLine.arguments.contains("--fixture-login") || signedOut { return nil }
        if !CommandLine.arguments.contains("--fixture-welcome") { acknowledged = true }
        if favorites.isEmpty { favorites = [movies()[0], shows()[0], channels()[0]] }
        return state()
    }
    func login(code: String) async throws -> SessionState { guard code.count == 16 else { throw FlixifyError.invalidCode }; signedOut = false; return state() }
    func startDeviceLogin() async throws -> DeviceLoginPresentation {
        fixturePairingCancelled = false
        guard let path = argument("--fixture-qr-png"), let png = try? Data(contentsOf: URL(fileURLWithPath: path)), png.count <= 256 * 1024 else { throw FlixifyError.network }
        return try DeviceLoginPresentation(["userCode": "BCDF-GHJK", "verificationUri": "https://flixify.vip/cihaz", "verificationUriComplete": "https://flixify.vip/cihaz?code=BCDF-GHJK", "qrPngBase64": png.base64EncodedString(), "expiresAt": "2026-12-01T00:00:00.000Z", "expiresInSeconds": 180, "intervalSeconds": 2])
    }
    func pollDeviceLogin() async throws -> DeviceLoginStatus {
        guard !fixturePairingCancelled else { throw FlixifyError.staleSource }
        let mode = argument("--fixture-pairing") ?? "pending"
        if mode == "save-failure" { throw FlixifyError.keychain }
        let status = DeviceLoginStatus(rawValue: mode) ?? .pending
        if status == .authorized { fixturePaired = true; signedOut = false }
        return status
    }
    func hasDeviceLoginSession() async -> Bool { fixturePaired }
    func deviceLoginInterval() async -> Int { 2 }
    func cancelDeviceLogin() async { if !fixturePaired { fixturePairingCancelled = true } }
    func acknowledgeDeviceLogin() async {}
    func refreshSession() async throws -> SessionState {
        if fixturePaired, CommandLine.arguments.contains("--fixture-pairing-auth-failure") {
            fixturePaired = false; signedOut = true; throw FlixifyError.authentication
        }
        if fixturePaired, CommandLine.arguments.contains("--fixture-pairing-bootstrap-failure"), !fixtureBootstrapFailed {
            fixtureBootstrapFailed = true; throw FlixifyError.network
        }
        return state()
    }
    func logout() async { fixturePaired = false; fixturePairingCancelled = true; signedOut = true; favorites = []; positions = [:]; watched = [] }
    func catalog(_ kind: MediaKind, force: Bool) async throws -> Catalog {
        let values = kind == .movie ? movies() : kind == .series ? shows() : channels()
        return Catalog(kind: kind, items: values)
    }
    func seriesDetail(_ item: CatalogItem) async throws -> SeriesDetail {
        SeriesDetail(series: item, seasons: (1...2).map { season in
            Season(number: season, episodes: (1...3).map { number in
                CatalogItem(id: "\(item.id)-\(season)-\(number)", kind: .episode, title: "\(item.title) · \(number). Bölüm", artworkURL: item.artworkURL, extension: "mp4", scope: scope, seriesID: item.id, season: season, episode: number)
            })
        })
    }
    func epg(_ item: CatalogItem) async throws -> [Programme] {
        let start = Date().addingTimeInterval(-900)
        var values: [Programme] = []
        for index in 0..<5 {
            let begins = start.addingTimeInterval(Double(index) * 3600)
            let ends = begins.addingTimeInterval(3600)
            let title = index == 0 ? "Test yayını" : "Yayın akışı \(index + 1)"
            values.append(Programme(title: title, startsAt: begins, endsAt: ends))
        }
        return values
    }
    func library(force: Bool) async throws -> PersonalLibrary { PersonalLibrary(favorites: favorites, watchedEpisodeKeys: watched) }
    func setFavorite(_ item: CatalogItem, favorited: Bool) async throws -> PersonalLibrary {
        var target = item
        if item.kind == .episode, let series = shows().first(where: { $0.id == item.seriesID }) { target = series }
        favorites.removeAll { $0.key == target.key }
        if favorited { favorites.append(target) }
        return try await library(force: false)
    }
    func markWatched(_ item: CatalogItem) async { watched.insert(item.key) }
    func playback(_ item: CatalogItem) async throws -> PlaybackRequest {
        guard state().account.canPlay else { throw FlixifyError.accessExpired }
        guard let path = argument("--fixture-media") else { throw FlixifyError.invalidData }
        var target = item, next: CatalogItem?
        if item.kind == .series {
            let detail = try await seriesDetail(item)
            target = detail.episodes.first(where: { !watched.contains($0.key) }) ?? detail.episodes[0]
            if let index = detail.episodes.firstIndex(where: { $0.key == target.key }), detail.episodes.indices.contains(index + 1) { next = detail.episodes[index + 1] }
        } else if item.kind == .episode, let series = shows().first(where: { $0.id == item.seriesID }) {
            let detail = try await seriesDetail(series)
            if let index = detail.episodes.firstIndex(where: { $0.key == item.key }), detail.episodes.indices.contains(index + 1) { next = detail.episodes[index + 1] }
        }
        return PlaybackRequest(item: target, url: URL(fileURLWithPath: path), expiresAt: expiry, resumeSeconds: positions[target.key] ?? 0, nextEpisode: next, scope: scope)
    }
    func saveProgress(_ item: CatalogItem, seconds: Double, duration: Double) async { positions[item.key] = seconds }
    func acknowledgeWelcome() async throws -> SessionState { acknowledged = true; return state() }
}
#endif
