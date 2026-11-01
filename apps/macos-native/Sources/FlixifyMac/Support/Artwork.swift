import AppKit
import ImageIO
import SwiftUI

actor ArtworkCache {
    static let shared = ArtworkCache()
    private let memory = NSCache<NSString, NSImage>()
    private let session: URLSession
    init() {
        memory.totalCostLimit = 48 * 1024 * 1024
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 8 * 1024 * 1024, diskCapacity: 160 * 1024 * 1024, diskPath: "flixify-mac-artwork")
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 12
        config.httpMaximumConnectionsPerHost = 4
        config.httpCookieStorage = nil; config.httpShouldSetCookies = false
        session = URLSession(configuration: config)
    }
    func image(_ value: String) async -> NSImage? {
        if let cached = memory.object(forKey: value as NSString) { return cached }
        guard let url = URL(string: value) else { return nil }
        var data: Data
        #if FIXTURE_QA
        if url.isFileURL, CommandLine.arguments.contains("--fixture-catalog") {
            guard let loaded = try? Data(contentsOf: url), loaded.count < 8 * 1024 * 1024 else { return nil }
            data = loaded
        } else {
            guard let loaded = await remote(url) else { return nil }; data = loaded
        }
        #else
        guard let loaded = await remote(url) else { return nil }; data = loaded
        #endif
        guard !Task.isCancelled, let source = CGImageSourceCreateWithData(data as CFData, nil),
            let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 1600,
                kCGImageSourceCreateThumbnailWithTransform: true
            ] as CFDictionary) else { return nil }
        let image = NSImage(cgImage: thumbnail, size: NSSize(width: thumbnail.width, height: thumbnail.height))
        memory.setObject(image, forKey: value as NSString, cost: thumbnail.width * thumbnail.height * 4)
        return image
    }
    private func remote(_ url: URL) async -> Data? {
        guard url.scheme == "https", url.user == nil, url.password == nil,
            !(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).contains(where: { ["password", "username", "token", "access_token"].contains($0.name.lowercased()) }) else { return nil }
        do {
            let (stream, response) = try await session.bytes(from: url)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                response.expectedContentLength <= 8 * 1024 * 1024,
                response.url?.scheme == "https" else { return nil }
            var data = Data()
            for try await byte in stream {
                if Task.isCancelled || data.count >= 8 * 1024 * 1024 { return nil }
                data.append(byte)
            }
            return data
        } catch { return nil }
    }
    func clearMemory() { memory.removeAllObjects() }
}

struct Artwork: View {
    let url: String
    var fit = false
    var icon = "film"
    @State private var image: NSImage?
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                fit ? Color.white : FlixTheme.panel
                if let image {
                    Image(nsImage: image).resizable().aspectRatio(contentMode: fit ? .fit : .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height).clipped()
                } else {
                    Image(systemName: icon).font(.system(size: 30, weight: .light))
                        .foregroundStyle(fit ? Color.gray : FlixTheme.muted)
                }
            }
        }
        .accessibilityHidden(true)
        .task(id: url) {
            image = nil
            let loaded = await ArtworkCache.shared.image(url)
            if !Task.isCancelled { image = loaded }
        }
    }
}
