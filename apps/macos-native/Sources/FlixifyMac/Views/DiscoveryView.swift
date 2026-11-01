import FlixifyCore
import SwiftUI

struct DiscoveryView: View {
    @EnvironmentObject var store: AppStore
    @State private var showCategories = false
    @State private var filtered: [CatalogItem] = []
    @State private var searching = false
    @State private var selectedCategoryTitle = "Tümü"
    @State private var shelves: [Shelf] = []
    @State private var heroItems: [CatalogItem] = []
    private var items: [CatalogItem] { store.currentItems }
    private var hasFilter: Bool { !store.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !store.category.isEmpty || !store.country.isEmpty }
    private var live: Bool { store.route == .live }
    private var fingerprint: String { "\(store.route.rawValue)|\(store.catalogRevision)|\(store.searchText)|\(store.category)|\(store.country)" }
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 31) {
                header
                if let error = store.error {
                    HStack(spacing: 15) {
                        Label(error, systemImage: "exclamationmark.circle").foregroundStyle(FlixTheme.muted)
                        Spacer()
                        Button("Tekrar dene") { Task { await store.loadCatalogs(force: true) } }
                    }.padding(15).background(FlixTheme.panel, in: RoundedRectangle(cornerRadius: 10))
                }
                if hasFilter {
                    if searching { ProgressView("Aranıyor…").padding(20) }
                    Text("\(filtered.count.formatted(.number.locale(Locale(identifier: "tr_TR")))) sonuç").foregroundStyle(FlixTheme.muted)
                    archive(filtered)
                } else if items.isEmpty && !store.loadingKinds.isEmpty {
                    VStack(spacing: 18) { ProgressView(); Text("İçerikler yükleniyor…").foregroundStyle(FlixTheme.muted) }
                        .frame(maxWidth: .infinity, minHeight: 320)
                } else if items.isEmpty {
                    EmptyContent(icon: store.route == .favorites ? "heart" : "film", title: store.route == .favorites ? "Listen henüz boş" : "İçerik bulunamadı", detail: store.route == .favorites ? "Oynatıcıdaki kalbe basarak film, dizi ve kanalları buraya ekleyebilirsin." : "Başka bir kategori seçebilir veya listeyi yenileyebilirsin.")
                } else if live {
                    archive(items)
                } else {
                    if store.route == .home || store.route == .movies { HeroView(items: heroItems) }
                    ForEach(shelves) { shelf in
                        ContentShelf(shelf: shelf)
                    }
                    if store.route != .home {
                        Text(store.route == .favorites ? "Tüm favorilerin" : "Tüm içerikler").font(.system(size: 25, weight: .bold))
                        archive(items)
                    }
                }
            }.padding(.horizontal, 30).padding(.top, 24).padding(.bottom, 48)
        }
        .id([store.route.rawValue, store.searchText, store.category, store.country, store.session?.sourceScope ?? ""])
        .background(FlixTheme.background)
        .sheet(isPresented: $showCategories) {
            CategoryPicker(items: items, current: store.category, liveOnly: live, country: store.country, revision: store.catalogRevision) { id, title in store.category = id; selectedCategoryTitle = title }
        }
        .onChange(of: store.session?.sourceScope) { _ in showCategories = false; selectedCategoryTitle = "Tümü" }
        .task(id: fingerprint) {
            let values = items, query = store.searchText, category = store.category, country = store.country, route = store.route
            guard hasFilter else {
                filtered = []; searching = false
                let prepared = await Task.detached(priority: .userInitiated) { () -> ([CatalogItem], [Shelf]) in
                    if route == .favorites {
                        return ([], [MediaKind.movie, .series, .live].compactMap { kind in
                            let entries = values.filter { $0.kind == kind }
                            return entries.isEmpty ? nil : Shelf(id: "favorites-" + kind.rawValue, title: kind == .movie ? "Filmler" : kind == .series ? "Diziler" : "Canlı TV", items: Array(entries.prefix(18)))
                        })
                    }
                    return (Discovery.hero(items: values), Discovery.shelves(for: route.kind, items: values))
                }.value
                guard !Task.isCancelled else { return }; heroItems = prepared.0; shelves = prepared.1
                return
            }
            searching = true
            try? await Task.sleep(nanoseconds: 140_000_000)
            guard !Task.isCancelled else { return }
            let result = await Task.detached(priority: .userInitiated) { Self.filter(values, query: query, category: category, country: country) }.value
            guard !Task.isCancelled else { return }; filtered = result; searching = false
        }
    }
    private var header: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 5) {
                Text(store.route.title).font(.system(size: 31, weight: .bold)).accessibilityAddTraits(.isHeader)
                if store.route != .home { Text("\(items.count.formatted(.number.locale(Locale(identifier: "tr_TR")))) \(live ? "kanal" : "içerik")").font(.system(size: 12)).foregroundStyle(FlixTheme.muted) }
            }
            Spacer(minLength: 12)
            if live {
                Menu {
                    Button("Tüm ülkeler") { store.country = "" }
                    ForEach(LiveLineup.countries, id: \.self) { id in Button(LiveLineup.countryTitle(id)) { store.country = id } }
                } label: { Text(store.country.isEmpty ? "Ülkeler" : LiveLineup.countryTitle(store.country)).lineLimit(1) }
                    .menuStyle(.borderlessButton).frame(maxWidth: 140)
            }
            Button { showCategories = true } label: {
                Label(store.category.isEmpty ? "Kategoriler" : selectedCategoryTitle, systemImage: "line.3.horizontal.decrease")
                    .lineLimit(1).frame(maxWidth: 230)
            }.buttonStyle(PrimaryActionStyle(prominent: false))
            Button { Task { await store.loadCatalogs(force: true) } } label: { Image(systemName: "arrow.clockwise").frame(width: 32, height: 32) }
                .buttonStyle(.plain).help("İçerikleri yenile").accessibilityLabel("İçerikleri yenile")
        }
    }
    @ViewBuilder private func archive(_ values: [CatalogItem]) -> some View {
        if values.isEmpty {
            EmptyContent(icon: "magnifyingglass", title: "Sonuç bulunamadı", detail: "Başka bir arama veya kategori deneyebilirsin.")
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: values.contains(where: { $0.kind == .live }) ? 205 : 150), spacing: 18, alignment: .top)], alignment: .leading, spacing: 25) {
                ForEach(values, id: \.key) { item in
                    PosterCard(item: item, favorite: store.favoriteKeys.contains(item.key), play: { store.open(item) }, inspect: { store.inspect(item) }, toggleFavorite: { store.toggleFavorite(item) }, width: item.kind == .live ? 205 : 150)
                }
            }.padding(.vertical, 6)
        }
    }
    nonisolated static func filter(_ items: [CatalogItem], query: String, category: String, country: String = "") -> [CatalogItem] {
        let locale = Locale(identifier: "tr_TR")
        let folded = query.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).trimmingCharacters(in: .whitespacesAndNewlines)
        return items.filter { item in
            let typeFilter: Bool
            if category.hasPrefix("@kind/") { typeFilter = item.kind.rawValue == String(category.dropFirst(6)) }
            else if category.hasPrefix("@live/category/") { typeFilter = item.kind == .live && LiveLineup.info(item).categoryID == String(category.dropFirst(15)) }
            else { typeFilter = item.categoryID == category }
            guard category.isEmpty || typeFilter else { return false }
            guard country.isEmpty || item.kind == .live && LiveLineup.info(item).countryID == country else { return false }
            if item.kind == .live { return folded.isEmpty || LiveLineup.search(item.title + " " + item.sourceTitle).contains(LiveLineup.search(query)) }
            return folded.isEmpty || (item.title + " " + item.sourceTitle).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).contains(folded)
        }
    }
}

struct CategoryPicker: View {
    let items: [CatalogItem]
    let current: String
    var liveOnly = false
    var country = ""
    let revision: UUID
    let choose: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var prepared: [CategoryRow] = []
    @State private var total = 0
    @State private var preparing = true
    private var categories: [CategoryRow] { prepared.filter { query.isEmpty || $0.title.localizedStandardContains(query) } }
    private struct CategoryRow: Identifiable, Sendable { let id: String; let title: String; let count: Int }
    nonisolated private static func prepare(_ items: [CatalogItem], liveOnly: Bool, country: String) -> ([CategoryRow], Int) {
        var names: [String: String] = [:], counts: [String: Int] = [:]
        var total = 0, kinds: [MediaKind: Int] = [:]
        for item in items {
            let info = liveOnly ? LiveLineup.info(item) : nil
            if !country.isEmpty && info?.countryID != country { continue }
            let id = liveOnly ? "@live/category/" + (info?.categoryID ?? "other") : item.categoryID
            names[id] = liveOnly ? LiveLineup.categoryTitle(info?.categoryID ?? "other") : item.categoryName
            counts[id, default: 0] += 1
            total += 1; kinds[item.kind, default: 0] += 1
        }
        var rows = counts.keys.filter { !$0.isEmpty }.map { CategoryRow(id: $0, title: Self.label(names[$0] ?? ""), count: counts[$0] ?? 0) }
        rows.sort { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        if kinds.count > 1 {
            rows.insert(contentsOf: [MediaKind.live, .movie, .series].compactMap { kind in
                let count = kinds[kind, default: 0]
                return count > 0 ? CategoryRow(id: "@kind/" + kind.rawValue, title: kind == .live ? "Canlı TV" : kind == .movie ? "Filmler" : "Diziler", count: count) : nil
            }, at: 0)
        }
        return (rows, total)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack { Text("Kategoriler").font(.title2.bold()); Spacer(); Button("Kapat") { dismiss() }.keyboardShortcut(.cancelAction) }
            TextField("Kategori ara", text: $query).textFieldStyle(.roundedBorder).accessibilityLabel("Kategori ara")
            if preparing { ProgressView("Kategoriler hazırlanıyor…").controlSize(.small) }
            List {
                row(id: "", title: "Tümü", count: total)
                ForEach(categories, id: \.id) { category in row(id: category.id, title: category.title, count: category.count) }
            }.listStyle(.plain)
        }.padding(24).frame(width: 480, height: 560).background(FlixTheme.background)
            .task(id: "\(revision)|\(country)") {
                let values = items, live = liveOnly, selectedCountry = country
                preparing = true
                let result = await Task.detached(priority: .userInitiated) { Self.prepare(values, liveOnly: live, country: selectedCountry) }.value
                guard !Task.isCancelled else { return }; prepared = result.0; total = result.1; preparing = false
            }
    }
    private func row(id: String, title: String, count: Int) -> some View {
        Button { choose(id, title); dismiss() } label: {
            HStack { Text(title); Spacer(); Text(count.formatted()).foregroundStyle(FlixTheme.muted); if current == id { Image(systemName: "checkmark").foregroundStyle(FlixTheme.text) } }.padding(.vertical, 8).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityAddTraits(current == id ? .isSelected : [])
    }
    nonisolated private static func label(_ value: String) -> String {
        let cleaned = value.replacingOccurrences(of: #"^[A-ZÇĞİÖŞÜ]{2,3}\s*[:|•-]\s*"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: "_", with: " ")
        if cleaned.isEmpty { return "Diğer" }
        if cleaned.uppercased().contains("ULUSAL") { return "Ulusal kanallar" }
        if cleaned.uppercased().contains("BEINSPORT") { return "beIN Sports" }
        return cleaned.localizedCapitalized
    }
}
