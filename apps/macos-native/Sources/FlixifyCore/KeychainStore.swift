import Foundation
import Security

struct StoredSession: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
    let accountID: String
    let codeSuffix: String
}

protocol SessionVault: Sendable {
    func load() throws -> StoredSession?
    func save(_ session: StoredSession) throws
    func clear()
    func installationID() throws -> String
}

struct KeychainStore: SessionVault {
    let service = "vip.flixify.mac.session"
    private func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }
    private func read(_ account: String) throws -> Data? {
        var request = query(account); request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count <= 65536 else { throw FlixifyError.keychain }; return data
    }
    private func write(_ data: Data, account: String) throws {
        let request = query(account), values = [kSecValueData as String: data]
        let update = SecItemUpdate(request as CFDictionary, values as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw FlixifyError.keychain }
        var insertion = request; insertion[kSecValueData as String] = data; insertion[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { throw FlixifyError.keychain }
    }
    func load() throws -> StoredSession? {
        guard let data = try read("session") else { return nil }
        guard let stored = try? JSONDecoder().decode(StoredSession.self, from: data), !stored.accessToken.isEmpty, !stored.refreshToken.isEmpty, !stored.accountID.isEmpty else { clear(); return nil }; return stored
    }
    func save(_ session: StoredSession) throws { try write(JSONEncoder().encode(session), account: "session") }
    func clear() { SecItemDelete(query("session") as CFDictionary) }
    func installationID() throws -> String {
        if let data = try read("installation"), let text = String(data: data, encoding: .utf8), UUID(uuidString: text) != nil { return text }
        let id = UUID().uuidString.lowercased(); try write(Data(id.utf8), account: "installation"); return id
    }
}
