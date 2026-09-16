// Files — transkripsi berkas audio/video, dalam kerangka yang sama dengan
// Home: toolbar lengket, kartu pilih berkas, hasil di kolom baca.
// Semua kendali FileView lama tetap: pilih berkas, bahasa, terjemahan,
// Transcribe, ekspor SRT/VTT/TXT, status, galat.
import AppKit
import SwiftUI
import SubMinKit

struct FilesView: View {
    @ObservedObject var model: FileTranscribeModel
    @ObservedObject var ui: UIState
    @ObservedObject var prefs: PrefsBridge

    init(app: AppController) {
        self.model = app.fileModel
        self.ui = app.ui
        self.prefs = PrefsBridge.shared
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                toolbar
                ReadingColumn {
                    dropCard.padding(.bottom, DS.Space.s4)

                    if !model.status.isEmpty {
                        HStack(spacing: 8) {
                            if model.busy { ProgressView().controlSize(.small) }
                            Text(model.status).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                        }
                        .padding(.bottom, 8)
                    }
                    if !model.error.isEmpty {
                        DSCallout(tone: .warning, title: "Transcription failed", icon: "exclamationmark.circle") {
                            Text(model.error).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.bottom, 12)
                    }

                    ForEach(model.lines) { l in
                        TranscriptSegmentView(line: l)
                    }
                }
                .padding(.bottom, DS.Space.s8)
            }
        }
        .background(DS.Colors.panel)
    }

    private var toolbar: some View {
        HStack(spacing: 8) {
            Button { Task { await model.transcribe() } } label: {
                Label(model.busy ? "Transcribing…" : "Transcribe", systemImage: "waveform")
            }
            .buttonStyle(DSButtonStyle(kind: .solid, size: DS.Width.controlSm))
            .disabled(model.url == nil || model.busy)
            .keyboardShortcut(.defaultAction)

            if !model.lines.isEmpty {
                Menu {
                    ForEach(SubtitleFormat.allCases, id: \.self) { f in
                        Button(f.rawValue.uppercased()) { model.export(f) }
                    }
                } label: { Label("Export", systemImage: "square.and.arrow.up") }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .padding(.horizontal, 12)
                    .frame(height: DS.Width.controlSm)
                    .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.lineStrong, lineWidth: 1))
            }

            Button { ui.showFileLanguagePopover = true } label: {
                Label(languageLabel, systemImage: "globe")
            }
            .buttonStyle(.dsOutlineSm)
            .popover(isPresented: $ui.showFileLanguagePopover, arrowEdge: .bottom) {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Languages").font(.system(size: 13, weight: .semibold))
                    Picker("Spoken language", selection: $prefs.sourceLocale) {
                        ForEach(Languages.sources) { Text($0.name).tag($0.id) }
                    }
                    Toggle("Translate", isOn: $prefs.translateEnabled)
                    Picker("Into", selection: $prefs.targetLanguage) {
                        ForEach(Languages.targets) { Text($0.name).tag($0.id) }
                    }
                    .disabled(!prefs.translateEnabled)
                }
                .padding(DS.Space.s4)
                .frame(width: 340)
            }
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

    private var dropCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "waveform.circle")
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(DS.Colors.textFaint)
            Text(model.url?.lastPathComponent ?? "Choose an audio or video file")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(DS.Colors.textBody)
            Text("Transcription runs on this Mac. Nothing is uploaded.")
                .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            Button("Choose file…") { model.pick() }.buttonStyle(.dsOutline)
        }
        .frame(maxWidth: .infinity)
        .dsCard(padding: DS.Space.s6)
    }
}
