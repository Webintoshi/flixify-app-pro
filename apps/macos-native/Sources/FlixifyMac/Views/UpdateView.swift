import SwiftUI

struct UpdateView: View {
    @StateObject private var updater = MacUpdater()
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(spacing: 22) {
            BrandLogo(width: 170)
            Text("Güncellemeler").font(.title2.bold())
            if updater.checking { ProgressView("Denetleniyor…") }
            if let value = updater.descriptor {
                Text("Flixify Pro \(value.versionName)").font(.title3.weight(.semibold))
                if !value.notes.isEmpty { Text(value.notes).foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center) }
                if updater.downloading { ProgressView(value: updater.progress).frame(width: 300) }
                else { Button("Güncellemeyi indir") { updater.download() }.buttonStyle(PrimaryActionStyle()) }
            }
            if !updater.message.isEmpty { Text(updater.message).foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center).font(.system(size: 14)) }
            HStack {
                Button("Kapat") { updater.cancel(); dismiss() }.keyboardShortcut(.cancelAction)
                if !updater.checking && !updater.downloading { Button("Yeniden denetle") { updater.check() } }
            }
        }.padding(32).frame(width: 440, height: 350).background(FlixTheme.background).foregroundStyle(FlixTheme.text)
            .onAppear { updater.check() }.onDisappear { updater.cancel() }
    }
}
