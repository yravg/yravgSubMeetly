// `--overlay-probe`: shows the overlay and reports whether the window can
// actually be moved and resized, by inspecting its style and by performing
// real frame changes and reading the result back.
import AppKit
import TransSubKit

@MainActor
enum OverlayProbe {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-overlay.txt")

    static func run(controller: AppController) async {
        var out: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[overlay] %@", s)
            try? out.joined(separator: "\n").write(to: reportPath, atomically: true, encoding: .utf8)
        }

        // Diagnostics must not change the user's saved layout.
        let savedFrame = Prefs.shared.overlayFrame
        defer { Prefs.shared.overlayFrame = savedFrame }
        // Tempuh inisialisasi yang sama dengan aplikasi sungguhan, kalau tidak
        // probe menguji objek yang belum terpasang wiring-nya (observer
        // preferensi dipasang di bootstrap) dan hasilnya menyesatkan.
        controller.bootstrap()
        controller.showOverlayDemo()
        try? await Task.sleep(nanoseconds: 1_500_000_000)

        guard let w = NSApp.windows.first(where: { $0 is NSPanel && $0.isVisible }) else {
            say("RESULT: FAIL — no visible overlay panel")
            return
        }
        let m = w.styleMask
        say("resizable          : \(m.contains(.resizable))")
        say("titled             : \(m.contains(.titled))")
        // NB: .borderless is rawValue 0, so `contains(.borderless)` is true for
        // every style mask — it can never be used as a test.
        say("titled (not borderless): \(m.contains(.titled))")
        say("fullSizeContent    : \(m.contains(.fullSizeContentView))")
        say("movableByBackground: \(w.isMovableByWindowBackground)")
        say("minSize            : \(w.minSize.width)x\(w.minSize.height)")
        say("level              : \(w.level.rawValue)")

        // Move it.
        let start = w.frame
        let moved = NSRect(x: start.origin.x + 120, y: start.origin.y + 90,
                           width: start.width, height: start.height)
        w.setFrame(moved, display: true)
        try? await Task.sleep(nanoseconds: 400_000_000)
        let afterMove = w.frame
        say("move  \(Int(start.origin.x)),\(Int(start.origin.y)) → "
            + "\(Int(afterMove.origin.x)),\(Int(afterMove.origin.y)): "
            + (afterMove.origin != start.origin ? "OK" : "FAILED"))

        // Resize both axes.
        let bigger = NSRect(x: afterMove.origin.x, y: afterMove.origin.y,
                            width: afterMove.width + 220, height: afterMove.height + 160)
        w.setFrame(bigger, display: true)
        try? await Task.sleep(nanoseconds: 400_000_000)
        let afterResize = w.frame
        say("resize \(Int(afterMove.width))x\(Int(afterMove.height)) → "
            + "\(Int(afterResize.width))x\(Int(afterResize.height)): "
            + (afterResize.width > afterMove.width && afterResize.height > afterMove.height
               ? "OK" : "FAILED"))

        // Shrink below the minimum to confirm the clamp works.
        w.setFrame(NSRect(x: afterResize.origin.x, y: afterResize.origin.y, width: 100, height: 40),
                   display: true)
        try? await Task.sleep(nanoseconds: 400_000_000)
        say("min clamp          : \(Int(w.frame.width))x\(Int(w.frame.height)) "
            + "(floor \(Int(w.minSize.width))x\(Int(w.minSize.height)))")

        // Preferensi tampilan harus BERLAKU pada overlay yang sedang tampil,
        // bukan hanya tersimpan. Ubah lewat PrefsBridge (jalur yang dipakai
        // Settings) lalu periksa modelnya ikut berubah.
        let bridge = PrefsBridge.shared
        let savedFont = bridge.fontSize
        let savedOpacity = bridge.opacity
        bridge.fontSize = savedFont == 30 ? 22 : 30
        bridge.opacity = savedOpacity == 0.5 ? 0.9 : 0.5
        try? await Task.sleep(nanoseconds: 300_000_000)
        let fontApplied = controller.overlayModel.fontSize == bridge.fontSize
        let opacityApplied = controller.overlayModel.opacity == bridge.opacity
        say("live font applied  : \(fontApplied) (prefs \(bridge.fontSize) → model \(controller.overlayModel.fontSize))")
        say("live opacity applied: \(opacityApplied) (prefs \(bridge.opacity) → model \(controller.overlayModel.opacity))")
        bridge.fontSize = savedFont
        bridge.opacity = savedOpacity

        let ok = fontApplied && opacityApplied && m.contains(.resizable) && m.contains(.titled)
            && afterMove.origin != start.origin
            && afterResize.width > afterMove.width && afterResize.height > afterMove.height
        say(ok ? "RESULT: PASS — movable and resizable" : "RESULT: FAIL")
        w.setFrame(start, display: true)
    }
}
