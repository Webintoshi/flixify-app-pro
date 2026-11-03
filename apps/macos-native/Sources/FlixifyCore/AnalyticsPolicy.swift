import Foundation
import CoreFoundation

public final class AnalyticsPolicy {
    public static let version = 1
    public private(set) var epoch = 0
    public private(set) var enabled = false
    private let configured: Bool
    private let sink: (String, [String: Any]) -> Void
    private static let events: Set<String> = ["login", "logout", "screen_view", "search", "select_content", "category_select", "catalog_page_loaded", "add_to_wishlist", "remove_from_wishlist", "trial_select", "welcome_offer_select", "select_item", "package_open", "update_offered", "update_selected", "update_downloaded", "playback_request", "video_start", "video_progress", "video_complete", "playback_buffer", "playback_error", "playback_end"]
    private static let screens: Set<String> = ["home", "live", "movies", "series", "favorites", "account", "login", "welcome", "player", "settings"]
    public init(configured: Bool, sink: @escaping (String, [String: Any]) -> Void) { self.configured = configured; self.sink = sink; enabled = configured }
    public func choice(accepted: Bool, version: Int) { epoch += 1; enabled = configured && accepted && version == Self.version }
    public static func catalogLabel(_ value: String,maximum: Int = 100) -> String? {
        guard value.utf8.count <= 4096 else { return nil }; let s=value.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !s.isEmpty,!value.unicodeScalars.contains(where:{ $0.properties.generalCategory == .control || $0.properties.generalCategory == .format || $0.properties.generalCategory == .lineSeparator || $0.properties.generalCategory == .paragraphSeparator }) else { return nil }
        let lower=s.lowercased()
        guard s.range(of:"(?:https?|ftp|mailto|data|file|javascript):",options:[.regularExpression,.caseInsensitive]) == nil,!lower.contains("://"),!lower.contains("www."),!lower.contains("@"),s.range(of:"%[0-9a-f]{2}",options:[.regularExpression,.caseInsensitive]) == nil,s.range(of:"(?:username|password|token|secret|session)(?:_id)?\\s*[=:]",options:[.regularExpression,.caseInsensitive]) == nil,s.range(of:"(?<![A-Za-z0-9])[A-Z0-9]{16}(?![A-Za-z0-9])",options:.regularExpression) == nil else { return nil }
        return String(s.prefix(maximum))
    }
    public func event(_ name: String, _ values: [String: Any] = [:], epoch: Int? = nil) {
        guard enabled, epoch == nil || epoch == self.epoch, Self.events.contains(name) else { return }
        var safe = [String: Any]()
        for (key, value) in values {
            if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() {
                let max: Double = key == "query_length" ? 500 : key == "result_count" ? 100_000 : key == "progress_percent" ? 100 : key == "package_users" ? 2 : key == "package_months" ? 12 : 86_400_000
                if ["query_length", "result_count", "startup_ms", "buffer_ms", "watch_ms", "progress_percent", "package_users", "package_months"].contains(key), n.doubleValue.isFinite, n.doubleValue >= 0, n.doubleValue <= max { safe[key] = n.int64Value }
            } else if let s = value as? String {
                if ["content_name","category_name"].contains(key) { if let label=Self.catalogLabel(s,maximum:key == "content_name" ? 100:80) { safe[key]=label };continue }
                if key == "screen_name" && Self.screens.contains(s) || key == "content_type" && ["live", "movie", "series", "episode"].contains(s) || key == "reason" && ["closed", "completed", "replaced", "network", "decoder", "access", "recovery", "unknown"].contains(s) || key == "offer_id" && s == "welcome-monthly-50-v1" || ["content_id", "category_id"].contains(key) && s.range(of: "^[0-9a-f]{24}$", options: .regularExpression) != nil { safe[key] = s }
            }
        }
        sink(name, safe)
    }
}
