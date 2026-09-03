// Main window: live subtitles control + file transcription.
import AppKit
import SwiftUI
import TransSubKit

struct MainView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Wordmark(size: 16)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            Picker("", selection: $ui.tab) {
                Text("Live subtitles").tag(0)
                Text("Transcribe a file").tag(1)
                Text("Meeting notes").tag(2)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(12)

            Divider()

            if ui.tab == 0 {
                LiveView(app: app)
            } else if ui.tab == 1 {
                FileView(model: app.fileModel)
            } else {
                NotesView()
            }
        }
        .frame(minWidth: 480, minHeight: 560)
        .tint(Brand.teal)
        .languagePackHost(app.packInstaller)
    }
}

struct LiveView: View {
    @ObservedObject var app: AppController
    @ObservedObject var prefs: PrefsBridge
    @ObservedObject var session: SubtitleSession

    init(app: AppController) {
        self.app = app
        self.prefs = PrefsBridge.shared
        self.session = app.session
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !app.hasScreenPermission {
                    VStack(alignment: .leading, spacing: 6) {
                        Banner(
                            text: "Screen Recording permission is required to capture audio from other apps.",
                            action: "Open Settings…", tint: .orange
                        ) { app.requestScreenPermission() }
                        if app.needsRelaunch {
                            HStack(spacing: 8) {
                                Text("Already switched it on? macOS only applies it to a freshly launched app.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                                Button("Quit & Reopen") { app.relaunch() }
                                    .controlSize(.small)
                            }
                        }
                    }
                }

                GroupBox("Audio source") {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("Capture", selection: Binding(
                            get: { app.selectedTarget.id },
                            set: { id in
                                if let t = app.targets.first(where: { $0.id == id }) {
                                    app.selectedTarget = t
                                }
                            })
                        ) {
                            ForEach(app.targets) { Text($0.name).tag($0.id) }
                        }
                        HStack {
                            Button("Refresh") { Task { await app.refreshTargets() } }
                            Text("Any app — browser, Zoom, VLC — or all system audio.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(6)
                }

                GroupBox("Languages") {
                    VStack(alignment: .leading, spacing: 8) {
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
                    .padding(6)
                }

                HStack {
                    Button(session.isRunning ? "Stop" : "Start subtitles") { app.toggle() }
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .tint(session.isRunning ? .red : Brand.teal)
                        .disabled(!app.hasScreenPermission)
                    if !session.lines.isEmpty {
                        Menu("Export") {
                            ForEach(SubtitleFormat.allCases, id: \.self) { f in
                                Button(f.rawValue.uppercased()) { session.export(as: f) }
                            }
                        }
                        .frame(width: 110)
                    }
                    Spacer()
                    if session.isRunning {
                        HStack(spacing: 6) {
                            Circle().fill(Brand.teal).frame(width: 8, height: 8)
                            Text("Listening").font(.caption)
                        }
                    }
                }

                if !session.statusText.isEmpty {
                    Text(session.statusText).font(.caption).foregroundStyle(.secondary)
                }
                if !session.translationNote.isEmpty {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(session.translationNote)
                            .font(.caption)
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                        // The low-latency model is a separate download and is
                        // the only way to reach ~0.1-0.2 s per line.
                        if session.translationNote.contains("low-latency") {
                            HStack(spacing: 8) {
                                Button(app.packInstaller.busy
                                       ? "Requesting…" : "Install fast model") {
                                    app.packInstaller.install(
                                        from: Languages.baseCode(prefs.sourceLocale),
                                        to: prefs.targetLanguage)
                                }
                                .disabled(app.packInstaller.busy)
                                if !app.packInstaller.status.isEmpty {
                                    Text(app.packInstaller.status)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
                if !session.errorText.isEmpty {
                    Banner(text: session.errorText, action: "Open Settings", tint: .red) {
                        NSWorkspace.shared.open(
                            URL(string: "x-apple.systempreferences:com.apple.Localization-Settings.extension")!)
                    }
                }

                if !session.lines.isEmpty {
                    GroupBox("Transcript (\(session.lines.count) lines)") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(session.lines.suffix(30)) { line in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(line.source)
                                        .font(.system(size: 12))
                                        .foregroundStyle(line.translation.isEmpty ? .primary : .secondary)
                                    if !line.translation.isEmpty {
                                        Text(line.translation)
                                            .font(.system(size: 13, weight: .medium))
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(6)
                    }
                }
            }
            .padding(14)
        }
    }
}

struct FileView: View {
    @ObservedObject var model: FileTranscribeModel
    @ObservedObject var prefs: PrefsBridge

    init(model: FileTranscribeModel) {
        self.model = model
        self.prefs = PrefsBridge.shared
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GroupBox {
                    VStack(spacing: 10) {
                        Image(systemName: "waveform.circle")
                            .font(.system(size: 34))
                            .foregroundStyle(.secondary)
                        Text(model.url?.lastPathComponent ?? "Choose an audio or video file")
                            .font(.callout)
                        Button("Choose file…") { model.pick() }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(18)
                }

                Picker("Spoken language", selection: $prefs.sourceLocale) {
                    ForEach(Languages.sources) { Text($0.name).tag($0.id) }
                }
                Toggle("Translate", isOn: $prefs.translateEnabled)
                Picker("Into", selection: $prefs.targetLanguage) {
                    ForEach(Languages.targets) { Text($0.name).tag($0.id) }
                }
                .disabled(!prefs.translateEnabled)

                HStack {
                    Button("Transcribe") { Task { await model.transcribe() } }
                        .disabled(model.url == nil || model.busy)
                        .keyboardShortcut(.defaultAction)
                        .buttonStyle(.borderedProminent)
                        .tint(Brand.teal)
                    if !model.lines.isEmpty {
                        Menu("Export") {
                            ForEach(SubtitleFormat.allCases, id: \.self) { f in
                                Button(f.rawValue.uppercased()) { model.export(f) }
                            }
                        }
                        .frame(width: 110)
                    }
                    Spacer()
                    if model.busy { ProgressView().controlSize(.small) }
                }

                if !model.status.isEmpty {
                    Text(model.status).font(.caption).foregroundStyle(.secondary)
                }
                if !model.error.isEmpty {
                    Text(model.error)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !model.lines.isEmpty {
                    GroupBox("\(model.lines.count) lines") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(model.lines) { l in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(SubtitleExporter.stamp(l.start, comma: false))
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                    Text(l.source).font(.system(size: 12))
                                    if !l.translation.isEmpty {
                                        Text(l.translation)
                                            .font(.system(size: 13, weight: .medium))
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(6)
                    }
                }
            }
            .padding(14)
        }
    }
}

struct Banner: View {
    let text: String
    let action: String
    let tint: Color
    let run: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(tint)
            Text(text).font(.caption).fixedSize(horizontal: false, vertical: true)
            Spacer()
            Button(action, action: run).controlSize(.small)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 8).fill(tint.opacity(0.12)))
    }
}
