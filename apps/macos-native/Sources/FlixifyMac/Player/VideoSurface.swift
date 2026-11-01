import AppKit
import SwiftUI
import VLCKit

@MainActor
struct VideoSurface: NSViewRepresentable {
    let controller: PlaybackController

    func makeNSView(context: Context) -> InteractiveVideoView {
        let view = InteractiveVideoView(frame: .zero)
        view.backColor = .black
        view.fillScreen = false
        view.onActivity = { [weak controller] in controller?.activity() }
        view.onToggle = { [weak controller] in controller?.togglePlayback() }
        view.onFullscreen = { [weak controller] in controller?.toggleFullscreen() }
        view.onWindow = { [weak controller] window in controller?.window = window }
        controller.session.attach(view)
        return view
    }

    func updateNSView(_ nsView: InteractiveVideoView, context: Context) {}
}

@MainActor
final class InteractiveVideoView: VLCVideoView {
    var onActivity: () -> Void = {}
    var onToggle: () -> Void = {}
    var onFullscreen: () -> Void = {}
    var onWindow: (NSWindow?) -> Void = { _ in }
    private var tracking: NSTrackingArea?
    private var singleClick: DispatchWorkItem?

    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        window?.acceptsMouseMovedEvents = true
        onWindow(window)
    }

    override func updateTrackingAreas() {
        if let tracking { removeTrackingArea(tracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        self.tracking = tracking
        super.updateTrackingAreas()
    }

    override func mouseMoved(with event: NSEvent) { onActivity() }
    override func mouseEntered(with event: NSEvent) { onActivity() }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        onActivity()
        singleClick?.cancel()
        if event.clickCount > 1 { onFullscreen(); return }
        let item = DispatchWorkItem { [weak self] in self?.onToggle() }
        singleClick = item
        DispatchQueue.main.asyncAfter(deadline: .now() + NSEvent.doubleClickInterval, execute: item)
    }
}

@MainActor
final class PlayerKeyboardMonitor: ObservableObject {
    private var monitor: Any?

    func install(controller: PlaybackController, handler: @escaping (NSEvent) -> Bool) {
        remove()
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak controller] event in
            guard let controller, let window = controller.window, NSApp.keyWindow === window else { return event }
            if window.firstResponder is NSTextView { return event }
            return handler(event) ? nil : event
        }
    }

    func remove() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
    }

    deinit { if let monitor { NSEvent.removeMonitor(monitor) } }
}
