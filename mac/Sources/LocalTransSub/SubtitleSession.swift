// Live subtitle session: capture → transcribe → translate → overlay.
import AppKit
import Foundation
import TransSubKit

@MainActor
final class SubtitleSession: ObservableObject {
    @Published private(set) var isRunning = false
    @Published var statusText = ""
    @Published var errorText = ""
    @Published var translationNote = ""
    @Published private(set) var lines: [SubtitleLine] = []

    private let capture = AudioCapture(sampleRate: 16_000)
    private let overlay: OverlayController
    private let model: OverlayModel

    // macOS 26+ types are behind availability, so they're stored type-erased.
    private var transcriberBox: AnyObject?
    private var translatorBox: AnyObject?
    private var translateTask: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?
    private var forceTask: Task<Void, Never>?
    private var pendingPartial: String?
    private var partialInFlight = false
    private var lastPartialSent: String?
    private var lastFinalText = ""
    private var pendingTranslation: [UUID] = []

    init(model: OverlayModel, overlay: OverlayController) {
        self.model = model
        self.overlay = overlay
    }

    func start(target: CaptureTarget) async {
        guard !isRunning else { return }
        errorText = ""
        guard #available(macOS 26.0, *) else {
            errorText = TranscriberError.unsupportedOS.localizedDescription
            return
        }
        guard AudioCapture.hasPermission() else {
            AudioCapture.requestPermission()
            errorText = CaptureError.permissionDenied.localizedDescription
            return
        }

        let prefs = Prefs.shared
        let locale = Locale(identifier: prefs.sourceLocale)
        model.dualLine = prefs.dualLine
        model.fontSize = prefs.fontSize
        model.opacity = prefs.opacity
        model.clear()
        model.status = "Preparing…"
        overlay.show()
        lines.removeAll()
        lastFinalText = ""

        // 1. speech model
        do {
            statusText = "Preparing speech model…"
            try await Transcriber.ensureModel(for: locale) { [weak self] p in
                Task { @MainActor in
                    self?.model.status = p < 1 ? "Downloading speech model \(Int(p * 100))%" : ""
                }
            }
        } catch {
            fail(error.localizedDescription)
            return
        }

        // 2. translation (optional) — Apple Translation if the pack exists,
        // otherwise the on-device foundation model.
        var engine: TranslationEngine?
        if prefs.translateEnabled {
            let e = TranslationEngine()
            let setup = await e.prepare(
                from: Languages.baseCode(prefs.sourceLocale),
                to: prefs.targetLanguage,
                lowLatency: true)
            if setup.kind != .none {
                engine = e
                translationNote = setup.note
            } else {
                // Neither path is ready *right now* (a language pack isn't
                // installed and the on-device model is warming up or busy).
                // Don't kill translation for the whole session — retry in the
                // background and back-fill lines once something works.
                translationNote =
                    setup.note + " Retrying automatically in the background."
                startTranslationRetry()
            }
        }
        translatorBox = engine

        // 3. transcriber
        let transcriber = Transcriber(sampleRate: 16_000)
        transcriberBox = transcriber
        do {
            try await transcriber.start(locale: locale) { [weak self] seg in
                Task { @MainActor in self?.handle(seg) }
            }
        } catch {
            fail(error.localizedDescription)
            return
        }

        // 4. audio
        do {
            try await capture.start(target: target) { [weak self] pcm in
                guard let self else { return }
                Task { await self.feed(pcm) }
            }
        } catch {
            await transcriber.stop()
            fail(error.localizedDescription)
            return
        }

        isRunning = true
        model.isListening = true
        let e = translatorBox as? TranslationEngine
        let engineLabel = e.map { $0.kind == .appleTranslation
            ? ($0.isLowLatency ? "Apple Translation (instant)" : "Apple Translation (~0.5s)")
            : $0.kind.label } ?? "off"
        statusText =
            "Listening — \(target.isSystemWide ? "all system audio" : target.name)"
            + (prefs.translateEnabled ? " · translation: \(engineLabel)" : "")
        model.status = statusText
    }

    private func feed(_ pcm: [Float]) async {
        guard #available(macOS 26.0, *), let t = transcriberBox as? Transcriber else { return }
        await t.feed(pcm)
    }

    @available(macOS 26.0, *)
    private func handle(_ seg: TranscriptSegment) {
        var finalID: UUID?
        if seg.isFinal {
            let line = SubtitleLine(
                start: seg.start, end: seg.end, source: seg.text, translation: "")
            lines.append(line)
            model.appendFinal(line)
            finalID = line.id
            lastFinalText = seg.text
        } else {
            model.setInterim(source: seg.text, translation: "")
        }
        guard let engine = translatorBox as? TranslationEngine else { return }

        // Live text: translate the in-progress sentence so subtitles appear
        // while the speaker is still talking, instead of only once the segment
        // finalises. Handled by a self-pacing loop rather than a task per
        // update — see drainPartial().
        if !seg.isFinal {
            guard engine.canTranslatePartials else { return }
            let text = seg.text
            // Ignore micro-updates; retranslating every keystroke-sized change
            // wastes the engine without changing what the reader sees.
            if let last = lastPartialSent, text.hasPrefix(last),
               text.count - last.count < 4 { return }
            pendingPartial = text
            drainPartial(engine: engine)
            return
        }

        // Final line: supersede any in-flight partial work.
        pendingPartial = nil
        let text = seg.text
        let refineOn = model.refine
        translateTask?.cancel()
        translateTask = Task { [weak self] in
            let out = await engine.translate(text)
            guard !Task.isCancelled, !out.isEmpty else { return }
            await MainActor.run {
                guard let self else { return }
                if let id = finalID {
                    self.model.setTranslation(out, for: id)
                    if let idx = self.lines.firstIndex(where: { $0.id == id }) {
                        self.lines[idx].translation = out
                    }
                }
            }
            // Refine: the fast model gets it on screen immediately, then the
            // higher-quality on-device model improves the finished line.
            guard refineOn, let id = finalID,
                  engine.kind == .appleTranslation
            else { return }
            let better = await engine.refine(text, draft: out)
            guard !Task.isCancelled, !better.isEmpty, better != out else { return }
            await MainActor.run {
                guard let self else { return }
                self.model.setTranslation(better, for: id)
                if let idx = self.lines.firstIndex(where: { $0.id == id }) {
                    self.lines[idx].translation = better
                }
            }
        }
    }

    /// Translate the newest in-progress text, one request at a time.
    ///
    /// Cancelling and restarting on every speech update would thrash the
    /// engine; queueing would fall behind. Keeping exactly one request in
    /// flight and always picking up the *latest* pending text makes the loop
    /// self-pacing: it runs at whatever rate the model can sustain (~380 ms on
    /// the high-fidelity model, ~100 ms on the low-latency one).
    @available(macOS 26.0, *)
    private func drainPartial(engine: TranslationEngine) {
        guard !partialInFlight, let text = pendingPartial, !text.isEmpty else { return }
        pendingPartial = nil
        partialInFlight = true
        lastPartialSent = text
        Task { [weak self] in
            let out = await engine.translate(text)
            await MainActor.run {
                guard let self else { return }
                self.partialInFlight = false
                if !out.isEmpty, self.isRunning {
                    self.model.setInterim(source: text, translation: out)
                }
                self.drainPartial(engine: engine)
            }
        }
    }

    /// Re-translate a chosen set of lines (the panel's "Force translate" menu).
    @available(macOS 26.0, *)
    func forceTranslate(scope: ForceScope) {
        guard let engine = translatorBox as? TranslationEngine else {
            model.footer = "Translation is not active."
            return
        }
        let todo: [SubtitleLine]
        switch scope {
        case .all: todo = model.cues
        case .selected: todo = model.cues.filter { model.selected.contains($0.id) }
        case .untranslated: todo = model.cues.filter { $0.translation.isEmpty && !$0.source.isEmpty }
        }
        guard !todo.isEmpty else { return }
        forceTask?.cancel()
        forceTask = Task { [weak self] in
            guard let self else { return }
            self.model.busy = true
            defer { Task { @MainActor in self.model.busy = false; self.model.footer = "" } }
            for (i, line) in todo.enumerated() {
                if Task.isCancelled { return }
                self.model.footer = "Translating \(i + 1)/\(todo.count)…"
                let out = await engine.translate(line.source)
                guard !out.isEmpty else { continue }
                self.model.setTranslation(out, for: line.id)
                if let idx = self.lines.firstIndex(where: { $0.id == line.id }) {
                    self.lines[idx].translation = out
                }
            }
        }
    }

    /// Re-attempt engine setup until one becomes available, then translate
    /// everything captured so far.
    @available(macOS 26.0, *)
    private func startTranslationRetry() {
        retryTask?.cancel()
        let prefs = Prefs.shared
        retryTask = Task { [weak self] in
            for attempt in 0..<60 {   // ~10 minutes
                try? await Task.sleep(nanoseconds: UInt64(10_000_000_000))
                guard let self, !Task.isCancelled, self.isRunning else { return }
                if self.translatorBox is TranslationEngine { return }

                let e = TranslationEngine()
                let setup = await e.prepare(
                    from: Languages.baseCode(prefs.sourceLocale),
                    to: prefs.targetLanguage,
                    lowLatency: true)
                guard setup.kind != .none else {
                    if attempt == 2 {
                        await MainActor.run {
                            self.translationNote =
                                "Still no translator. Apple Intelligence must be on "
                                + "(System Settings → Apple Intelligence & Siri); its model "
                                + "loads on demand and can take a minute."
                        }
                    }
                    continue
                }
                await MainActor.run {
                    self.translatorBox = e
                    self.translationNote =
                        setup.note.isEmpty
                        ? "Translation is now active (\(setup.kind.label))."
                        : setup.note
                    self.statusText = self.statusText.replacingOccurrences(
                        of: "translation: off", with: "translation: \(setup.kind.label)")
                }
                await self.backfillTranslations(engine: e)
                return
            }
        }
    }

    /// Translate lines captured before the engine came up.
    @available(macOS 26.0, *)
    private func backfillTranslations(engine: TranslationEngine) async {
        let todo = lines.filter { $0.translation.isEmpty && !$0.source.isEmpty }
        for line in todo.suffix(20) {
            guard isRunning else { return }
            let out = await engine.translate(line.source)
            guard !out.isEmpty else { continue }
            await MainActor.run {
                if let idx = self.lines.firstIndex(where: { $0.id == line.id }) {
                    self.lines[idx].translation = out
                }
            }
        }
    }

    func stop() async {
        guard isRunning else { return }
        isRunning = false
        model.isListening = false
        translateTask?.cancel()
        retryTask?.cancel()
        forceTask?.cancel()
        pendingPartial = nil
        lastPartialSent = nil
        try? await capture.stop()
        if #available(macOS 26.0, *) {
            if let t = transcriberBox as? Transcriber { await t.finish() }
            (translatorBox as? TranslationEngine)?.reset()
        }
        transcriberBox = nil
        translatorBox = nil
        overlay.hide()
        statusText = "Stopped"
    }

    private func fail(_ message: String) {
        errorText = message
        statusText = ""
        model.status = ""
        overlay.hide()
        isRunning = false
    }

    /// Save the session transcript.
    func export(as format: SubtitleFormat) {
        guard !lines.isEmpty else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "transcript.\(format.fileExtension)"
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let text = SubtitleExporter.format(lines, as: format, dualLine: Prefs.shared.dualLine)
        try? text.write(to: url, atomically: true, encoding: .utf8)
    }
}
