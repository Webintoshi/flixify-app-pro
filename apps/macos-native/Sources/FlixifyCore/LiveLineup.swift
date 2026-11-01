import Foundation

public struct LiveInfo: Equatable, Sendable {
    public let countryID: String
    public let categoryID: String
    public let name: String
    public let position: Double
}

struct LiveProjection {
    let catalog: Catalog
    let canonicalByID: [String: String]
    let originals: [String: CatalogItem]
    func resolve(_ id: String) -> CatalogItem? {
        guard let canonical = canonicalByID[id] else { return nil }; return catalog.items.first { $0.id == canonical }
    }
}

public enum LiveLineup {
    public static let countries = LiveLineupData.countryOrder
    public static let categoryIDs = ["national", "news", "sports", "kids", "documentary", "music", "local", "themed", "radio"]
    private static let categoryTitles = ["Ulusal", "Haber", "Spor", "Çocuk", "Belgesel", "Müzik", "Yerel", "7/24", "Radyo"]
    private static let national: Set<String> = ["trt1", "kanald", "atv", "showtv", "now", "startv", "kanal7", "tv8", "beyaztv", "cnbce", "diyanettv", "a2", "teve2", "tv85", "trt2", "360", "tlc", "dmax", "trt4k"]
    private static let news: Set<String> = ["trthaber", "cnnturk", "ntv", "ahaber", "haberturk", "sozcutv", "halktv", "tele1", "tv100", "24", "tgrthaber", "apara", "ekoturk", "bloomberght", "ulusal1", "ulusalkanal"]
    private static let positions = LiveLineupData.referencePositions.reduce(into: [String: Double]()) { $0[station($1.key)] = $1.value }
    private static let aliases = LiveLineupData.aliases.reduce(into: [String: String]()) { $0[station($1.key)] = station($1.value) }
    private static let technical = #"(?i)\b(?:full[\s_-]*hd|fhd|1080[pi]|720[pi]?|480[pi]?|576[pi]?|2160[pi]?|4k|uhd|hd|sd|raw|hevc|h[.\s_-]?26[45]|x26[45]|avc|mpeg[\s_-]*ts|m3u8|hls|(?:25|30|50|60|100|120)\s*(?:fps|hz)|\d+(?:[.,]\d+)?\s*(?:kbps|mbps|mbit))\b"#
    private static let event = #"(?i)\b(?:macta(?:\s+aktif)?|sadece\s+(?:ist(?:anbul)?[.\s]*)?mac(?:lari)?|mac(?:lar)?\s*(?:zamani|saatinde|gunu|aktif)|yayin\s*(?:zamani|sirasinda)\s*(?:aktif|acik)?|event[\s_-]*only|live[\s_-]*events?[\s_-]*only|only\s+(?:during\s+)?events?|only\s+matches|matches\s+only)\b"#
    private static let eventDisplay = #"(?i)(?:ma[çc]ta(?:\s+akt[iıİ]f)?|sadece\s+(?:[iıİ]st(?:anbul)?[.\s]*)?ma[çc](?:lar[ıi])?|ma[çc](?:lar)?\s*(?:zaman[ıi]|saat[iıİ]nde|g[üu]n[üu]|akt[iıİ]f)|yay[ıi]n\s*(?:zaman[ıi]|s[ıi]ras[ıi]nda)\s*(?:akt[iıİ]f|a[çc][ıi]k)?|event[\s_-]*only|live[\s_-]*events?[\s_-]*only|only\s+(?:during\s+)?events?|only\s+matches|matches\s+only)"#
    private static let low = #"(?i)\b(?:kota\s*dostu|low(?:\s+(?:bitrate|bandwidth))?|d[üu][şs][üu]k(?:\s+(?:bitrate|bant))?)\b"#
    private static let smallcapMap = Dictionary(uniqueKeysWithValues: zip(Array("ꜰʜᴅᴇᴠᴄʀᴀᴡꜱᴘᴛɪɴᴏᴜʟᴋᴍʙɢᴊ"), Array("FHDEVCRAWSPTINOULKMBGJ")))
    private struct Description {
        let name: String
        let groupKey: String
        let country: String?
        let score: [Int]
    }
    private static func smallcaps(_ input: String) -> String {
        String(input.precomposedStringWithCompatibilityMapping.map { smallcapMap[$0] ?? $0 })
    }
    public static func search(_ value: String) -> String { Text.search(smallcaps(value)) }
    private static func station(_ value: String) -> String { let key = search(value); return LiveLineupData.stationNames[key] ?? key }
    private static func code(_ raw: String) -> String? {
        let key = raw.uppercased(); return LiveLineupData.countryAliases[key] ?? (LiveLineupData.isoCountries.contains(key) ? key : nil)
    }
    private static func prefix(_ raw: String) -> (country: String?, quality: String, rest: String) {
        for pattern in [#"(?i)^([a-z]{2,3}?)\s*(fhd|fullhd|hd|sd|uhd|4k|1080[pi]|720p)(?:\s*[•·|:\-]+\s*|\s+)"#, #"(?i)^([a-z]{2,3})\s*[•·|:\-]+\s*"#] {
            guard let regex = Text.regex(pattern), let match = regex.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)), let range = Range(match.range(at: 1), in: raw), let country = code(String(raw[range])), let matched = Range(match.range, in: raw) else { continue }
            let quality: String = match.numberOfRanges > 2 ? Range(match.range(at: 2), in: raw).map { String(raw[$0]) } ?? "" : ""
            return (country, quality, String(raw[matched.upperBound...]))
        }
        return (nil, "", raw)
    }
    private static func groupCountry(_ raw: String) -> String? {
        if let country = prefix(raw).country { return country }
        if let leading = Text.capture(raw, #"(?i)^([a-z]{2,3})(?:\s|$)"#), let country = code(leading) { return country }
        let normalized = Text.replace(Text.fold(raw), #"[^\p{L}\p{N}\s]"#, " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        for (country, names) in LiveLineupData.countryNames {
            if names.split(separator: "|").contains(where: { normalized == $0 || normalized.hasPrefix($0 + " ") }) { return country }
        }
        return nil
    }
    private static func removableNote(_ note: String) -> Bool {
        let folded = Text.fold(note).trimmingCharacters(in: .whitespacesAndNewlines)
        if Text.matches(folded, #"^(?:fubotv|fibra|sat|orange|live\s*events?)$"#) || Text.matches(folded, event) || Text.matches(folded, low) { return true }
        let remainder = Text.replace(Text.replace(Text.replace(folded, technical, " "), #"\b7\s*[/x]\s*24(?:\s+canli)?\b"#, " "), #"[\s.,:;_\-/]+"#, "")
        return !folded.isEmpty && remainder.isEmpty
    }
    private static func describe(_ item: CatalogItem) -> Description {
        var original = Text.replace(smallcaps(item.sourceTitle.isEmpty ? item.title : item.sourceTitle), #"(?i)<br\s*/?\s*>|[\x00-\x1f\x7f-\x9f]"#, " ").trimmingCharacters(in: .whitespacesAndNewlines)
        original = Text.replace(original, #"(?i)^\s*\[\s*fubotv\s*\]\s*"#, "")
        original = Text.replace(original, #"(?i)\b(fhd|uhd|hevc|hd|sd)(?=7\s*/\s*24)"#, "$1 ")
        original = Text.replace(original, #"(?i)(7\s*/\s*24)(?=canl[ıi])"#, "$1 ")
        let p = prefix(original), fromGroup = groupCountry(smallcaps(item.categoryName)), country = p.country ?? fromGroup, analysis = Text.fold(p.quality + " " + p.rest)
        let hevc = Text.matches(analysis, #"\b(?:hevc|h[.\s_-]?265|x265)\b"#), raw = Text.matches(analysis, #"\braw\b"#)
        let quality = Text.matches(analysis, #"\b(?:4k|uhd|2160[pi]?)\b"#) ? 5 : Text.matches(analysis, #"\b(?:sd|480[pi]?|576[pi]?)\b"#) ? 4 : Text.matches(analysis, #"\b720[pi]?\b"#) ? 1 : Text.matches(analysis, #"\b(?:fhd|full[\s_-]*hd|1080[pi])\b"#) ? 0 : Text.matches(analysis, #"\bhd\b"#) ? 1 : raw ? 2 : 3
        var name = p.rest
        if let regex = Text.regex(#"\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}"#) {
            let matches = regex.matches(in: name, range: NSRange(name.startIndex..., in: name))
            for match in matches.reversed() {
                let notes = (1..<match.numberOfRanges).compactMap { Range(match.range(at: $0), in: name).map { String(name[$0]) } }
                if let note = notes.first, removableNote(note), let range = Range(match.range, in: name) { name.replaceSubrange(range, with: " ") }
            }
        }
        name = Text.replace(name, #"(?i)^VIP\s+(?=be[iıİ]n\s*sports?|s\s*sport|exxen\b)"#, "")
        let branded4K = Text.matches(name, #"(?i)^\s*(trt|bein\s*sports?)\s*4k(?:\s|$)"#)
        name = Text.replace(Text.replace(Text.replace(name, eventDisplay, " "), low, " "), technical, " ")
        name = Text.replace(name, #"(?i)\b7\s*[/x]\s*24(?:\s+canl[ıi])?\b|\b(?:canl[ıi]\s*yay[ıi]n|canl[ıi])\s*$"#, " ")
        name = Text.replace(name, #"^[\s•·|:\-]+|[\s•·|:\-]+$"#, "").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        name = Text.replace(name, #"(?i)^be[iıİ]n\s*sports?\s*(?=\d|MAX\b|PLUS\b|$)"#, "BEIN Sport ")
        name = Text.replace(name, #"(?i)^s\s*sport\s*(?=\d|MAX\b|PLUS\b|$)"#, "S Sport ")
        let brands = ["aspor": "A Spor", "trtspor": "TRT Spor", "trt1": "TRT 1", "kanald": "Kanal D", "startv": "Star TV", "beyaztv": "Beyaz TV", "tv8": "TV8", "tv85": "TV8.5", "halktv": "Halk TV", "ahaber": "A Haber", "atv": "ATV", "360tv": "360", "360": "360"]
        name = brands[search(name)] ?? name
        if let number = Text.capture(name, #"(?i)^exxen\s*(?:sport\s*)?(\d+)"#), Text.matches(Text.fold(item.categoryName), #"\b(?:spor|sport|sports)\b"#) { name = "EXXEN Sport " + number }
        if branded4K && ["trt", "beinsport"].contains(search(name)) { name = search(name) == "trt" ? "TRT 4K" : "BEIN Sport 4K" }
        name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalized = Text.replace(Text.replace(Text.fold(name), #"[’'`"]"#, ""), #"[^\p{L}\p{N}+\s]"#, " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        let languageWords = [("ar", "arabic|arapca"), ("de", "german|deutsch|almanca"), ("en", "english|ingilizce|eng"), ("es", "spanish|espanol|ispanyolca"), ("fr", "french|francais|fransizca"), ("it", "italian|italiano|italyanca"), ("ku", "kurdish|kurtce"), ("pt", "portuguese|portugues|portekizce"), ("ru", "russian|rusca"), ("tr", "turkish|turkce")]
        let languages = languageWords.filter { Text.matches(Text.fold(name + " " + item.categoryName), "\\b(?:" + $0.1 + ")\\b") }.map(\.0).joined(separator: ",")
        let conflict = p.country != nil && fromGroup != nil && p.country != fromGroup ? "!" + fromGroup! : ""
        let unknown = Text.replace(Text.fold(item.categoryName), #"[^\p{L}\p{N}\s]"#, " ").split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return Description(name: name, groupKey: (country ?? "unknown:" + unknown) + conflict + "|" + languages + "|" + normalized, country: country, score: [hevc ? 1 : 0, quality, Text.matches(analysis, event) ? 1 : 0, Text.matches(analysis, low) ? 1 : 0, raw ? 1 : 0])
    }
    static func curate(_ raw: Catalog, excluded: Set<String>) -> LiveProjection {
        var groups: [String: [(CatalogItem, Description)]] = [:], originals: [String: CatalogItem] = [:]
        for item in raw.items {
            originals[item.id] = item
            guard !excluded.contains(item.id) else { continue }
            let d = describe(item)
            guard !d.name.isEmpty, !d.groupKey.hasSuffix("|"), search(d.name) != "trt4k", !search(d.name).contains("sifirpanelbilgilendirme") else { continue }
            groups[d.groupKey, default: []].append((item, d))
        }
        var chosen: [CatalogItem] = [], canonical: [String: String] = [:]
        for key in groups.keys.sorted() {
            let entries = groups[key]!.sorted { a, b in
                if a.1.score != b.1.score { return a.1.score.lexicographicallyPrecedes(b.1.score) }
                let comparison = a.0.id.compare(b.0.id, options: .numeric)
                return comparison == .orderedSame ? a.0.sourceTitle < b.0.sourceTitle : comparison == .orderedAscending
            }
            guard let selected = entries.first else { continue }; var item = selected.0; item.title = selected.1.name; chosen.append(item)
            for row in entries { canonical[row.0.id] = item.id }
        }
        let used = Set(chosen.map(\.categoryID))
        return LiveProjection(catalog: Catalog(kind: .live, items: sort(chosen), categories: raw.categories.filter { used.contains($0.id) }), canonicalByID: canonical, originals: originals)
    }
    public static func clean(_ items: [CatalogItem]) -> [CatalogItem] { curate(Catalog(kind: .live, items: items), excluded: []).catalog.items }
    private static func country(_ code: String?, group: String, source: String) -> String {
        if let code = code { let key = code == "CO" ? "latam" : code.lowercased(); if countries.contains(key) { return key } }
        for (pattern, key) in [(#"^(?:arabic|arabia|middle east)(?:\W|$)"#, "arabic"), (#"^(?:kurdish|ku)(?:\W|$)"#, "kurdish"), (#"^(?:latin america|latam)(?:\W|$)"#, "latam")] where Text.matches(group, pattern) { return key }
        if code != nil { return "other" }
        if Text.matches(group, #"^(?:turkish|turkce|turkiye|turkey)(?:\W|$)"#) { return "tr" }
        guard let raw = Text.capture(source.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), #"^(tr|de|fr|uk|gb|us|usa|it|es|pt|bg|gr|se|dk|ru|br|col|ku)(?=[\s•·|:\-])"#) else { return "other" }
        return ["uk": "gb", "usa": "us", "col": "latam", "ku": "kurdish"][raw] ?? raw
    }
    private static func category(group: String, name: String, title: String) -> String {
        if national.contains(name) { return "national" }
        for (pattern, key) in [("radyo|radio", "radio"), ("muzik|music", "music"), ("yoresel|yerel|local|regional", "local"), (#"7\s*[/x]\s*24|sinema|cinema|yerli dizi|yabanci dizi|ambiyans"#, "themed")] where Text.matches(group, pattern) { return key }
        let text = group + " " + title
        if Text.matches(text, "belgesel|documenta(?:ry|ire)|nature|discovery|nat geo") { return "documentary" }
        if Text.matches(text, "cocuk|kids?|child|cartoon|nick(?:elodeon)?|minika|baby") { return "kids" }
        if news.contains(name) || Text.matches(text, "haber|news|cnn|bbc world|bulten") { return "news" }
        if Text.matches(text, "spor|sport|futbol|football|bein|dazn|nfl|nba|laliga|liga de campeones|eurosport") { return "sports" }
        return "national"
    }
    public static func info(_ item: CatalogItem) -> LiveInfo {
        let d = describe(item), name = station(d.name), group = Text.fold(item.categoryName), category = category(group: group, name: name, title: Text.fold(d.name))
        var position = positions[aliases[name] ?? name]
        if position == nil && category == "sports" {
            let bein = ["beinsport1", "beinsport2", "beinsport3", "beinsport4", "beinsport5", "beinsportmax1", "beinsportmax2", "beinsport4k"]
            if let index = bein.firstIndex(of: name) { position = 76 + Double(index + 1) / 100 }
            else if Text.matches(name, #"^beinsport(?:max|plus)?[0-9]+$"#) { position = 76.9 }
            else if Text.matches(name, #"^tivibusport?([0-9]+|4k)?$"#) { position = 84 + (name.hasSuffix("4k") ? 0.9 : Double(Text.capture(name, #"([0-9]+)$"#) ?? "0")! / 100) }
            else if Text.matches(name, #"^ssportplus[0-9]+$"#) { position = 88.5 }
            else if Text.matches(name, #"^exxen(?:sports?)?[0-9]+$"#) { position = 89.5 }
            else if Text.matches(name, #"^beinconne?ct|^beinconnet"#) { position = 91.5 }
        }
        if position == nil && Text.matches(group, "dini|religio|diyanet") { position = 247.5 }
        let fallback: [String: Double] = ["national": 48.9, "news": 69.9, "sports": 94.9, "documentary": 117.9, "kids": 136.9, "music": 199.9, "local": 299.9]
        return LiveInfo(countryID: country(d.country, group: group, source: item.sourceTitle), categoryID: category, name: d.name, position: position ?? fallback[category] ?? 1000)
    }
    public static func sort(_ items: [CatalogItem]) -> [CatalogItem] {
        let infos = items.map(info)
        return items.indices.sorted { left, right in
            let a = infos[left], b = infos[right]
            if (a.countryID == "tr") != (b.countryID == "tr") { return a.countryID == "tr" }
            if a.countryID != "tr" { return left < right }
            if a.position != b.position { return a.position < b.position }
            let compared = a.name.compare(b.name, options: [.numeric, .caseInsensitive, .diacriticInsensitive], range: nil, locale: Locale(identifier: "tr_TR"))
            return compared == .orderedSame ? items[left].id.compare(items[right].id, options: .numeric) == .orderedAscending : compared == .orderedAscending
        }.map { items[$0] }
    }
    public static func countryTitle(_ id: String) -> String { LiveLineupData.countryTitles[id] ?? "Diğer" }
    public static func categoryTitle(_ id: String) -> String { categoryIDs.firstIndex(of: id).map { categoryTitles[$0] } ?? "Tümü" }
}
