// `--bench-translate`: measures real translation latency per strategy from
// inside the app bundle. A bare CLI binary cannot reach the Translation
// daemon (it hangs), so the benchmark has to live here.
import AppKit
import Foundation
import Translation
import TransSubKit

@available(macOS 26.0, *)
enum BenchTranslate {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-bench.txt")

    private static let lines = [
        "Hello everyone.",
        "This is a local subtitle test.",
        "Machine learning runs completely on this device.",
        "How are you doing today?",
        "Use very simple Chinese, hope you understand.",
        "We will speak a little more slowly.",
        "If you are a beginner, do not worry.",
    ]

    @MainActor
    static func run(source: String, target: String) async {
        var out: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[bench] %@", s)
            try? out.joined(separator: "\n").write(to: reportPath, atomically: true, encoding: .utf8)
        }
        func ms(_ t: Date) -> String { String(format: "%.0f", Date().timeIntervalSince(t) * 1000) }

        let src = Locale.Language(identifier: source)
        let tgt = Locale.Language(identifier: target)
        say("pair: \(source) → \(target)")
        let both = await Translator.strategyStatus(from: source, to: target)
        say("strategyStatus -> fast: \(both.fast)  standard: \(both.standard)")

        for lowLatency in [true, false] {
            let name = lowLatency ? "lowLatency" : "highFidelity"
            let availability: LanguageAvailability
            if #available(macOS 26.4, *) {
                availability = LanguageAvailability(
                    preferredStrategy: lowLatency ? .lowLatency : .highFidelity)
            } else {
                availability = LanguageAvailability()
            }
            let status = await availability.status(from: src, to: tgt)
            say("\n[\(name)] status: \(status)")
            guard status == .installed else {
                say("[\(name)] not installed — skipped")
                continue
            }

            let session: TranslationSession
            if #available(macOS 26.4, *) {
                session = TranslationSession(
                    installedSource: src, target: tgt,
                    preferredStrategy: lowLatency ? .lowLatency : .highFidelity)
            } else {
                session = TranslationSession(installedSource: src, target: tgt)
            }
            do {
                var t = Date()
                try await session.prepareTranslation()
                say("[\(name)] prepare: \(ms(t)) ms")
                t = Date()
                _ = try await session.translate(lines[0])
                say("[\(name)] first  : \(ms(t)) ms")

                var times: [Double] = []
                for line in lines {
                    let t2 = Date()
                    _ = try await session.translate(line)
                    times.append(Date().timeIntervalSince(t2) * 1000)
                }
                let avg = times.reduce(0, +) / Double(times.count)
                say(String(format: "[%@] warm   : avg %.0f ms  min %.0f  max %.0f",
                           name, avg, times.min() ?? 0, times.max() ?? 0))
            } catch {
                say("[\(name)] THREW: \(error)")
            }
        }
        say("\ndone")
    }
}
