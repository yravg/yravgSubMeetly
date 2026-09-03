// Live view of which translation models are installed, shown in Settings so
// the state is visible without starting a session first.
import AppKit
import Foundation
import TransSubKit

struct PairStatus: Identifiable, Sendable {
    let id: String
    let label: String
    var fast: TranslationAvailability
    var standard: TranslationAvailability

    /// Best case wins: the fast model is what makes subtitles feel instant.
    var summary: String {
        switch (fast, standard) {
        case (.ready, _): return "instant (low-latency installed)"
        case (_, .ready): return "~0.4 s (high-fidelity only)"
        case (.unsupported, .unsupported): return "not supported"
        default: return "not installed"
        }
    }

    var isGood: Bool { fast == .ready }
    var isUsable: Bool { fast == .ready || standard == .ready }
}

@MainActor
final class LanguageStatusModel: ObservableObject {
    @Published var pairs: [PairStatus] = []
    @Published var checking = false
    @Published var lastChecked: Date?

    /// Checks the configured pair plus its reverse — the two a user actually
    /// switches between.
    func refresh() async {
        guard #available(macOS 26.0, *), !checking else { return }
        checking = true
        defer { checking = false }

        let prefs = Prefs.shared
        let src = Languages.baseCode(prefs.sourceLocale)
        let tgt = prefs.targetLanguage
        var wanted: [(String, String)] = [(src, tgt)]
        if src != tgt { wanted.append((tgt, src)) }

        var out: [PairStatus] = []
        for (a, b) in wanted {
            let s = await Translator.strategyStatus(from: a, to: b)
            out.append(
                PairStatus(
                    id: "\(a)>\(b)",
                    label: "\(Languages.targetName(a)) → \(Languages.targetName(b))",
                    fast: s.fast, standard: s.standard))
        }
        pairs = out
        lastChecked = Date()
    }

    /// Opens System Settings at Language & Region, where the Translation
    /// Languages sheet lives.
    func openSystemSettings() {
        let candidates = [
            "x-apple.systempreferences:com.apple.Localization-Settings.extension",
            "x-apple.systempreferences:com.apple.preference.general",
        ]
        for raw in candidates {
            if let url = URL(string: raw), NSWorkspace.shared.open(url) { return }
        }
    }
}
