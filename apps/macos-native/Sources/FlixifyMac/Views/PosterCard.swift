import FlixifyCore
import SwiftUI

struct PosterCard: View {
    let item: CatalogItem
    let favorite: Bool
    let play: () -> Void
    let inspect: () -> Void
    let toggleFavorite: () -> Void
    var width: CGFloat = 166
    @State private var hovering = false
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var live: Bool { item.kind == .live }
    var body: some View {
        Button(action: play) {
            VStack(alignment: .leading, spacing: 9) {
                ZStack(alignment: .topTrailing) {
                    Artwork(url: item.artworkURL, fit: live, icon: live ? "tv" : "film")
                        .frame(width: width, height: live ? width * 0.565 : width * 1.48)
                        .clipShape(RoundedRectangle(cornerRadius: 11))
                    if favorite { Image(systemName: "heart.fill").font(.system(size: 12, weight: .semibold)).padding(8).background(.black.opacity(0.8), in: Circle()).padding(7) }
                    if hovering || focused {
                        RoundedRectangle(cornerRadius: 11).stroke(FlixTheme.text, lineWidth: 2.5)
                    }
                }
                Text(item.title).font(.system(size: 14, weight: .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                    .frame(width: width, height: 36, alignment: .topLeading)
                if !live && item.releaseYear > 0 { Text(String(item.releaseYear)).font(.system(size: 12)).foregroundStyle(FlixTheme.muted) }
            }.foregroundStyle(FlixTheme.text)
        }
        .buttonStyle(.plain).focused($focused).frame(width: width)
        .scaleEffect((hovering || focused) && !reduceMotion ? 1.035 : 1, anchor: .center)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: hovering || focused)
        .onHover { hovering = $0; if $0 { PosterSound.shared.focused(item.scope + item.key) } }
        .onChange(of: focused) { if $0 { PosterSound.shared.focused(item.scope + item.key) } }
        .accessibilityLabel(item.title).accessibilityHint("İzlemeye başla")
        .contextMenu {
            Button("İzle", systemImage: "play.fill", action: play)
            Button("İncele", systemImage: "info.circle", action: inspect)
            Button(favorite ? "Favorilerden çıkar" : "Favorilere ekle", systemImage: favorite ? "heart.slash" : "heart", action: toggleFavorite)
        }
    }
}

struct ContentShelf: View {
    @EnvironmentObject var store: AppStore
    let shelf: Shelf
    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            Text(shelf.title).font(.system(size: 25, weight: .bold)).accessibilityAddTraits(.isHeader)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 18) {
                    ForEach(shelf.items, id: \.key) { item in
                        PosterCard(item: item, favorite: store.favoriteKeys.contains(item.key), play: { store.open(item) }, inspect: { store.inspect(item) }, toggleFavorite: { store.toggleFavorite(item) }, width: item.kind == .live ? 226 : 166)
                    }
                }.padding(.vertical, 8).padding(.horizontal, 5)
            }.padding(.horizontal, -5)
        }
    }
}
