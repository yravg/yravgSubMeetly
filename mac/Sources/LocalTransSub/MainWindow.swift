// AppKit-owned main window.
//
// Using an NSWindow instead of a SwiftUI `Window` scene so the app can open it
// programmatically (first launch, menu item) — a menu-bar-only app that shows
// nothing on first launch leaves the user with no way to grant permissions.
import AppKit
import SwiftUI
import TransSubKit

@MainActor
final class MainWindowController {
    private var window: NSWindow?
    private let app: AppController

    init(app: AppController) {
        self.app = app
    }

    func show() {
        if window == nil {
            build()
            window?.center()
        }
        // A menu-bar-only app still needs a Dock presence to show a real window,
        // so borrow .regular while one is open.
        if Prefs.shared.hideDockIcon { NSApp.setActivationPolicy(.regular) }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    private func build() {
        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        w.title = "yraverageSub"
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: MainView(app: app))
        w.setFrameAutosaveName("LocalTransSubMain")
        // Back to menu-bar-only when the window closes.
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: w, queue: .main
        ) { _ in
            Task { @MainActor in
                if Prefs.shared.hideDockIcon { NSApp.setActivationPolicy(.accessory) }
            }
        }
        window = w
    }
}
