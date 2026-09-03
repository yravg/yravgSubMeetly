// View-local state lives in ObservableObjects owned by AppController.
//
// Why not @State: SwiftUI's @State is a macro in the macOS 26 SDK and its
// implementation plugin ships only with full Xcode — this project builds with
// Command Line Tools, so @State cannot be expanded. @ObservedObject is a plain
// property wrapper and works fine.
import AppKit
import Foundation
import TransSubKit

@MainActor
final class UIState: ObservableObject {
    @Published var tab: Int = 0
    @Published var launchAtLogin: Bool = false
    @Published var packStatus: String = ""
}

@MainActor
final class FileTranscribeModel: ObservableObject {
    @Published var url: URL?
    @Published var lines: [SubtitleLine] = []
    @Published var busy = false
    @Published var status = ""
    @Published var error = ""

    func pick() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio, .movie]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK {
            url = panel.url
            lines = []
            error = ""
            status = ""
        }
    }

    func transcribe() async {
        guard let url else { return }
        guard #available(macOS 26.0, *) else {
            error = TranscriberError.unsupportedOS.localizedDescription
            return
        }
        busy = true
        error = ""
        lines = []
        status = "Preparing model…"
        defer { busy = false }

        let prefs = Prefs.shared
        let locale = Locale(identifier: prefs.sourceLocale)
        do {
            try await Transcriber.ensureModel(for: locale) { [weak self] p in
                Task { @MainActor in
                    if p < 1 { self?.status = "Downloading speech model \(Int(p * 100))%" }
                }
            }
            status = "Transcribing…"
            let segs = try await Transcriber.transcribeFile(at: url, locale: locale)
            var result = segs.map { SubtitleLine(start: $0.start, end: $0.end, source: $0.text) }

            if prefs.translateEnabled {
                let engine = TranslationEngine()
                let setup = await engine.prepare(
                    from: Languages.baseCode(prefs.sourceLocale),
                    to: prefs.targetLanguage,
                    lowLatency: false)
                if setup.kind == .none {
                    error = setup.note
                } else {
                    if !setup.note.isEmpty { error = setup.note }
                    for i in result.indices {
                        status = "Translating \(i + 1)/\(result.count) (\(setup.kind.label))…"
                        result[i].translation = await engine.translate(result[i].source)
                    }
                    engine.reset()
                }
            }
            lines = result
            status = result.isEmpty ? "No speech found." : "Done — \(result.count) lines"
        } catch {
            self.error = error.localizedDescription
            status = ""
        }
    }

    func export(_ format: SubtitleFormat) {
        guard !lines.isEmpty else { return }
        let panel = NSSavePanel()
        let base = url?.deletingPathExtension().lastPathComponent ?? "transcript"
        panel.nameFieldStringValue = "\(base).\(format.fileExtension)"
        guard panel.runModal() == .OK, let out = panel.url else { return }
        let text = SubtitleExporter.format(
            lines, as: format, dualLine: Prefs.shared.dualLine)
        try? text.write(to: out, atomically: true, encoding: .utf8)
    }
}
