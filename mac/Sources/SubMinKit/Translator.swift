// On-device translation via Apple's Translation framework.
//
// macOS 26 added `TranslationSession(installedSource:target:)`, so we can
// translate from plain Swift without hosting a SwiftUI view — and the language
// packs are managed by the system, so there is nothing for us to download.
//
// `TranslationSession` is not Sendable and `translate` runs off-actor, so the
// session is owned exclusively by one long-lived worker task and never crosses
// an isolation boundary. Callers talk to it through a command stream.
import Foundation
import Translation

public enum TranslationAvailability: Sendable, Equatable {
    case ready
    case needsDownload      // supported, but the user must install the pair
    case unsupported
}

public enum TranslatorError: LocalizedError, Sendable {
    case unsupportedOS
    case pairUnavailable(String, String)

    public var errorDescription: String? {
        switch self {
        case .unsupportedOS:
            return "On-device translation requires macOS 26 or later."
        case .pairUnavailable(let s, let t):
            return """
                The \(s) → \(t) language pair isn't installed. Open System Settings → \
                General → Language & Region → Translation Languages and download it.
                """
        }
    }
}

@available(macOS 26.0, *)
public final class Translator: Sendable {
    private enum Command: Sendable {
        case prepare(source: String, target: String, lowLatency: Bool,
                     reply: CheckedContinuation<Void, any Error>)
        case translate(text: String, reply: CheckedContinuation<String, Never>)
        case reset
    }

    private let commands: AsyncStream<Command>.Continuation

    public init() {
        let (stream, cont) = AsyncStream<Command>.makeStream()
        commands = cont
        // The worker owns `session` as a task-local — single owner, no sending.
        Task.detached {
            var session: TranslationSession?
            var pair = ""
            var cache: [String: String] = [:]

            for await command in stream {
                switch command {
                case .prepare(let source, let target, let lowLatency, let reply):
                    let key = "\(source)>\(target)|\(lowLatency)"
                    if session != nil, pair == key {
                        reply.resume()
                        continue
                    }
                    let status = await Translator.availability(
                        from: source, to: target, lowLatency: lowLatency)
                    guard status == .ready else {
                        reply.resume(throwing: TranslatorError.pairUnavailable(source, target))
                        continue
                    }
                    let src = Locale.Language(identifier: source)
                    let tgt = Locale.Language(identifier: target)
                    let s: TranslationSession
                    if #available(macOS 26.4, *) {
                        s = TranslationSession(
                            installedSource: src, target: tgt,
                            preferredStrategy: lowLatency ? .lowLatency : .highFidelity)
                    } else {
                        s = TranslationSession(installedSource: src, target: tgt)
                    }
                    // Prove the session really works before adopting it.
                    // `prepareTranslation()` can succeed for a pair whose model
                    // is missing; only a real translate surfaces `.notInstalled`.
                    // Swallowing this with `try?` is what made every subtitle
                    // come back as an empty string while the UI claimed success.
                    do {
                        try await s.prepareTranslation()
                        _ = try await s.translate("Hello.")
                    } catch {
                        s.cancel()
                        reply.resume(throwing: error)
                        continue
                    }
                    session = s
                    pair = key
                    cache.removeAll()
                    reply.resume()

                case .translate(let text, let reply):
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty, let s = session else {
                        reply.resume(returning: "")
                        continue
                    }
                    if let hit = cache[trimmed] {
                        reply.resume(returning: hit)
                        continue
                    }
                    do {
                        let out = try await s.translate(trimmed).targetText
                        // Live subtitles retranslate partials constantly — bound it.
                        if cache.count > 400 { cache.removeAll(keepingCapacity: true) }
                        cache[trimmed] = out
                        reply.resume(returning: out)
                    } catch {
                        NSLog("[TransSub] translate failed: \(error.localizedDescription)")
                        reply.resume(returning: "")
                    }

                case .reset:
                    session?.cancel()
                    session = nil
                    pair = ""
                    cache.removeAll()
                }
            }
        }
    }

    deinit { commands.finish() }

    /// Every language the system's translation stack knows about.
    public static func supportedLanguageIDs() async -> [String] {
        await LanguageAvailability().supportedLanguages.map { $0.maximalIdentifier }
    }

    /// Probe every supported pair using the system's own Locale.Language values,
    /// so no identifier-spelling mismatch can hide an installed pack.
    /// Returns "src→tgt" for pairs reported as installed.
    public static func installedPairs() async -> [String] {
        let availability = LanguageAvailability()
        let langs = await availability.supportedLanguages
        var out: [String] = []
        for src in langs {
            for tgt in langs where src.maximalIdentifier != tgt.maximalIdentifier {
                if await availability.status(from: src, to: tgt) == .installed {
                    out.append("\(src.maximalIdentifier)→\(tgt.maximalIdentifier)")
                }
            }
        }
        return out
    }

    /// Resolve a loose code ("zh-Hans") to the system's supported language.
    public static func resolve(_ code: String) async -> Locale.Language? {
        let langs = await LanguageAvailability().supportedLanguages
        let wanted = Locale.Language(identifier: code)
        // exact, then script-insensitive, then base-code match
        if let hit = langs.first(where: { $0.maximalIdentifier == wanted.maximalIdentifier }) {
            return hit
        }
        if let hit = langs.first(where: {
            $0.languageCode == wanted.languageCode && $0.script == wanted.script
        }) {
            return hit
        }
        return langs.first { $0.languageCode == wanted.languageCode }
    }

    /// IMPORTANT: availability is per-strategy. The low-latency model is a
    /// separate download from the high-fidelity one, and asking the default
    /// (high-fidelity) object about a low-latency session reports "installed"
    /// for a pair that will actually throw `.notInstalled` on every call.
    public static func availability(
        from source: String, to target: String, lowLatency: Bool = false
    ) async -> TranslationAvailability {
        let src = Locale.Language(identifier: source)
        let tgt = Locale.Language(identifier: target)
        let availability: LanguageAvailability
        if #available(macOS 26.4, *) {
            availability = LanguageAvailability(
                preferredStrategy: lowLatency ? .lowLatency : .highFidelity)
        } else {
            availability = LanguageAvailability()
        }
        switch await availability.status(from: src, to: tgt) {
        case .installed: return .ready
        case .supported: return .needsDownload
        case .unsupported: return .unsupported
        @unknown default: return .unsupported
        }
    }

    /// Prepares a session. `lowLatency` favours speed for live subtitles.
    public func prepare(from source: String, to target: String, lowLatency: Bool = true)
        async throws
    {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, any Error>) in
            commands.yield(
                .prepare(source: source, target: target, lowLatency: lowLatency, reply: c))
        }
    }

    public func translate(_ text: String) async -> String {
        await withCheckedContinuation { (c: CheckedContinuation<String, Never>) in
            commands.yield(.translate(text: text, reply: c))
        }
    }

    public func reset() {
        commands.yield(.reset)
    }
}

@available(macOS 26.0, *)
extension Translator {
    /// Attempt to trigger a language-pack download from code.
    /// Apple's documented path is the SwiftUI `.translationTask` prompt, which
    /// isn't in the Command Line Tools SDK — this probes whether the plain
    /// session API can do it instead. Returns a human-readable outcome.
    public static func probeDownload(from source: String, to target: String) async -> String {
        guard let src = await resolve(source), let tgt = await resolve(target) else {
            return "could not resolve \(source)/\(target)"
        }
        let session = TranslationSession(installedSource: src, target: tgt)
        let canRequest = session.canRequestDownloads
        var out = "canRequestDownloads=\(canRequest)"
        do {
            try await session.prepareTranslation()
            out += " · prepareTranslation OK"
        } catch {
            out += " · prepareTranslation threw: \(error.localizedDescription)"
        }
        let after = await availability(from: source, to: target)
        out += " · status now \(after)"
        if after == .ready {
            let text = await Translator().translateOnce(session: session, text: "Hello world")
            out += " · sample: \(text)"
        }
        return out
    }

    fileprivate func translateOnce(session: TranslationSession, text: String) async -> String {
        (try? await session.translate(text).targetText) ?? "(failed)"
    }
}

@available(macOS 26.0, *)
extension Translator {
    /// Availability of BOTH model variants for a pair. They are separate
    /// downloads: having one says nothing about the other.
    public static func strategyStatus(from source: String, to target: String) async
        -> (fast: TranslationAvailability, standard: TranslationAvailability)
    {
        async let fast = availability(from: source, to: target, lowLatency: true)
        async let standard = availability(from: source, to: target, lowLatency: false)
        return await (fast, standard)
    }
}
