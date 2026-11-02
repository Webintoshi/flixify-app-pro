import FlixifyCore
import SwiftUI

struct SearchSheet: View {
    @EnvironmentObject var store: AppStore
    @State private var query = ""
    @State private var matches: [CatalogItem] = []
    @State private var selected: String?
    @State private var analyticsSearch=SearchAnalyticsSession()
    @State private var resolvedRevision=""
    @State private var finishingRevision=""
    @FocusState private var inputFocused: Bool
    private var searchRevision: String { "\(query)|\(store.catalogRevision)|\(store.session?.sourceScope ?? "")|\(store.category)|\(store.country)" }
    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack { Text("Ne izlemek istersin?").font(.system(size: 28, weight: .bold)); Spacer(); Button("Kapat") { store.showSearch = false }.keyboardShortcut(.cancelAction) }
            HStack(spacing: 13) {
                Image(systemName: "magnifyingglass").foregroundStyle(FlixTheme.muted)
                TextField("Film, dizi veya kanal ara", text: $query).textFieldStyle(.plain).font(.system(size: 22)).focused($inputFocused)
                    .accessibilityLabel("Film, dizi veya kanal ara").onSubmit { finishSearch(); if let item = matches.first(where: { $0.key == selected }) ?? matches.first { play(item) } }
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill") }.buttonStyle(.plain).accessibilityLabel("Aramayı temizle") }
            }.padding(18).background(FlixTheme.background, in: Capsule())
            Text(query.isEmpty ? "Tüm içeriklerinde ara" : "\(matches.count.formatted()) sonuç").foregroundStyle(FlixTheme.muted)
            if matches.isEmpty {
                EmptyContent(icon: "magnifyingglass", title: query.isEmpty ? "Aramaya başla" : "Sonuç bulunamadı", detail: "Bir içerik adı yaz. Sonuca tıkladığında doğrudan izlemeye başlayabilirsin.")
            } else {
                List(selection: $selected) {
                    ForEach(matches, id: \.key) { item in
                        Button { play(item) } label: {
                            HStack(spacing: 17) {
                                Artwork(url: item.artworkURL, fit: item.kind == .live, icon: item.kind == .live ? "tv" : "film")
                                    .frame(width: item.kind == .live ? 93 : 51, height: 70).clipShape(RoundedRectangle(cornerRadius: 6))
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.title).font(.system(size: 16, weight: .semibold)).lineLimit(2)
                                    Text(item.kind == .live ? "Canlı TV" : item.kind == .series ? "Dizi" : "Film").font(.system(size: 13)).foregroundStyle(FlixTheme.muted)
                                }
                                Spacer(); Image(systemName: "play.fill").font(.system(size: 13))
                            }.padding(.vertical, 7).contentShape(Rectangle())
                        }.buttonStyle(.plain).tag(item.key)
                    }
                }.listStyle(.plain)
            }
        }.padding(30).frame(minWidth: 640, idealWidth: 720, minHeight: 520, idealHeight: 610)
            .background(FlixTheme.panel).foregroundStyle(FlixTheme.text)
            .onAppear { inputFocused = true }
            .onChange(of: query) { value in _=analyticsSearch.begin(query:value,epoch:FlixifyAnalytics.shared.epoch,enabled:FlixifyAnalytics.shared.accepted) }
            .onDisappear { finishSearch() }
            .task(id: searchRevision) {
                let value = query, items = store.currentItems, category = store.category, country = store.country, revision=searchRevision
                let ticket=analyticsSearch.begin(query:value,epoch:FlixifyAnalytics.shared.epoch,enabled:FlixifyAnalytics.shared.accepted)
                try? await Task.sleep(nanoseconds: 120_000_000)
                guard !Task.isCancelled else { return }
                guard !value.trimmingCharacters(in: .whitespaces).isEmpty else { matches = [];resolvedRevision=revision;return }
                let result = await Task.detached { DiscoveryView.filter(items, query: value, category: category, country: country) }.value
                guard !Task.isCancelled else { return }; matches = result;resolvedRevision=revision
                if let ticket { completeSearch(ticket,count:result.count) }
            }
    }
    private func completeSearch(_ ticket:SearchAnalyticsSession.Ticket,count:Int) {
        let analytics=FlixifyAnalytics.shared
        if let values=analyticsSearch.complete(ticket,resultCount:count,epoch:analytics.epoch,enabled:analytics.accepted) { analytics.event("search",values.mapValues { $0 as Any }) }
    }
    private func finishSearch() {
        let analytics=FlixifyAnalytics.shared
        guard let ticket=analyticsSearch.begin(query:query,epoch:analytics.epoch,enabled:analytics.accepted) else { return }
        if resolvedRevision == searchRevision { completeSearch(ticket,count:matches.count);return }
        guard finishingRevision != searchRevision else { return };finishingRevision=searchRevision
        let value=query,items=store.currentItems,category=store.category,country=store.country
        Task {
            let count=await Task.detached { DiscoveryView.filter(items,query:value,category:category,country:country).count }.value
            completeSearch(ticket,count:count)
        }
    }
    private func play(_ item: CatalogItem) { finishSearch();store.showSearch = false; store.open(item) }
}
