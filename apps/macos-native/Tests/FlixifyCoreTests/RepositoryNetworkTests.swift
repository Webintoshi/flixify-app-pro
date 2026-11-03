import XCTest
@testable import FlixifyCore

private final class MemoryVault: SessionVault, @unchecked Sendable {
    private let lock = NSLock()
    private var value: StoredSession?
    var failSave = false
    var onSave: (@Sendable () -> Void)?
    func load() throws -> StoredSession? { lock.lock(); defer { lock.unlock() }; return value }
    func save(_ session: StoredSession) throws { if failSave { throw FlixifyError.keychain }; lock.lock(); value = session; lock.unlock(); onSave?() }
    func clear() { lock.lock(); value = nil; lock.unlock() }
    func installationID() throws -> String { "00000000-0000-0000-0000-000000000001" }
}

private struct FixtureReply {
    let status: Int
    let data: Data
    var delay: TimeInterval = 0
    var headers: [String: String] = [:]
    var onDelivery: (@Sendable () -> Void)?
    init(_ value: Any, status: Int = 200, delay: TimeInterval = 0, onDelivery: (@Sendable () -> Void)? = nil) { self.status = status; self.data = try! JSONSerialization.data(withJSONObject: value); self.delay = delay; self.onDelivery = onDelivery }
}

private final class FixtureClock: @unchecked Sendable {
    private let lock = NSLock()
    private var date = Date(timeIntervalSince1970: 1793538000)
    func now() -> Date { lock.lock(); defer { lock.unlock() }; return date }
    func advance(_ seconds: TimeInterval) { lock.lock(); date.addTimeInterval(seconds); lock.unlock() }
}

private final class FixtureRouter: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []
    var pairingStatus = "authorized"
    var pairingDelay: TimeInterval = 0
    var onPairingDelivery: (@Sendable () -> Void)?
    var accountFailure = false
    var accountAuthFailure = false
    var foreignPairingURL = false
    var oversizedPairingPNG = false
    private var sourceVersion = "fixture-source-v1"
    private var forceRefresh = false
    private var refreshes = 0
    private var movieDelay: TimeInterval = 0
    private var welcomeChoices: [String] = []
    private var unauthorizedProvider = false
    private var providerFirstDelay: TimeInterval = 0
    private var providerSessionResponses = 0
    private var liveCount = 0
    private var preferredLiveID = "101"
    private var excludedLiveIDs: [String] = []
    private var watchedEpisodeIDs = Set(["301"])
    private var watchedWriteDelay: TimeInterval = 0
    private var watchedWriteStatus = 200
    let expires = "2026-12-01T00:00:00.000Z"
    func changeSource() { lock.lock(); sourceVersion = "fixture-source-v2"; lock.unlock() }
    func requireRefresh() { lock.lock(); forceRefresh = true; lock.unlock() }
    func delayMovie(_ delay: TimeInterval) { lock.lock(); movieDelay = delay; lock.unlock() }
    func denyProvider() { lock.lock(); unauthorizedProvider = true; lock.unlock() }
    func allowProvider(firstBootstrapDelay: TimeInterval = 0) { lock.lock(); unauthorizedProvider = false; providerFirstDelay = firstBootstrapDelay; providerSessionResponses = 0; lock.unlock() }
    func largeLiveCatalog(_ count: Int) { lock.lock(); liveCount = count; lock.unlock() }
    func replaceLiveSource() { lock.lock(); preferredLiveID = "102"; lock.unlock() }
    func excludeLive(_ ids: [String]) { lock.lock(); excludedLiveIDs = ids; lock.unlock() }
    func configureWatched(_ ids: [String] = [], delay: TimeInterval = 0, status: Int = 200) { lock.lock(); watchedEpisodeIDs = Set(ids); watchedWriteDelay = delay; watchedWriteStatus = status; lock.unlock() }
    private func acceptWatched(_ id: String) { lock.lock(); watchedEpisodeIDs.insert(id); lock.unlock() }
    func count(_ path: String) -> Int { lock.lock(); defer { lock.unlock() }; return requests.filter { $0.url?.path == path }.count }
    func allRequests() -> [URLRequest] { lock.lock(); defer { lock.unlock() }; return requests }
    func choices() -> [String] { lock.lock(); defer { lock.unlock() }; return welcomeChoices }
    func response(_ incoming: URLRequest) -> FixtureReply {
        var request = incoming
        if request.httpBody == nil, let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }; var body = Data(), bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable && body.count < 65536 { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; body.append(contentsOf: bytes.prefix(count)) }
            request.httpBody = body
        }
        lock.lock(); requests.append(request); let source = sourceVersion, expired = forceRefresh, delay = movieDelay, denied = unauthorizedProvider, syntheticCount = liveCount, liveID = preferredLiveID, excluded = excludedLiveIDs, watchedIDs = watchedEpisodeIDs, watchedDelay = watchedWriteDelay, watchedStatus = watchedWriteStatus; lock.unlock()
        let path = request.url!.path
        let user: [String: Any] = ["id": "fixture-account", "codeSuffix": "TEST", "status": "active", "hasAssignedLink": true, "hasActiveSubscription": true, "activePackage": ["title": "1 Ay", "endsAt": expires]]
        switch path {
        case "/auth/device/start": return FixtureReply(["requestId": "00000000-0000-0000-0000-000000000002", "deviceSecret": String(repeating: "a", count: 43), "userCode": "BCDF-GHJK", "verificationUri": "https://flixify.vip/cihaz", "verificationUriComplete": foreignPairingURL ? "https://evil.invalid/cihaz?code=BCDF-GHJK" : "https://flixify.vip/cihaz?code=BCDF-GHJK", "qrPngBase64": oversizedPairingPNG ? "iVBORw0KGgoAAAANSUhEUgAABAEAAAQBCAIAAADU4QRPAAAUn0lEQVR4nO3XMQEAMAyAsPo33brYDhIFvMwCAAAl8zsAAAB4ygMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANDiAQAAoMUDAABAiwcAAIAWDwAAAC0eAAAAWjwAAAC0eAAAAGjxAAAA0OIBAACgxQMAAECLBwAAgBYPAAAALR4AAABaPAAAALR4AAAAaPEAAADQ4gEAAKDFAwAAQIsHAACAFg8AAAAtHgAAAFo8AAAAtHgAAABo8QAAANByJ7O5tEyOvVQAAAAASUVORK5CYII=" : "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABKklEQVR4nO3RMQ0AAAjAMPybBhk9WBUs2Wyo0QHfNQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYA3AGoA1AGsA1gCsAVgDsAZgDcAagDUAawDWAKwBWAOwBmANwBqANQBrANYArAFYA7AGYAeU6UsysMvN4wAAAABJRU5ErkJggg==", "expiresAt": expires, "expiresInSeconds": 180, "intervalSeconds": 2])
        case "/auth/device/token":
            var payload: [String: Any] = ["status": pairingStatus]
            if pairingStatus == "authorized" { payload["session"] = ["accessToken": "fixture-paired-access", "refreshToken": "fixture-paired-refresh", "user": ["id": "fixture-account", "codeSuffix": "TEST"]] }
            return FixtureReply(payload, delay: pairingDelay, onDelivery: onPairingDelivery)
        case "/auth/device/cancel": return FixtureReply(["status": "cancelled"])
        case "/auth/device/ack": return FixtureReply(["status": "complete"])
        case "/auth/login-by-code": return FixtureReply(["accessToken": "fixture-access-old", "refreshToken": "fixture-refresh-old", "user": user])
        case "/auth/refresh":
            lock.lock(); refreshes += 1; lock.unlock()
            return FixtureReply(["accessToken": "fixture-access-new", "refreshToken": "fixture-refresh-new", "user": user], delay: 0.05)
        case "/me":
            if accountAuthFailure { return FixtureReply(["reason": "unauthorized"], status: 401) }
            if accountFailure { return FixtureReply(["reason": "unavailable"], status: 503) }
            if expired && request.value(forHTTPHeaderField: "Authorization") != "Bearer fixture-access-new" { return FixtureReply(["reason": "expired"], status: 401) }
            return FixtureReply(["user": user])
        case "/me/provider-session":
            lock.lock(); providerSessionResponses += 1; let bootstrapDelay = providerSessionResponses == 1 ? providerFirstDelay : 0; lock.unlock()
            var payload: [String: Any] = ["accountId": "fixture-account", "sourceVersion": source, "providerOrigin": "https://provider.example", "username": "fixture-user", "password": "fixture-password", "expiresAt": expires, "moviePolicy": "general-audience-only"]
            if !excluded.isEmpty { payload["livePolicy"] = ["revision": String(repeating: "b", count: 64), "excludedIds": excluded] }
            return FixtureReply(payload, delay: bootstrapDelay)
        case "/me/welcome-offer": return FixtureReply(["campaign": WelcomeOffer.campaign, "eligible": false, "state": "not_eligible", "offers": []])
        case "/me/welcome-offer/choice":
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            lock.lock(); welcomeChoices.append(body?["choice"] as? String ?? "invalid"); lock.unlock()
            return FixtureReply(["campaign": WelcomeOffer.campaign, "eligible": false, "state": "redeemed", "offers": []])
        case "/me/personal-library": return FixtureReply(["favorites": [["source": "personal", "sourceVersion": source, "kind": "live", "id": "100"]], "watched": watchedIDs.sorted().map { ["source": "personal", "sourceVersion": source, "kind": "episode", "id": $0, "seriesId": "201"] }])
        case "/me/personal-library/favorites": return FixtureReply(["ok": true])
        case "/me/personal-library/watched":
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any], ref = body?["ref"] as? [String: Any]
            guard request.httpMethod == "PUT", ref?["source"] as? String == "personal", ref?["sourceVersion"] as? String == source, ref?["seriesId"] as? String == "201", ref?["kind"] as? String == "episode", let id = ref?["id"] as? String, ["301", "302"].contains(id) else { return FixtureReply(["ok": false], status: 400) }
            var accepted: (@Sendable () -> Void)?
            if watchedStatus == 200 { accepted = { [self] in acceptWatched(id) } }
            return FixtureReply(["ok": watchedStatus == 200], status: watchedStatus, delay: watchedDelay, onDelivery: accepted)
        case "/player_api.php":
            if denied { return FixtureReply(["error": "blocked"], status: 403) }
            let action = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "action" }?.value
            switch action {
            case "get_vod_categories": return FixtureReply([["category_id": "1", "category_name": "TR | Aksiyon - Macera Filmleri"]])
            case "get_vod_streams": return FixtureReply([["stream_id": "10", "name": "Avengers (2026)", "year": 2026, "category_id": "1", "container_extension": "mp4", "stream_icon": "https://images.example/movie.jpg"]], delay: delay)
            case "get_series_categories": return FixtureReply([["category_id": "2", "category_name": "Diziler"]])
            case "get_series": return FixtureReply([["series_id": "201", "name": "Yeni Dizi (2026)", "year": 2026, "category_id": "2", "cover": "https://images.example/series.jpg"]])
            case "get_series_info": return FixtureReply(["episodes": ["1": [["id": "301", "title": "İlk bölüm", "season": 1, "episode_num": 1, "container_extension": "mp4"]], "2": [["id": "302", "title": "Yeni sezon", "season": 2, "episode_num": 1, "container_extension": "mkv"]]]])
            case "get_live_categories": return FixtureReply([["category_id": "3", "category_name": "TR:ULUSAL"]])
            case "get_live_streams":
                if syntheticCount > 0 { return FixtureReply((0..<syntheticCount).map { ["stream_id": String(1000 + $0), "name": "TR • FixtureStation\($0) FHD", "category_id": "3"] }) }
                return FixtureReply([["stream_id": "100", "name": "TR • ATV HEVC FHD", "category_id": "3"], ["stream_id": liveID, "name": "TR • ATV FHD", "category_id": "3"]])
            case "get_short_epg": return FixtureReply(["epg_listings": [["title": Data("Test yayını".utf8).base64EncodedString(), "start_timestamp": "1793538000", "stop_timestamp": "1793541600"]]])
            default: return FixtureReply(["error": "unknown-action"], status: 500)
            }
        default: return FixtureReply(["error": "unexpected-url"], status: 500)
        }
    }
}

private final class RoutingURLProtocol: URLProtocol, @unchecked Sendable {
    static var router = FixtureRouter()
    private let lock = NSLock()
    private var stopped = false
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let reply = Self.router.response(request)
        DispatchQueue.global().asyncAfter(deadline: .now() + reply.delay) { [self] in
            lock.lock(); let cancelled = stopped; lock.unlock(); guard !cancelled else { return }
            reply.onDelivery?()
            var headers = reply.headers; headers["Content-Length"] = String(reply.data.count); headers["Content-Type"] = "application/json"
            let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: reply.data); client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() { lock.lock(); stopped = true; lock.unlock() }
}

final class RepositoryNetworkTests: XCTestCase {
    func testAuthorizationDeliveredAtFinalDeadlineNeverReachesVault() async throws {
        let clock = FixtureClock(), vault = MemoryVault()
        let repo = repository(vault: vault, pairingClock: { clock.now().timeIntervalSince1970 })
        let saved = expectation(description: "expired delivery is never saved"); saved.isInverted = true
        vault.onSave = { saved.fulfill() }
        _ = try await repo.startDeviceLogin()
        clock.advance(239)
        RoutingURLProtocol.router.onPairingDelivery = { clock.advance(1) }
        let status = try await repo.pollDeviceLogin()
        XCTAssertEqual(status, .expired)
        XCTAssertNil(try vault.load())
        let adopted = await repo.hasDeviceLoginSession(); XCTAssertFalse(adopted)
        for _ in 0..<30 {
            if RoutingURLProtocol.router.count("/auth/device/cancel") > 0 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/token"), 1)
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/cancel"), 1)
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/ack"), 0)
        await fulfillment(of: [saved], timeout: 0.05)
    }

    func testAuthorizationStillAdoptsDuringFinalDeliveryGrace() async throws {
        let clock = FixtureClock(), vault = MemoryVault()
        let repo = repository(vault: vault, pairingClock: { clock.now().timeIntervalSince1970 })
        _ = try await repo.startDeviceLogin(); clock.advance(238)
        RoutingURLProtocol.router.onPairingDelivery = { clock.advance(1) }
        let status = try await repo.pollDeviceLogin()
        XCTAssertEqual(status, .authorized)
        XCTAssertEqual(try vault.load()?.accessToken, "fixture-paired-access")
    }
    func testInactivePairingNeverStartsOrAdoptsLateAuthorization() async throws {
        let vault = MemoryVault(), inactive = repository(vault: vault, pairingActive: { false })
        do { _ = try await inactive.startDeviceLogin(); XCTFail("inactive surface must not start") } catch {}
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/start"), 0)
        let activity = FixtureClock()
        let repo = repository(vault: vault, pairingActive: { activity.now().timeIntervalSince1970 < 1793538001 })
        _ = try await repo.startDeviceLogin(); RoutingURLProtocol.router.pairingDelay = 0.1
        let poll = Task { try await repo.pollDeviceLogin() }
        try await Task.sleep(nanoseconds: 20_000_000); activity.advance(10)
        _ = try? await poll.value; XCTAssertNil(try vault.load())
    }
    func testRejectedAdoptedSessionReleasesPairingForManualLogin() async throws {
        let vault = MemoryVault(), repo = repository(vault: vault)
        _ = try await repo.startDeviceLogin(); _ = try await repo.pollDeviceLogin()
        RoutingURLProtocol.router.accountAuthFailure = true
        do { _ = try await repo.refreshSession(); XCTFail("revoked session must fail") } catch { XCTAssertEqual(error as? FlixifyError, .authentication) }
        let adopted = await repo.hasDeviceLoginSession(); XCTAssertFalse(adopted); XCTAssertNil(try vault.load())
        RoutingURLProtocol.router.accountAuthFailure = false
        _ = try await repo.login(code: "ABCDEFGHIJKLMNOP")
        XCTAssertNotNil(try vault.load())
    }
    func testAdoptedSessionSurvivesSurfaceCancellationAndAcknowledges() async throws {
        let vault = MemoryVault(), repo = repository(vault: vault)
        _ = try await repo.startDeviceLogin()
        _ = try await repo.pollDeviceLogin()
        await repo.cancelDeviceLogin()
        let adopted = await repo.hasDeviceLoginSession()
        XCTAssertTrue(adopted)
        for _ in 0..<30 {
            if RoutingURLProtocol.router.count("/auth/device/ack") > 0 { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        XCTAssertGreaterThan(RoutingURLProtocol.router.count("/auth/device/ack"), 0)
        XCTAssertEqual(try vault.load()?.accessToken, "fixture-paired-access")
    }
    func testNativePNGDimensionBoundRejectsOversizedImage() async throws {
        RoutingURLProtocol.router.oversizedPairingPNG = true
        let repo = repository()
        do { _ = try await repo.startDeviceLogin(); XCTFail("oversized PNG must be rejected before rendering") } catch { XCTAssertEqual(error as? FlixifyError, .invalidData) }
    }
    func testForeignDeviceVerificationURLNeverReachesPresentation() async throws {
        RoutingURLProtocol.router.foreignPairingURL = true
        let repo = repository()
        do { _ = try await repo.startDeviceLogin(); XCTFail("foreign URL must be rejected") } catch { XCTAssertEqual(error as? FlixifyError, .invalidData) }
    }
    func testDeviceLoginAdoptsCodeLessSessionOnceAndRetriesBootstrap() async throws {
        let vault = MemoryVault(), repo = repository(vault: vault)
        RoutingURLProtocol.router.accountFailure = true
        let presentation = try await repo.startDeviceLogin()
        XCTAssertEqual(presentation.userCode, "BCDF-GHJK")
        let status = try await repo.pollDeviceLogin(); XCTAssertEqual(status, .authorized)
        XCTAssertEqual(try vault.load()?.accessToken, "fixture-paired-access")
        do { _ = try await repo.refreshSession(); XCTFail("offline bootstrap must fail") } catch {}
        RoutingURLProtocol.router.accountFailure = false
        let state = try await repo.refreshSession()
        XCTAssertEqual(state.account.codeSuffix, "TEST")
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/token"), 1)
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/login-by-code"), 0)
        await repo.acknowledgeDeviceLogin()
        XCTAssertGreaterThanOrEqual(RoutingURLProtocol.router.count("/auth/device/ack"), 1)
    }
    func testCancelledDeviceResponseCannotReachVaultOrReplaceManualLogin() async throws {
        let vault = MemoryVault(), repo = repository(vault: vault)
        _ = try await repo.startDeviceLogin()
        RoutingURLProtocol.router.pairingDelay = 0.1
        let poll = Task { try await repo.pollDeviceLogin() }
        try await Task.sleep(nanoseconds: 20_000_000)
        await repo.cancelDeviceLogin()
        _ = try await repo.login(code: "ABCDEFGHIJKLMNOP")
        _ = try? await poll.value
        XCTAssertEqual(try vault.load()?.accessToken, "fixture-access-old")
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/ack"), 0)
    }
    func testSecureSaveFailureNeverAcknowledges() async throws {
        let vault = MemoryVault(), repo = repository(vault: vault)
        _ = try await repo.startDeviceLogin(); vault.failSave = true
        do { _ = try await repo.pollDeviceLogin(); XCTFail("must surface secure save failure") } catch { XCTAssertEqual(error as? FlixifyError, .keychain) }
        XCTAssertNil(try vault.load())
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/device/ack"), 0)
    }
    func testDeviceTerminalsAndDeliveryGrace() async throws {
        let repo = repository()
        for status in ["denied", "cancelled", "expired", "complete"] {
            _ = try await repo.startDeviceLogin(); RoutingURLProtocol.router.pairingStatus = status
            let result = try await repo.pollDeviceLogin(); XCTAssertEqual(result.rawValue, status)
        }
        let lifetime = DeviceLoginLifetime(duration: 180, startedAt: 10)
        XCTAssertEqual(lifetime.remaining(at: 190), 0)
        XCTAssertTrue(lifetime.canPoll(at: 249))
        XCTAssertFalse(lifetime.canPoll(at: 250))
    }

    private var directories: [URL] = []
    override func setUp() { super.setUp(); RoutingURLProtocol.router = FixtureRouter() }
    override func tearDown() { for directory in directories { try? FileManager.default.removeItem(at: directory) }; directories.removeAll(); super.tearDown() }
    private func repository(vault: MemoryVault = MemoryVault(), clock: FixtureClock? = nil, pairingActive: @escaping @Sendable () async -> Bool = { true }, pairingClock: @escaping @Sendable () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) -> FlixifyRepository {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("flixify-repository-test-" + UUID().uuidString); directories.append(root)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [RoutingURLProtocol.self]
        return FlixifyRepository(client: HTTPClient(configuration: configuration), vault: vault, cache: MetadataCache(root: root.appendingPathComponent("metadata")), progress: ProgressStore(file: root.appendingPathComponent("progress.json")), now: { clock?.now() ?? Date(timeIntervalSince1970: 1793538000) }, deviceLoginIsActive: pairingActive, deviceLoginClock: pairingClock)
    }
    private func login(_ repository: FlixifyRepository) async throws { let state = try await repository.login(code: "ABCDEFGHIJKLMNOP"); XCTAssertTrue(state.account.canPlay) }

    func testActualContractsUseViewerIPCatalogAndNoLegacyRelay() async throws {
        let repository = repository(); try await login(repository)
        let catalog = try await repository.catalog(.movie)
        XCTAssertEqual(catalog.items.first?.id, "10")
        let playback = try await repository.playback(catalog.items[0])
        XCTAssertEqual(playback.url.host, "provider.example")
        XCTAssertEqual(playback.item.scope, "fixture-account:fixture-source-v1")
        let requests = RoutingURLProtocol.router.allRequests()
        XCTAssertTrue(requests.contains { $0.url?.host == "provider.example" && $0.url?.path == "/player_api.php" })
        XCTAssertFalse(requests.contains { $0.url!.path.contains("/me/native/") || $0.url!.path.contains("/me/catalog/") })
        XCTAssertTrue(requests.filter { $0.url?.host == "provider.example" }.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil })
        XCTAssertFalse(requests.contains { $0.url == playback.url })
    }
    func testLoginSessionPersistRestoreAndLogoutDoNotTouchUserKeychain() async throws {
        let vault = MemoryVault(), repository = repository(vault: vault)
        let empty = try await repository.restore(); XCTAssertNil(empty)
        try await login(repository); XCTAssertEqual(try vault.load()?.accountID, "fixture-account")
        let restored = self.repository(vault: vault), restoredState = try await restored.restore()
        XCTAssertEqual(restoredState?.account.id, "fixture-account")
        await restored.logout(); XCTAssertNil(try vault.load()); let loggedOut = try await restored.restore(); XCTAssertNil(loggedOut)
    }
    func testConcurrentRefreshRequestsShareOneTokenRotation() async throws {
        let repository = repository(); try await login(repository); RoutingURLProtocol.router.requireRefresh()
        async let a = repository.refreshSession(); async let b = repository.refreshSession()
        let results = try await [a, b]; XCTAssertTrue(results.allSatisfy { $0.account.canPlay })
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/refresh"), 1)
    }
    func testLiveFavoriteAliasResolvesAndDeletesOriginalReference() async throws {
        let repository = repository(); try await login(repository)
        let library = try await repository.library()
        XCTAssertEqual(library.favorites.map(\.id), ["101"])
        _ = try await repository.setFavorite(library.favorites[0], favorited: false)
        let deletion = try XCTUnwrap(RoutingURLProtocol.router.allRequests().first { $0.url?.path == "/me/personal-library/favorites" && $0.httpMethod == "DELETE" })
        let payload = try XCTUnwrap(deletion.httpBody)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: payload) as? [String: Any]), ref = try XCTUnwrap(body["ref"] as? [String: Any])
        XCTAssertEqual(ref["id"] as? String, "100")
        XCTAssertEqual(ref["sourceVersion"] as? String, "fixture-source-v1")
    }
    func testSeriesStartsFirstUnwatchedAndKeepsCrossSeasonSuccessor() async throws {
        let repository = repository(); try await login(repository)
        let series = try await repository.catalog(.series).items[0]
        let selected = try await repository.playback(series)
        XCTAssertEqual(selected.item.id, "302")
        let detail = try await repository.seriesDetail(series)
        let first = try await repository.playback(detail.episodes[0])
        XCTAssertEqual(first.nextEpisode?.id, "302"); XCTAssertEqual(first.nextEpisode?.season, 2)
        await repository.saveProgress(detail.episodes[0], seconds: 100, duration: 1000)
        let resumed = try await repository.playback(series)
        XCTAssertEqual(resumed.item.id, "301"); XCTAssertEqual(resumed.resumeSeconds, 100)
    }
    private func waitForWatchedWriteCount(_ count: Int) async throws {
        for _ in 0..<500 {
            if RoutingURLProtocol.router.count("/me/personal-library/watched") >= count { return }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("Watched request did not start")
    }
    func testNearEndExitImmediatelySelectsNextEpisodeAndWritesWatchedOnlyOnce() async throws {
        RoutingURLProtocol.router.configureWatched(delay: 0.15)
        let repository = repository(); try await login(repository)
        let series = try await repository.catalog(.series).items[0], episode = try await repository.seriesDetail(series).episodes[0]
        let initial = try await repository.playback(series); XCTAssertEqual(initial.item.id, "301")
        let save = Task { await repository.saveProgress(episode, seconds: 950, duration: 1000) }
        try await waitForWatchedWriteCount(1)
        await repository.saveProgress(episode, seconds: 951, duration: 1000)
        await repository.markWatched(episode)
        let refreshing = try await repository.library(force: true)
        XCTAssertTrue(refreshing.watchedEpisodeKeys.contains("episode:201:301"))
        let next = try await repository.playback(series)
        XCTAssertEqual(next.item.id, "302"); XCTAssertEqual(next.resumeSeconds, 0)
        await save.value
        await repository.saveProgress(episode, seconds: 1000, duration: 1000)
        await repository.markWatched(episode)
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 1)
    }
    func testNearEndWatchedThresholdUsesTwoMinuteCapForLongEpisodes() async throws {
        RoutingURLProtocol.router.configureWatched()
        let repository = repository(); try await login(repository)
        let series = try await repository.catalog(.series).items[0], episode = try await repository.seriesDetail(series).episodes[0]
        _ = try await repository.playback(series)
        await repository.saveProgress(episode, seconds: 3420, duration: 3600)
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 0)
        await repository.saveProgress(episode, seconds: 3479.99, duration: 3600)
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 0)
        await repository.saveProgress(episode, seconds: 3480, duration: 3600)
        let next = try await repository.playback(series)
        XCTAssertEqual(next.item.id, "302")
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 1)
    }
    func testBelowThresholdInvalidProgressAndMoviesDoNotMarkEpisodesWatched() async throws {
        RoutingURLProtocol.router.configureWatched()
        let repository = repository(); try await login(repository)
        let series = try await repository.catalog(.series).items[0], episode = try await repository.seriesDetail(series).episodes[0]
        let movie = try await repository.catalog(.movie).items[0]
        _ = try await repository.playback(series)
        await repository.saveProgress(movie, seconds: 950, duration: 1000)
        for (seconds, duration) in [(Double.nan, 1000.0), (Double.infinity, 1000), (-1.0, 1000), (950.0, 0), (950.0, Double.infinity), (950.0, Double.nan)] {
            await repository.saveProgress(episode, seconds: seconds, duration: duration)
        }
        await repository.saveProgress(episode, seconds: 949.99, duration: 1000)
        let resumed = try await repository.playback(series)
        XCTAssertEqual(resumed.item.id, "301"); XCTAssertEqual(resumed.resumeSeconds, 949.99)
        let library = try await repository.library()
        XCTAssertFalse(library.watchedEpisodeKeys.contains("episode:201:301"))
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 0)
    }
    func testRejectedWatchedWriteRollsBackOptimisticCompletionAndCanRetry() async throws {
        RoutingURLProtocol.router.configureWatched(delay: 0.08, status: 500)
        let repository = repository(); try await login(repository)
        let series = try await repository.catalog(.series).items[0], episode = try await repository.seriesDetail(series).episodes[0]
        _ = try await repository.playback(series)
        let save = Task { await repository.saveProgress(episode, seconds: 950, duration: 1000) }
        try await waitForWatchedWriteCount(1)
        let pending = try await repository.library(); XCTAssertTrue(pending.watchedEpisodeKeys.contains("episode:201:301"))
        await save.value
        let rejected = try await repository.library(); XCTAssertFalse(rejected.watchedEpisodeKeys.contains("episode:201:301"))
        let original = try await repository.playback(series); XCTAssertEqual(original.item.id, "301")
        RoutingURLProtocol.router.configureWatched()
        await repository.saveProgress(episode, seconds: 950, duration: 1000)
        let next = try await repository.playback(series); XCTAssertEqual(next.item.id, "302")
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/personal-library/watched"), 2)
    }
    func testEPGIsFetchedFromProviderWithCanonicalID() async throws {
        let repository = repository(); try await login(repository)
        let live = try await repository.catalog(.live).items[0], programs = try await repository.epg(live)
        XCTAssertEqual(programs.map(\.title), ["Test yayını"])
        let epg = try XCTUnwrap(RoutingURLProtocol.router.allRequests().last { URLComponents(url: $0.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains(URLQueryItem(name: "action", value: "get_short_epg")) == true })
        let queries = URLComponents(url: epg.url!, resolvingAgainstBaseURL: false)!.queryItems!
        XCTAssertTrue(queries.contains(URLQueryItem(name: "stream_id", value: "101")))
    }
    func testSourceChangeInvalidatesOldItemsAndScopeCache() async throws {
        let repository = repository(); try await login(repository)
        let old = try await repository.catalog(.movie).items[0]
        RoutingURLProtocol.router.changeSource(); let changed = try await repository.refreshSession()
        XCTAssertEqual(changed.sourceScope, "fixture-account:fixture-source-v2")
        do { _ = try await repository.playback(old); XCTFail("Old source opened") } catch { XCTAssertEqual(error as? FlixifyError, .invalidData) }
        let current = try await repository.catalog(.movie)
        XCTAssertEqual(current.items[0].scope, "fixture-account:fixture-source-v2")
    }
    func testLogoutRejectsLateCatalogResponse() async throws {
        let repository = repository(); try await login(repository); RoutingURLProtocol.router.delayMovie(0.1)
        let task = Task { try await repository.catalog(.movie) }
        try await Task.sleep(nanoseconds: 20_000_000); await repository.logout()
        do { _ = try await task.value; XCTFail("Late catalog published after logout") } catch { XCTAssertTrue(error is FlixifyError || error is CancellationError) }
        let loggedOut = try await repository.restore(); XCTAssertNil(loggedOut)
    }
    func testRepeatedCatalogUsesCacheAndProviderDenialDoesNotFallBackToRelay() async throws {
        let repository = repository(); try await login(repository)
        _ = try await repository.catalog(.movie); let count = RoutingURLProtocol.router.count("/player_api.php")
        _ = try await repository.catalog(.movie); XCTAssertEqual(RoutingURLProtocol.router.count("/player_api.php"), count)
        RoutingURLProtocol.router.denyProvider()
        do { _ = try await repository.catalog(.movie, force: true); XCTFail("Denied source allowed") } catch { XCTAssertEqual(error as? FlixifyError, .accessExpired) }
        XCTAssertFalse(RoutingURLProtocol.router.allRequests().contains { $0.url?.path.contains("/me/native/") == true })
    }
    func testWelcomeChoicePostsServerTrialAndMonthlyValues() async throws {
        let repository = repository(); try await login(repository)
        _ = try await repository.acknowledgeWelcome(); _ = try await repository.chooseWelcome(monthly: true)
        XCTAssertEqual(RoutingURLProtocol.router.choices(), ["trial", "monthly"])
        XCTAssertEqual(RoutingURLProtocol.router.count("/auth/register-anon"), 0)
    }
    func testAbsoluteExpiryStopsCachedPlaybackWithoutOpeningMedia() async throws {
        let clock = FixtureClock(), repository = repository(clock: clock); try await login(repository)
        let movie = try await repository.catalog(.movie).items[0]
        clock.advance(40 * 24 * 60 * 60)
        do { _ = try await repository.playback(movie); XCTFail("Expired cached access opened") } catch { XCTAssertEqual(error as? FlixifyError, .accessExpired) }
        XCTAssertFalse(RoutingURLProtocol.router.allRequests().contains { $0.url?.path.hasPrefix("/movie/") == true })
    }
    private func invalidateProvider(_ repository: FlixifyRepository) async throws {
        RoutingURLProtocol.router.denyProvider()
        do { _ = try await repository.catalog(.movie, force: true); XCTFail("Expected provider denial") } catch { XCTAssertEqual(error as? FlixifyError, .accessExpired) }
    }
    private func waitForBootstrapCount(_ count: Int) async throws {
        for _ in 0..<500 {
            if RoutingURLProtocol.router.count("/me/provider-session") >= count { return }
            try await Task.sleep(nanoseconds: 1_000_000)
        }
        XCTFail("Bootstrap request did not start")
    }
    func testColdParallelCatalogAndLibraryShareOneBootstrap() async throws {
        let repository = repository(); try await login(repository); try await invalidateProvider(repository)
        RoutingURLProtocol.router.allowProvider(firstBootstrapDelay: 0.05)
        let before = RoutingURLProtocol.router.count("/me/provider-session")
        async let movies = repository.catalog(.movie)
        async let series = repository.catalog(.series)
        async let library = repository.library(force: true)
        _ = try await (movies, series, library)
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/provider-session") - before, 1)
    }
    func testForcedBootstrapSupersedesDelayedColdResponseWithoutRollingBackSource() async throws {
        let repository = repository(); try await login(repository); try await invalidateProvider(repository)
        RoutingURLProtocol.router.allowProvider(firstBootstrapDelay: 0.15)
        let before = RoutingURLProtocol.router.count("/me/provider-session")
        let cold = Task { try await repository.catalog(.movie) }
        try await waitForBootstrapCount(before + 1)
        RoutingURLProtocol.router.changeSource()
        let refreshed = try await repository.refreshSession()
        XCTAssertEqual(refreshed.sourceScope, "fixture-account:fixture-source-v2")
        let result = try await cold.value
        XCTAssertEqual(result.items.first?.scope, "fixture-account:fixture-source-v2")
        let after = try await repository.catalog(.movie)
        XCTAssertEqual(after.items.first?.scope, "fixture-account:fixture-source-v2")
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/provider-session") - before, 2)
    }
    func testOverlappingForcedBootstrapRefreshesJoinOneForcedRequest() async throws {
        let repository = repository(); try await login(repository)
        RoutingURLProtocol.router.allowProvider(firstBootstrapDelay: 0.05)
        let before = RoutingURLProtocol.router.count("/me/provider-session")
        async let first = repository.refreshSession(); async let second = repository.refreshSession()
        let results = try await [first, second]
        XCTAssertTrue(results.allSatisfy { $0.sourceScope == "fixture-account:fixture-source-v1" })
        XCTAssertEqual(RoutingURLProtocol.router.count("/me/provider-session") - before, 1)
    }
    func testRepeatedLargeLiveSelectionsReusePreparedCatalogue() async throws {
        let repository = repository(); try await login(repository); RoutingURLProtocol.router.largeLiveCatalog(5000)
        let first = try await repository.catalog(.live); XCTAssertEqual(first.items.count, 5000)
        let requests = RoutingURLProtocol.router.count("/player_api.php"), start = Date()
        for _ in 0..<12 { let repeated = try await repository.catalog(.live); XCTAssertEqual(repeated.items.first?.id, first.items.first?.id) }
        XCTAssertLessThan(Date().timeIntervalSince(start), 8, "Cached selections must avoid catalogue-sized cleanup work")
        XCTAssertEqual(RoutingURLProtocol.router.count("/player_api.php"), requests)
        let playback = try await repository.playback(first.items[0]); XCTAssertEqual(playback.item.id, first.items[0].id)
    }
    func testFreshLiveFeedReplacesPreparedSelectionAtSameClockInstant() async throws {
        let repository = repository(); try await login(repository)
        let first = try await repository.catalog(.live); XCTAssertEqual(first.items.first?.id, "101")
        RoutingURLProtocol.router.replaceLiveSource()
        let fresh = try await repository.catalog(.live, force: true); XCTAssertEqual(fresh.items.first?.id, "102")
        let again = try await repository.catalog(.live); XCTAssertEqual(again.items.first?.id, "102")
        let favorites = try await repository.library(force: true); XCTAssertEqual(favorites.favorites.first?.id, "102")
    }
    func testNewLivePolicyReprojectsMemoryAndFavoriteAliasesWithoutRefetch() async throws {
        let repository = repository(); try await login(repository)
        let first = try await repository.catalog(.live); XCTAssertEqual(first.items.first?.id, "101")
        let metadata = RoutingURLProtocol.router.count("/player_api.php")
        RoutingURLProtocol.router.excludeLive(["101"]); _ = try await repository.refreshSession()
        let changed = try await repository.catalog(.live); XCTAssertEqual(changed.items.first?.id, "100")
        XCTAssertEqual(RoutingURLProtocol.router.count("/player_api.php"), metadata)
        let favorites = try await repository.library(force: true); XCTAssertEqual(favorites.favorites.first?.id, "100")
    }
    func testRestoreSupersedesBootstrapOwnedByPreviousAuthGeneration() async throws {
        let repository = repository(); try await login(repository)
        RoutingURLProtocol.router.allowProvider(firstBootstrapDelay: 0.15)
        let before = RoutingURLProtocol.router.count("/me/provider-session")
        let old = Task { try await repository.refreshSession() }
        try await waitForBootstrapCount(before + 1); RoutingURLProtocol.router.changeSource()
        let restored = try await repository.restore(); XCTAssertEqual(restored?.sourceScope, "fixture-account:fixture-source-v2")
        do { _ = try await old.value; XCTFail("Previous auth generation accepted") } catch { XCTAssertEqual(error as? FlixifyError, .staleSource) }
        let items = try await repository.catalog(.movie); XCTAssertEqual(items.items.first?.scope, "fixture-account:fixture-source-v2")
    }
}
