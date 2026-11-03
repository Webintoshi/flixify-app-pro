import Foundation
import AppKit

private struct PersonalReference: Codable, Hashable {
    let kind: MediaKind
    let id: String
    let seriesID: String
    let sourceVersion: String
    var key: String { "\(kind.rawValue):\(seriesID):\(id)" }
}

private struct LibrarySnapshot: Codable {
    var references: Set<PersonalReference>
    var watched: Set<String>
    var resolved: [CatalogItem]
}

private struct CatalogFlight {
    let id: UUID
    let scope: String
    let task: Task<Catalog, Error>
}

private struct BackgroundFlight { let id: UUID; let task: Task<Void, Never> }
private struct BootstrapFlight { let id: UUID; let forced: Bool; let task: Task<ProviderSession, Error> }

public actor FlixifyRepository: FlixifyRepositoryProtocol {
    private static let api = URL(string: "https://api.flixify.vip")!
    private let client: HTTPClient
    private let vault: any SessionVault
    private let cache: MetadataCache
    private let progress: ProgressStore
    private let deviceLoginIsActive: @Sendable () async -> Bool
    private let deviceLoginClock: @Sendable () -> TimeInterval
    private let now: @Sendable () -> Date
    private var pairing: DeviceLoginAttempt?
    private var pairingEpoch = UUID()
    private var pairedSessionAdopted = false
    private var pairingAcknowledgement: Task<Void, Never>?
    private var pairingCleanup: [UUID: Task<Void, Never>] = [:]
    private var session: StoredSession?
    private var provider: ProviderSession?
    private var authGeneration: UInt64 = 0
    private var sourceGeneration: UInt64 = 0
    private var refreshTask: Task<StoredSession, Error>?
    private var bootstrapFlight: BootstrapFlight?
    private var providerCheckedAt = Date.distantPast
    private var accountCheckedAt = Date.distantPast
    private var currentAccount: Account?
    private var catalogs: [MediaKind: CacheHit<Catalog>] = [:]
    private var flights: [MediaKind: CatalogFlight] = [:]
    private var details: [String: CacheHit<SeriesDetail>] = [:]
    private var liveProjection: LiveProjection?
    private var liveRawRevision: UInt64 = 0
    private var projectedRawRevision: UInt64?
    private var projectedScope = ""
    private var projectedPolicyRevision: String?
    private var projectedExcluded = Set<String>()
    private var references = Set<PersonalReference>()
    private var watched = Set<String>()
    private var watchedWrites: [String: UUID] = [:]
    private var resolvedFavorites: [CatalogItem] = []
    private var libraryScope = ""
    private var librarySavedAt = Date.distantPast
    private var libraryRevision: UInt64 = 0
    private var background: [String: BackgroundFlight] = [:]
    private var optionalPausedUntil = Date.distantPast

    public init() {
        client = HTTPClient(); vault = KeychainStore(); cache = MetadataCache(); progress = ProgressStore(); now = { Date() }; deviceLoginIsActive = { await MainActor.run { NSApp?.isActive ?? true } }
        deviceLoginClock = { ProcessInfo.processInfo.systemUptime }
    }
    init(client: HTTPClient, vault: any SessionVault, cache: MetadataCache, progress: ProgressStore, now: @escaping @Sendable () -> Date = { Date() }, deviceLoginIsActive: @escaping @Sendable () async -> Bool = { await MainActor.run { NSApp?.isActive ?? true } }, deviceLoginClock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.client = client; self.vault = vault; self.cache = cache; self.progress = progress; self.now = now; self.deviceLoginIsActive = deviceLoginIsActive
        self.deviceLoginClock = deviceLoginClock
    }

    deinit { pairingAcknowledgement?.cancel(); for task in pairingCleanup.values { task.cancel() } }

    private func checkAuth(_ generation: UInt64) throws {
        guard authGeneration == generation, session != nil else { throw FlixifyError.staleSource }
        try Task.checkCancellation()
    }
    private func checkSource(_ auth: UInt64, _ source: UInt64, _ scope: String) throws {
        try checkAuth(auth)
        guard let current = provider, sourceGeneration == source, current.scope == scope else { throw FlixifyError.staleSource }
        guard current.expiresAt > now() else { clearProvider(); throw FlixifyError.accessExpired }
    }
    private func clearProvider() {
        sourceGeneration &+= 1; provider = nil; providerCheckedAt = .distantPast
        for flight in flights.values { flight.task.cancel() }; flights.removeAll()
        for flight in background.values { flight.task.cancel() }; background.removeAll()
        catalogs.removeAll(); details.removeAll(); liveProjection = nil; liveRawRevision &+= 1; projectedRawRevision = nil
        projectedScope = ""; projectedPolicyRevision = nil; projectedExcluded.removeAll()
        references.removeAll(); watched.removeAll(); watchedWrites.removeAll(); resolvedFavorites.removeAll(); libraryScope = ""; librarySavedAt = .distantPast; libraryRevision &+= 1
    }
    public func logout() async {
        if let attempt = pairing, attempt.adopted { cleanupPairing(attempt) }
        await cancelDeviceLogin(); pairing = nil; pairingEpoch = UUID(); pairedSessionAdopted = false; pairingAcknowledgement?.cancel(); pairingAcknowledgement = nil
        authGeneration &+= 1; refreshTask?.cancel(); refreshTask = nil; bootstrapFlight?.task.cancel(); bootstrapFlight = nil; session = nil; currentAccount = nil; accountCheckedAt = .distantPast
        clearProvider(); vault.clear()
    }
    public func restore() async throws -> SessionState? {
        guard let stored = try vault.load() else { return nil }
        authGeneration &+= 1; refreshTask?.cancel(); refreshTask = nil; bootstrapFlight?.task.cancel(); bootstrapFlight = nil
        clearProvider(); session = stored
        do { return try await refreshSession() }
        catch FlixifyError.authentication { await logout(); return nil }
    }
    public func login(code: String) async throws -> SessionState {
        let code = code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard Text.matches(code, #"^[A-Z0-9]{16}$"#) else { throw FlixifyError.invalidCode }
        await logout(); let auth = authGeneration
        let result = try await client.request(url: Self.api.appendingPathComponent("auth/login-by-code"), method: "POST", body: ["code": code, "deviceName": "Flixify macOS", "platform": "macos", "installationId": try vault.installationID()])
        guard auth == authGeneration else { throw FlixifyError.staleSource }
        guard result.status == 200 else { throw result.status == 401 ? FlixifyError.authentication : FlixifyError.network }
        let stored = try Self.tokens(ProviderParser.object(result.data)); try vault.save(stored); session = stored
        return try await refreshSession()
    }
    public func startDeviceLogin() async throws -> DeviceLoginPresentation {
        await cancelDeviceLogin()
        guard await deviceLoginIsActive(), !Task.isCancelled else { throw FlixifyError.staleSource }
        guard session == nil else { throw FlixifyError.staleSource }
        let epoch = UUID(), auth = authGeneration
        pairingEpoch = epoch
        let result = try await client.request(url: Self.api.appendingPathComponent("auth/device/start"), method: "POST", body: ["platform": "macos", "deviceName": "Flixify macOS", "installationId": try vault.installationID()])
        guard result.status == 200 else { throw result.status == 429 ? FlixifyError.limit : FlixifyError.network }
        let raw = try ProviderParser.object(result.data)
        guard let request = raw["requestId"] as? String, UUID(uuidString: request) != nil,
              let proof = raw["deviceSecret"] as? String, Text.matches(proof, #"^[A-Za-z0-9_-]{43}$"#) else { throw FlixifyError.invalidData }
        let attempt = DeviceLoginAttempt(epoch: epoch, requestID: request, proof: proof, auth: auth, lifetime: DeviceLoginLifetime(startedAt: deviceLoginClock()), interval: 2)
        let active = await deviceLoginIsActive()
        guard active, epoch == pairingEpoch, auth == authGeneration, session == nil, !Task.isCancelled else { cleanupPairing(attempt); throw FlixifyError.staleSource }
        do {
            let presentation = try DeviceLoginPresentation(raw)
            pairing = attempt; pairing?.interval = presentation.interval
            return presentation
        } catch { cleanupPairing(attempt); throw error }
    }
    public func hasDeviceLoginSession() async -> Bool { pairedSessionAdopted && session != nil }
    public func deviceLoginInterval() async -> Int { pairing?.interval ?? 2 }
    public func pollDeviceLogin() async throws -> DeviceLoginStatus {
        guard await deviceLoginIsActive(), !Task.isCancelled else { await cancelDeviceLogin(); throw FlixifyError.staleSource }
        guard let attempt = pairing, !attempt.adopted, !attempt.polling, attempt.auth == authGeneration, session == nil else { throw FlixifyError.staleSource }
        guard attempt.lifetime.canPoll(at: deviceLoginClock()) else { await cancelDeviceLogin(); return .expired }
        pairing?.polling = true
        do {
            let result = try await client.request(url: Self.api.appendingPathComponent("auth/device/token"), method: "POST", body: attempt.body)
            guard pairingEpoch == attempt.epoch, pairing?.epoch == attempt.epoch, authGeneration == attempt.auth, session == nil else { throw FlixifyError.staleSource }
            try Task.checkCancellation()
            pairing?.polling = false
            if result.status == 429 || result.status >= 500 { throw FlixifyError.network }
            guard result.status == 200 else { throw FlixifyError.invalidData }
            let raw = try ProviderParser.object(result.data)
            guard let text = raw["status"] as? String, let status = DeviceLoginStatus(rawValue: text) else { throw FlixifyError.invalidData }
            if let interval = raw["intervalSeconds"] as? Int { pairing?.interval = min(60, max(2, interval)) }
            else if status == .slowDown { pairing?.interval = min(60, attempt.interval + 5) }
            if status == .authorized {
                guard let rawSession = raw["session"] as? [String: Any] else { throw FlixifyError.invalidData }
                let stored = try Self.tokens(rawSession)
                let active = await deviceLoginIsActive()
                if !active { await cancelDeviceLogin(); throw FlixifyError.staleSource }
                // No await between the activity/attempt fence and secure adoption.
                try Task.checkCancellation()
                guard active, pairingEpoch == attempt.epoch, pairing?.epoch == attempt.epoch, authGeneration == attempt.auth, session == nil else { throw FlixifyError.staleSource }
                guard attempt.lifetime.canPoll(at: deviceLoginClock()) else { await cancelDeviceLogin(); return .expired }
                try vault.save(stored); session = stored; pairing?.adopted = true; pairedSessionAdopted = true
                startPairingAcknowledgement()
            } else {
                guard raw["session"] == nil else { throw FlixifyError.invalidData }
                if status.terminal { pairing = nil; pairingEpoch = UUID() }
            }
            return status
        } catch {
            if pairing?.epoch == attempt.epoch { pairing?.polling = false; if error as? FlixifyError == .network { pairing?.interval = min(60, (pairing?.interval ?? 2) + 5) } }
            throw error
        }
    }
    private func startPairingAcknowledgement() {
        pairingAcknowledgement?.cancel()
        pairingAcknowledgement = Task { [weak self] in
            for delay in [0, 2, 5, 10, 20] {
                if delay > 0 { try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000_000) }
                guard !Task.isCancelled else { return }
                await self?.acknowledgeDeviceLogin()
            }
        }
    }
    public func acknowledgeDeviceLogin() async {
        guard let attempt = pairing, attempt.adopted, session != nil else { return }
        guard let result = try? await client.request(url: Self.api.appendingPathComponent("auth/device/ack"), method: "POST", body: attempt.body), result.status == 200,
              let raw = try? ProviderParser.object(result.data), raw["status"] as? String == "complete", pairing?.epoch == attempt.epoch else { return }
        pairing = nil
    }
    public func cancelDeviceLogin() async {
        pairingEpoch = UUID()
        guard let attempt = pairing else { return }
        if attempt.adopted { return }
        pairing = nil; cleanupPairing(attempt)
    }
    private func cleanupPairing(_ attempt: DeviceLoginAttempt) {
        let ticket = UUID(), client = client
        pairingCleanup[ticket] = Task { [weak self] in
            _ = try? await client.request(url: Self.api.appendingPathComponent("auth/device/cancel"), method: "POST", body: attempt.body)
            await self?.finishedPairingCleanup(ticket)
        }
    }
    private func finishedPairingCleanup(_ ticket: UUID) { pairingCleanup.removeValue(forKey: ticket) }
    private static func tokens(_ raw: [String: Any]) throws -> StoredSession {
        guard let user = raw["user"] as? [String: Any] else { throw FlixifyError.invalidData }
        return try StoredSession(accessToken: ProviderParser.secret(raw["accessToken"], max: 16384), refreshToken: ProviderParser.secret(raw["refreshToken"], max: 16384), accountID: ProviderParser.secret(user["id"], max: 256), codeSuffix: String(Text.clean(user["codeSuffix"], max: 16).suffix(4)))
    }
    private func rotateTokens() async throws -> StoredSession {
        if let task = refreshTask { let value = try await task.value; guard session?.accountID == value.accountID else { throw FlixifyError.staleSource }; return value }
        guard let before = session else { throw FlixifyError.authentication }
        let auth = authGeneration, client = client
        let task = Task<StoredSession, Error> {
            let result = try await client.request(url: Self.api.appendingPathComponent("auth/refresh"), method: "POST", body: ["refreshToken": before.refreshToken])
            guard result.status == 200 else { throw result.status == 401 || result.status == 403 ? FlixifyError.authentication : FlixifyError.network }
            let stored = try Self.tokens(ProviderParser.object(result.data)); guard stored.accountID == before.accountID else { throw FlixifyError.staleSource }; return stored
        }
        refreshTask = task
        do {
            let stored = try await task.value; try checkAuth(auth)
            guard session?.refreshToken == before.refreshToken else { throw FlixifyError.staleSource }
            try vault.save(stored); session = stored; refreshTask = nil; return stored
        } catch {
            if auth == authGeneration { refreshTask = nil; if error as? FlixifyError == .authentication { await logout() } }
            throw error
        }
    }
    private func api(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("?"), let stored = session else { throw FlixifyError.authentication }
        let auth = authGeneration, url = Self.api.appendingPathComponent(String(path.dropFirst()))
        var result = try await client.request(url: url, method: method, body: body, token: stored.accessToken); try checkAuth(auth)
        if result.status == 401 {
            let refreshed = try await rotateTokens(); try checkAuth(auth)
            result = try await client.request(url: url, method: method, body: body, token: refreshed.accessToken); try checkAuth(auth)
        }
        if result.status == 401 { await logout(); throw FlixifyError.authentication }
        if result.status == 403 { throw FlixifyError.accessExpired }
        guard (200...299).contains(result.status) else { throw FlixifyError.network }
        return try ProviderParser.object(result.data)
    }
    private func bootstrap(force: Bool = false) async throws -> ProviderSession {
        guard session != nil else { throw FlixifyError.authentication }
        let auth = authGeneration
        let flight: BootstrapFlight
        if let current = bootstrapFlight, !force || current.forced { flight = current }
        else {
            if !force, let current = provider, current.expiresAt > now(), now().timeIntervalSince(providerCheckedAt) < 60 { return current }
            bootstrapFlight?.task.cancel()
            let ticket = UUID(), generation = sourceGeneration
            let task = Task<ProviderSession, Error> { try await self.fetchBootstrap(ticket: ticket, auth: auth, generation: generation) }
            flight = BootstrapFlight(id: ticket, forced: force, task: task); bootstrapFlight = flight
        }
        do {
            _ = try await flight.task.value; try checkAuth(auth)
            if let current = bootstrapFlight, current.id != flight.id { return try await bootstrap() }
            if bootstrapFlight?.id == flight.id { bootstrapFlight = nil }
            guard let current = provider, current.expiresAt > now() else { throw FlixifyError.accessExpired }
            return current
        } catch {
            try checkAuth(auth)
            if bootstrapFlight?.id != flight.id {
                if bootstrapFlight != nil { return try await bootstrap() }
                if let current = provider, current.expiresAt > now() { return current }
            } else { bootstrapFlight = nil }
            throw error
        }
    }
    private func fetchBootstrap(ticket: UUID, auth: UInt64, generation: UInt64) async throws -> ProviderSession {
        do {
            let raw = try await api("/me/provider-session"); try checkAuth(auth)
            guard bootstrapFlight?.id == ticket, sourceGeneration == generation else { throw FlixifyError.staleSource }
            var incoming = try ProviderParser.bootstrap(raw, now: now())
            guard incoming.accountID == session?.accountID else { throw FlixifyError.staleSource }
            if let old = provider, incoming.sameIdentity(old) {
                if incoming.policyRevision == nil && old.policyRevision != nil { incoming = ProviderSession(accountID: incoming.accountID, sourceVersion: incoming.sourceVersion, origin: incoming.origin, username: incoming.username, password: incoming.password, expiresAt: incoming.expiresAt, excludedLiveIDs: old.excludedLiveIDs, policyRevision: old.policyRevision) }
                if incoming.policyRevision != old.policyRevision { liveProjection = nil }
            } else { clearProvider() }
            provider = incoming; providerCheckedAt = now(); return incoming
        } catch {
            if auth == authGeneration, bootstrapFlight?.id == ticket, sourceGeneration == generation, error as? FlixifyError == .accessExpired || error as? FlixifyError == .invalidData { clearProvider() }
            throw error
        }
    }
    private func loadAccount(force: Bool) async throws -> Account {
        if !force, let account = currentAccount, now().timeIntervalSince(accountCheckedAt) < 60, !account.canPlay || (account.expiresAt ?? .distantPast) > now() { return account }
        let auth = authGeneration, raw = try await api("/me"); try checkAuth(auth)
        guard let user = raw["user"] as? [String: Any], let assigned = ProviderParser.bool(user["hasAssignedLink"]), let subscribed = ProviderParser.bool(user["hasActiveSubscription"]) else { throw FlixifyError.invalidData }
        let id = try ProviderParser.secret(user["id"], max: 256)
        guard id == session?.accountID else { clearProvider(); throw FlixifyError.staleSource }
        let package = user["activePackage"] as? [String: Any] ?? [:], title = Text.clean(package["title"], max: 256), expiry = ProviderParser.date(package["endsAt"])
        let blocked = user["status"] as? String == "blocked", eligible = !blocked && assigned && subscribed && (expiry ?? .distantPast) > now()
        var canPlay = false, deadline = expiry
        if eligible {
            do { let source = try await bootstrap(force: force); canPlay = true; deadline = source.expiresAt }
            catch FlixifyError.accessExpired { clearProvider() }
        } else { clearProvider() }
        try checkAuth(auth)
        let suffix = Text.clean(user["codeSuffix"], max: 16)
        let account = Account(id: id, codeSuffix: String((suffix.isEmpty ? session?.codeSuffix ?? "" : suffix).suffix(4)), packageTitle: title, expiresAt: deadline, canPlay: canPlay, trial: title == "3 Saat Deneme" || title == "24 Saat Test", message: canPlay ? "İzleme erişimin açık." : blocked ? "Hesabın için destek ekibimizle iletişime geç." : !assigned ? "İçerik bağlantın henüz hazır değil." : "Aktif izleme erişimin bulunmuyor.")
        currentAccount = account; accountCheckedAt = now(); return account
    }
    public func refreshSession() async throws -> SessionState {
        let auth = authGeneration, account = try await loadAccount(force: true)
        let offer = try ProviderParser.welcome(await api("/me/welcome-offer")); try checkAuth(auth)
        return SessionState(account: account, welcomeOffer: offer, sourceScope: provider?.scope ?? "")
    }
    public func acknowledgeWelcome() async throws -> SessionState {
        try await chooseWelcome(monthly: false)
    }
    public func chooseWelcome(monthly: Bool) async throws -> SessionState {
        let auth = authGeneration
        let offer = try ProviderParser.welcome(await api("/me/welcome-offer/choice", method: "POST", body: ["choice": monthly ? "monthly" : "trial"]))
        guard !offer.showPrompt else { throw FlixifyError.invalidData }
        let account = try await loadAccount(force: false); try checkAuth(auth); return SessionState(account: account, welcomeOffer: offer, sourceScope: provider?.scope ?? "")
    }

    private func providerRequest(_ source: ProviderSession, action: String, id: String? = nil) async throws -> Data {
        let auth = authGeneration, generation = sourceGeneration
        try checkSource(auth, generation, source.scope)
        guard provider?.sameIdentity(source) == true else { throw FlixifyError.staleSource }
        guard ["get_vod_categories", "get_vod_streams", "get_series_categories", "get_series", "get_live_categories", "get_live_streams", "get_series_info", "get_short_epg"].contains(action) else { throw FlixifyError.invalidData }
        var parts = URLComponents(string: source.origin + "/player_api.php")!
        parts.queryItems = [URLQueryItem(name: "username", value: source.username), URLQueryItem(name: "password", value: source.password), URLQueryItem(name: "action", value: action)]
        if action == "get_series_info" || action == "get_short_epg" {
            guard let id = id, !ProviderParser.id(id).isEmpty else { throw FlixifyError.invalidData }
            parts.queryItems?.append(URLQueryItem(name: action == "get_series_info" ? "series_id" : "stream_id", value: id))
        }
        if action == "get_short_epg" { parts.queryItems?.append(URLQueryItem(name: "limit", value: "24")) }
        guard let url = parts.url else { throw FlixifyError.invalidData }
        let result = try await client.request(url: url); try checkSource(auth, generation, source.scope)
        if result.status == 401 || result.status == 403 { clearProvider(); throw FlixifyError.accessExpired }
        guard result.status == 200 else { throw FlixifyError.network }; return result.data
    }
    private func display(_ raw: Catalog, source: ProviderSession) -> Catalog {
        guard raw.kind == .live else { return raw }
        if let projection = liveProjection, projectedRawRevision == liveRawRevision, projectedScope == source.scope, projectedPolicyRevision == source.policyRevision, projectedExcluded == source.excludedLiveIDs { return projection.catalog }
        let latest = catalogs[.live]?.value ?? raw
        let projection = LiveLineup.curate(latest, excluded: source.excludedLiveIDs)
        liveProjection = projection; projectedRawRevision = liveRawRevision; projectedScope = source.scope
        projectedPolicyRevision = source.policyRevision; projectedExcluded = source.excludedLiveIDs
        return projection.catalog
    }
    private func validateCache(_ catalog: Catalog, scope: String, kind: MediaKind) -> Bool {
        catalog.kind == kind && catalog.items.count <= 50000 && catalog.items.allSatisfy { $0.kind == kind && $0.scope == scope && !ProviderParser.id($0.id).isEmpty && ($0.artworkURL.isEmpty || ProviderParser.artwork($0.artworkURL) == $0.artworkURL) }
    }
    public func catalog(_ kind: MediaKind, force: Bool = false) async throws -> Catalog {
        guard kind != .episode else { throw FlixifyError.invalidData }
        let source = try await bootstrap(), auth = authGeneration, generation = sourceGeneration
        if !force {
            // Parser/disk validation happens before insertion; source changes clear this actor-owned memory.
            if let hit = catalogs[kind], hit.value.kind == kind, now().timeIntervalSince(hit.savedAt) < MetadataCache.maxAge {
                if now().timeIntervalSince(hit.savedAt) >= MetadataCache.fresh { scheduleRefresh(kind: kind, auth: auth, generation: generation, scope: source.scope) }
                return display(hit.value, source: source)
            }
            if let hit = cache.read(Catalog.self, scope: source.scope, name: "catalog-" + kind.rawValue, expiry: source.expiresAt, now: now()), validateCache(hit.value, scope: source.scope, kind: kind) {
                catalogs[kind] = hit; if kind == .live { liveRawRevision &+= 1 }
                if hit.stale { scheduleRefresh(kind: kind, auth: auth, generation: generation, scope: source.scope) }; return display(hit.value, source: source)
            }
        }
        if let flight = flights[kind], flight.scope == source.scope {
            do { let raw = try await flight.task.value; try checkSource(auth, generation, source.scope); return display(raw, source: provider!) }
            catch { if auth == authGeneration && session != nil && provider == nil { throw FlixifyError.accessExpired }; throw error }
        }
        let ticket = UUID()
        let task = Task<Catalog, Error> { try await self.fetchCatalog(kind: kind, source: source, auth: auth, generation: generation) }
        flights[kind] = CatalogFlight(id: ticket, scope: source.scope, task: task)
        do {
            let raw = try await task.value; try checkSource(auth, generation, source.scope)
            if flights[kind]?.id == ticket { flights.removeValue(forKey: kind) }
            return display(raw, source: provider!)
        } catch {
            if flights[kind]?.id == ticket { flights.removeValue(forKey: kind) }
            if auth == authGeneration && session != nil && provider == nil { throw FlixifyError.accessExpired }; throw error
        }
    }
    private func fetchCatalog(kind: MediaKind, source: ProviderSession, auth: UInt64, generation: UInt64) async throws -> Catalog {
        let categoriesAction = kind == .live ? "get_live_categories" : kind == .movie ? "get_vod_categories" : "get_series_categories"
        let itemsAction = kind == .live ? "get_live_streams" : kind == .movie ? "get_vod_streams" : "get_series"
        async let groups = providerRequest(source, action: categoriesAction)
        async let rows = providerRequest(source, action: itemsAction)
        let raw = try await ProviderParser.catalog(kind: kind, rows: ProviderParser.array(rows), groups: ProviderParser.array(groups), scope: source.scope)
        try checkSource(auth, generation, source.scope)
        let saved = now(); catalogs[kind] = CacheHit(value: raw, savedAt: saved, stale: false)
        if kind == .live { liveRawRevision &+= 1 }
        cache.write(raw, scope: source.scope, name: "catalog-" + kind.rawValue, expiry: provider!.expiresAt, now: saved); return raw
    }
    private func scheduleRefresh(kind: MediaKind, auth: UInt64, generation: UInt64, scope: String) {
        let key = "catalog-" + kind.rawValue
        guard now() >= optionalPausedUntil, background[key] == nil else { return }
        let ticket = UUID()
        let task = Task { [weak self] in
            guard let self = self else { return }
            if (try? await self.checkSource(auth, generation, scope)) != nil { _ = try? await self.catalog(kind, force: true) }
            await self.finishedBackground(key, id: ticket)
        }
        background[key] = BackgroundFlight(id: ticket, task: task)
    }
    private func finishedBackground(_ key: String, id: UUID) { if background[key]?.id == id { background.removeValue(forKey: key) } }
    private func canonical(_ item: CatalogItem) async throws -> CatalogItem {
        let source = try await bootstrap(); _ = try ProviderParser.reference(item, scope: source.scope)
        if item.kind == .episode {
            let parent = CatalogItem(id: item.seriesID, kind: .series, title: "", scope: source.scope), detail = try await seriesDetail(parent)
            guard let match = detail.episodes.first(where: { $0.id == item.id }) else { throw FlixifyError.invalidData }; return match
        }
        let values = try await catalog(item.kind)
        let result = item.kind == .live ? liveProjection?.resolve(item.id) : values.items.first { $0.id == item.id }
        guard let result = result else { throw FlixifyError.invalidData }; return result
    }
    public func seriesDetail(_ item: CatalogItem) async throws -> SeriesDetail {
        guard item.kind == .series else { throw FlixifyError.invalidData }
        let source = try await bootstrap(), auth = authGeneration, generation = sourceGeneration
        _ = try ProviderParser.reference(item, scope: source.scope)
        let values = try await catalog(.series)
        guard let parent = values.items.first(where: { $0.id == item.id }) else { throw FlixifyError.invalidData }
        if let hit = details[parent.id], now().timeIntervalSince(hit.savedAt) < MetadataCache.fresh { return hit.value }
        if let hit = cache.read(SeriesDetail.self, scope: source.scope, name: "series-" + parent.id, expiry: source.expiresAt, now: now()), hit.value.series.id == parent.id, hit.value.series.scope == source.scope, hit.value.episodes.allSatisfy({ $0.scope == source.scope && $0.seriesID == parent.id && $0.kind == .episode }) { details[parent.id] = hit; if !hit.stale { return hit.value } }
        let raw = try ProviderParser.object(await providerRequest(source, action: "get_series_info", id: parent.id)), detail = try ProviderParser.series(raw, parent: parent)
        try checkSource(auth, generation, source.scope)
        details[parent.id] = CacheHit(value: detail, savedAt: now(), stale: false)
        if details.count > 24, let oldest = details.min(by: { $0.value.savedAt < $1.value.savedAt })?.key { details.removeValue(forKey: oldest) }
        cache.write(detail, scope: source.scope, name: "series-" + parent.id, expiry: provider!.expiresAt, now: now()); return detail
    }
    public func epg(_ item: CatalogItem) async throws -> [Programme] {
        guard item.kind == .live else { throw FlixifyError.invalidData }
        let verified = try await canonical(item), source = try await bootstrap()
        return try ProviderParser.epg(await ProviderParser.object(providerRequest(source, action: "get_short_epg", id: verified.id)))
    }

    private func readReferences(_ raw: Any?, source: ProviderSession, episodes: Bool) throws -> Set<PersonalReference> {
        guard let rows = raw as? [Any], rows.count <= (episodes ? 20000 : 500) else { throw FlixifyError.invalidData }
        var output = Set<PersonalReference>()
        for value in rows {
            guard let row = value as? [String: Any], row["source"] as? String == "personal", row["sourceVersion"] as? String == source.sourceVersion, let kindText = row["kind"] as? String, let kind = MediaKind(rawValue: kindText), episodes == (kind == .episode) else { continue }
            let id = ProviderParser.id(row["id"]), series = kind == .episode ? ProviderParser.id(row["seriesId"]) : ""
            guard !id.isEmpty, kind == .episode ? !series.isEmpty : row["seriesId"] == nil else { continue }
            output.insert(PersonalReference(kind: kind, id: id, seriesID: series, sourceVersion: source.sourceVersion))
        }
        return output
    }
    private func persistLibrary(_ source: ProviderSession) {
        cache.write(LibrarySnapshot(references: references, watched: watched.subtracting(watchedWrites.keys), resolved: resolvedFavorites), scope: source.scope, name: "library", expiry: source.expiresAt, now: librarySavedAt)
    }
    public func library(force: Bool = false) async throws -> PersonalLibrary {
        let source = try await bootstrap(), auth = authGeneration, generation = sourceGeneration
        if libraryScope != source.scope, let hit = cache.read(LibrarySnapshot.self, scope: source.scope, name: "library", expiry: source.expiresAt, now: now()), hit.value.references.count <= 500, hit.value.watched.count <= 20000, hit.value.references.allSatisfy({ $0.sourceVersion == source.sourceVersion && $0.kind != .episode && !ProviderParser.id($0.id).isEmpty && $0.seriesID.isEmpty }), hit.value.resolved.allSatisfy({ $0.scope == source.scope && $0.kind != .episode && ($0.kind != .live || !source.excludedLiveIDs.contains($0.id)) }) {
            references = hit.value.references; watched = hit.value.watched; resolvedFavorites = hit.value.resolved; libraryScope = source.scope; librarySavedAt = hit.savedAt
            if !force { scheduleLibrary(auth: auth, generation: generation, scope: source.scope); return PersonalLibrary(favorites: resolvedFavorites, watchedEpisodeKeys: watched) }
        }
        if force || libraryScope != source.scope || now().timeIntervalSince(librarySavedAt) >= 60 {
            let revision = libraryRevision, raw = try await api("/me/personal-library"); try checkSource(auth, generation, source.scope)
            let incoming = try readReferences(raw["favorites"], source: source, episodes: false), incomingWatched = try readReferences(raw["watched"], source: source, episodes: true)
            if revision == libraryRevision { references = incoming; watched = Set(incomingWatched.map(\.key)).union(watchedWrites.keys); libraryScope = source.scope; librarySavedAt = now(); libraryRevision &+= 1 }
        }
        var resolved: [CatalogItem] = [], keys = Set<String>()
        for kind in [MediaKind.live, .movie, .series] where references.contains(where: { $0.kind == kind }) {
            let catalog = try await catalog(kind); try checkSource(auth, generation, source.scope)
            let index = Dictionary(uniqueKeysWithValues: catalog.items.map { ($0.id, $0) })
            for reference in references.filter({ $0.kind == kind }).sorted(by: { $0.id < $1.id }) {
                if let item = kind == .live ? liveProjection?.resolve(reference.id) : index[reference.id], keys.insert(item.key).inserted { resolved.append(item) }
            }
        }
        try checkSource(auth, generation, source.scope); resolvedFavorites = resolved; persistLibrary(provider!); return PersonalLibrary(favorites: resolved, watchedEpisodeKeys: watched)
    }
    private func scheduleLibrary(auth: UInt64, generation: UInt64, scope: String) {
        guard background["library"] == nil, now() >= optionalPausedUntil else { return }
        let ticket = UUID()
        let task = Task { [weak self] in
            guard let self = self else { return }
            if (try? await self.checkSource(auth, generation, scope)) != nil { _ = try? await self.library(force: true) }
            await self.finishedBackground("library", id: ticket)
        }
        background["library"] = BackgroundFlight(id: ticket, task: task)
    }
    public func setFavorite(_ item: CatalogItem, favorited: Bool) async throws -> PersonalLibrary {
        let original: CatalogItem
        if item.kind == .episode { original = CatalogItem(id: item.seriesID, kind: .series, title: "", scope: item.scope) } else { original = item }
        let verified = try await canonical(original); _ = try await library(force: true)
        let source = try await bootstrap(), auth = authGeneration, generation = sourceGeneration
        let matches = references.filter { reference in reference.kind == verified.kind && (verified.kind == .live ? liveProjection?.resolve(reference.id)?.id == verified.id : reference.id == verified.id) }
        if favorited {
            if matches.isEmpty {
                let accepted = try await api("/me/personal-library/favorites", method: "PUT", body: ["ref": ProviderParser.reference(verified, scope: source.scope)]); try checkSource(auth, generation, source.scope)
                guard ProviderParser.bool(accepted["ok"]) == true else { throw FlixifyError.invalidData }
                references.insert(PersonalReference(kind: verified.kind, id: verified.id, seriesID: "", sourceVersion: source.sourceVersion)); libraryRevision &+= 1
            }
        } else {
            for reference in matches {
                let raw = liveProjection?.originals[reference.id] ?? verified
                let accepted = try await api("/me/personal-library/favorites", method: "DELETE", body: ["ref": ProviderParser.reference(raw, scope: source.scope)]); try checkSource(auth, generation, source.scope)
                guard ProviderParser.bool(accepted["ok"]) == true else { throw FlixifyError.invalidData }; references.remove(reference); libraryRevision &+= 1
            }
        }
        librarySavedAt = now(); return try await library()
    }
    public func markWatched(_ item: CatalogItem) async {
        guard item.kind == .episode else { return }
        let auth = authGeneration
        var pending: (key: String, ticket: UUID, generation: UInt64, scope: String)?
        do {
            let verified = try await canonical(item), source = try await bootstrap(), generation = sourceGeneration
            _ = try await library(); try checkSource(auth, generation, source.scope)
            let reference = try ProviderParser.reference(verified, scope: source.scope)
            guard !watched.contains(verified.key), watchedWrites[verified.key] == nil else { return }
            let ticket = UUID(); pending = (verified.key, ticket, generation, source.scope)
            watchedWrites[verified.key] = ticket; watched.insert(verified.key); libraryRevision &+= 1; librarySavedAt = now()
            let accepted = try await api("/me/personal-library/watched", method: "PUT", body: ["ref": reference])
            try checkSource(auth, generation, source.scope)
            guard ProviderParser.bool(accepted["ok"]) == true, watchedWrites[verified.key] == ticket else { throw FlixifyError.invalidData }
            watchedWrites.removeValue(forKey: verified.key); watched.insert(verified.key); libraryRevision &+= 1; librarySavedAt = now(); persistLibrary(provider!)
        } catch {
            guard let pending = pending, authGeneration == auth, sourceGeneration == pending.generation,
                  let current = provider, current.scope == pending.scope, watchedWrites[pending.key] == pending.ticket else { return }
            watchedWrites.removeValue(forKey: pending.key); watched.remove(pending.key); libraryRevision &+= 1; librarySavedAt = now(); persistLibrary(current)
        }
    }
    public func playback(_ item: CatalogItem) async throws -> PlaybackRequest {
        for flight in background.values { flight.task.cancel() }; background.removeAll(); optionalPausedUntil = now().addingTimeInterval(60)
        let account = try await loadAccount(force: true); guard account.canPlay else { throw FlixifyError.accessExpired }
        let auth = authGeneration, generation = sourceGeneration
        var verified: CatalogItem, next: CatalogItem?
        if item.kind == .series {
            let detail = try await seriesDetail(item), library = try await library()
            guard let selected = progress.latestEpisode(detail.episodes) ?? detail.episodes.first(where: { !library.watchedEpisodeKeys.contains($0.key) }) ?? detail.episodes.first else { throw FlixifyError.invalidData }
            verified = selected; if let index = detail.episodes.firstIndex(where: { $0.key == selected.key }), index + 1 < detail.episodes.count { next = detail.episodes[index + 1] }
        } else {
            verified = try await canonical(item)
            if verified.kind == .episode {
                let detail = try await seriesDetail(CatalogItem(id: verified.seriesID, kind: .series, title: "", scope: verified.scope))
                if let index = detail.episodes.firstIndex(where: { $0.key == verified.key }), index + 1 < detail.episodes.count { next = detail.episodes[index + 1] }
            }
        }
        try checkSource(auth, generation, verified.scope)
        let source = provider!, url = try ProviderParser.mediaURL(verified, session: source, now: now())
        return PlaybackRequest(item: verified, url: url, expiresAt: source.expiresAt, resumeSeconds: progress.position(verified), nextEpisode: next, scope: source.scope)
    }
    public func saveProgress(_ item: CatalogItem, seconds: Double, duration: Double) async {
        guard seconds.isFinite, duration.isFinite, seconds >= 0, duration > 0,
              let source = provider, source.scope == item.scope, source.expiresAt > now() else { return }
        progress.save(item, seconds: seconds, duration: duration, now: now())
        if item.kind == .episode, seconds >= duration - min(120, duration / 20) { await markWatched(item) }
    }
}
