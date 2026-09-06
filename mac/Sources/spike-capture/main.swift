// Spike: prove ScreenCaptureKit per-app audio capture works on this machine
// before the rest of the app is built on top of it.
//
//   swift run spike-capture              → list capturable apps
//   swift run spike-capture <name> [sec] → capture that app's audio, report levels
import Foundation
import SubMinKit

// Unbuffered: this tool is always piped/redirected, and buffered output is
// lost if the probe is interrupted.
setvbuf(stdout, nil, _IONBF, 0)

let args = CommandLine.arguments
let wanted = args.count > 1 ? args[1] : nil
let seconds = args.count > 2 ? Double(args[2]) ?? 6 : 6

func rms(_ x: [Float]) -> Float {
    guard !x.isEmpty else { return 0 }
    var sum: Float = 0
    for v in x { sum += v * v }
    return (sum / Float(x.count)).squareRoot()
}

/// Thread-safe level meter — the capture callback runs on SCK's queue.
final class Meter: @unchecked Sendable {
    private let lock = NSLock()
    private var total = 0
    private var window: [Float] = []
    private var loudChunks = 0
    private var peak: Float = 0
    private let start: Date

    init(start: Date) { self.start = start }

    func feed(_ pcm: [Float]) {
        lock.lock()
        defer { lock.unlock() }
        total += pcm.count
        window.append(contentsOf: pcm)
        peak = max(peak, pcm.map { abs($0) }.max() ?? 0)
        if window.count >= 16_000 {   // ~1 s
            let level = rms(window)
            if level > 0.005 { loudChunks += 1 }
            let bars = Int(min(40, level * 400))
            let t = Date().timeIntervalSince(start)
            print(String(format: "  t=%4.1fs  rms=%.4f  %@", t, level,
                         String(repeating: "█", count: bars)))
            window.removeAll(keepingCapacity: true)
        }
    }

    func snapshot() -> (Int, Int, Float) {
        lock.lock()
        defer { lock.unlock() }
        return (total, loudChunks, peak)
    }
}

// NOTE: top-level code is @MainActor-isolated, so blocking it with a semaphore
// while awaiting inside a Task deadlocks. Use top-level await instead.
func run() async {
    print("▸ checking Screen Recording permission…")
    if !AudioCapture.hasPermission() {
        print("✗ NOT GRANTED for this binary.")
        print("  Requesting… (a system dialog may appear)")
        AudioCapture.requestPermission()
        if !AudioCapture.hasPermission() {
            print("""

              Screen Recording must be granted to the process running this binary.
              System Settings → Privacy & Security → Screen Recording
              (The real app bundle prompts for itself — a bare CLI inherits the
               terminal's identity, which is why this probe can't self-grant.)
            """)
            return
        }
    }
    print("✓ permission granted")

    let targets: [CaptureTarget]
    do {
        targets = try await AudioCapture.availableTargets()
    } catch {
        print("✗ \(error.localizedDescription)")
        return
    }

    guard let wanted else {
        print("\n▸ capturable applications (\(targets.count)):")
        for t in targets.prefix(60) {
            print("   \(t.isSystemWide ? "[system]" : t.id)  —  \(t.name)")
        }
        print("\nUsage: spike-capture <app name or bundle id> [seconds]")
        return
    }

    let needle = wanted.lowercased()
    let target =
        needle == "system"
        ? CaptureTarget.systemWide
        : targets.first {
            $0.name.lowercased().contains(needle) || $0.id.lowercased().contains(needle)
        }
    guard let target else {
        print("✗ no app matching '\(wanted)'. Run with no arguments to list.")
        return
    }

    print("\n▸ capturing: \(target.name) [\(target.isSystemWide ? "system-wide" : target.id)]")
    print("  (play audio in that app now)\n")

    let cap = AudioCapture(sampleRate: 16_000)
    let meter = Meter(start: Date())

    do {
        try await cap.start(target: target) { pcm in meter.feed(pcm) }
    } catch {
        print("✗ start failed: \(error.localizedDescription)")
        return
    }

    try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    try? await cap.stop()

    let (total, sawAudio, pk) = meter.snapshot()

    let dur = Double(total) / 16_000.0
    print("\n▸ results")
    print(String(format: "   samples captured : %d (%.2f s of audio)", total, dur))
    print(String(format: "   peak amplitude   : %.4f", pk))
    print("   seconds w/ sound : \(sawAudio)")
    if total == 0 {
        print("\n✗ FAIL — no audio buffers arrived.")
    } else if sawAudio == 0 {
        print("\n⚠ PARTIAL — stream works but was silent (was audio playing in that app?).")
    } else {
        print("\n✅ PASS — per-app audio capture works.")
    }
}

await run()
