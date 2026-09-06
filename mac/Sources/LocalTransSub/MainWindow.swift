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
import TransSubKit

@MainActor
final class MainWindowController: NSObject, NSToolbarDelegate {
    private var window: NSWindow?
    private let app: AppController
    private var cancellables = Set<AnyCancellable>()
    private var toggleItem: NSToolbarItem?
    private var statusItem: NSToolbarItem?

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
        let w = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false)
        w.title = "yraverageSub"
        w.isReleasedWhenClosed = false
        w.contentView = NSHostingView(rootView: MainView(app: app))
        let toolbar = NSToolbar(identifier: "TransSubSession")
        toolbar.delegate = self
        toolbar.displayMode = .iconAndLabel
        w.toolbar = toolbar
        w.setFrameAutosaveName("LocalTransSubMain")
        app.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.refreshSessionItems() }
            .store(in: &cancellables)
        // Back to menu-bar-only when the window closes.
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: w, queue: .main
        ) { _ in
            Task { @MainActor in
                if Prefs.shared.hideDockIcon { NSApp.setActivationPolicy(.accessory) }
            }
        }
        window = w
        refreshSessionItems()
    }

    // MARK: - Session toolbar (NSToolbarDelegate)

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.toggleSession, .flexibleSpace, .sessionStatus]
    }

    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.toggleSession, .flexibleSpace, .sessionStatus]
    }

    func toolbar(
        _ toolbar: NSToolbar,
        itemForItemIdentifier id: NSToolbarItem.Identifier,
        willBeInsertedIntoToolbar flag: Bool
    ) -> NSToolbarItem? {
        switch id {
        case .toggleSession:
            let item = NSToolbarItem(itemIdentifier: id)
            item.label = "Sesi"
            item.toolTip = "Mulai / hentikan subtitel (⌘⇧S)"
            let button = NSButton(title: "", target: self, action: #selector(toggleSession))
            button.bezelStyle = .rounded
            item.view = button
            toggleItem = item
            refreshSessionItems()
            return item
        case .sessionStatus:
            let item = NSToolbarItem(itemIdentifier: id)
            item.label = "Status"
            let label = NSTextField(labelWithString: "")
            label.font = .systemFont(ofSize: 11)
            label.textColor = .secondaryLabelColor
            item.view = label
            statusItem = item
            refreshSessionItems()
            return item
        default:
            return nil
        }
    }

    @objc private func toggleSession() {
        app.toggle()
    }

    private func refreshSessionItems() {
        if let button = toggleItem?.view as? NSButton {
            button.title = app.isRunning ? "■ Stop" : "▶ Start"
        }
        if let label = statusItem?.view as? NSTextField {
            label.stringValue = app.isRunning
                ? (app.status.isEmpty ? "Listening…" : app.status)
                : (app.error.isEmpty ? "Idle" : app.error)
        }
    }
}

private extension NSToolbarItem.Identifier {
    static let toggleSession = NSToolbarItem.Identifier("com.localtranssub.toggleSession")
    static let sessionStatus = NSToolbarItem.Identifier("com.localtranssub.sessionStatus")
}
