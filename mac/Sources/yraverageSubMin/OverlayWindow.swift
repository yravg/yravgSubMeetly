// The floating subtitle window.
//
// A real non-activating panel that floats above everything (including other
// apps' fullscreen video), never fights page CSS, and can't be blocked by a
// site — the main advantage over the browser extension's in-page overlay.
import AppKit
import SwiftUI
import SubMinKit

/// Panel subtitel yang TIDAK PERNAH bisa mengambil fokus keyboard.
///
/// `.nonactivatingPanel` hanya mencegah *aplikasi* ikut aktif — ia tidak
/// mencegah panel menjadi key window. Sementara `.titled` dan `.resizable`
/// (dipakai agar panel bisa di-drag dan diubah ukurannya) membuat
/// `canBecomeKey` bernilai true secara bawaan. Akibatnya jendela yang sedang
/// diketik pengguna melepas status key: kursor berhenti berkedip dan ketikan
/// nyasar ke panel. Bagi pengguna itu sama saja dengan fokus dirampas.
///
/// `becomesKeyOnlyIfNeeded` tidak cukup: ia justru MEMBERI status key ketika
/// ada view yang butuh first responder (mis. teks yang bisa diseleksi).
private final class NonKeyOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// `NSHostingView` menolak klik pertama di jendela non-key, sehingga setiap
/// kontrol toolbar akan butuh dua klik. Panel ini sengaja tidak pernah key,
/// jadi klik pertama harus tetap diterima.
private final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class OverlayController {
    private var panel: NSPanel?
    private let model: OverlayModel

    init(model: OverlayModel) {
        self.model = model
    }

    var isVisible: Bool { panel?.isVisible ?? false }

    func show() {
        if panel == nil { build() }
        panel?.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    func toggle() {
        isVisible ? hide() : show()
    }

    private func build() {
        let screen = NSScreen.main ?? NSScreen.screens.first!
        let size = NSSize(width: min(760, screen.frame.width * 0.55), height: 300)
        let origin = NSPoint(
            x: screen.frame.midX - size.width / 2,
            y: screen.frame.minY + screen.frame.height * 0.10)

        let p = NonKeyOverlayPanel(
            contentRect: NSRect(origin: origin, size: size),
            // .resizable so the transcript can be sized like the extension panel.
            // .titled + .fullSizeContentView (with the titlebar hidden) instead
            // of .borderless: it looks identical but gives native dragging and
            // native resizing from every edge and corner. A borderless window
            // has no resize hit area at all, so `.resizable` does nothing there.
            styleMask: [
                .titled, .fullSizeContentView, .resizable, .nonactivatingPanel, .utilityWindow,
            ],
            backing: .buffered,
            defer: false)
        p.isFloatingPanel = true
        // Harus SETELAH isFloatingPanel: properti itu menetapkan level .floating,
        // yang akan menimpa nilai ini bila urutannya dibalik.
        // .screenSaver sits above fullscreen video; .statusBar is not enough.
        p.level = .screenSaver
        p.collectionBehavior = [
            .canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle,
        ]
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true
        p.hidesOnDeactivate = false
        p.becomesKeyOnlyIfNeeded = true
        // Hide the titlebar chrome but keep the titlebar's behaviour: the top
        // strip drags the window, and the toolbar's own controls still get
        // their clicks because the content view extends under it.
        p.titlebarAppearsTransparent = true
        p.titleVisibility = .hidden
        p.title = "yraverageSubMin"
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            p.standardWindowButton(button)?.isHidden = true
        }
        // Dragging anywhere that isn't an interactive control also moves it,
        // which matters once the titlebar strip is covered by the toolbar.
        p.isMovableByWindowBackground = true
        p.minSize = NSSize(width: 320, height: 84)
        // Effectively unbounded: let it be dragged as large as the display.
        p.maxSize = NSSize(width: 100_000, height: 100_000)

        let host = FirstMouseHostingView(rootView: OverlayPanelView(model: model))
        host.autoresizingMask = [.width, .height]
        p.contentView = host

        if !Prefs.shared.overlayFrame.isEmpty {
            let saved = NSRectFromString(Prefs.shared.overlayFrame)
            if saved.width >= p.minSize.width, saved.height >= p.minSize.height {
                p.setFrame(saved, display: false)
            }
        }
        for name in [NSWindow.didMoveNotification, NSWindow.didResizeNotification] {
            NotificationCenter.default.addObserver(forName: name, object: p, queue: .main) { note in
                guard let w = note.object as? NSWindow else { return }
                let frame = NSStringFromRect(w.frame)
                Task { @MainActor in Prefs.shared.overlayFrame = frame }
            }
        }
        panel = p
    }

    func resetPosition() {
        move(to: "bottom", animate: true)
    }

    /// Pindah ke preset posisi (top/center/bottom), simpan pilihan + bingkai.
    func move(to position: String) {
        move(to: position, animate: true)
    }

    private func move(to position: String, animate: Bool) {
        guard let screen = NSScreen.main else { return }
        let pos = ["top", "center", "bottom"].contains(position) ? position : "bottom"
        let p = panel
        let size = p?.frame.size ?? NSSize(width: min(760, screen.frame.width * 0.55), height: 300)
        let yFrac = pos == "top" ? 0.72 : pos == "center" ? 0.42 : 0.10
        let origin = NSPoint(
            x: screen.frame.midX - size.width / 2,
            y: screen.frame.minY + screen.frame.height * yFrac)
        if let p {
            p.setFrame(NSRect(origin: origin, size: size), display: true, animate: animate)
            Prefs.shared.overlayFrame = NSStringFromRect(p.frame)
        }
        Prefs.shared.overlayPosition = pos
    }
}

/// Everything the overlay shows, plus the state behind its controls.
@MainActor
final class OverlayModel: ObservableObject {
    /// Finalised lines, oldest first.
    @Published var cues: [SubtitleLine] = []
    /// The line currently being spoken (volatile).
    @Published var interim: SubtitleLine?
    @Published var activeID: UUID?
    @Published var selected: Set<UUID> = []
    /// Bumped whenever new text arrives, so the list can auto-scroll.
    @Published var scrollTick: Int = 0

    @Published var status: String = ""
    @Published var footer: String = ""
    @Published var busy: Bool = false
    @Published var isListening: Bool = false
    @Published var minimized: Bool = false

    @Published var dualLine: Bool = Prefs.shared.dualLine {
        didSet { Prefs.shared.dualLine = dualLine }
    }
    @Published var autoScroll: Bool = Prefs.shared.overlayAutoScroll {
        didSet { Prefs.shared.overlayAutoScroll = autoScroll }
    }
    @Published var refine: Bool = Prefs.shared.refineTranslation {
        didSet {
            Prefs.shared.refineTranslation = refine
            onToggleRefine?(refine)
        }
    }
    @Published var fontSize: Double = Prefs.shared.fontSize
    @Published var opacity: Double = Prefs.shared.opacity

    var onForceTranslate: ((ForceScope) -> Void)?
    var onClose: (() -> Void)?
    var onToggleRefine: ((Bool) -> Void)?

    var untranslatedCount: Int {
        cues.filter { $0.translation.isEmpty && !$0.source.isEmpty }.count
    }

    func clear() {
        cues.removeAll()
        interim = nil
        activeID = nil
        selected.removeAll()
        footer = ""
    }

    func appendFinal(_ line: SubtitleLine) {
        cues.append(line)
        // Bound memory on long sessions.
        let cap = Prefs.shared.maxOverlayCues
        if cues.count > cap { cues.removeFirst(cues.count - cap) }
        interim = nil
        activeID = line.id
        scrollTick &+= 1
    }

    func setInterim(source: String, translation: String) {
        interim = SubtitleLine(start: 0, end: 0, source: source, translation: translation)
        scrollTick &+= 1
    }

    func setTranslation(_ text: String, for id: UUID) {
        guard let i = cues.firstIndex(where: { $0.id == id }) else { return }
        cues[i].translation = text
    }

    /// Load demo cues for UI previews / store screenshots without live capture.
    func loadMockSession() {
        MockSession.apply(to: self)
    }
}
