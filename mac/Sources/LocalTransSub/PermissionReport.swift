// Prints the app's real permission + capability state (`--check-perms`).
// Runs inside the app bundle's own identity, which is the only place these
// answers are meaningful — a CLI probe inherits the terminal's identity.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import TransSubKit

enum PermissionReport {
    // Fixed path on purpose: NSTemporaryDirectory() inside an app bundle points
    // at a per-app container, which is awkward to find from a shell.
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-perms.txt")

    @MainActor
    static func run() async {
        var out: [String] = []
        // Written after every line: SCShareableContent can block forever when
        // Screen Recording is denied, and a partial report still diagnoses that.
        func say(_ s: String) {
            out.append(s)
            NSLog("[perm] %@", s)
            try? out.joined(separator: "\n").write(
                to: reportPath, atomically: true, encoding: .utf8)
        }

        let preflight = CGPreflightScreenCaptureAccess()
        say("bundle id      : \(Bundle.main.bundleIdentifier ?? "nil")")
        say("bundle path    : \(Bundle.main.bundlePath)")
        say("screen preflight: \(preflight)")
        say("accessibility   : \(AXIsProcessTrusted())")

        // Only probe when preflight says yes — the call hangs (no error, no
        // return) if the permission is missing.
        if preflight {
            say("shareable content: probing (5 s timeout)…")
            let result = await withTaskGroup(of: String?.self) { group -> String? in
                group.addTask {
                    do {
                        let targets = try await AudioCapture.availableTargets()
                        let names = targets.prefix(6).filter { !$0.isSystemWide }
                            .map { "\($0.name) [\($0.id)]" }
                        return "OK — \(targets.count) targets: \(names.joined(separator: ", "))"
                    } catch {
                        return "FAILED — \(error.localizedDescription)"
                    }
                }
                group.addTask {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    return nil
                }
                let first = await group.next() ?? nil
                group.cancelAll()
                return first
            }
            say("shareable content: \(result ?? "TIMED OUT — permission is not really granted")")
        } else {
            say("shareable content: skipped (preflight denied)")
        }

        if #available(macOS 26.0, *) {
            let installed = await Transcriber.installedLocales()
            say("speech installed : \(installed.count) locales")
            let src = Languages.baseCode(Prefs.shared.sourceLocale)
            let tgt = Prefs.shared.targetLanguage
            let a = await Translator.availability(from: src, to: tgt)
            say("translate \(src)→\(tgt): \(a)")
            // What does the system think it supports at all?
            let langs = await Translator.supportedLanguageIDs()
            say("translation supportedLanguages (\(langs.count)): \(langs.joined(separator: ", "))")

            // Probe with the system's own language objects — this cannot be
            // fooled by identifier-spelling differences.
            let pairs = await Translator.installedPairs()
            say("INSTALLED PAIRS (\(pairs.count)): \(pairs.isEmpty ? "NONE" : pairs.joined(separator: ", "))")

            say("on-device LLM availability: \(LLMTranslator.availability())")
            // Same path the app uses at session start, with its real error.
            let probe = await LLMTranslator.diagnose(from: "en", to: "zh-Hans")
            say("LLM diagnose: \(probe)")
            if LLMTranslator.availability() == .available {
                let llm = LLMTranslator()
                let t0 = Date()
                let zh = await llm.translate("Machine learning runs completely on this device.",
                                             from: "en", to: "zh-Hans")
                say(String(format: "LLM en→zh (%.0f ms): %@", Date().timeIntervalSince(t0) * 1000, zh))
                let ja = await llm.translate("This is a local subtitle test.", from: "en", to: "ja")
                say("LLM en→ja: \(ja)")
            }

            if CommandLine.arguments.contains("--try-download") {
                say("download probe en→zh-Hans: \(await Translator.probeDownload(from: "en", to: "zh-Hans"))")
            }

            for code in ["en", "ja", "zh-Hans"] {
                let r = await Translator.resolve(code)
                say("resolve \(code) → \(r?.maximalIdentifier ?? "nil")")
            }
        }

        say("REPORT COMPLETE")
        print(out.joined(separator: "\n"))
    }
}
