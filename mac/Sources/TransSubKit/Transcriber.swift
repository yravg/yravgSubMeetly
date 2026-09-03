// On-device speech recognition via Apple's SpeechAnalyzer stack (macOS 26+).
//
// Chosen over a bundled Whisper build because the models are installed and
// updated by the system (no multi-GB downloads for us to manage or for a
// flaky network to corrupt), it runs on the Neural Engine, and it emits
// *volatile* partial results — which is what makes live subtitles feel instant.
import AVFoundation
import Foundation
import Speech

public struct TranscriptSegment: Sendable, Equatable {
    public let text: String
    public let isFinal: Bool
    public let start: Double   // seconds from session start
    public let end: Double

    public init(text: String, isFinal: Bool, start: Double, end: Double) {
        self.text = text
        self.isFinal = isFinal
        self.start = start
        self.end = end
    }
}

public enum TranscriberError: LocalizedError {
    case unsupportedOS
    case localeUnsupported(String)
    case assetInstallFailed(String)
    case notRunning

    public var errorDescription: String? {
        switch self {
        case .unsupportedOS:
            return "On-device transcription requires macOS 26 or later."
        case .localeUnsupported(let l):
            return "Speech recognition isn't available for \(l) on this Mac."
        case .assetInstallFailed(let m):
            return "Could not install the speech model: \(m)"
        case .notRunning:
            return "Transcriber is not running."
        }
    }
}

/// Thread-safe accumulator for results arriving on the analyzer's task.
final class SegmentBox: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [TranscriptSegment] = []
    func append(_ s: TranscriptSegment) {
        lock.lock()
        defer { lock.unlock() }
        items.append(s)
    }
    func all() -> [TranscriptSegment] {
        lock.lock()
        defer { lock.unlock() }
        return items
    }
}

@available(macOS 26.0, *)
public actor Transcriber {
    public typealias Handler = @Sendable (TranscriptSegment) -> Void

    private var analyzer: SpeechAnalyzer?
    private var transcriber: SpeechTranscriber?
    private var continuation: AsyncStream<AnalyzerInput>.Continuation?
    private var resultsTask: Task<Void, Never>?
    private var analyzerFormat: AVAudioFormat?
    private var converter: AVAudioConverter?
    private let sourceFormat: AVAudioFormat
    private var handler: Handler?

    public init(sampleRate: Double = 16_000) {
        sourceFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: sampleRate, channels: 1,
            interleaved: false)!
    }

    /// Locales with an installed (or installable) speech model.
    public static func supportedLocales() async -> [Locale] {
        await SpeechTranscriber.supportedLocales
    }

    public static func installedLocales() async -> [Locale] {
        await SpeechTranscriber.installedLocales
    }

    /// Downloads the model for `locale` if needed. Progress is 0…1.
    public static func ensureModel(
        for locale: Locale, onProgress: (@Sendable (Double) -> Void)? = nil
    ) async throws {
        let supported = await SpeechTranscriber.supportedLocales
        guard supported.contains(where: { $0.identifier(.bcp47) == locale.identifier(.bcp47) })
        else {
            throw TranscriberError.localeUnsupported(locale.identifier)
        }
        let module = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
                let progress = request.progress
                let observer = Task { @Sendable in
                    while !Task.isCancelled && !progress.isFinished {
                        onProgress?(progress.fractionCompleted)
                        try? await Task.sleep(nanoseconds: 300_000_000)
                    }
                }
                defer { observer.cancel() }
                try await request.downloadAndInstall()
                onProgress?(1.0)
            }
            // Keep the locale allocated so the system doesn't evict it.
            _ = try? await AssetInventory.reserve(locale: locale)
        } catch {
            throw TranscriberError.assetInstallFailed(error.localizedDescription)
        }
    }

    /// Starts a streaming session. `onSegment` fires for both partial and final text.
    public func start(locale: Locale, onSegment: @escaping Handler) async throws {
        await stop()
        handler = onSegment

        // volatileResults → live partials; audioTimeRange → timestamps for SRT.
        let t = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [.volatileResults, .fastResults],
            attributeOptions: [.audioTimeRange])
        transcriber = t

        analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [t])
        if let target = analyzerFormat, target != sourceFormat {
            converter = AVAudioConverter(from: sourceFormat, to: target)
            converter?.primeMethod = .none
        }

        let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
        continuation = cont

        // NOTE: use the modules-only initializer and attach the stream via
        // start(). The `init(inputSequence:modules:)` overload *also* attaches,
        // and doing both leaves the input silently unconsumed.
        let a = SpeechAnalyzer(modules: [t])
        analyzer = a
        try? await a.prepareToAnalyze(in: analyzerFormat)

        // Drain results into the handler.
        resultsTask = Task { [weak self] in
            guard let self else { return }
            do {
                for try await result in t.results {
                    let text = String(result.text.characters)
                    guard !text.isEmpty else { continue }
                    let seg = TranscriptSegment(
                        text: text,
                        isFinal: result.isFinal,
                        start: result.range.start.seconds,
                        end: result.range.end.seconds)
                    await self.emit(seg)
                }
            } catch {
                NSLog("[TransSub] transcriber results ended: \(error.localizedDescription)")
            }
        }

        try await a.start(inputSequence: stream)
    }

    private func emit(_ seg: TranscriptSegment) {
        handler?(seg)
    }

    /// Format the analyzer negotiated (diagnostics).
    public func negotiatedFormat() -> String {
        guard let f = analyzerFormat else { return "none (using source 16k mono)" }
        return "\(Int(f.sampleRate)) Hz, \(f.channelCount) ch, \(f.commonFormat.rawValue)"
    }

    /// Transcribe a media file end-to-end. SpeechAnalyzer decodes and time-indexes
    /// it natively, so this handles any format AVFoundation can read.
    public static func transcribeFile(
        at url: URL, locale: Locale, onSegment: Handler? = nil
    ) async throws -> [TranscriptSegment] {
        let t = SpeechTranscriber(
            locale: locale,
            transcriptionOptions: [],
            reportingOptions: [],
            attributeOptions: [.audioTimeRange])
        let file = try AVAudioFile(forReading: url)
        let analyzer = try await SpeechAnalyzer(
            inputAudioFile: file, modules: [t], finishAfterFile: true)

        let collector = SegmentBox()
        let reader = Task {
            for try await result in t.results where result.isFinal {
                let text = String(result.text.characters)
                guard !text.isEmpty else { continue }
                let seg = TranscriptSegment(
                    text: text, isFinal: true,
                    start: result.range.start.seconds, end: result.range.end.seconds)
                collector.append(seg)
                onSegment?(seg)
            }
        }
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        _ = try? await reader.value
        return collector.all()
    }

    /// Feed mono Float32 PCM at the configured sample rate.
    public func feed(_ samples: [Float]) {
        guard let cont = continuation, !samples.isEmpty else { return }
        guard let buffer = Self.makeBuffer(samples, format: sourceFormat) else { return }
        guard let converted = convert(buffer) else { return }
        cont.yield(AnalyzerInput(buffer: converted))
    }

    private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let converter, let target = analyzerFormat else { return buffer }
        let ratio = target.sampleRate / sourceFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else {
            return nil
        }
        var supplied = false
        var err: NSError?
        converter.convert(to: out, error: &err) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        if let err {
            NSLog("[TransSub] audio convert failed: \(err.localizedDescription)")
            return nil
        }
        return out.frameLength > 0 ? out : nil
    }

    private static func makeBuffer(_ samples: [Float], format: AVAudioFormat) -> AVAudioPCMBuffer? {
        guard
            let buf = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count))
        else { return nil }
        buf.frameLength = AVAudioFrameCount(samples.count)
        if let ch = buf.floatChannelData {
            samples.withUnsafeBufferPointer { src in
                ch[0].update(from: src.baseAddress!, count: samples.count)
            }
        }
        return buf
    }

    /// Flush any in-flight audio and end the session.
    public func finish() async {
        continuation?.finish()
        continuation = nil
        try? await analyzer?.finalizeAndFinishThroughEndOfInput()
        await teardown()
    }

    public func stop() async {
        continuation?.finish()
        continuation = nil
        await analyzer?.cancelAndFinishNow()
        await teardown()
    }

    private func teardown() async {
        resultsTask?.cancel()
        resultsTask = nil
        analyzer = nil
        transcriber = nil
        converter = nil
        analyzerFormat = nil
        handler = nil
    }
}
