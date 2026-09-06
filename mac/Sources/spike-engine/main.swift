// Spike: prove the on-device Speech + Translation engines work, using a real
// audio file (no Screen Recording permission needed).
//
//   swift run spike-engine ../test/speech.wav [locale]
import AVFoundation
import Foundation
import Speech
import SubMinKit

setvbuf(stdout, nil, _IONBF, 0)

let wavPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "../test/speech.wav"
let localeID = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "en-US"

func loadPCM(_ path: String) throws -> [Float] {
    let url = URL(fileURLWithPath: path)
    let file = try AVAudioFile(forReading: url)
    let target = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    guard let converter = AVAudioConverter(from: file.processingFormat, to: target) else {
        throw NSError(domain: "spike", code: 1)
    }
    let inBuf = AVAudioPCMBuffer(
        pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
    try file.read(into: inBuf)
    let ratio = 16_000.0 / file.processingFormat.sampleRate
    let outBuf = AVAudioPCMBuffer(
        pcmFormat: target, frameCapacity: AVAudioFrameCount(Double(file.length) * ratio) + 4096)!
    var done = false
    var err: NSError?
    converter.convert(to: outBuf, error: &err) { _, status in
        if done { status.pointee = .endOfStream; return nil }
        done = true
        status.pointee = .haveData
        return inBuf
    }
    if let err { throw err }
    let n = Int(outBuf.frameLength)
    return Array(UnsafeBufferPointer(start: outBuf.floatChannelData![0], count: n))
}

final class Collector: @unchecked Sendable {
    private let lock = NSLock()
    private var finals: [String] = []
    private var partialCount = 0
    private var firstPartial: Date?
    let start = Date()

    func add(_ s: TranscriptSegment) {
        lock.lock()
        defer { lock.unlock() }
        if s.isFinal {
            finals.append(s.text)
            print(String(format: "  [final  %6.2f–%6.2f] %@", s.start, s.end, s.text))
        } else {
            partialCount += 1
            if firstPartial == nil {
                firstPartial = Date()
                print(String(format: "  [first partial after %.2fs] %@",
                             Date().timeIntervalSince(start), s.text))
            }
        }
    }

    func summary() -> (String, Int) {
        lock.lock()
        defer { lock.unlock() }
        return (finals.joined(separator: " "), partialCount)
    }
}

func run() async {
    guard #available(macOS 26.0, *) else {
        print("✗ needs macOS 26+; this Mac is older.")
        return
    }

    print("▸ Speech: checking locale support for \(localeID)")
    let locale = Locale(identifier: localeID)
    let supported = await Transcriber.supportedLocales()
    let installed = await Transcriber.installedLocales()
    print("   supported locales: \(supported.count), installed: \(installed.count)")
    let isSupported = supported.contains { $0.identifier(.bcp47) == locale.identifier(.bcp47) }
    print("   \(localeID) supported: \(isSupported)")
    guard isSupported else {
        print("   available: \(supported.prefix(12).map { $0.identifier }.joined(separator: ", "))…")
        return
    }

    do {
        print("▸ ensuring model installed (downloads on first use)…")
        try await Transcriber.ensureModel(for: locale) { p in
            if p < 1 { print(String(format: "   download %.0f%%", p * 100)) }
        }
        print("   ✓ model ready")
    } catch {
        print("   ✗ \(error.localizedDescription)")
        return
    }

    let samples: [Float]
    do {
        samples = try loadPCM(wavPath)
        print(String(format: "▸ audio: %@ (%.2f s)", wavPath, Double(samples.count) / 16_000))
    } catch {
        print("✗ could not read \(wavPath): \(error.localizedDescription)")
        return
    }

    let collector = Collector()
    let transcriber = Transcriber()
    do {
        try await transcriber.start(locale: locale) { seg in collector.add(seg) }
        print("   analyzer format: \(await transcriber.negotiatedFormat())")
    } catch {
        print("✗ start failed: \(error.localizedDescription)")
        return
    }

    // Feed in 100 ms chunks to mimic realtime streaming.
    print("▸ streaming audio…")
    let chunk = 1_600
    var i = 0
    while i < samples.count {
        let end = min(i + chunk, samples.count)
        await transcriber.feed(Array(samples[i..<end]))
        i = end
    }
    await transcriber.finish()
    try? await Task.sleep(nanoseconds: 1_500_000_000)

    let (text, partials) = collector.summary()
    print("\n▸ TRANSCRIPT: \(text.isEmpty ? "(empty)" : text)")
    print("   partial updates: \(partials)")

    // ---- translation ----
    print("\n▸ Translation availability:")
    for tgt in ["zh-Hans", "ja", "es"] {
        let a = await Translator.availability(from: "en", to: tgt)
        print("   en → \(tgt): \(a)")
    }

    let sample = text.isEmpty ? "Machine learning runs completely on this device." : text
    for tgt in ["zh-Hans", "ja"] {
        guard await Translator.availability(from: "en", to: tgt) == .ready else {
            print("   (skipping en → \(tgt): pair not installed)")
            continue
        }
        let tr = Translator()
        do {
            try await tr.prepare(from: "en", to: tgt)
            let t0 = Date()
            let out = await tr.translate(sample)
            print(String(format: "   en → %@ (%.0f ms): %@", tgt,
                         Date().timeIntervalSince(t0) * 1000, out))
        } catch {
            print("   ✗ en → \(tgt): \(error.localizedDescription)")
        }
    }

    print(text.isEmpty ? "\n✗ FAIL — no transcript produced." : "\n✅ engines OK")
}

await run()
