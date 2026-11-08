// AppKit-owned main window.
//
// Using an NSWindow instead of a SwiftUI `Window` scene so the app can open it
// programmatically (first launch, menu item) — a menu-bar-only app that shows
// nothing on first launch leaves the user with no way to grant permissions.
//
// Kendali sesi di toolbar jendela (Start/Stop + status) supaya sesi selalu
// terjangkau tanpa menggulir isi LiveView — tetap AppKit/SwiftUI asli.
import AppKit
import Combine
import SwiftUI
import SubMinKit

@MainActor
final class MainWindowController: NSObject {
    private var window: NSWindow?
    private let app: AppController
    private var cancellables = Set<AnyCancellable>()

    init(app: AppController) {
        self.app = app
        super.init()
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
        // Kerangka dua panel ala Meetily: konten ukuran penuh dengan bilah judul
        // transparan, sehingga lampu lalu-lintas duduk di atas sidebar. Kendali
        // Start/Stop kini selalu terlihat di sidebar dan pil rekam, jadi
        // NSToolbar lama tidak lagi diperlukan; ⌘⇧S tetap lewat menu bar extra.
        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        w.title = "yravgSubMeetly"
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        w.isMovableByWindowBackground = false
        w.minSize = NSSize(width: 900, height: 600)
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: AppShellView(app: app))
        w.setFrameAutosaveName("yraverageSubMinShell")
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
