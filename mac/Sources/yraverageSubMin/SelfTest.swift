// End-to-end self test (`--selftest`): runs the real pipeline — system audio
// capture → transcription → translation → overlay — against audio played
// through the speakers, and writes the result to /tmp/transsub-selftest.txt.
import AppKit
import Foundation
import SubMinKit

enum SelfTest {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-selftest.txt")

    @MainActor
    static func run(controller: AppController, wav: String?, seconds: Double) async {
        var out: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[selftest] %@", s)
            try? out.joined(separator: "\n").write(
                to: reportPath, atomically: true, encoding: .utf8)
        }

        guard #available(macOS 26.0, *) else {
            say("needs macOS 26+")
            return
        }

        // Force a known-good configuration for the run.
        let prefs = Prefs.shared
        prefs.sourceLocale = "en-US"
        prefs.targetLanguage = "zh-Hans"
        prefs.translateEnabled = true
        prefs.dualLine = true

        say("source=\(prefs.sourceLocale) target=\(prefs.targetLanguage) translate=on")
        say("screen permission: \(AudioCapture.hasPermission())")

        await controller.refreshTargets()
        let target = CaptureTarget.systemWide
        say("capturing: \(target.name)")

        await controller.session.start(target: target)
        say("status: \(controller.session.statusText)")
        if !controller.session.errorText.isEmpty {
            say("error: \(controller.session.errorText)")
        }
        if !controller.session.translationNote.isEmpty {
            say("note: \(controller.session.translationNote)")
        }
        guard controller.session.isRunning else {
            say("RESULT: FAILED — session did not start")
            return
        }

        // Play the audio into the system output so capture picks it up.
        if let wav {
            say("playing: \(wav)")
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/usr/bin/afplay")
            p.arguments = [wav]
            try? p.run()
        }

        // Watch the overlay while audio plays: when does translated text first
        // appear, and how often does the live line update? This is the number
        // the viewer actually feels — not the per-call engine time.
        let t0 = Date()
        var firstInterim: Double?
        var firstFinal: Double?
        var interimUpdates = 0
        var lastInterim = ""
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            try? await Task.sleep(nanoseconds: 60_000_000)
            if let itm = controller.overlayModel.interim, !itm.translation.isEmpty {
                if itm.translation != lastInterim {
                    lastInterim = itm.translation
                    interimUpdates += 1
                    if firstInterim == nil { firstInterim = Date().timeIntervalSince(t0) }
                }
            }
            if firstFinal == nil,
               controller.overlayModel.cues.contains(where: { !$0.translation.isEmpty }) {
                firstFinal = Date().timeIntervalSince(t0)
            }
        }
        say(String(format: "first live translation : %@",
                   firstInterim.map { String(format: "%.2f s", $0) } ?? "never"))
        say(String(format: "first finished line    : %@",
                   firstFinal.map { String(format: "%.2f s", $0) } ?? "never"))
        say("live updates while speaking: \(interimUpdates)")

        let lines = controller.session.lines
        say("lines: \(lines.count)")
        for l in lines {
            say(String(format: "  [%.1f–%.1f] %@ | %@", l.start, l.end, l.source, l.translation))
        }
        let last = controller.overlayModel.cues.last
        say("overlay lines: \(controller.overlayModel.cues.count)")
        say("overlay last source: \(last?.source ?? "-")")
        say("overlay last translation: \(last?.translation ?? "-")")

        await controller.session.stop()

        // Transkrip sesi terakhir harus SELAMAT dari stop, kalau tidak menu
        // Export (yang digating oleh lines.isEmpty) hilang begitu sesi berhenti
        // dan pengguna kehilangan hasilnya.
        let afterStop = controller.session.lines
        say("lines setelah stop : \(afterStop.count)")
        if let last = afterStop.last {
            let srt = SubtitleExporter.format([last], as: .srt, dualLine: false)
            say("contoh SRT sesi terakhir: \(srt.replacingOccurrences(of: "\n", with: " ⏎ ").prefix(90))")
        }
        say(afterStop.isEmpty
            ? "EXPORT-AFTER-STOP: FAIL — transkrip hilang saat sesi dihentikan"
            : "EXPORT-AFTER-STOP: PASS — \(afterStop.count) baris masih bisa diekspor")

        let transcript = lines.map(\.source).joined(separator: " ")
        let translated = lines.filter { !$0.translation.isEmpty }.count
        if transcript.isEmpty {
            say("RESULT: FAILED — no transcript")
        } else if prefs.translateEnabled && translated == 0 {
            say("RESULT: PARTIAL — transcribed but nothing translated")
        } else {
            say("RESULT: PASS — \(lines.count) lines, \(translated) translated")
        }
    }
}
