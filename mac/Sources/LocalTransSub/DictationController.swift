// Wispr-Flow-style dictation: hold a hotkey, speak, release → the cleaned-up
// text is inserted at the cursor in whatever app has focus.
//
// Permissions needed: Input Monitoring (to watch the hotkey), Accessibility
// (to synthesize ⌘V), Microphone.
import AppKit
import AVFoundation
import Carbon.HIToolbox
import Foundation
import TransSubKit

@MainActor
final class DictationController: ObservableObject {
    enum Mode: Equatable {
        case idle
        case holding        // hotkey held
        case handsFree      // double-tap session
        case transcribing
    }

    @Published private(set) var mode: Mode = .idle
    @Published var lastError = ""
    /// True selagi event tap hotkey terpasang dan mendengarkan.
    @Published private(set) var tapActive = false

    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private let engine = AVAudioEngine()
    private let pcm = PCMBuffer()
    private var transcriberBox: AnyObject?
    private var lastFnDown = Date.distantPast
    /// Aplikasi yang memegang kursor saat rekaman dimulai. Teks harus kembali
    /// ke sini walau fokus sempat berpindah selama transkripsi berjalan.
    private var targetApp: NSRunningApplication?
    private var autoStopTask: Task<Void, Never>?
    private var pill: DictationPill?

    // 5 minutes, so a forgotten hands-free session can't record all afternoon.
    private let maxSessionSeconds: TimeInterval = 300

    func start() {
        installEventTap()
    }

    func stop() {
        if let src = runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetCurrent(), src, .commonModes)
        }
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
        }
        eventTap = nil
        runLoopSource = nil
        tapActive = false
        Task { await cancelRecording() }
    }

    // MARK: - hotkey

    private func installEventTap() {
        // flagsChanged carries the fn key; keyDown lets Esc cancel.
        let mask =
            (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.keyUp.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            let controller = Unmanaged<DictationController>.fromOpaque(refcon)
                .takeUnretainedValue()
            // Passive observation — always pass the event through so the key
            // still reaches the app the user is typing in.
            MainActor.assumeIsolated { controller.handle(type: type, event: event) }
            return Unmanaged.passUnretained(event)
        }

        guard
            let tap = CGEvent.tapCreate(
                tap: .cgSessionEventTap,
                place: .headInsertEventTap,
                options: .listenOnly,
                eventsOfInterest: CGEventMask(mask),
                callback: callback,
                userInfo: Unmanaged.passUnretained(self).toOpaque())
        else {
            lastError =
                "Input Monitoring permission is required for the dictation hotkey. "
                + "Grant it in System Settings → Privacy & Security → Input Monitoring."
            tapActive = false
            return
        }
        eventTap = tap
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        runLoopSource = src
        CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        tapActive = true
    }

    private func handle(type: CGEventType, event: CGEvent) {
        // Esc membatalkan, apa pun hotkey-nya.
        if type == .keyDown,
           event.getIntegerValueField(.keyboardEventKeycode) == Int64(kVK_Escape),
           mode != .idle {
            Task { await cancelRecording() }
            return
        }
        switch DictationHotkey.state(Prefs.shared.dictationHotkey, type: type, event: event) {
        case .some(true):
            do {
                let now = Date()
                if now.timeIntervalSince(lastFnDown) < 0.4 {
                    // double-tap → hands-free
                    lastFnDown = .distantPast
                    if mode == .handsFree {
                        Task { await finishRecording() }
                    } else {
                        Task { await beginRecording(handsFree: true) }
                    }
                    return
                }
                lastFnDown = now
                if mode == .idle { Task { await beginRecording(handsFree: false) } }
            }

        case .some(false):
            if mode == .holding { Task { await finishRecording() } }

        case .none:
            break
        }
    }

    // MARK: - recording

    private func beginRecording(handsFree: Bool) async {
        guard mode == .idle else { return }
        let front = NSWorkspace.shared.frontmostApplication
        targetApp = front?.processIdentifier == ProcessInfo.processInfo.processIdentifier
            ? nil : front
        guard #available(macOS 26.0, *) else {
            lastError = TranscriberError.unsupportedOS.localizedDescription
            return
        }
        mode = handsFree ? .handsFree : .holding
        pcm.clear()

        showPill(handsFree ? "Hands-free — tap fn to stop" : "Listening…")

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let target = AVAudioFormat(
            commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
        let converter = AVAudioConverter(from: format, to: target)

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buf, _ in
            guard let self, let converter else { return }
            let ratio = 16_000.0 / format.sampleRate
            let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 1024
            guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: cap) else { return }
            var fed = false
            var err: NSError?
            converter.convert(to: out, error: &err) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return buf
            }
            guard err == nil, out.frameLength > 0, let ch = out.floatChannelData else { return }
            let samples = Array(UnsafeBufferPointer(start: ch[0], count: Int(out.frameLength)))
            self.pcm.append(samples)
        }

        do {
            engine.prepare()
            try engine.start()
        } catch {
            lastError = "Microphone unavailable: \(error.localizedDescription)"
            mode = .idle
            hidePill()
            return
        }

        autoStopTask?.cancel()
        autoStopTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(300 * 1_000_000_000))
            guard let self, !Task.isCancelled else { return }
            await self.finishRecording()
        }
    }

    private func teardownAudio() {
        engine.inputNode.removeTap(onBus: 0)
        if engine.isRunning { engine.stop() }
        autoStopTask?.cancel()
        autoStopTask = nil
    }

    private func cancelRecording() async {
        targetApp = nil
        guard mode != .idle else { return }
        teardownAudio()
        pcm.clear()
        mode = .idle
        hidePill()
    }

    private func finishRecording() async {
        guard mode == .holding || mode == .handsFree else { return }
        teardownAudio()
        let samples = pcm.drain()

        guard samples.count > 8_000 else {   // < 0.5 s — treat as a misfire
            mode = .idle
            hidePill()
            return
        }

        mode = .transcribing
        showPill("Transcribing…")
        defer { mode = .idle }

        guard #available(macOS 26.0, *) else { return }
        let locale = Locale(identifier: Prefs.shared.sourceLocale)
        let collected = SegmentCollector()
        let t = Transcriber(sampleRate: 16_000)
        transcriberBox = t
        do {
            try await t.start(locale: locale) { seg in
                if seg.isFinal { collected.append(seg.text) }
            }
            let chunk = 16_000
            var i = 0
            while i < samples.count {
                let end = min(i + chunk, samples.count)
                await t.feed(Array(samples[i..<end]))
                i = end
            }
            await t.finish()
            try? await Task.sleep(nanoseconds: 400_000_000)
        } catch {
            lastError = error.localizedDescription
            hidePill()
            return
        }
        transcriberBox = nil

        var text = collected.joined()
        if Prefs.shared.dictationCleanup { text = DictationCleanup.clean(text) }
        hidePill()
        guard !text.isEmpty else {
            targetApp = nil
            return
        }
        // Ada jeda ratusan milidetik–detik antara hotkey dilepas dan ⌘V terkirim
        // (transkripsi + jeda 400 ms di atas). Kalau fokus sempat pindah, teks
        // akan mendarat di aplikasi yang salah — dan clipboard lama sudah telanjur
        // ditimpa. Kembalikan target lebih dulu.
        if let targetApp, !targetApp.isActive {
            targetApp.activate()
            try? await Task.sleep(nanoseconds: 150_000_000)
        }
        targetApp = nil
        Inserter.insert(text, restoreClipboard: Prefs.shared.restoreClipboard)
    }

    // MARK: - pill

    private func showPill(_ text: String) {
        if pill == nil { pill = DictationPill() }
        pill?.show(text)
    }

    private func hidePill() {
        pill?.hide()
    }
}

/// Mic samples shared between the audio tap and async code. Locking lives in
/// synchronous methods — NSLock.lock() is unavailable from async contexts.
final class PCMBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private var samples: [Float] = []

    func append(_ new: [Float]) {
        lock.lock()
        defer { lock.unlock() }
        samples.append(contentsOf: new)
    }

    func drain() -> [Float] {
        lock.lock()
        defer { lock.unlock() }
        let out = samples
        samples.removeAll()
        return out
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        samples.removeAll()
    }
}

/// Collects final segments from the transcriber's callback thread.
final class SegmentCollector: @unchecked Sendable {
    private let lock = NSLock()
    private var parts: [String] = []

    func append(_ s: String) {
        lock.lock()
        defer { lock.unlock() }
        parts.append(s)
    }

    func joined() -> String {
        lock.lock()
        defer { lock.unlock() }
        return parts.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Light touch-ups; Apple's recognizer already punctuates and cases well, so
/// this only removes the filler words dictation tends to capture.
enum DictationCleanup {
    private static let fillers = [
        "um", "uh", "erm", "hmm", "ah", "like,", "you know,",
    ]

    static func clean(_ text: String) -> String {
        var words = text.split(separator: " ").map(String.init)
        words.removeAll { w in
            let bare = w.lowercased().trimmingCharacters(
                in: CharacterSet.punctuationCharacters)
            return fillers.contains(bare) || fillers.contains(w.lowercased())
        }
        var out = words.joined(separator: " ")
        out = out.replacingOccurrences(of: "  ", with: " ")
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

/// Menerjemahkan pilihan hotkey di Settings menjadi pencocokan event.
///
/// Sebelumnya handler mengunci ke `.maskSecondaryFn`, sehingga tiga dari empat
/// pilihan di Settings tidak berfungsi — dan sembarang kombinasi fn (fn+panah,
/// fn+F-key) ikut memulai rekaman.
enum DictationHotkey {
    /// Bit device-dependent: membedakan modifier kiri dan kanan.
    private static let rightCommand: UInt64 = 0x0000_0010
    private static let rightOption: UInt64 = 0x0000_0040

    /// true = hotkey ditekan, false = dilepas, nil = event bukan hotkey kita.
    static func state(_ id: String, type: CGEventType, event: CGEvent) -> Bool? {
        switch id {
        case "f5":
            let code = event.getIntegerValueField(.keyboardEventKeycode)
            guard code == Int64(kVK_F5) else { return nil }
            if type == .keyDown { return true }
            if type == .keyUp { return false }
            return nil
        case "rightOption", "rightCommand":
            guard type == .flagsChanged else { return nil }
            let bit = id == "rightOption" ? rightOption : rightCommand
            return (event.flags.rawValue & bit) != 0
        default: // "fn"
            guard type == .flagsChanged else { return nil }
            return event.flags.contains(.maskSecondaryFn)
        }
    }
}

/// Inserts text at the cursor via the pasteboard + ⌘V.
enum Inserter {
    @MainActor
    static func insert(_ text: String, restoreClipboard: Bool) {
        let pb = NSPasteboard.general
        let previous = restoreClipboard ? pb.string(forType: .string) : nil
        pb.clearContents()
        pb.setString(text, forType: .string)

        guard AXIsProcessTrusted() else {
            NSLog("[TransSub] Accessibility not granted — text left on the clipboard.")
            return
        }
        // .privateState, bukan .combinedSessionState: yang terakhir ikut membawa
        // modifier yang masih ditekan fisik oleh pengguna. Pada mode hands-free
        // fn sering masih tertekan saat paste, sehingga ⌘V berubah jadi fn-⌘V.
        let src = CGEventSource(stateID: .privateState)
        let vDown = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: true)
        vDown?.flags = .maskCommand
        let vUp = CGEvent(keyboardEventSource: src, virtualKey: CGKeyCode(kVK_ANSI_V), keyDown: false)
        vUp?.flags = []
        vDown?.post(tap: .cgAnnotatedSessionEventTap)
        vUp?.post(tap: .cgAnnotatedSessionEventTap)

        if let previous {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
                pb.clearContents()
                pb.setString(previous, forType: .string)
            }
        }
    }
}

/// Tiny always-on-top status pill shown while dictating.
@MainActor
final class DictationPill {
    private var panel: NSPanel?

    func show(_ text: String) {
        if panel == nil { build() }
        if let field = panel?.contentView?.subviews.compactMap({ $0 as? NSTextField }).first {
            field.stringValue = "  ●  \(text)  "
        }
        panel?.orderFrontRegardless()
    }

    func hide() { panel?.orderOut(nil) }

    private func build() {
        let screen = NSScreen.main ?? NSScreen.screens.first!
        let size = NSSize(width: 260, height: 38)
        let rect = NSRect(
            x: screen.frame.midX - size.width / 2,
            y: screen.frame.minY + 90, width: size.width, height: size.height)
        let p = NSPanel(
            contentRect: rect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        p.isFloatingPanel = true
        p.level = .screenSaver
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        // NSPanel default-nya menyembunyikan diri saat app tidak aktif — padahal
        // pil ini justru muncul ketika aplikasi LAIN sedang dipakai.
        p.hidesOnDeactivate = false
        // Indikator status murni: jangan pernah menelan klik pengguna.
        p.ignoresMouseEvents = true
        p.backgroundColor = .clear
        p.isOpaque = false
        p.hasShadow = true

        let container = NSView(frame: NSRect(origin: .zero, size: size))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.85).cgColor
        container.layer?.cornerRadius = 19

        let field = NSTextField(labelWithString: "")
        field.frame = container.bounds
        field.alignment = .center
        field.textColor = .white
        field.font = .systemFont(ofSize: 13, weight: .medium)
        field.backgroundColor = .clear
        field.isBezeled = false
        field.autoresizingMask = [.width, .height]
        container.addSubview(field)
        p.contentView = container
        panel = p
    }
}
