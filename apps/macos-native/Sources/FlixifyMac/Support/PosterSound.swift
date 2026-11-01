import AppKit

@MainActor final class PosterSound {
    static let shared = PosterSound()
    private let sound: NSSound?
    private var lastKey = ""
    private init() {
        sound = AppResources.url("poster_move", extension: "wav").flatMap { NSSound(contentsOf: $0, byReference: false) }
        sound?.volume = 0.6
    }
    func focused(_ key: String) {
        guard key != lastKey else { return }; lastKey = key
        guard UserDefaults.standard.object(forKey: "posterSoundEnabled") as? Bool ?? true else { return }
        sound?.stop(); sound?.play()
    }
    func stop() { sound?.stop(); lastKey = "" }
}
