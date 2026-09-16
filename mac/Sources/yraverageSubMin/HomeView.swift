// Home — subtitel langsung, ditata ulang seperti layar rekam Meetily:
// toolbar lengket (Copy · Source · Language · Export), peringatan izin amber,
// kolom baca 750 px berisi segmen `[MM:SS] teks` (+ terjemahan), titik
// "Listening…", dan pil rekam mengambang di bawah.
//
// Semua kendali LiveView lama masih ada; yang dulu tiga GroupBox bertumpuk
// kini dua popover toolbar (Source, Language) supaya transkrip yang jadi
// pusat perhatian, bukan formulirnya.
import AppKit
import SwiftUI
import SubMinKit

struct HomeView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var prefs: PrefsBridge
    @ObservedObject var session: SubtitleSession

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
        self.prefs = PrefsBridge.shared
        self.session = app.session
    }

    private var hasTranscript: Bool { !session.lines.isEmpty }

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(spacing: 0) {
                        toolbar

                        if !app.hasScreenPermission { permissionAlert.padding(.horizontal, DS.Space.s4) }

                        ReadingColumn {
                            if let t = app.sessionStartedAt, session.isRunning {
                                RecordingStatusBar(startedAt: t).padding(.bottom, 8)
                            }

                            notes

                            ForEach(session.lines) { line in
                                TranscriptSegmentView(line: line, dual: prefs.dualLine || !line.translation.isEmpty)
                                    .id(line.id)
                            }

                            if session.isRunning && hasTranscript {
                                HStack(spacing: 8) {
                                    DSStatusDot(kind: .live, size: 8, pulse: true)
                                    Text("Listening…").font(.system(size: 13)).foregroundStyle(DS.Colors.textSubtle)
                                }
                                .padding(.top, 16)
                            }

                            if !hasTranscript { emptyState }
                        }
                        .padding(.bottom, 96)
                    }
                }
                .onChange(of: session.lines.count) { _, _ in
                    if let last = session.lines.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }

            RecordingPill(app: app)
                .padding(.bottom, DS.Space.s12)
        }
        .background(DS.Colors.panel)
    }

    // MARK: Toolbar

    private var toolbar: some View {
        HStack(spacing: 8) {
            if hasTranscript {
                Button { copyTranscript() } label: { Label("Copy", systemImage: "doc.on.doc") }
                    .buttonStyle(.dsOutlineSm)
                Menu {
                    ForEach(SubtitleFormat.allCases, id: \.self) { f in
                        Button(f.rawValue.uppercased()) { session.export(as: f) }
                    }
                } label: { Label("Export", systemImage: "square.and.arrow.up") }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .frame(height: DS.Width.controlSm)
                    .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.lineStrong, lineWidth: 1))
            }

            Button { ui.showSourcePopover = true } label: {
                Label(app.selectedTarget.name, systemImage: "speaker.wave.2")
                    .lineLimit(1)
            }
            .buttonStyle(.dsOutlineSm)
            .popover(isPresented: $ui.showSourcePopover, arrowEdge: .bottom) { sourcePopover }

            Button { ui.showLanguagePopover = true } label: {
                Label(languageLabel, systemImage: "globe")
            }
            .buttonStyle(.dsOutlineSm)
            .popover(isPresented: $ui.showLanguagePopover, arrowEdge: .bottom) { languagePopover }
        }
        .font(.system(size: 13))
        .padding(DS.Space.s4)
        .frame(maxWidth: .infinity)
        .background(DS.Colors.panel)
    }

    private var languageLabel: String {
        let src = Languages.sourceName(prefs.sourceLocale)
        guard prefs.translateEnabled else { return src }
        return "\(src) → \(Languages.targetName(prefs.targetLanguage))"
    }

    /// Pemilih sumber tangkapan — dulu GroupBox "Source".
    private var sourcePopover: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Capture source").font(.system(size: 13, weight: .semibold))
            Picker("Capture", selection: Binding(
                get: { app.selectedTarget.id },
                set: { id in if let t = app.targets.first(where: { $0.id == id }) { app.selectedTarget = t } }
            )) {
                ForEach(app.targets) { Text($0.name).tag($0.id) }
            }
            .labelsHidden()
            HStack(spacing: 8) {
                Button("Refresh") { Task { await app.refreshTargets() } }.buttonStyle(.dsOutlineSm)
                Text("Any app — browser, Zoom, VLC — or all system audio.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            }
        }
        .padding(DS.Space.s4)
        .frame(width: 360)
    }

    /// Pasangan bahasa + terjemahan — dulu GroupBox "Task & languages".
    private var languagePopover: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Languages").font(.system(size: 13, weight: .semibold))
            Picker("Spoken", selection: $prefs.sourceLocale) {
                ForEach(Languages.sources) { Text($0.name).tag($0.id) }
            }
            Toggle("Translate", isOn: $prefs.translateEnabled)
            Picker("Into", selection: $prefs.targetLanguage) {
                ForEach(Languages.targets) { Text($0.name).tag($0.id) }
            }
            .disabled(!prefs.translateEnabled)
            Toggle("Show original + translation", isOn: $prefs.dualLine)
                .disabled(!prefs.translateEnabled)
        }
        .padding(DS.Space.s4)
        .frame(width: 340)
    }

    // MARK: Peringatan izin

    private var permissionAlert: some View {
        DSCallout(tone: .warning, title: "Screen Recording permission required", icon: "exclamationmark.triangle") {
            VStack(alignment: .leading, spacing: 8) {
                Text("yraverageSubMin captures other apps' audio through ScreenCaptureKit. Without this permission it can still transcribe the microphone, but not what other participants say.")
                    .fixedSize(horizontal: false, vertical: true)
                if app.needsRelaunch {
                    Text("Already switched it on? macOS only applies it to a freshly launched app.")
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Button { app.requestScreenPermission() } label: {
                        Label("Open Screen Recording settings", systemImage: "gearshape")
                    }
                    .buttonStyle(.dsSolid)
                    if app.needsRelaunch {
                        Button("Quit & Reopen") { app.relaunch() }.buttonStyle(.dsOutline)
                    }
                    Button { Task { await app.refreshTargets() } } label: { Label("Recheck", systemImage: "arrow.clockwise") }
                        .buttonStyle(.dsOutline)
                }
            }
        }
        .frame(maxWidth: 448)
        .padding(.top, DS.Space.s4)
    }

    // MARK: Catatan sesi (status, catatan terjemahan, galat)

    @ViewBuilder
    private var notes: some View {
        if !session.statusText.isEmpty {
            Text(session.statusText).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                .padding(.bottom, 8)
        }
        if !session.translationNote.isEmpty {
            DSCallout(tone: .info, title: "Translation model", icon: "arrow.down.circle") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(session.translationNote).fixedSize(horizontal: false, vertical: true)
                    // Model low-latency adalah unduhan terpisah — satu-satunya jalan
                    // ke ~0,1–0,2 dtk per baris.
                    if session.translationNote.contains("low-latency") {
                        HStack(spacing: 8) {
                            Button(app.packInstaller.busy ? "Requesting…" : "Install fast model") {
                                app.packInstaller.install(
                                    from: Languages.baseCode(prefs.sourceLocale), to: prefs.targetLanguage)
                            }
                            .buttonStyle(.dsOutlineSm)
                            .disabled(app.packInstaller.busy)
                            if !app.packInstaller.status.isEmpty {
                                Text(app.packInstaller.status).font(.system(size: 11)).foregroundStyle(DS.Colors.textSubtle)
                            }
                        }
                    }
                }
            }
            .padding(.bottom, 12)
        }
        if !session.errorText.isEmpty {
            DSCallout(tone: .warning, title: "Something failed", icon: "exclamationmark.circle") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(session.errorText).fixedSize(horizontal: false, vertical: true)
                    Button("Open Language & Region settings") {
                        NSWorkspace.shared.open(
                            URL(string: "x-apple.systempreferences:com.apple.Localization-Settings.extension")!)
                    }
                    .buttonStyle(.dsOutlineSm)
                }
            }
            .padding(.bottom, 12)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 4) {
            if session.isRunning {
                DSStatusDot(kind: .live, size: 12, pulse: true).padding(.bottom, 8)
                Text("Listening for speech…").font(.system(size: 13)).foregroundStyle(DS.Colors.textMuted)
                Text("Speak, or play audio in the captured app, to see live subtitles")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textFaint)
            } else {
                Text("Welcome to yraverageSubMin")
                    .font(.system(size: 18, weight: .semibold)).foregroundStyle(DS.Colors.textStrong)
                Text("Start recording to see live subtitles. Everything runs on this Mac.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 32)
    }

    private func copyTranscript() {
        let text = session.lines.map { l in
            l.translation.isEmpty ? l.source : "\(l.source)\n\(l.translation)"
        }.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

/// Kolom baca 66,6 % / maks 750 px, dipusatkan — aturan tata letak Meetily.
struct ReadingColumn<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        HStack {
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 0) { content }
                .frame(maxWidth: DS.Width.reading, alignment: .leading)
                .padding(.horizontal, DS.Space.s4)
                .padding(.vertical, DS.Space.s2)
            Spacer(minLength: 0)
        }
    }
}

/// `[04:12]` di kiri (mono, samar), teks di kanan; terjemahan di bawahnya
/// lebih tebal — pola dual-line kita di atas TranscriptSegment Meetily.
struct TranscriptSegmentView: View {
    let line: SubtitleLine
    var dual = true

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("[\(DS.clock(line.start))]")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(DS.Colors.textFaint)
                .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(line.source)
                    .font(.system(size: 15))
                    .lineSpacing(3)
                    .foregroundStyle(line.translation.isEmpty ? DS.Colors.textBody : DS.Colors.textMuted)
                if dual && !line.translation.isEmpty {
                    Text(line.translation)
                        .font(.system(size: 15, weight: .medium))
                        .lineSpacing(3)
                        .foregroundStyle(DS.Colors.textStrong)
                }
            }
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
