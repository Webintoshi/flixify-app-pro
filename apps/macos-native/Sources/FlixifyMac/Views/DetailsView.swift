import FlixifyCore
import SwiftUI

struct SeriesDetailsView: View {
    @EnvironmentObject var store: AppStore
    let detail: SeriesDetail
    @State private var season = 0
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack { Spacer(); Button("Kapat") { store.details = nil }.keyboardShortcut(.cancelAction) }
                detailHeader(detail.series)
                HStack {
                    Text("Bölümler").font(.title2.bold()); Spacer()
                    Picker("Sezon", selection: $season) {
                        ForEach(detail.seasons) { value in Text("\(value.number). Sezon").tag(value.number) }
                    }.frame(maxWidth: 180)
                }
                LazyVStack(spacing: 0) {
                    ForEach(detail.seasons.first(where: { $0.number == season })?.episodes ?? [], id: \.key) { episode in
                        Button { store.activeEpisodes = detail.episodes; store.open(episode) } label: {
                            HStack(spacing: 20) {
                                Text(String(format: "%02d", episode.episode)).font(.system(size: 21, weight: .semibold)).foregroundStyle(FlixTheme.muted).frame(width: 35)
                                Artwork(url: episode.artworkURL).frame(width: 130, height: 74).clipShape(RoundedRectangle(cornerRadius: 8))
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(episode.title).font(.system(size: 16, weight: .semibold))
                                    Text("\(episode.season). Sezon · \(episode.episode). Bölüm").foregroundStyle(FlixTheme.muted).font(.system(size: 13))
                                }
                                Spacer()
                                if store.library.watchedEpisodeKeys.contains(episode.key) { Image(systemName: "checkmark.circle").foregroundStyle(FlixTheme.muted).accessibilityLabel("İzlendi") }
                                Image(systemName: "play.fill")
                            }.padding(.vertical, 15).contentShape(Rectangle())
                        }.buttonStyle(.plain)
                        Divider().overlay(FlixTheme.text.opacity(0.09))
                    }
                }
            }.padding(30)
        }.frame(minWidth: 700, idealWidth: 900, minHeight: 570, idealHeight: 700)
            .background(FlixTheme.background).foregroundStyle(FlixTheme.text)
            .onAppear { season = detail.seasons.first?.number ?? 0 }
    }
    private func detailHeader(_ item: CatalogItem) -> some View {
        HStack(alignment: .top, spacing: 26) {
            Artwork(url: item.artworkURL).frame(width: 150, height: 222).clipShape(RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 17) {
                Text("DİZİ").font(.system(size: 12, weight: .bold)).foregroundStyle(FlixTheme.accent)
                Text(item.title).font(.system(size: 32, weight: .bold))
                Text("\(detail.seasons.count) sezon · \(detail.episodes.count) bölüm").foregroundStyle(FlixTheme.muted)
                if !item.description.isEmpty { Text(item.description).foregroundStyle(FlixTheme.muted).lineLimit(5) }
                HStack {
                    Button { store.open(item) } label: { Label("İzle", systemImage: "play.fill") }.buttonStyle(PrimaryActionStyle())
                    Button { store.toggleFavorite(item) } label: { Label(store.favoriteKeys.contains(item.key) ? "Listemde" : "Listeme ekle", systemImage: store.favoriteKeys.contains(item.key) ? "heart.fill" : "heart") }.buttonStyle(PrimaryActionStyle(prominent: false))
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

struct FilmDetailsView: View {
    @EnvironmentObject var store: AppStore
    let item: CatalogItem
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack { Spacer(); Button("Kapat") { store.filmDetails = nil }.keyboardShortcut(.cancelAction) }
                HStack(alignment: .top, spacing: 27) {
                    Artwork(url: item.artworkURL, fit: item.kind == .live, icon: item.kind == .live ? "tv" : "film")
                        .frame(width: item.kind == .live ? 235 : 160, height: item.kind == .live ? 132 : 238).clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 18) {
                        Text(item.title).font(.system(size: 31, weight: .bold))
                        if item.releaseYear > 0 { Text(String(item.releaseYear)).foregroundStyle(FlixTheme.muted) }
                        if !item.description.isEmpty { Text(item.description).foregroundStyle(FlixTheme.muted) }
                        HStack {
                            Button { store.open(item) } label: { Label(item.kind == .live ? "Canlı izle" : "İzle", systemImage: "play.fill") }.buttonStyle(PrimaryActionStyle())
                            Button { store.toggleFavorite(item) } label: { Image(systemName: store.favoriteKeys.contains(item.key) ? "heart.fill" : "heart") }.buttonStyle(PrimaryActionStyle(prominent: false)).accessibilityLabel("Favorileri değiştir")
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                if item.kind == .live {
                    Text("Yayın akışı").font(.title2.bold())
                    if let programmes = store.programmes[item.key], !programmes.isEmpty {
                        ForEach(programmes) { value in
                            HStack(alignment: .top, spacing: 20) {
                                Text(value.startsAt, style: .time).monospacedDigit().foregroundStyle(FlixTheme.muted)
                                Text(value.title); Spacer()
                                if value.startsAt <= Date() && value.endsAt > Date() { Text("Şimdi").foregroundStyle(FlixTheme.accent) }
                            }.padding(.vertical, 10)
                        }
                    } else { Text("Bu kanal için yayın akışı bilgisi bulunmuyor.").foregroundStyle(FlixTheme.muted) }
                }
            }.padding(30)
        }.frame(minWidth: 650, idealWidth: 780, minHeight: 430, idealHeight: 560).background(FlixTheme.background).foregroundStyle(FlixTheme.text)
    }
}
