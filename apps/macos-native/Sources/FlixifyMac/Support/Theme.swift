import SwiftUI

enum AppResources {
    static let bundle: Bundle = {
        if let url = Bundle.main.url(forResource: "FlixifyMac_FlixifyMac", withExtension: "bundle"), let bundle = Bundle(url: url) { return bundle }
        return Bundle.main
    }()
    static func url(_ name: String, extension suffix: String) -> URL? {
        guard let resources = Bundle.main.resourceURL else { return nil }
        for root in [resources.appendingPathComponent("FlixifyMac_FlixifyMac.bundle", isDirectory: true), resources] {
            let candidate = root.appendingPathComponent(name + "." + suffix)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
        }
        return nil
    }
}

enum FlixTheme {
    static let background = Color(red: 7/255, green: 9/255, blue: 12/255)
    static let panel = Color(red: 19/255, green: 23/255, blue: 30/255)
    static let accent = Color(red: 1, green: 53/255, blue: 69/255)
    static let text = Color(red: 245/255, green: 246/255, blue: 248/255)
    static let muted = Color(red: 167/255, green: 176/255, blue: 190/255)
}

struct BrandLogo: View {
    var width: CGFloat = 172
    var body: some View {
        Group {
            if let url = AppResources.url("flixify-logo", extension: "png"), let image = NSImage(contentsOf: url) {
                Image(nsImage: image).resizable().scaledToFit()
            } else { Text("FLIXIFY PRO").font(.system(size: 22, weight: .black)) }
        }.frame(width: width, height: width * 0.27).accessibilityLabel("Flixify Pro")
    }
}

struct PrimaryActionStyle: ButtonStyle {
    var prominent = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 15, weight: .semibold))
            .padding(.horizontal, 22).padding(.vertical, 13)
            .foregroundStyle(prominent ? FlixTheme.background : FlixTheme.text)
            .background(prominent ? FlixTheme.text : FlixTheme.panel, in: Capsule())
            .opacity(configuration.isPressed ? 0.72 : 1)
    }
}

struct EmptyContent: View {
    let icon: String
    let title: String
    let detail: String
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 38, weight: .light)).foregroundStyle(FlixTheme.muted)
            Text(title).font(.title2.weight(.semibold))
            Text(detail).foregroundStyle(FlixTheme.muted).multilineTextAlignment(.center).frame(maxWidth: 420)
        }.frame(maxWidth: .infinity, minHeight: 300).padding(32)
    }
}
