// `--focus-probe`: membuktikan overlay mengambang tidak merampas fokus.
//
// "Merebut fokus" hanya bermakna ANTAR proses, jadi kebenarannya ada di
// NSWorkspace.frontmostApplication. NSApp.isActive dan NSPanel.isKeyWindow
// adalah pandangan aplikasi ini tentang dirinya sendiri — menguatkan, bukan
// menggantikan.
//
// Sengaja TRI-STATE: bila baseline tak bisa dibangun (tak ada aplikasi lain di
// depan), hasilnya UNKNOWN. Pengukuran yang gagal diambil tidak boleh terbaca
// sebagai PASS.
import AppKit
import SubMinKit

@MainActor
enum FocusProbe {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-focus.txt")

    static func run(controller: AppController, decoy: String?, settle: Double) async {
        var out: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[focus] %@", s)
            try? out.joined(separator: "\n").write(to: reportPath, atomically: true, encoding: .utf8)
        }

        let me = Bundle.main.bundleIdentifier ?? "unknown"
        say("self bundle id     : \(me)")

        // Diagnostik tidak boleh mengubah tata letak pengguna.
        let savedFrame = Prefs.shared.overlayFrame
        defer { Prefs.shared.overlayFrame = savedFrame }

        if let decoy, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: decoy) {
            let cfg = NSWorkspace.OpenConfiguration()
            cfg.activates = true
            _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: cfg)
            // Aktivasi butuh beberapa putaran runloop. Tunggu sampai umpan
            // BENAR-BENAR di depan; kalau baseline diambil terlalu cepat, aktivasi
            // yang menyusul akan terbaca sebagai "fokus berpindah" padahal itu
            // ulah probe sendiri.
            var settled = false
            for _ in 0..<Int(max(1, settle) * 10) {
                if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == decoy {
                    settled = true
                    break
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            say("decoy activated    : \(decoy)\(settled ? "" : " (TIDAK sempat ke depan)")")
            guard settled else {
                say("RESULT: UNKNOWN — umpan tidak sempat menjadi frontmost; baseline tidak sah")
                return
            }
        } else {
            say("decoy activated    : none")
            try? await Task.sleep(nanoseconds: UInt64(max(0.5, settle) * 1_000_000_000))
        }

        guard let before = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else {
            say("RESULT: UNKNOWN — tidak ada aplikasi frontmost terbaca")
            return
        }
        say("frontmost BEFORE   : \(before)")
        guard before != me else {
            say("RESULT: UNKNOWN — aplikasi ini sudah frontmost sebelum overlay tampil, "
                + "jadi 'tidak berubah' tidak membuktikan apa pun. Jalankan dengan --decoy.")
            return
        }

        controller.showOverlayDemo()
        try? await Task.sleep(nanoseconds: 1_200_000_000)

        guard let panel = NSApp.windows.first(where: { $0 is NSPanel && $0.isVisible }) as? NSPanel
        else {
            say("RESULT: UNKNOWN — panel overlay tidak terlihat; tidak ada yang diukur")
            return
        }
        say("canBecomeKey       : \(panel.canBecomeKey)  (harus false)")
        say("canBecomeMain      : \(panel.canBecomeMain) (harus false)")
        say("nonactivatingPanel : \(panel.styleMask.contains(.nonactivatingPanel))")

        var failures: [String] = []
        var noise: [String] = []
        func check(_ label: String) {
            let now = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
            say("[\(label)] frontmost=\(now ?? "nil") appActive=\(NSApp.isActive) panelKey=\(panel.isKeyWindow)")
            // Yang diuji: fokus tidak boleh berpindah KE aplikasi ini.
            if now == me { failures.append("\(label): frontmost menjadi aplikasi ini") }
            else if now != before { noise.append("\(label): \(before) → \(now ?? "nil") (aplikasi lain, bukan kita)") }
            if NSApp.isActive { failures.append("\(label): NSApp.isActive jadi true") }
            if panel.isKeyWindow { failures.append("\(label): panel jadi key window") }
        }
        check("show")

        // Ulangi setelah interaksi yang dilakukan aplikasi sendiri.
        controller.overlay.show()
        let f = panel.frame
        panel.setFrame(NSRect(x: f.origin.x + 40, y: f.origin.y + 30, width: f.width, height: f.height), display: true)
        try? await Task.sleep(nanoseconds: 800_000_000)
        check("interact")
        panel.setFrame(f, display: true)

        if panel.canBecomeKey { failures.append("panel.canBecomeKey masih true") }
        if !noise.isEmpty { say("catatan derau      : " + noise.joined(separator: "; ")) }
        say(failures.isEmpty
            ? "RESULT: PASS — fokus tidak pernah pindah ke aplikasi ini, app tidak aktif, panel tidak pernah key"
            : "RESULT: FAIL — " + failures.joined(separator: "; "))
        controller.overlay.hide()
        say("REPORT COMPLETE")
    }
}
