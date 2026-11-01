import XCTest
import CryptoKit
@testable import FlixifyCore

final class CorePolicyTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1793538000)
    private func item(_ id: String, _ title: String, kind: MediaKind = .movie, category: String = "Aksiyon - Macera Filmleri", art: String = "https://images.example/poster.jpg", year: Int = 0) -> CatalogItem {
        CatalogItem(id: id, kind: kind, title: title, categoryID: "1", categoryName: category, artworkURL: art, extension: kind == .live ? "ts" : "mp4", scope: "account:source", releaseYear: year)
    }
    private func session(_ changes: [String: Any] = [:]) -> [String: Any] {
        var value: [String: Any] = ["accountId": "account", "sourceVersion": "source", "providerOrigin": "https://provider.example", "username": "fixture-user", "password": "fixture-password", "expiresAt": "2026-12-01T00:00:00.000Z", "moviePolicy": "general-audience-only"]
        value.merge(changes) { _, new in new }; return value
    }
    private func manifest(_ changes: [String: Any] = [:]) throws -> Data {
        var value: [String: Any] = ["bundleIdentifier": "vip.flixify.mac", "versionName": "1.0.1", "buildNumber": 2, "minSystemVersion": "13.0", "architectures": ["arm64", "x86_64"], "dmgUrl": "https://flixify.vip/downloads/Flixify-Pro-1.0.1-macos-universal.dmg", "sha256": String(repeating: "a", count: 64), "sizeBytes": 1024, "notes": "Yeni sürüm"]
        value.merge(changes) { _, new in new }; return try JSONSerialization.data(withJSONObject: value)
    }
    func testReleaseYearRejectsConflictingInvalidAndNonterminalEvidence() {
        XCTAssertEqual(CatalogReleaseYear.title("Film (2026)"), 2026)
        XCTAssertEqual(CatalogReleaseYear.title("Film [2026]"), 2026)
        XCTAssertEqual(CatalogReleaseYear.title("Film (2026) Fragman"), 0)
        XCTAssertEqual(CatalogReleaseYear.title("Film (2025) (2026)"), 0)
        XCTAssertEqual(CatalogReleaseYear.metadata(["year": 2026, "releaseDate": "2026-02-30"], title: "Film (2026)"), 0)
        XCTAssertEqual(CatalogReleaseYear.metadata(["year": 2026, "release_year": 2025], title: "Film (2026)"), 0)
        XCTAssertEqual(CatalogReleaseYear.metadata(["year": true], title: "Film (2026)"), 0)
        XCTAssertEqual(CatalogReleaseYear.metadata(["year": ""], title: "Film (2026)"), 2026)
        XCTAssertEqual(CatalogReleaseYear.metadata(["release_date": "2024-02-29T12:30:00Z"], title: "Film"), 2024)
    }
    func testBootstrapOriginAccountPolicyAndExpiryAreStrict() throws {
        let good = try ProviderParser.bootstrap(session(), now: now)
        XCTAssertEqual(good.scope, "account:source")
        for origin in ["http://provider.example", "https://user:pass@provider.example", "https://provider.example/", "https://provider.example?secret=x", "https://provider.example:443", "https://PROVIDER.example", "https://provider.example#fragment"] { XCTAssertThrowsError(try ProviderParser.bootstrap(session(["providerOrigin": origin]), now: now), origin) }
        XCTAssertThrowsError(try ProviderParser.bootstrap(session(["moviePolicy": "all"]), now: now))
        XCTAssertThrowsError(try ProviderParser.bootstrap(session(["accountId": "other:account"]), now: now))
        XCTAssertThrowsError(try ProviderParser.bootstrap(session(["sourceVersion": "a/b"]), now: now))
        XCTAssertThrowsError(try ProviderParser.bootstrap(session(["expiresAt": "2025-01-01T00:00:00Z"]), now: now))
    }
    func testMovieParserRequiresGeneralAudienceCategoryAndSafeArtwork() throws {
        let groups: [[String: Any]] = [["category_id": "1", "category_name": "TR | Aksiyon - Macera Filmleri"], ["category_id": "2", "category_name": "Private Adult"]]
        let rows: [[String: Any]] = [
            ["stream_id": "10", "name": "Avengers (2026)", "category_id": "1", "container_extension": "mp4", "stream_icon": "https://images.example/a.jpg", "year": 2026],
            ["stream_id": "11", "name": "Private", "category_id": "2", "container_extension": "mp4"],
            ["stream_id": "12", "name": "Missing format", "category_id": "1"],
            ["stream_id": "13", "name": "Image token", "category_id": "1", "container_extension": "mp4", "stream_icon": "https://images.example/a.jpg?password=fixture"]
        ]
        let parsed = try ProviderParser.catalog(kind: .movie, rows: rows, groups: groups, scope: "account:source")
        XCTAssertEqual(parsed.items.map(\.id), ["10", "13"])
        XCTAssertEqual(parsed.items.first?.releaseYear, 2026)
        XCTAssertEqual(parsed.items.last?.artworkURL, "")
    }
    func testLiveMissingFormatDefaultsToTSAndDuplicateSourceMapsToFHD() throws {
        let groups: [[String: Any]] = [["category_id": "1", "category_name": "TR:ULUSAL"]]
        let rows: [[String: Any]] = [
            ["stream_id": "100", "name": "TR • ATV HEVC FHD", "category_id": "1"],
            ["stream_id": "101", "name": "TR • ATV FHD", "category_id": "1"],
            ["stream_id": "102", "name": "TR • ATV 4K", "category_id": "1"]
        ]
        let raw = try ProviderParser.catalog(kind: .live, rows: rows, groups: groups, scope: "account:source")
        XCTAssertTrue(raw.items.allSatisfy { $0.extension == "ts" })
        let projection = LiveLineup.curate(raw, excluded: [])
        XCTAssertEqual(projection.catalog.items.map(\.id), ["101"])
        XCTAssertEqual(projection.resolve("100")?.id, "101")
        XCTAssertEqual(projection.catalog.items.first?.title, "ATV")
        XCTAssertEqual(LiveLineup.curate(raw, excluded: ["101"]).catalog.items.first?.id, "102")
    }
    func testTurkeyReferenceOrderingFriendlyFiltersAndForeignIdentity() {
        let items = [item("1", "TR • ATV FHD", kind: .live, category: "TR:ULUSAL"), item("2", "TR • Star TV RAW", kind: .live, category: "TR:ULUSAL"), item("3", "TR • TRT 1 HEVC", kind: .live, category: "TR:ULUSAL"), item("4", "DE • ATV FHD", kind: .live, category: "DE:ULUSAL"), item("5", "TRT 4K", kind: .live, category: "TR:ULUSAL"), item("6", "Sifir Panel Bilgilendirme Kanalı", kind: .live, category: "TR:ULUSAL")]
        let cleaned = LiveLineup.clean(items)
        XCTAssertEqual(cleaned.map(\.id), ["3", "2", "1", "4"])
        XCTAssertEqual(LiveLineup.info(cleaned[0]).countryID, "tr")
        XCTAssertEqual(LiveLineup.info(cleaned[0]).categoryID, "national")
        XCTAssertEqual(LiveLineup.categoryTitle("national"), "Ulusal")
        XCTAssertEqual(LiveLineup.countryTitle("tr"), "Türkiye")
        XCTAssertEqual(LiveLineup.search("TR • ŞÖMİNE HD"), "trsominehd")
    }
    func testEventAndTechnicalNotesCleanWithoutCombiningCountries() {
        let values = LiveLineup.clean([item("1", "TR • RAW BeIN Sport 1 Kota Dostu [Maçta aktif]", kind: .live, category: "TR:BEINSPORT"), item("2", "TR • beIN Sports 1 FHD 7/24 Canlı", kind: .live, category: "TR:BEINSPORT"), item("3", "DE • beIN Sports 1 FHD", kind: .live, category: "DE:SPORT")])
        XCTAssertEqual(values.count, 2)
        XCTAssertEqual(values.first?.id, "2")
        XCTAssertEqual(values.first?.title, "BEIN Sport 1")
    }
    func testDiscovery2026AndMovieCollectionsUseVerifiedMembership() {
        let items = [item("1", "Avengers (2026)", year: 2026), item("2", "Harry Potter (2001)", category: "Bilim Kurgu - Fantastik Filmler", year: 2001), item("3", "Aksiyon (2025)", year: 2025), item("4", "Science (2026)", category: "Bilim Kurgu - Fantastik Filmler", year: 2026), item("5", "No poster (2026)", art: "", year: 2026), item("6", "Yeni Dizi (2026)", kind: .series, category: "Dizi", year: 2026), item("7", "Old (1994)", kind: .series, category: "Dizi", year: 1994)]
        let shelves = Discovery.shelves(for: .movie, items: items, day: now)
        XCTAssertEqual(shelves.map(\.id), ["movies-2026", "movies-marvel", "movies-action", "movies-fantasy"])
        XCTAssertEqual(shelves.first(where: { $0.id == "movies-marvel" })?.items.map(\.id), ["1"])
        XCTAssertEqual(shelves.first(where: { $0.id == "movies-fantasy" })?.items.map(\.id), ["2"])
        XCTAssertFalse(shelves.first(where: { $0.id == "movies-action" })!.items.contains { $0.artworkURL.isEmpty })
        let home = Discovery.shelves(for: nil, items: items, day: now)
        XCTAssertTrue(home.flatMap(\.items).allSatisfy { $0.releaseYear == 2026 || $0.kind == .live })
        XCTAssertEqual(home, Discovery.shelves(for: nil, items: items, day: now))
        XCTAssertTrue(Discovery.hero(items: items, day: now).allSatisfy { $0.releaseYear == 2026 && !$0.artworkURL.isEmpty })
    }
    func testMediaURLUsesCurrentScopeEncodesCredentialsAndNeverAcceptsSeries() throws {
        let session = try ProviderParser.bootstrap(session(["username": "fixture /user", "password": "fixture?/#password"]), now: now)
        let movie = item("11", "Film")
        let url = try ProviderParser.mediaURL(movie, session: session, now: now)
        XCTAssertEqual(url.host, "provider.example")
        XCTAssertNil(url.query)
        XCTAssertTrue(url.absoluteString.contains("fixture%20%2Fuser"))
        XCTAssertThrowsError(try ProviderParser.mediaURL(item("11", "Series", kind: .series), session: session, now: now))
        var wrong = movie; wrong.scope = "other:source"
        XCTAssertThrowsError(try ProviderParser.mediaURL(wrong, session: session, now: now))
        XCTAssertThrowsError(try ProviderParser.mediaURL(movie, session: session, now: session.expiresAt))
    }
    func testSeriesSortCrossSeasonNextAndEPGValidation() throws {
        let parent = item("201", "Dizi", kind: .series)
        let detail = try ProviderParser.series(["episodes": ["2": [["id": "302", "title": "İkinci", "season": 2, "episode_num": 1, "container_extension": "mkv"]], "1": [["id": "301", "title": "Birinci", "season": 1, "episode_num": 1, "container_extension": "mp4"]]]], parent: parent)
        XCTAssertEqual(detail.seasons.map(\.number), [1, 2]); XCTAssertEqual(detail.episodes.map(\.id), ["301", "302"])
        let programs = try ProviderParser.epg(["epg_listings": [["title": Data("Maç".utf8).base64EncodedString(), "start_timestamp": "1793538000", "stop_timestamp": "1793541600"], ["title": "invalid***", "start_timestamp": 1, "end_timestamp": 2]]])
        XCTAssertEqual(programs.map(\.title), ["Maç"])
    }
    func testCacheScopeExpiryFutureAndNoCredentialSerialization() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flixify-core-cache-test-" + UUID().uuidString); defer { try? FileManager.default.removeItem(at: directory) }
        let cache = MetadataCache(root: directory)
        let catalog = Catalog(kind: .movie, items: [item("10", "Film")])
        cache.write(catalog, scope: "account:source", name: "movie", expiry: now.addingTimeInterval(3600), now: now)
        XCTAssertNotNil(cache.read(Catalog.self, scope: "account:source", name: "movie", expiry: now.addingTimeInterval(3600), now: now))
        XCTAssertNil(cache.read(Catalog.self, scope: "other:source", name: "movie", expiry: now.addingTimeInterval(3600), now: now))
        XCTAssertNil(cache.read(Catalog.self, scope: "account:source", name: "movie", expiry: now, now: now))
        XCTAssertNil(cache.read(Catalog.self, scope: "account:source", name: "movie", expiry: now.addingTimeInterval(3600), now: now.addingTimeInterval(-1)))
        let bytes = try Data(contentsOf: cache.file(scope: "account:source", name: "movie")); let text = String(decoding: bytes, as: UTF8.self)
        XCTAssertFalse(text.contains("fixture-password")); XCTAssertFalse(text.contains("/movie/fixture-user"))
    }
    func testProgressIsScopedBoundedAndEndClearsResume() {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flixify-core-progress-test-" + UUID().uuidString); defer { try? FileManager.default.removeItem(at: directory) }
        let store = ProgressStore(file: directory.appendingPathComponent("progress.json")), movie = item("10", "Film")
        store.save(movie, seconds: 60, duration: 1000, now: now); XCTAssertEqual(store.position(movie), 60)
        var other = movie; other.scope = "other:source"; XCTAssertEqual(store.position(other), 0)
        store.save(movie, seconds: 990, duration: 1000, now: now); XCTAssertEqual(store.position(movie), 0)
    }
    func testWelcomeRequiresExactCampaignQuotesAndServerState() throws {
        var value: [String: Any] = ["campaign": WelcomeOffer.campaign, "eligible": true, "state": "pending", "offers": [["id": WelcomeOffer.campaign, "users": 1, "currency": "try", "durationMonths": 1, "amountMinor": 12500, "regularAmountMinor": 25000, "packageSlug": "1-ay"], ["id": WelcomeOffer.campaign, "users": 2, "currency": "try", "durationMonths": 1, "amountMinor": 19950, "regularAmountMinor": 39900, "packageSlug": "1-ay-2-kullanici"]], "catalogue": ["movies": 12000, "live": 11000, "series": 5000]]
        let offer = try ProviderParser.welcome(value); XCTAssertTrue(offer.canAcknowledge); XCTAssertEqual(offer.paymentURL(users: 2).absoluteString, "https://flixify.vip/paketler?welcome=1&users=2")
        value["state"] = "redeemed"; XCTAssertThrowsError(try ProviderParser.welcome(value))
        value["state"] = "pending"
        var quotes = value["offers"] as! [[String: Any]]; quotes[0]["amountMinor"] = 12500.5; value["offers"] = quotes
        XCTAssertThrowsError(try ProviderParser.welcome(value))
    }
    func testUpdateDescriptorRejectsForeignDowngradeMalformedAndDuplicates() throws {
        let update = try NativeUpdatePolicy.validate(manifest(), currentVersion: "1.0.0", currentBuild: 1, currentSystemVersion: "13.0")
        XCTAssertEqual(update.versionName, "1.0.1")
        for change in [["dmgUrl": "http://flixify.vip/a.dmg"], ["dmgUrl": "https://evil.example/Flixify.dmg"], ["bundleIdentifier": "other.app"], ["architectures": ["arm64"]], ["sha256": "bad"], ["sizeBytes": -1]] as [[String: Any]] { XCTAssertThrowsError(try NativeUpdatePolicy.parse(manifest(change))) }
        XCTAssertThrowsError(try NativeUpdatePolicy.validate(manifest(), currentVersion: "2.0.0", currentBuild: 1, currentSystemVersion: "13.0"))
        XCTAssertThrowsError(try NativeUpdatePolicy.validate(manifest(["minSystemVersion": "15.0"]), currentVersion: "1.0.0", currentBuild: 1, currentSystemVersion: "13.0"))
        let duplicate = Data(#"{"bundleIdentifier":"bad","bundleIdentifier":"vip.flixify.mac"}"#.utf8)
        XCTAssertThrowsError(try NativeUpdatePolicy.parse(duplicate))
    }
    func testUpdateFileRequiresExactHashAndByteCount() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("flixify-update-test-" + UUID().uuidString); defer { try? FileManager.default.removeItem(at: file) }
        let bytes = Data("fixture-dmg".utf8), digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(); try bytes.write(to: file)
        let descriptor = try NativeUpdatePolicy.parse(manifest(["sizeBytes": bytes.count, "sha256": digest]))
        XCTAssertNoThrow(try NativeUpdatePolicy.verifyFile(file, descriptor: descriptor))
        try Data("tampered".utf8).write(to: file); XCTAssertThrowsError(try NativeUpdatePolicy.verifyFile(file, descriptor: descriptor))
    }
    func testBoundedJSONRejectsDepthBomb() {
        let bomb = Data((String(repeating: "[", count: 65) + "0" + String(repeating: "]", count: 65)).utf8)
        XCTAssertThrowsError(try ProviderParser.array(bomb))
    }
}
