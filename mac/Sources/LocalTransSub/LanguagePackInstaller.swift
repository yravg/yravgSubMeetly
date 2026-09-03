// Requests Apple language-model downloads from inside the app.
//
// Apple gates pack installation behind a SwiftUI view modifier: a session
// vended by `.translationTask` reports `canRequestDownloads == true`, so
// `prepareTranslation()` presents the system "Download language?" sheet. A
// session built with `TranslationSession(installedSource:)` reports false and
// simply throws — which is why this needs a hosted view rather than a plain
// async call.
//
// `_Translation_SwiftUI` is imported explicitly: the Translation↔SwiftUI
// cross-import overlay does not auto-load under Command Line Tools, which is
// what made `.translationTask` look unavailable.
import AppKit
import SwiftUI
import Translation
import _Translation_SwiftUI
import TransSubKit

@MainActor
final class LanguagePackInstaller: ObservableObject {
    @Published var configuration: TranslationSession.Configuration?
    @Published var status: String = ""
    @Published var busy = false

    /// Ask the system to install the fast (low-latency) model for a pair.
    /// Falls back to requesting the high-fidelity model when low-latency is
    /// unsupported for that pair.
    func install(from source: String, to target: String, lowLatency: Bool = true) {
        busy = true
        status = "Requesting \(Languages.targetName(target)) model…"
        let src = Locale.Language(identifier: source)
        let tgt = Locale.Language(identifier: target)
        // A fresh Configuration instance is required — reassigning an equal one
        // does not re-fire .translationTask.
        if #available(macOS 26.4, *), lowLatency {
            configuration = TranslationSession.Configuration(
                source: src, target: tgt, preferredStrategy: .lowLatency)
        } else {
            configuration = TranslationSession.Configuration(source: src, target: tgt)
        }
    }

    /// Called by the host once the session work is done. Only Sendable values
    /// cross the boundary — `TranslationSession` itself must never leave the
    /// `.translationTask` closure (it is not Sendable).
    func finish(ok: Bool, message: String?) {
        busy = false
        configuration = nil
        status = ok
            ? "✅ Model ready — stop and restart subtitles to use it."
            : "Could not install: \(message ?? "unknown error")"
    }
}

/// Invisible host that gives the installer a place to run.
struct LanguagePackHost: ViewModifier {
    @ObservedObject var installer: LanguagePackInstaller

    func body(content: Content) -> some View {
        content.translationTask(installer.configuration) { session in
            // `TranslationSession` is not Sendable and its methods run
            // off-actor, so passing it out of this main-actor closure trips
            // Swift 6's region isolation. Exactly one task ever touches this
            // session and SwiftUI keeps it alive for the closure's lifetime,
            // so the transfer is safe.
            nonisolated(unsafe) let s = session
            do {
                // Presents the system "Download language?" sheet when missing.
                try await s.prepareTranslation()
                _ = try? await s.translate("Hello.")
                installer.finish(ok: true, message: nil)
            } catch {
                installer.finish(ok: false, message: error.localizedDescription)
            }
        }
    }
}

extension View {
    func languagePackHost(_ installer: LanguagePackInstaller) -> some View {
        modifier(LanguagePackHost(installer: installer))
    }
}
