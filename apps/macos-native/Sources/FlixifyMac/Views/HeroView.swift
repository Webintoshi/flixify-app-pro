import FlixifyCore
import SwiftUI

struct HeroView: View {
    @EnvironmentObject var store: AppStore
    let items: [CatalogItem]
    @State private var selected = 0
    private var item: CatalogItem? { items.indices.contains(selected) ? items[selected] : items.first }
    var body: some View {
        if let item {
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Artwork(url: item.artworkURL).frame(width: geometry.size.width, height: geometry.size.height)
                    LinearGradient(stops: [.init(color: FlixTheme.background, location: 0), .init(color: FlixTheme.background.opacity(0.97), location: 0.28), .init(color: FlixTheme.background.opacity(0.65), location: 0.6), .init(color: .clear, location: 1)], startPoint: .leading, endPoint: .trailing)
                    LinearGradient(colors: [.clear, FlixTheme.background], startPoint: .center, endPoint: .bottom)
                    HStack(spacing: 26) {
                        VStack(alignment: .leading, spacing: 18) {
                            Text(verbatim: item.releaseYear > 0 ? "\(String(item.releaseYear)) · \(item.kind == .series ? "Dizi" : "Film")" : (item.kind == .series ? "Dizi" : "Film"))
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(FlixTheme.accent)
                            Text(item.title).font(.system(size: geometry.size.width < 800 ? 32 : 44, weight: .bold)).lineLimit(3)
                                .fixedSize(horizontal: false, vertical: true)
                            if !item.description.isEmpty { Text(item.description).foregroundStyle(FlixTheme.muted).font(.system(size: 14)).lineLimit(3) }
                            HStack(spacing: 14) {
                                Button { store.open(item) } label: { Label("İzle", systemImage: "play.fill") }.buttonStyle(PrimaryActionStyle())
                                Button("İncele") { store.inspect(item) }.buttonStyle(PrimaryActionStyle(prominent: false))
                                Button { store.toggleFavorite(item) } label: { Image(systemName: store.favoriteKeys.contains(item.key) ? "heart.fill" : "heart").font(.system(size: 22)).frame(width: 40, height: 40) }
                                    .buttonStyle(.plain).accessibilityLabel(store.favoriteKeys.contains(item.key) ? "Favorilerden çıkar" : "Favorilere ekle")
                            }
                            if items.count > 1 {
                                HStack(spacing: 9) {
                                    ForEach(Array(items.enumerated()), id: \.element.key) { index, value in
                                        Button {
                                            selected = index; PosterSound.shared.focused(value.scope + value.key)
                                        } label: {
                                            Artwork(url: value.artworkURL).frame(width: 43, height: 62).clipShape(RoundedRectangle(cornerRadius: 6))
                                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(index == selected ? FlixTheme.text : .clear, lineWidth: 2))
                                        }.buttonStyle(.plain).help(value.title).accessibilityLabel(value.title)
                                    }
                                }.padding(.top, 9)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading)
                        if geometry.size.width > 700 {
                            Artwork(url: item.artworkURL).frame(width: 180, height: 267).clipShape(RoundedRectangle(cornerRadius: 13)).padding(.trailing, 25)
                        }
                    }.padding(.horizontal, 30).padding(.vertical, 28)
                }.clipped().clipShape(RoundedRectangle(cornerRadius: 18))
            }.frame(height: 335)
            .onChange(of: items.map(\.key)) { _ in if selected >= items.count { selected = 0 } }
        }
    }
}
