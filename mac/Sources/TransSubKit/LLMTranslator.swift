// Fallback translator built on Apple's on-device foundation model.
//
// Why this exists: the Translation framework can only use language pairs the
// user has installed, and an app cannot trigger that download itself
// (`canRequestDownloads` is false and `prepareTranslation` throws). When no
// pack is installed, this uses the on-device system model instead — same
// privacy guarantee, nothing to download, no Python.
//
// Strictly on-device: this uses `SystemLanguageModel` only, never
// `PrivateCloudComputeLanguageModel`.
import Foundation
import FoundationModels

public enum LLMAvailability: Sendable, Equatable {
    case available
    case appleIntelligenceOff
    case deviceNotEligible
    case notReady
    case unsupportedOS

    public var explanation: String {
        switch self {
        case .available:
            return "On-device model ready."
        case .appleIntelligenceOff:
            return "Apple Intelligence is turned off. Enable it in System Settings → Apple Intelligence & Siri."
        case .deviceNotEligible:
            return "This Mac doesn't support the on-device foundation model."
        case .notReady:
            return "The on-device model is still downloading or warming up. Try again shortly."
        case .unsupportedOS:
            return "Requires macOS 26 or later."
        }
    }
}

@available(macOS 26.0, *)
public final class LLMTranslator: Sendable {
    private enum Command: Sendable {
        case translate(text: String, source: String, target: String,
                       reply: CheckedContinuation<String, Never>)
        case reset
    }

    private let commands: AsyncStream<Command>.Continuation

    public static func availability() -> LLMAvailability {
        switch SystemLanguageModel.default.availability {
        case .available:
            return .available
        case .unavailable(let reason):
            switch reason {
            case .appleIntelligenceNotEnabled: return .appleIntelligenceOff
            case .deviceNotEligible: return .deviceNotEligible
            default: return .notReady
            }
        @unknown default:
            return .notReady
        }
    }

    public init() {
        let (stream, cont) = AsyncStream<Command>.makeStream()
        commands = cont
        // One owner for the session, like Translator — LanguageModelSession is
        // not Sendable.
        Task.detached {
            var session: LanguageModelSession?
            var pair = ""
            var cache: [String: String] = [:]

            for await command in stream {
                switch command {
                case .translate(let text, let source, let target, let reply):
                    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else {
                        reply.resume(returning: "")
                        continue
                    }
                    if let hit = cache[trimmed] {
                        reply.resume(returning: hit)
                        continue
                    }
                    let key = "\(source)>\(target)"
                    if session == nil || pair != key {
                        let src = LanguageNames.name(source)
                        let tgt = LanguageNames.name(target)
                        session = LanguageModelSession(
                            model: SystemLanguageModel.default,
                            instructions: """
                                You are a subtitle translator. Translate the user's \(src) text \
                                into \(tgt).
                                Reply with the translation only — no quotes, no notes, no \
                                romanisation, no explanations. Keep it natural and concise, \
                                matching the register of speech. If the text is already in \
                                \(tgt), repeat it unchanged.
                                """)
                        pair = key
                        cache.removeAll()
                    }
                    do {
                        let response = try await session?.respond(to: trimmed)
                        let out = (response?.content ?? "")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if cache.count > 400 { cache.removeAll(keepingCapacity: true) }
                        cache[trimmed] = out
                        reply.resume(returning: out)
                    } catch {
                        NSLog("[TransSub] LLM translate failed: \(error.localizedDescription)")
                        // A session can get poisoned by a context overflow; drop it.
                        session = nil
                        reply.resume(returning: "")
                    }

                case .reset:
                    session = nil
                    pair = ""
                    cache.removeAll()
                }
            }
        }
    }

    deinit { commands.finish() }

    public func translate(_ text: String, from source: String, to target: String) async -> String {
        await withCheckedContinuation { (c: CheckedContinuation<String, Never>) in
            commands.yield(.translate(text: text, source: source, target: target, reply: c))
        }
    }

    /// Correct a machine-translated draft using the full source sentence.
    public func refine(_ text: String, draft: String, from source: String, to target: String)
        async -> String
    {
        let prompt = """
            Original (\(LanguageNames.name(source))): \(text)
            Draft translation (\(LanguageNames.name(target))): \(draft)
            Corrected translation:
            """
        let out = await translate(prompt, from: source, to: target)
        return out
    }

    public func reset() {
        commands.yield(.reset)
    }
}

enum LanguageNames {
    private static let names: [String: String] = [
        "en": "English", "ja": "Japanese", "zh": "Simplified Chinese",
        "zh-Hans": "Simplified Chinese", "zh-Hant": "Traditional Chinese",
        "ko": "Korean", "es": "Spanish", "fr": "French", "de": "German",
        "it": "Italian", "pt": "Portuguese", "ru": "Russian", "ar": "Arabic",
        "hi": "Hindi", "id": "Indonesian", "th": "Thai", "vi": "Vietnamese",
        "tr": "Turkish", "nl": "Dutch", "pl": "Polish", "uk": "Ukrainian",
    ]

    static func name(_ code: String) -> String {
        if let exact = names[code] { return exact }
        let base = String(code.split(separator: "-").first ?? "")
        return names[base] ?? code
    }
}

@available(macOS 26.0, *)
extension LLMTranslator {
    /// Runs one translation and reports exactly what happened — availability
    /// alone lies (it says "not ready" for a model that answers fine).
    public static func diagnose(from src: String, to tgt: String) async -> String {
        let availability = Self.availability()
        var out = "availability=\(availability)"
        do {
            let session = LanguageModelSession(
                model: SystemLanguageModel.default,
                instructions: "Translate the user's text to \(LanguageNames.name(tgt)). Reply with the translation only.")
            let started = Date()
            let response = try await session.respond(to: "Hello world")
            out += String(
                format: " · respond OK in %.0f ms: %@", Date().timeIntervalSince(started) * 1000,
                response.content.trimmingCharacters(in: .whitespacesAndNewlines))
        } catch {
            out += " · respond THREW: \(type(of: error)) — \(error)"
        }
        return out
    }
}
