import AppKit
import FlixifyCore
import SwiftUI

final class FlixifyAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

@main struct FlixifyApp: App {
    @NSApplicationDelegateAdaptor(FlixifyAppDelegate.self) private var delegate
    @StateObject private var store: AppStore
    init() {
        #if FIXTURE_QA
        if CommandLine.arguments.contains("--fixture-catalog") {
            _store = StateObject(wrappedValue: AppStore(repository: FixtureRepository(), fixtureMode: true))
            return
        }
        #endif
        _store = StateObject(wrappedValue: AppStore(repository: FlixifyRepository()))
    }
    var body: some Scene {
        WindowGroup("Flixify Pro") {
            RootView().environmentObject(store).preferredColorScheme(.dark)
                .frame(minWidth: 900, minHeight: 620)
        }
        .defaultSize(width: 1280, height: 800)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) { }
            CommandMenu("İçerikler") {
                Button("Ara") { store.showSearch = true }.keyboardShortcut("f").disabled(store.session == nil || store.showWelcome)
                Divider()
                ForEach(Array(AppRoute.allCases.enumerated()), id: \.element.id) { index, route in
                    Button(route.title) { store.navigate(route) }.keyboardShortcut(KeyEquivalent(Character(String(index + 1))))
                        .disabled(store.session == nil || store.showWelcome)
                }
                Divider()
                Button("İçerikleri yenile") { Task { await store.loadCatalogs(force: true) } }.keyboardShortcut("r").disabled(store.session == nil)
            }
            CommandGroup(replacing: .help) {
                Button("Flixify Destek") { store.openWebsite("https://flixify.vip/iletisim") }
            }
        }
        Settings { AppSettingsView().preferredColorScheme(.dark) }
    }
}
