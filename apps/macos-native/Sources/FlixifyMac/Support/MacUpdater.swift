import AppKit
import FlixifyCore
import Foundation

@MainActor final class MacUpdater: ObservableObject {
    @Published var checking = false
    @Published var downloading = false
    @Published var progress: Double = 0
    @Published var descriptor: NativeUpdateDescriptor?
    @Published var message = ""
    private var task: Task<Void, Never>?
    private let client = URLSession(configuration: .ephemeral)

    func check() {
        guard !checking && !downloading else { return }
        checking = true; message = ""; descriptor = nil
        let analyticsTicket=FlixifyAnalytics.shared.epoch
        task = Task {
            defer { checking = false }
            do {
                let (bytes, response) = try await client.bytes(from: NativeUpdatePolicy.manifestURL)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                    response.url == NativeUpdatePolicy.manifestURL, response.expectedContentLength <= 65_536 else { throw FlixifyError.network }
                var data = Data()
                for try await byte in bytes { guard data.count < 65_536, !Task.isCancelled else { throw CancellationError() }; data.append(byte) }
                let value = try NativeUpdatePolicy.validate(data, currentVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0", currentBuild: Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1") ?? 1)
                guard !Task.isCancelled else { return }; descriptor = value
                FlixifyAnalytics.shared.event("update_offered",epoch:analyticsTicket)
            } catch is CancellationError { }
            catch FlixifyError.updateUnavailable { message = "Uyumlu yeni bir sürüm bulunamadı." }
            catch { message = "Güncelleme bilgisine ulaşılamadı. Daha sonra tekrar deneyebilirsin." }
        }
    }

    func download() {
        guard let descriptor, !downloading else { return }
        downloading = true; progress = 0; message = ""
        let analyticsTicket=FlixifyAnalytics.shared.epoch
        FlixifyAnalytics.shared.event("update_selected")
        task = Task {
            defer { downloading = false }
            var directory: URL?
            do {
                let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("vip.flixify.mac/Updates", isDirectory: true)
                let folder = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
                directory = folder
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
                let file = folder.appendingPathComponent(descriptor.dmgURL.lastPathComponent)
                guard FileManager.default.createFile(atPath: file.path, contents: nil, attributes: [.posixPermissions: 0o600]) else { throw FlixifyError.updateUnavailable }
                let connection = client
                let worker = Task.detached(priority: .utility) {
                    try await NativeUpdateDownload.fetch(descriptor, file: file, client: connection) { fraction in
                        await MainActor.run { self.progress = fraction }
                    }
                }
                try await withTaskCancellationHandler(operation: { try await worker.value }, onCancel: { worker.cancel() })
                message = "Apple doğrulaması kontrol ediliyor…"
                try await Task.detached(priority: .userInitiated) { try NativeUpdateTrust.verify(file, descriptor: descriptor) }.value
                guard !Task.isCancelled else { throw CancellationError() }
                progress = 1
                FlixifyAnalytics.shared.event("update_downloaded",epoch:analyticsTicket)
                NSWorkspace.shared.open(file)
                message = "Açılan pencerede Flixify Pro’yu Uygulamalar klasörüne sürükleyebilirsin."
                directory = nil
            } catch is CancellationError { message = "İndirme iptal edildi." }
            catch { message = "Güncelleme güvenlik denetiminden geçmedi; kurulum açılmadı." }
            if let directory { try? FileManager.default.removeItem(at: directory) }
        }
    }
    func cancel() { task?.cancel(); client.invalidateAndCancel() }
}

private enum NativeUpdateDownload {
    static func fetch(_ descriptor: NativeUpdateDescriptor, file: URL, client: URLSession, progress: @escaping @Sendable (Double) async -> Void) async throws {
        let handle = try FileHandle(forWritingTo: file); defer { try? handle.close() }
        let (stream, response) = try await client.bytes(from: descriptor.dmgURL)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, response.url == descriptor.dmgURL,
            response.expectedContentLength == -1 || response.expectedContentLength == Int64(descriptor.sizeBytes) else { throw FlixifyError.updateUnavailable }
        var buffer = Data(), written = 0
        for try await byte in stream {
            try Task.checkCancellation()
            guard written + buffer.count < descriptor.sizeBytes else { throw FlixifyError.limit }
            buffer.append(byte)
            if buffer.count == 65_536 {
                try handle.write(contentsOf: buffer); written += buffer.count; buffer.removeAll(keepingCapacity: true)
                await progress(Double(written) / Double(descriptor.sizeBytes))
            }
        }
        try handle.write(contentsOf: buffer); try handle.synchronize(); try handle.close()
        try Task.checkCancellation()
        try NativeUpdatePolicy.verifyFile(file, descriptor: descriptor)
    }
}

enum NativeUpdateTrust {
    @discardableResult
    private static func run(_ executable: String, _ arguments: [String]) throws -> String {
        let process = Process(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: executable); process.arguments = arguments
        process.standardOutput = output; process.standardError = output
        let timer = DispatchSource.makeTimerSource(queue: .global())
        timer.schedule(deadline: .now() + 40)
        timer.setEventHandler {
            if process.isRunning {
                process.terminate()
                DispatchQueue.global().asyncAfter(deadline: .now() + 5) { if process.isRunning { kill(process.processIdentifier, SIGKILL) } }
            }
        }
        timer.resume(); defer { timer.cancel() }
        try process.run()
        let data = output.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0, data.count < 65_536 else { throw FlixifyError.updateUnavailable }
        return String(decoding: data, as: UTF8.self)
    }
    private static func team(_ output: String) throws -> String {
        guard output.contains("Authority=Developer ID Application:"),
            let line = output.split(separator: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") }) else { throw FlixifyError.updateUnavailable }
        let value = String(line.dropFirst("TeamIdentifier=".count))
        guard value.range(of: #"^[A-Z0-9]{10}$"#, options: .regularExpression) != nil else { throw FlixifyError.updateUnavailable }
        return value
    }
    static func verify(_ file: URL, descriptor: NativeUpdateDescriptor) throws {
        let currentTeam = try team(run("/usr/bin/codesign", ["-d", "--verbose=4", Bundle.main.bundleURL.path]))
        try run("/usr/bin/codesign", ["--verify", "--strict", file.path])
        guard try team(run("/usr/bin/codesign", ["-d", "--verbose=4", file.path])) == currentTeam else { throw FlixifyError.updateUnavailable }
        let gatekeeper = try run("/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", "-vv", file.path])
        guard gatekeeper.contains("Notarized Developer ID") else { throw FlixifyError.updateUnavailable }
        let mount = file.deletingLastPathComponent().appendingPathComponent("VerifiedImage", isDirectory: true)
        try FileManager.default.createDirectory(at: mount, withIntermediateDirectories: false)
        try run("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount.path, file.path])
        defer { _ = try? run("/usr/bin/hdiutil", ["detach", mount.path]) }
        let app = mount.appendingPathComponent("Flixify Pro.app", isDirectory: true)
        let plist = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
        guard let info = try PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any],
            info["CFBundleIdentifier"] as? String == "vip.flixify.mac",
            info["CFBundleShortVersionString"] as? String == descriptor.versionName,
            info["CFBundleVersion"] as? String == String(descriptor.buildNumber),
            try team(run("/usr/bin/codesign", ["-d", "--verbose=4", app.path])) == currentTeam else { throw FlixifyError.updateUnavailable }
        try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app.path])
        try run("/usr/sbin/spctl", ["--assess", "--type", "execute", "-vv", app.path])
        guard let executable = info["CFBundleExecutable"] as? String, !executable.contains("/") else { throw FlixifyError.updateUnavailable }
        try UniversalBinaryPolicy.verify(app.appendingPathComponent("Contents/MacOS/" + executable))
    }
}
