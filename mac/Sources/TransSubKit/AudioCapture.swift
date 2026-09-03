// System / per-application audio capture via ScreenCaptureKit.
//
// This is the macOS answer to the browser extension's tabCapture: one Screen
// Recording grant, then we can tap the audio of ANY running app (browser,
// Zoom, VLC…) with no per-tab permission dance and no picker each session.
import AVFoundation
import CoreGraphics
import Foundation
import ScreenCaptureKit

public struct CaptureTarget: Sendable, Identifiable, Hashable {
    public let id: String          // bundle id (or "" for whole-system)
    public let name: String
    public let processID: pid_t

    public init(id: String, name: String, processID: pid_t) {
        self.id = id
        self.name = name
        self.processID = processID
    }

    public static let systemWide = CaptureTarget(id: "", name: "All system audio", processID: 0)
    public var isSystemWide: Bool { id.isEmpty }
}

public enum CaptureError: LocalizedError {
    case noDisplay
    case permissionDenied
    case appNotFound(String)
    case streamFailed(String)

    public var errorDescription: String? {
        switch self {
        case .noDisplay:
            return "No display available to capture from."
        case .permissionDenied:
            return "Screen Recording permission is required. Grant it in System Settings → Privacy & Security → Screen Recording, then relaunch."
        case .appNotFound(let name):
            return "Application not found or not running: \(name)"
        case .streamFailed(let msg):
            return "Capture stream failed: \(msg)"
        }
    }
}

/// Captures audio and delivers mono Float32 @ the requested sample rate.
public final class AudioCapture: NSObject, @unchecked Sendable {
    public typealias PCMHandler = @Sendable ([Float]) -> Void

    private var stream: SCStream?
    private let output = AudioStreamOutput()
    private let queue = DispatchQueue(label: "transsub.capture.audio")
    public let sampleRate: Int

    public init(sampleRate: Int = 16_000) {
        self.sampleRate = sampleRate
        super.init()
    }

    /// Apps that currently exist and could produce audio.
    public static func availableTargets() async throws -> [CaptureTarget] {
        let content = try await shareableContent()
        var seen = Set<String>()
        var targets: [CaptureTarget] = [.systemWide]
        for app in content.applications {
            let bid = app.bundleIdentifier
            guard !bid.isEmpty, !seen.contains(bid) else { continue }
            // Skip our own process and obvious background agents with no UI name.
            guard bid != Bundle.main.bundleIdentifier, !app.applicationName.isEmpty else { continue }
            seen.insert(bid)
            targets.append(
                CaptureTarget(id: bid, name: app.applicationName, processID: app.processID))
        }
        return targets
    }

    private static func shareableContent() async throws -> SCShareableContent {
        do {
            return try await SCShareableContent.excludingDesktopWindows(
                false, onScreenWindowsOnly: false)
        } catch {
            // SCK reports a TCC denial as a generic stream error.
            throw CaptureError.permissionDenied
        }
    }

    /// Non-blocking check. Probing SCShareableContent instead would HANG when
    /// the permission is missing and no UI session can show the prompt.
    public static func hasPermission() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Triggers the system prompt (returns immediately; the user decides).
    /// Only meaningful from a bundled, signed .app — a bare CLI has no TCC identity.
    @discardableResult
    public static func requestPermission() -> Bool {
        CGRequestScreenCaptureAccess()
    }

    public func start(target: CaptureTarget, onPCM: @escaping PCMHandler) async throws {
        try await stop()

        let content = try await Self.shareableContent()
        guard let display = content.displays.first else { throw CaptureError.noDisplay }

        let filter: SCContentFilter
        if target.isSystemWide {
            filter = SCContentFilter(display: display, excludingWindows: [])
        } else {
            let apps = content.applications.filter { $0.bundleIdentifier == target.id }
            guard !apps.isEmpty else { throw CaptureError.appNotFound(target.name) }
            filter = SCContentFilter(display: display, including: apps, exceptingWindows: [])
        }

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = sampleRate
        config.channelCount = 1
        config.excludesCurrentProcessAudio = true   // never capture our own beeps
        // Keep the video side as cheap as legally possible — we only want audio,
        // but SCK requires a video configuration to exist.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 5

        output.onPCM = onPCM
        let s = SCStream(filter: filter, configuration: config, delegate: output)
        try s.addStreamOutput(output, type: .audio, sampleHandlerQueue: queue)
        do {
            try await s.startCapture()
        } catch {
            throw CaptureError.streamFailed(error.localizedDescription)
        }
        stream = s
    }

    public func stop() async throws {
        guard let s = stream else { return }
        stream = nil
        output.onPCM = nil
        try? await s.stopCapture()
    }
}

/// Receives SCK audio buffers and converts them to mono Float32.
private final class AudioStreamOutput: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    var onPCM: AudioCapture.PCMHandler?

    func stream(
        _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio, let handler = onPCM, sampleBuffer.isValid else { return }
        guard let samples = Self.floatSamples(from: sampleBuffer), !samples.isEmpty else { return }
        handler(samples)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        NSLog("[TransSub] capture stopped: \(error.localizedDescription)")
    }

    /// Flattens a CMSampleBuffer's audio into interleaved-averaged mono Float32.
    static func floatSamples(from sb: CMSampleBuffer) -> [Float]? {
        guard let fmt = sb.formatDescription?.audioStreamBasicDescription else { return nil }
        var blockBuffer: CMBlockBuffer?
        var abl = AudioBufferList()
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sb,
            bufferListSizeNeededOut: nil,
            bufferListOut: &abl,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return nil }

        let buffers = UnsafeMutableAudioBufferListPointer(&abl)
        guard fmt.mFormatFlags & kAudioFormatFlagIsFloat != 0 else { return nil }

        if buffers.count == 1 {
            let b = buffers[0]
            guard let data = b.mData else { return nil }
            let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
            let ptr = data.bindMemory(to: Float.self, capacity: count)
            let channels = Int(b.mNumberChannels)
            if channels <= 1 { return Array(UnsafeBufferPointer(start: ptr, count: count)) }
            // interleaved multi-channel → average to mono
            var mono = [Float](repeating: 0, count: count / channels)
            for i in 0..<mono.count {
                var sum: Float = 0
                for c in 0..<channels { sum += ptr[i * channels + c] }
                mono[i] = sum / Float(channels)
            }
            return mono
        }

        // Non-interleaved: average across planar buffers.
        var mono: [Float] = []
        for (idx, b) in buffers.enumerated() {
            guard let data = b.mData else { continue }
            let count = Int(b.mDataByteSize) / MemoryLayout<Float>.size
            let ptr = data.bindMemory(to: Float.self, capacity: count)
            if idx == 0 {
                mono = Array(UnsafeBufferPointer(start: ptr, count: count))
            } else {
                for i in 0..<min(mono.count, count) { mono[i] += ptr[i] }
            }
        }
        if buffers.count > 1 {
            let n = Float(buffers.count)
            for i in 0..<mono.count { mono[i] /= n }
        }
        return mono
    }
}
