import Foundation

public enum Discovery {
    private static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(identifier: "Europe/Istanbul"); formatter.dateFormat = "yyyy-MM-dd"; return formatter.string(from: date)
    }
    private static func hash(_ text: String) -> UInt32 {
        var value: UInt32 = 0x811c9dc5
        for c in text.utf16 { value = (value ^ UInt32(c)) &* 16777619 }
        value ^= value >> 16; value = value &* 0x85ebca6b; value ^= value >> 13; return value
    }
    private static func identity(_ item: CatalogItem) -> String { item.kind.rawValue + ":" + item.id }
    private static func titleIdentity(_ item: CatalogItem) -> String { item.kind.rawValue + ":" + item.title.precomposedStringWithCompatibilityMapping.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased() }
    private static func group(_ item: CatalogItem) -> String { item.categoryName.isEmpty ? "Diğer" : item.categoryName }
    private static func coveredFirst(_ items: [CatalogItem], limit: Int) -> [CatalogItem] { Array((items.filter { !$0.artworkURL.isEmpty } + items.filter { $0.artworkURL.isEmpty }).prefix(limit)) }
    private static func ranked(_ items: [CatalogItem], day: String) -> [CatalogItem] {
        let ranks = items.map { hash(day + "\u{0}" + identity($0)) }
        return items.indices.sorted { a, b in
            if ranks[a] != ranks[b] { return ranks[a] < ranks[b] }
            if identity(items[a]) != identity(items[b]) { return identity(items[a]) < identity(items[b]) }
            if group(items[a]) != group(items[b]) { return group(items[a]) < group(items[b]) }
            return titleIdentity(items[a]) < titleIdentity(items[b])
        }.map { items[$0] }
    }
    private static func ordered(_ items: [CatalogItem], day: String) -> [CatalogItem] {
        let sorted = ranked(items, day: day), buckets = Dictionary(grouping: sorted, by: group)
        let names = buckets.keys.sorted { a, b in
            let x = hash(day + "\u{0}group\u{0}" + a), y = hash(day + "\u{0}group\u{0}" + b)
            return x == y ? a < b : x < y
        }
        var result: [CatalogItem] = [], offsets = [String: Int]()
        while result.count < min(12, sorted.count) {
            var changed = false
            for name in names {
                let offset = offsets[name, default: 0], bucket = buckets[name]!
                if offset < bucket.count { result.append(bucket[offset]); offsets[name] = offset + 1; changed = true }
                if result.count >= 12 { break }
            }
            if !changed { break }
        }
        for name in names.prefix(4) {
            let offset = offsets[name, default: 0], bucket = buckets[name]!, end = min(bucket.count, offset + 12)
            result.append(contentsOf: bucket[offset..<end]); offsets[name] = end
        }
        var occurrences: [String: Int] = [:]; for item in result { occurrences[item.key, default: 0] += 1 }
        for item in sorted { if occurrences[item.key, default: 0] > 0 { occurrences[item.key]! -= 1 } else { result.append(item) } }
        return result
    }
    private struct Rows { let primary: [CatalogItem]; let categories: [(String, [CatalogItem])]; let other: [CatalogItem]; var flattened: [CatalogItem] { primary + categories.flatMap(\.1) + other } }
    private static func rows(_ items: [CatalogItem], kind: MediaKind, excluded: [CatalogItem] = []) -> Rows {
        var ids = Set(excluded.map(identity)), titles = Set(excluded.map(titleIdentity)), visible: [CatalogItem] = []
        for item in items where item.kind == kind {
            guard !ids.contains(identity(item)), !titles.contains(titleIdentity(item)) else { continue }
            ids.insert(identity(item)); titles.insert(titleIdentity(item)); visible.append(item)
        }
        let primary = Array(visible.prefix(12)); var categories: [(String, [CatalogItem])] = [], other: [CatalogItem] = []
        for item in visible.dropFirst(primary.count) {
            let name = group(item)
            if let index = categories.firstIndex(where: { $0.0 == name }) { if categories[index].1.count < 12 { categories[index].1.append(item) } else { other.append(item) } }
            else if categories.count < 4 { categories.append((name, [item])) }
            else { other.append(item) }
        }
        return Rows(primary: primary, categories: categories, other: other)
    }
    private static func homePool(_ items: [CatalogItem], day: String) -> [CatalogItem] {
        [MediaKind.movie, .series].flatMap { kind in rows(ordered(items.filter { $0.kind == kind && $0.releaseYear == 2026 }, day: day), kind: kind).flattened }
    }
    private static func homeHero(_ pool: [CatalogItem], day: String) -> [CatalogItem] {
        var result: [CatalogItem] = [], ids = Set<String>(), titles = Set<String>()
        for item in ranked(pool, day: day) where !item.artworkURL.isEmpty {
            guard result.count < min(5, max(1, pool.count / 3)) else { break }
            if ids.insert(identity(item)).inserted && titles.insert(titleIdentity(item)).inserted { result.append(item) }
        }
        return result
    }
    private static func movieText(_ text: String) -> String { Text.replace(Text.fold(text), #"[^a-z0-9]+"#, " ").trimmingCharacters(in: .whitespacesAndNewlines) }
    private static let marvel = #"\b(?:marvel|avengers|yenilmezler|iron man|ironman|thor|captain america|kaptan amerika|spider man|spiderman|orumcek adam|hulk|doctor strange|doktor strange|black panther|kara panter|ant man|karinca adam|guardians of the galaxy|galaksinin koruyuculari|black widow|kara dul|shang chi|eternals|deadpool|wolverine|x men|venom)\b"#
    private static let fantasy = #"\b(?:harry potter|fantastic beasts|fantastik canavarlar|lord of the rings|yuzuklerin efendisi|hobbit|narnia)\b"#
    private static func moviePool(_ items: [CatalogItem], day: String) -> [CatalogItem] {
        var result: [CatalogItem] = [], ids: [String: Int] = [:], titles: [String: Int] = [:]
        for item in ordered(items.filter { $0.kind == .movie }, day: day) {
            if let index = ids[identity(item)] ?? titles[titleIdentity(item)] {
                if result[index].artworkURL.isEmpty && !item.artworkURL.isEmpty { result[index] = item }; ids[identity(item)] = index; titles[titleIdentity(item)] = index
            } else { ids[identity(item)] = result.count; titles[titleIdentity(item)] = result.count; result.append(item) }
        }
        return result
    }
    private static func movieHero(_ pool: [CatalogItem]) -> [CatalogItem] {
        let current = pool.filter { $0.releaseYear == 2026 }; return Array(current.filter { !$0.artworkURL.isEmpty }.prefix(min(5, max(1, current.count / 3))))
    }
    public static func hero(items: [CatalogItem], day: Date = Date()) -> [CatalogItem] {
        let day = dayKey(day)
        if !items.isEmpty && items.allSatisfy({ $0.kind == .movie }) { return movieHero(moviePool(items, day: day)) }
        return homeHero(homePool(items, day: day), day: day)
    }
    public static func shelves(for kind: MediaKind?, items: [CatalogItem], day: Date = Date()) -> [Shelf] {
        let day = dayKey(day)
        switch kind {
        case nil:
            let pool = homePool(items, day: day), selected = homeHero(pool, day: day)
            return [Shelf(id: "home-movies", title: "2026 Filmleri", items: coveredFirst(rows(pool, kind: .movie, excluded: selected).flattened, limit: 18)), Shelf(id: "home-series", title: "2026 Dizileri", items: coveredFirst(rows(pool, kind: .series, excluded: selected).flattened, limit: 18)), Shelf(id: "home-live", title: "Canlı TV", items: Array(LiveLineup.sort(items.filter { $0.kind == .live }).prefix(12)))].filter { !$0.items.isEmpty }
        case .movie:
            let pool = moviePool(items, day: day), selected = movieHero(pool)
            var used = Set(selected.map(identity))
            let lists: [(String, String, [CatalogItem])] = [
                ("movies-2026", "2026 Filmleri", pool.filter { $0.releaseYear == 2026 }),
                ("movies-marvel", "Çok İzlenenler · Marvel", pool.filter { Text.matches(movieText($0.title), marvel) }),
                ("movies-action", "Aksiyon Filmleri", pool.filter { !$0.artworkURL.isEmpty && Text.matches(movieText($0.categoryName), #"\b(?:aksiyon|action)\b"#) }),
                ("movies-fantasy", "Fantastik Filmler", pool.filter { Text.matches(movieText($0.title), fantasy) || Text.matches(movieText($0.categoryName), #"\b(?:fantastik|fantasy)\b"#) && !Text.matches(movieText($0.categoryName), #"\b(?:bilim kurgu|science fiction|sci fi|scifi)\b"#) })
            ]
            return lists.compactMap { id, title, entries in
                let covered = coveredFirst(entries, limit: entries.count), unique = covered.filter { !used.contains(identity($0)) }, chosen = Array((unique.isEmpty ? covered : unique).prefix(18))
                used.formUnion(chosen.map(identity)); return chosen.isEmpty ? nil : Shelf(id: id, title: title, items: chosen)
            }
        case .series:
            let row = rows(ordered(items.filter { $0.kind == .series }, day: day), kind: .series)
            var shelves = [Shelf(id: "series-primary", title: "Günün Seçkisi", items: row.primary)]
            for (index, entry) in row.categories.enumerated() { shelves.append(Shelf(id: "series-category-\(index)", title: entry.0, items: entry.1)) }
            if !row.other.isEmpty { shelves.append(Shelf(id: "series-other", title: "Diğer Diziler", items: row.other)) }; return shelves.filter { !$0.items.isEmpty }
        case .live:
            let sorted = LiveLineup.sort(items.filter { $0.kind == .live })
            let grouped = Dictionary(grouping: sorted) { LiveLineup.info($0).categoryID }
            return LiveLineup.categoryIDs.compactMap { id in
                guard let matches = grouped[id], !matches.isEmpty else { return nil }
                return Shelf(id: "live-" + id, title: LiveLineup.categoryTitle(id), items: matches)
            }
        case .episode: return []
        }
    }
}
