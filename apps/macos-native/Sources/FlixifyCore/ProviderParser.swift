import Foundation
import CoreFoundation

enum Text {
    private static let regexes: NSCache<NSString, NSRegularExpression> = { let cache = NSCache<NSString, NSRegularExpression>(); cache.countLimit = 256; return cache }()
    static func regex(_ pattern: String) -> NSRegularExpression? {
        if let cached = regexes.object(forKey: pattern as NSString) { return cached }
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }; regexes.setObject(regex, forKey: pattern as NSString); return regex
    }
    static func clean(_ value: Any?, max: Int = 512) -> String {
        guard let value = value as? String, value.count <= max else { return "" }
        return replace(value, #"[\x00-\x1f\x7f-\x9f]"#, " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
    static func replace(_ value: String, _ pattern: String, _ replacement: String) -> String {
        regex(pattern)?.stringByReplacingMatches(in: value, range: NSRange(value.startIndex..., in: value), withTemplate: replacement) ?? value
    }
    static func matches(_ value: String, _ pattern: String) -> Bool { regex(pattern)?.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil }
    static func fold(_ value: String) -> String {
        value.precomposedStringWithCompatibilityMapping.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).replacingOccurrences(of: "ı", with: "i").lowercased()
    }
    static func search(_ value: String) -> String { replace(fold(value), #"[^\p{L}\p{N}]"#, "") }
    static func capture(_ value: String, _ pattern: String, group: Int = 1) -> String? {
        guard let regex = regex(pattern), let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)), group < match.numberOfRanges, let range = Range(match.range(at: group), in: value) else { return nil }
        return String(value[range])
    }
}

public enum CatalogReleaseYear {
    public static func title(_ value: String) -> Int {
        let text = value.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let regex = try? NSRegularExpression(pattern: #"\(((?:19|20)[0-9]{2})\)|\[((?:19|20)[0-9]{2})\]"#) else { return 0 }
        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))
        var years = Set<Int>()
        for match in matches {
            let index = match.range(at: 1).location == NSNotFound ? 2 : 1
            if let range = Range(match.range(at: index), in: text), let year = Int(text[range]) { years.insert(year) }
        }
        guard years.count == 1, let last = matches.last, NSMaxRange(last.range) == text.utf16.count else { return 0 }
        return years.first ?? 0
    }
    public static func metadata(_ values: [String: Any], title: String) -> Int {
        var found = Set<Int>()
        for field in ["year", "release_year", "releaseYear", "releaseDate", "release_date"] {
            guard let value = values[field], !(value is NSNull) else { continue }
            if let text = value as? String, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            var year = 0
            if field == "releaseDate" || field == "release_date" {
                if let date = value as? String {
                    let text = date.trimmingCharacters(in: .whitespacesAndNewlines)
                    if Text.matches(text, #"^((?:19|20)[0-9]{2})-([0-9]{2})-([0-9]{2})(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\.[0-9]{1,3})?)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9]))?$"#) {
                        let parts = text.prefix(10).split(separator: "-").compactMap { Int($0) }
                        if parts.count == 3 {
                            var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                            let components = DateComponents(year: parts[0], month: parts[1], day: parts[2])
                            if let date = calendar.date(from: components), calendar.dateComponents([.year, .month, .day], from: date) == components { year = parts[0] }
                        }
                    }
                }
            } else if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.rounded() == n.doubleValue, (1900...2099).contains(n.intValue) { year = n.intValue }
            else if let s = value as? String, Text.matches(s.trimmingCharacters(in: .whitespacesAndNewlines), #"^(?:19|20)[0-9]{2}$"#) { year = Int(s.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0 }
            if year == 0 { return 0 }; found.insert(year)
        }
        return found.count > 1 ? 0 : found.first ?? self.title(title)
    }
}

struct ProviderSession: Sendable {
    let accountID: String
    let sourceVersion: String
    let origin: String
    let username: String
    let password: String
    var expiresAt: Date
    let excludedLiveIDs: Set<String>
    let policyRevision: String?
    var scope: String { accountID + ":" + sourceVersion }
    func sameIdentity(_ other: ProviderSession) -> Bool { accountID == other.accountID && sourceVersion == other.sourceVersion && origin == other.origin && username == other.username && password == other.password }
}

enum ProviderParser {
    static let extensions: Set<String> = ["mp4", "mkv", "avi", "m3u8", "ts"]
    static let movieCategories: Set<String> = Set(["Vizyondaki Filmler", "Yüksek Puanlı Filmler", "Yerli Filmler", "Yeşilçam Filmleri", "Kemal Sunal Filmleri", "Film Serileri / Box Setler", "Aksiyon - Macera Filmleri", "Macera", "Komedi", "Dram - Romantik", "Romantik", "Korku - Gerilim", "Suç / Polisiye", "Bilim Kurgu - Fantastik Filmler", "Fantastik", "Tarih / Savaş", "Gerçek Hikâye / Biyografi", "Vahşi Batı / Western", "Müzikal", "Belgesel", "Aile", "Animasyon / Çizgi Film", "Anime", "Aksiyon (Yabancı)", "Aksiyon (Yerli)", "Amazon", "Animasyon", "Apple TV+", "Bilim Kurgu", "Disney+", "Dram (Yabancı)", "Dram (Yerli)", "Filmler", "Gerilim (Yabancı)", "HBO Max", "Komedi (Yabancı)", "Komedi (Yerli)", "Korku (Yabancı)", "Korku (Yerli)", "MUBI FILMLER", "Müzik", "Netflix", "Savaş", "Seri Filmler", "Sinema", "Suç", "Tabii"].map(categoryLabel))
    static func categoryLabel(_ s: String) -> String { Text.replace(Text.fold(s), #"^tr\s*[|:]\s*"#, "").trimmingCharacters(in: .whitespacesAndNewlines) }
    static func object(_ data: Data) throws -> [String: Any] {
        guard data.count <= 20 * 1024 * 1024 else { throw FlixifyError.limit }
        try StrictJSON.validate(data)
        guard data.count <= 20 * 1024 * 1024, let object = try? JSONSerialization.jsonObject(with: data), let dictionary = object as? [String: Any] else { throw FlixifyError.invalidData }
        return dictionary
    }
    static func array(_ data: Data, maximum: Int = 50000) throws -> [[String: Any]] {
        guard data.count <= 20 * 1024 * 1024 else { throw FlixifyError.limit }
        try StrictJSON.validate(data)
        guard data.count <= 20 * 1024 * 1024, let object = try? JSONSerialization.jsonObject(with: data), let array = object as? [Any], array.count <= maximum else { throw FlixifyError.invalidData }
        return array.compactMap { $0 as? [String: Any] }
    }
    static func secret(_ value: Any?, max: Int) throws -> String {
        guard let text = value as? String, !text.isEmpty, text.count <= max, !Text.matches(text, #"[\x00-\x1f\x7f]"#) else { throw FlixifyError.invalidData }; return text
    }
    static func id(_ value: Any?) -> String {
        if let s = value as? String { return Text.matches(s, #"^[1-9][0-9]{0,14}$"#) ? s : "" }
        if let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.rounded() == n.doubleValue, n.doubleValue >= 1, n.doubleValue <= 999999999999999 { return String(Int64(n.doubleValue)) }
        return ""
    }
    private static func positive(_ value: Any?, maximum: Int) -> Int {
        let text = (value as? String) ?? id(value)
        guard Text.matches(text, #"^[0-9]{1,5}$"#), let number = Int(text), (1...maximum).contains(number) else { return 0 }; return number
    }
    private static func integer(_ value: Any?, maximum: Int) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.intValue), (0...maximum).contains(number.intValue) else { return nil }; return number.intValue
    }
    static func bool(_ value: Any?) -> Bool? { guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }; return n.boolValue }
    static func date(_ value: Any?) -> Date? {
        guard let text = value as? String, text.count <= 64 else { return nil }
        let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = format.date(from: text) { return date }; format.formatOptions = [.withInternetDateTime]; return format.date(from: text)
    }
    static func artwork(_ value: Any?) -> String {
        guard let s = value as? String, s.count <= 2048, let c = URLComponents(string: s), c.scheme == "https", c.host != nil, c.user == nil, c.password == nil, c.query == nil, c.fragment == nil, !s.contains("\\") else { return "" }; return c.url?.absoluteString ?? ""
    }
    static func bootstrap(_ raw: [String: Any], now: Date) throws -> ProviderSession {
        let account = try secret(raw["accountId"], max: 256), version = try secret(raw["sourceVersion"], max: 128)
        let username = try secret(raw["username"], max: 256), password = try secret(raw["password"], max: 2048)
        guard !account.contains(":"), Text.matches(version, #"^[A-Za-z0-9_-]{1,128}$"#), let origin = raw["providerOrigin"] as? String, let parts = URLComponents(string: origin), parts.scheme == "https", let host = parts.host, !host.isEmpty, parts.user == nil, parts.password == nil, parts.path.isEmpty, parts.query == nil, parts.fragment == nil, !origin.contains("\\"), parts.port == nil || (1...65535).contains(parts.port!), parts.port != 443, origin == "https://" + host.lowercased() + (parts.port.map { ":\($0)" } ?? ""), raw["moviePolicy"] as? String == "general-audience-only", let expiry = date(raw["expiresAt"]), expiry > now else { throw FlixifyError.invalidData }
        var excluded = Set<String>(), revision: String?
        if let policy = raw["livePolicy"] as? [String: Any], let rev = policy["revision"] as? String, Text.matches(rev, #"^[a-f0-9]{64}$"#), let ids = policy["excludedIds"] as? [String], ids.count <= 50000, ids.allSatisfy({ !id($0).isEmpty }) { excluded = Set(ids); revision = rev }
        return ProviderSession(accountID: account, sourceVersion: version, origin: origin, username: username, password: password, expiresAt: expiry, excludedLiveIDs: excluded, policyRevision: revision)
    }
    static func catalog(kind: MediaKind, rows: [[String: Any]], groups: [[String: Any]], scope: String) throws -> Catalog {
        guard kind != .episode, rows.count <= 50000, groups.count <= 50000 else { throw FlixifyError.limit }
        var categories: [String: String] = [:], order: [String] = []
        for row in groups {
            let key = id(row["category_id"]), title = Text.clean(row["category_name"], max: 256)
            guard !key.isEmpty, !title.isEmpty else { continue }
            if let old = categories[key], old != title { throw FlixifyError.invalidData }
            if categories[key] == nil { order.append(key) }; categories[key] = title
        }
        var items: [CatalogItem] = [], seen = Set<String>(), usedGroups = Set<String>()
        for row in rows {
            let key = id(row[kind == .series ? "series_id" : "stream_id"]), title = Text.clean(row["name"]), categoryID = id(row["category_id"]), category = categories[categoryID] ?? ""
            guard !key.isEmpty, !title.isEmpty, !seen.contains(key), !Text.matches(title.lowercased(), #"^(?:data:image/|/9j/|ivborw0kggo|r0lgod)"#), !(title.count >= 160 && Text.matches(title, #"^[A-Za-z0-9+/=\s]+$"#)) else { continue }
            let declaration = row["container_extension"], declared = declaration as? String ?? "", normalized = declared.lowercased()
            let missing = declaration == nil || declaration is NSNull || (declaration as? String) == ""
            let ext = extensions.contains(normalized) ? normalized : kind == .live ? (missing ? "ts" : "m3u8") : ""
            if kind == .movie && (category.isEmpty || !movieCategories.contains(categoryLabel(category)) || ext.isEmpty) { continue }
            items.append(CatalogItem(id: key, kind: kind, title: title, categoryID: categoryID, categoryName: category, artworkURL: artwork(row["stream_icon"] is NSNull || row["stream_icon"] == nil ? row["cover"] : row["stream_icon"]), extension: ext, scope: scope, description: Text.clean(row["plot"], max: 8192), releaseYear: kind == .live ? 0 : CatalogReleaseYear.metadata(row, title: title)))
            seen.insert(key); usedGroups.insert(categoryID)
        }
        return Catalog(kind: kind, items: items, categories: order.filter { usedGroups.contains($0) }.map { Category(id: $0, title: categories[$0]!) })
    }
    static func series(_ raw: [String: Any], parent: CatalogItem) throws -> SeriesDetail {
        guard parent.kind == .series, let buckets = raw["episodes"] as? [String: Any], buckets.count <= 5000 else { throw FlixifyError.invalidData }
        var episodes: [CatalogItem] = [], seen = Set<String>(), count = 0
        for (_, value) in buckets {
            guard let list = value as? [Any], list.count <= 5000 else { throw FlixifyError.invalidData }; count += list.count
            guard count <= 5000 else { throw FlixifyError.limit }
            for value in list {
                guard let row = value as? [String: Any] else { continue }
                let key = id(row["id"]), ext = (row["container_extension"] as? String ?? "").lowercased()
                let season = positive(row["season"], maximum: 999), number = positive(row["episode_num"], maximum: 9999)
                guard !key.isEmpty, !seen.contains(key), extensions.contains(ext), (1...999).contains(season), (1...9999).contains(number) else { continue }
                let info = row["info"] as? [String: Any] ?? [:], title = Text.clean(row["title"])
                episodes.append(CatalogItem(id: key, kind: .episode, title: title.isEmpty ? "\(number). Bölüm" : title, categoryID: parent.categoryID, categoryName: parent.categoryName, artworkURL: artwork(info["movie_image"]).isEmpty ? parent.artworkURL : artwork(info["movie_image"]), extension: ext, scope: parent.scope, seriesID: parent.id, season: season, episode: number, description: Text.clean(info["plot"], max: 8192)))
                seen.insert(key)
            }
        }
        episodes.sort { $0.season == $1.season ? ($0.episode == $1.episode ? $0.id.compare($1.id, options: .numeric) == .orderedAscending : $0.episode < $1.episode) : $0.season < $1.season }
        let numbers = Set(episodes.map(\.season)).sorted()
        return SeriesDetail(series: parent, seasons: numbers.map { number in Season(number: number, episodes: episodes.filter { $0.season == number }) })
    }
    static func reference(_ item: CatalogItem, scope: String) throws -> [String: Any] {
        guard item.scope == scope, !id(item.id).isEmpty, let split = scope.lastIndex(of: ":"), split > scope.startIndex, item.kind == .episode ? !id(item.seriesID).isEmpty : item.seriesID.isEmpty, item.extension.isEmpty || extensions.contains(item.extension) else { throw FlixifyError.invalidData }
        var value: [String: Any] = ["source": "personal", "sourceVersion": String(scope[scope.index(after: split)...]), "kind": item.kind.rawValue, "id": item.id]
        if !item.extension.isEmpty { value["extension"] = item.extension }; if item.kind == .episode { value["seriesId"] = item.seriesID }; return value
    }
    static func mediaURL(_ item: CatalogItem, session: ProviderSession, now: Date) throws -> URL {
        _ = try reference(item, scope: session.scope)
        guard session.expiresAt > now, item.kind != .series, !session.excludedLiveIDs.contains(item.kind == .live ? item.id : ""), extensions.contains(item.extension) else { throw FlixifyError.accessExpired }
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let username = session.username.addingPercentEncoding(withAllowedCharacters: allowed), let password = session.password.addingPercentEncoding(withAllowedCharacters: allowed), let url = URL(string: session.origin + "/" + (item.kind == .episode ? "series" : item.kind.rawValue) + "/" + username + "/" + password + "/" + item.id + "." + item.extension) else { throw FlixifyError.invalidData }; return url
    }
    static func epg(_ raw: [String: Any]) throws -> [Programme] {
        guard let rows = raw["epg_listings"] as? [Any], rows.count <= 24 else { throw FlixifyError.invalidData }
        return rows.compactMap { value -> Programme? in
            guard let row = value as? [String: Any], let encoded = row["title"] as? String, encoded.count <= 1024, let bytes = Data(base64Encoded: encoded), let title = String(data: bytes, encoding: .utf8), let start = Double(String(describing: row["start_timestamp"] ?? "")), let end = Double(String(describing: row["stop_timestamp"] ?? row["end_timestamp"] ?? "")), start >= 946684800, end <= 4102444800, end > start, end - start <= 86400 else { return nil }
            let clean = Text.clean(title); return clean.isEmpty ? nil : Programme(title: clean, startsAt: Date(timeIntervalSince1970: start), endsAt: Date(timeIntervalSince1970: end))
        }.sorted { $0.startsAt < $1.startsAt }
    }
    static func welcome(_ raw: [String: Any]) throws -> WelcomeOffer {
        guard raw["campaign"] as? String == WelcomeOffer.campaign, let eligible = bool(raw["eligible"]), let state = raw["state"] as? String, ["pending", "dismissed", "not_eligible", "redeemed"].contains(state), eligible == (state == "pending" || state == "dismissed"), let offers = raw["offers"] as? [[String: Any]], offers.count == (eligible ? 2 : 0) else { throw FlixifyError.invalidData }
        var users = Set<Int>()
        for offer in offers {
            let n = integer(offer["users"], maximum: 2) ?? 0
            guard [1, 2].contains(n), users.insert(n).inserted, offer["id"] as? String == WelcomeOffer.campaign, offer["currency"] as? String == "try", integer(offer["durationMonths"], maximum: 12) == 1, integer(offer["amountMinor"], maximum: 100000) == (n == 1 ? 12500 : 19950), integer(offer["regularAmountMinor"], maximum: 100000) == (n == 1 ? 25000 : 39900), offer["packageSlug"] as? String == (n == 1 ? "1-ay" : "1-ay-2-kullanici") else { throw FlixifyError.invalidData }
        }
        let counts = raw["catalogue"] as? [String: Any]
        if eligible && counts == nil { throw FlixifyError.invalidData }
        func count(_ field: String) throws -> Int {
            guard let counts = counts else { return 0 }; guard let number = counts[field] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue == Double(number.intValue), (0...1000000).contains(number.intValue) else { throw FlixifyError.invalidData }; return number.intValue
        }
        return try WelcomeOffer(state: state, eligible: eligible, movies: count("movies"), live: count("live"), series: count("series"))
    }
}
