// Picks the best available on-device translator.
//
//   1. Translation framework  — fast (~ms), but only for language pairs the
//      user has installed, and the app cannot install them itself.
//   2. On-device foundation model (Apple Intelligence) — no packs needed and
//      always available once Apple Intelligence is on, but far slower
//      (~5 s/line), so it only ever translates finished lines.
import Foundation

public enum TranslationEngineKind: Sendable, Equatable {
    case none
    case appleTranslation
    case onDeviceLLM

    public var label: String {
        switch self {
        case .none: return "off"
        case .appleTranslation: return "Apple Translation (fast)"
        case .onDeviceLLM: return "on-device model (slower)"
        }
    }

    public var isApple: Bool { self == .appleTranslation }
}

public struct TranslationSetup: Sendable {
    public let kind: TranslationEngineKind
    public let note: String
}

@available(macOS 26.0, *)
public final class TranslationEngine: @unchecked Sendable {
    public private(set) var kind: TranslationEngineKind = .none
    /// True only when the fast low-latency Apple model is in use.
    public private(set) var isLowLatency = false
    /// Apple's models are fast enough to translate in-progress speech when the
    /// caller keeps a single request in flight (see SubtitleSession's drain
    /// loop). The on-device LLM at ~5 s/line is not.
    public var canTranslatePartials: Bool { kind == .appleTranslation }
    private var apple: Translator?
    private var llm: LLMTranslator?
    private var source = ""
    private var target = ""

    public init() {}

    /// Choose an engine for this pair. Never throws — falls back or reports .none.
    public func prepare(from src: String, to tgt: String, lowLatency: Bool = true) async
        -> TranslationSetup
    {
        source = src
        target = tgt
        apple = nil
        llm = nil
        isLowLatency = false

        if Languages.baseCode(src) == Languages.baseCode(tgt) {
            kind = .none
            return TranslationSetup(kind: .none, note: "Source and target are the same language.")
        }

        // 1. Apple Translation. Try the fast low-latency model first, then fall
        // back to high-fidelity — they are separate downloads, and having one
        // installed says nothing about the other.
        for wantLowLatency in (lowLatency ? [true, false] : [false]) {
            guard await Translator.availability(from: src, to: tgt, lowLatency: wantLowLatency)
                == .ready
            else { continue }
            let t = Translator()
            do {
                try await t.prepare(from: src, to: tgt, lowLatency: wantLowLatency)
                apple = t
                kind = .appleTranslation
                isLowLatency = wantLowLatency
                return TranslationSetup(
                    kind: .appleTranslation,
                    note: wantLowLatency
                        ? ""
                        : "Using the high-fidelity translation model (~0.5 s per line). "
                            + "Install the low-latency model for instant subtitles.")
            } catch {
                continue   // model missing or broken — try the next rung
            }
        }

        // 2. On-device foundation model.
        //
        // `availability` reports `.notReady` while the model warms up even when
        // it will answer perfectly a moment later, so don't trust it as a gate:
        // only hard-fail on the two permanent reasons, otherwise actually try a
        // translation and judge by the result.
        let availability = LLMTranslator.availability()
        if availability != .deviceNotEligible && availability != .appleIntelligenceOff {
            let l = LLMTranslator()
            // Warm-up doubles as the probe; the first call can take ~10 s.
            let probe = await Self.withTimeout(seconds: 45) {
                await l.translate("Hello.", from: src, to: tgt)
            }
            if let probe, !probe.isEmpty {
                llm = l
                kind = .onDeviceLLM
                return TranslationSetup(
                    kind: .onDeviceLLM,
                    note:
                        "Using the on-device model — the \(Languages.targetName(tgt)) language "
                        + "pack isn't installed. It works offline but is slower, so only "
                        + "completed lines are translated.")
            }
        }

        kind = .none
        return TranslationSetup(
            kind: .none,
            note:
                "No translator available right now. \(availability.explanation)")
    }

    public func translate(_ text: String) async -> String {
        switch kind {
        case .none:
            return ""
        case .appleTranslation:
            return normalizeScript(await apple?.translate(text) ?? "")
        case .onDeviceLLM:
            return normalizeScript(await llm?.translate(text, from: source, to: target) ?? "")
        }
    }

    /// Force Chinese output into the script that was actually asked for.
    ///
    /// The low-latency model sometimes answers a zh-Hans request in Traditional
    /// (measured: one line of three), which reads as a glitch mid-subtitle. The
    /// ICU transform is a no-op on text already in the right script.
    private func normalizeScript(_ text: String) -> String {
        guard !text.isEmpty else { return text }
        let transform: String
        switch target {
        case "zh-Hans", "zh": transform = "Hant-Hans"
        case "zh-Hant": transform = "Hans-Hant"
        default: return text
        }
        return text.applyingTransform(StringTransform(rawValue: transform), reverse: false) ?? text
    }

    /// Improve a draft translation using the on-device model. Returns "" when
    /// no better result is available, so callers can keep the draft.
    public func refine(_ text: String, draft: String) async -> String {
        guard !text.isEmpty, !draft.isEmpty else { return "" }
        let polisher = llm ?? {
            let l = LLMTranslator()
            llm = l
            return l
        }()
        return await polisher.refine(text, draft: draft, from: source, to: target)
    }

    public func reset() {
        apple?.reset()
        llm?.reset()
        apple = nil
        llm = nil
        kind = .none
        isLowLatency = false
    }

    /// Returns nil if the operation outlives `seconds`.
    private static func withTimeout<T: Sendable>(
        seconds: Double, _ work: @escaping @Sendable () async -> T
    ) async -> T? {
        await withTaskGroup(of: T?.self) { group in
            group.addTask { await work() }
            group.addTask {
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                return nil
            }
            let first = await group.next() ?? nil
            group.cancelAll()
            return first
        }
    }
}
