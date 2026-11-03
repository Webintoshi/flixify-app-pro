import Foundation

public enum MediaKind: String, Codable, CaseIterable, Hashable, Sendable {
    case live, movie, series, episode
}

public struct CatalogItem: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var kind: MediaKind
    public var title: String
    public var categoryID: String
    public var categoryName: String
    public var artworkURL: String
    public var `extension`: String
    public var scope: String
    public var seriesID: String
    public var season: Int
    public var episode: Int
    public var description: String
    public var sourceTitle: String
    public var releaseYear: Int
    public var key: String { "\(kind.rawValue):\(seriesID):\(id)" }

    public init(id: String, kind: MediaKind, title: String, categoryID: String = "", categoryName: String = "", artworkURL: String = "", extension: String = "", scope: String = "", seriesID: String = "", season: Int = 0, episode: Int = 0, description: String = "", sourceTitle: String = "", releaseYear: Int = 0) {
        self.id = id; self.kind = kind; self.title = title; self.categoryID = categoryID; self.categoryName = categoryName
        self.artworkURL = artworkURL; self.extension = `extension`; self.scope = scope; self.seriesID = seriesID
        self.season = season; self.episode = episode; self.description = description
        self.sourceTitle = sourceTitle.isEmpty ? title : sourceTitle; self.releaseYear = releaseYear
    }
}

public struct Category: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public init(id: String, title: String) { self.id = id; self.title = title }
}

public struct Catalog: Codable, Equatable, Sendable {
    public let kind: MediaKind
    public var items: [CatalogItem]
    public var categories: [Category]
    public init(kind: MediaKind, items: [CatalogItem], categories: [Category] = []) { self.kind = kind; self.items = items; self.categories = categories }
}

public struct Season: Codable, Equatable, Identifiable, Sendable {
    public let number: Int
    public let episodes: [CatalogItem]
    public var id: Int { number }
    public init(number: Int, episodes: [CatalogItem]) { self.number = number; self.episodes = episodes }
}

public struct SeriesDetail: Codable, Equatable, Sendable {
    public let series: CatalogItem
    public let seasons: [Season]
    public var episodes: [CatalogItem] { seasons.flatMap(\.episodes) }
    public init(series: CatalogItem, seasons: [Season]) { self.series = series; self.seasons = seasons }
}

public struct Account: Equatable, Sendable {
    public let id: String
    public let codeSuffix: String
    public let packageTitle: String
    public let expiresAt: Date?
    public let canPlay: Bool
    public let trial: Bool
    public let message: String
    public init(id: String, codeSuffix: String = "", packageTitle: String = "", expiresAt: Date? = nil, canPlay: Bool = false, trial: Bool = false, message: String = "") {
        self.id = id; self.codeSuffix = codeSuffix; self.packageTitle = packageTitle; self.expiresAt = expiresAt
        self.canPlay = canPlay; self.trial = trial; self.message = message
    }
}

public struct WelcomeOffer: Equatable, Sendable {
    public static let campaign = "welcome-monthly-50-v1"
    public let state: String
    public let eligible: Bool
    public let movies: Int
    public let live: Int
    public let series: Int
    public let singlePriceMinor: Int
    public let dualPriceMinor: Int
    public var canAcknowledge: Bool { eligible && state == "pending" }
    public var showPrompt: Bool { canAcknowledge }
    public init(state: String = "not_eligible", eligible: Bool = false, movies: Int = 0, live: Int = 0, series: Int = 0, singlePriceMinor: Int = 12500, dualPriceMinor: Int = 19950) {
        self.state = state; self.eligible = eligible; self.movies = movies; self.live = live; self.series = series
        self.singlePriceMinor = singlePriceMinor; self.dualPriceMinor = dualPriceMinor
    }
    public func paymentURL(users: Int) -> URL { URL(string: "https://flixify.vip/paketler?welcome=1&users=\(users == 2 ? 2 : 1)")! }
}

public struct SessionState: Equatable, Sendable {
    public let account: Account
    public let welcomeOffer: WelcomeOffer?
    public let sourceScope: String
    public init(account: Account, welcomeOffer: WelcomeOffer? = nil, sourceScope: String = "") { self.account = account; self.welcomeOffer = welcomeOffer; self.sourceScope = sourceScope }
}

public struct Programme: Codable, Equatable, Identifiable, Sendable {
    public let title: String
    public let startsAt: Date
    public let endsAt: Date
    public var id: String { "\(startsAt.timeIntervalSince1970):\(title)" }
    public init(title: String, startsAt: Date, endsAt: Date) { self.title = title; self.startsAt = startsAt; self.endsAt = endsAt }
}

public struct PersonalLibrary: Codable, Equatable, Sendable {
    public var favorites: [CatalogItem]
    public var watchedEpisodeKeys: Set<String>
    public init(favorites: [CatalogItem] = [], watchedEpisodeKeys: Set<String> = []) { self.favorites = favorites; self.watchedEpisodeKeys = watchedEpisodeKeys }
}

public struct PlaybackRequest: Sendable {
    public let analyticsContext: PlaybackAnalyticsContext?
    public let item: CatalogItem
    public let url: URL
    public let expiresAt: Date
    public let resumeSeconds: Double
    public let nextEpisode: CatalogItem?
    public let scope: String
    public init(item: CatalogItem, url: URL, expiresAt: Date, resumeSeconds: Double = 0, nextEpisode: CatalogItem? = nil, scope: String, analyticsContext: PlaybackAnalyticsContext? = nil) {
        self.item = item; self.url = url; self.expiresAt = expiresAt; self.resumeSeconds = resumeSeconds; self.nextEpisode = nextEpisode; self.scope = scope; self.analyticsContext = analyticsContext
    }
}

public struct Shelf: Equatable, Identifiable, Sendable {
    public let id: String
    public let title: String
    public let items: [CatalogItem]
    public init(id: String, title: String, items: [CatalogItem]) { self.id = id; self.title = title; self.items = items }
}

public enum FlixifyError: Error, LocalizedError, Equatable {
    case invalidData, invalidCode, authentication, accessExpired, staleSource, network, limit, keychain, updateUnavailable
    public var errorDescription: String? {
        switch self {
        case .invalidData: return "İçerik bilgisi doğrulanamadı."
        case .invalidCode: return "16 karakterli kullanıcı kodunu kontrol et."
        case .authentication: return "Oturumun sona erdi. Yeniden giriş yap."
        case .accessExpired: return "Aktif izleme erişimin bulunmuyor."
        case .staleSource: return "Hesap bilgisi değişti. Lütfen tekrar dene."
        case .network: return "Bağlantı kurulamadı. Lütfen tekrar dene."
        case .limit: return "İçerik listesi izin verilen boyutu aşıyor."
        case .keychain: return "Güvenli oturum bilgisi kaydedilemedi."
        case .updateUnavailable: return "Güvenilir bir uygulama güncellemesi bulunamadı."
        }
    }
}

public protocol FlixifyRepositoryProtocol: Sendable {
    func startDeviceLogin() async throws -> DeviceLoginPresentation
    func pollDeviceLogin() async throws -> DeviceLoginStatus
    func hasDeviceLoginSession() async -> Bool
    func deviceLoginInterval() async -> Int
    func acknowledgeDeviceLogin() async
    func cancelDeviceLogin() async
    func restore() async throws -> SessionState?
    func login(code: String) async throws -> SessionState
    func refreshSession() async throws -> SessionState
    func logout() async
    func catalog(_ kind: MediaKind, force: Bool) async throws -> Catalog
    func seriesDetail(_ item: CatalogItem) async throws -> SeriesDetail
    func epg(_ item: CatalogItem) async throws -> [Programme]
    func library(force: Bool) async throws -> PersonalLibrary
    func setFavorite(_ item: CatalogItem, favorited: Bool) async throws -> PersonalLibrary
    func markWatched(_ item: CatalogItem) async
    func playback(_ item: CatalogItem) async throws -> PlaybackRequest
    func saveProgress(_ item: CatalogItem, seconds: Double, duration: Double) async
    func acknowledgeWelcome() async throws -> SessionState
    func chooseWelcome(monthly: Bool) async throws -> SessionState
}

public extension FlixifyRepositoryProtocol {
    func catalog(_ kind: MediaKind) async throws -> Catalog { try await catalog(kind, force: false) }
    func library() async throws -> PersonalLibrary { try await library(force: false) }
    func chooseWelcome(monthly: Bool) async throws -> SessionState { try await acknowledgeWelcome() }
}
