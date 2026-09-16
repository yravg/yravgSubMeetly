// Workspace rapat ala Meetily: split yang bisa diseret — transkrip di kiri
// (30–50 %, tersimpan), register di kanan. Kepala halaman memuat judul, meta,
// Export, dan menu Rename/Delete.
//
// Jalur tulis (Tahap 2): Generate notes (heuristik helper), tambah butir,
// tandai selesai / hapus butir lewat menu konteks. Semua lewat AppController →
// helper (atau berkas bila helper mati).
//
// Ekspor dipindahkan dari NotesView lama: dulu ia mengekspor data contoh,
// sekarang mengekspor dokumen bersama yang sungguhan.
import AppKit
import SwiftUI
import SubMinKit

struct MeetingView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var notes: NotesViewState
    @ObservedObject var prefs: PrefsBridge
    @Environment(\.colorScheme) private var scheme
    let id: String?

    init(app: AppController, id: String?) {
        self.app = app
        self.ui = app.ui
        self.notes = app.notesUI
        self.prefs = PrefsBridge.shared
        self.id = id
    }

    private var doc: SharedNoteDoc? {
        notes.sharedDocs.first { $0.id == id } ?? notes.sharedDocs.first
    }

    var body: some View {
        Group {
            if let d = doc {
                VStack(spacing: 0) {
                    header(d)
                    GeometryReader { geo in
                        HStack(spacing: 0) {
                            transcriptPane(d)
                                .frame(width: max(200, geo.size.width * ui.paneRatio))
                            splitHandle(total: geo.size.width)
                            registerPane(d)
                        }
                        .coordinateSpace(name: "split")
                    }
                }
            } else {
                emptyWorkspace
            }
        }
        .background(DS.Colors.panel)
    }

    // MARK: Kepala

    private func header(_ d: SharedNoteDoc) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(d.title)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(DS.Colors.textStrong)
                    .lineLimit(2)
                HStack(spacing: 8) {
                    Text(meta(d)).font(.system(size: 12)).foregroundStyle(DS.Colors.textFaint)
                    if !ui.noteBusy.isEmpty {
                        ProgressView().controlSize(.mini)
                        Text(ui.noteBusy).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                    }
                }
            }
            Spacer()
            Menu {
                Button("Text (.txt)") { export(d, markdown: false) }
                Button("Markdown (.md)") { export(d, markdown: true) }
            } label: { Label("Export", systemImage: "square.and.arrow.up") }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .padding(.horizontal, 12)
                .frame(height: DS.Width.controlSm)
                .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.lineStrong, lineWidth: 1))
            Menu {
                Button("Rename…") { ui.renameText = d.title; ui.renamingId = d.id }
                Divider()
                Button("Delete meeting…", role: .destructive) { ui.deletingId = d.id }
            } label: { Image(systemName: "ellipsis") }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .frame(width: DS.Width.controlSm, height: DS.Width.controlSm)
                .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.lineStrong, lineWidth: 1))
        }
        .padding(.horizontal, DS.Space.s6)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }
    }

    private func meta(_ d: SharedNoteDoc) -> String {
        var parts: [String] = []
        if !d.date.isEmpty { parts.append(d.date) }
        parts.append(d.register.count == 1 ? "1 item" : "\(d.register.count) items")
        if !d.transcript.isEmpty { parts.append("\(d.transcript.count) transcript lines") }
        else if let e = d.meeting?.engine, e.segments > 0 { parts.append("\(e.segments) segments") }
        parts.append(d.source == "mac" ? "recorded on this Mac" : "processed locally")
        return parts.joined(separator: " · ")
    }

    // MARK: Panel transkrip

    private func transcriptPane(_ d: SharedNoteDoc) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { copyTranscript(d) } label: { Label("Copy", systemImage: "doc.on.doc") }
                    .buttonStyle(.dsOutlineSm)
                    .disabled(d.transcript.isEmpty)
                Text("Transcript")
                    .font(.system(size: 12, weight: .medium)).foregroundStyle(DS.Colors.textSubtle)
                Spacer()
            }
            .padding(DS.Space.s4)
            .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }

            if d.transcript.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "text.quote").font(.system(size: 28, weight: .light)).foregroundStyle(DS.Colors.textFaint)
                    Text("No transcript stored")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(DS.Colors.textBody)
                    Text(d.source == "mac"
                         ? "This recording produced no speech."
                         : "This meeting was pushed from the browser extension, which keeps only each item's source timestamp.")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(DS.Space.s6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(d.transcript) { l in
                            TranscriptSegmentView(
                                line: SubtitleLine(start: l.t0, end: l.t1, source: l.source, translation: l.translation),
                                dual: true)
                        }
                    }
                    .padding(.horizontal, DS.Space.s4)
                    .padding(.vertical, DS.Space.s3)
                }
            }
        }
        .background(DS.Colors.panel)
    }

    /// Garis 1 px di zona 8 px; menebal & jadi teal saat diseret. Rasio dijepit
    /// 0,30–0,50 dan tersimpan (Prefs.transcriptPaneRatio).
    private func splitHandle(total: CGFloat) -> some View {
        ZStack {
            Color.clear
            DS.Colors.line.frame(width: 1)
        }
        .frame(width: 8)
        .contentShape(Rectangle())
        .onHover { inside in
            if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
        }
        .gesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .named("split"))
                .onChanged { v in
                    guard total > 0 else { return }
                    ui.paneRatio = min(0.5, max(0.3, v.location.x / total))
                }
        )
        .accessibilityLabel("Resize transcript pane")
    }

    // MARK: Panel register

    private func registerPane(_ d: SharedNoteDoc) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button { Task { await app.generateNotes(for: d.id) } } label: {
                    Label("Generate notes", systemImage: "sparkles")
                }
                .buttonStyle(.dsAI)
                .disabled(d.transcript.isEmpty || !ui.noteBusy.isEmpty)
                .help(d.transcript.isEmpty
                      ? "Needs a transcript recorded on this Mac"
                      : "Draft decisions and actions from the transcript via the Native Helper")

                Button { beginAdd(.decision) } label: { Label("Decision", systemImage: "plus") }
                    .buttonStyle(.dsOutlineSm)
                Button { beginAdd(.action) } label: { Label("Action", systemImage: "plus") }
                    .buttonStyle(.dsOutlineSm)
                Menu {
                    Button("Question") { beginAdd(.question) }
                    Button("Risk") { beginAdd(.risk) }
                    Button("Info") { beginAdd(.info) }
                } label: { Label("More", systemImage: "plus") }
                    .menuStyle(.borderlessButton)
                    .fixedSize()
                    .padding(.horizontal, 10)
                    .frame(height: DS.Width.controlSm)
                    .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.lineStrong, lineWidth: 1))
                Spacer()
            }
            .padding(DS.Space.s4)
            .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }

            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.s3) {
                    if !ui.noteError.isEmpty {
                        DSCallout(tone: .warning, title: "Could not generate notes", icon: "exclamationmark.triangle") {
                            Text(ui.noteError).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if let t = ui.addingType { addForm(d, type: t) }

                    SharedRegisterView(
                        docs: [d],
                        selectedId: .constant(d.id),
                        typeFilter: $notes.sharedTypeFilter,
                        accent: Brand.reskinAccent(prefs.reskin, scheme),
                        embedded: true,
                        onToggle: { item in Task { await app.setItemStatus(in: d.id, ref: item.ref, closed: !item.isClosed) } },
                        onDelete: { item in Task { await app.removeItem(from: d.id, ref: item.ref) } }
                    )
                }
                .padding(DS.Space.s4)
                .frame(maxWidth: DS.Width.reading, alignment: .leading)
            }
        }
        .background(DS.Colors.panel)
    }

    private func beginAdd(_ type: SharedItemType) {
        ui.addText = ""
        ui.addOwner = ""
        ui.addingType = type
    }

    /// Formulir tambah butir, inline di atas register (Meetily: textarea
    /// "Add context…" di kaki panel transkrip).
    private func addForm(_ d: SharedNoteDoc, type: SharedItemType) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("New \(type.label.lowercased())").font(.system(size: 12, weight: .semibold)).foregroundStyle(DS.Colors.textSubtle)
            TextField("What was \(type == .action ? "agreed to be done" : "said")…", text: $ui.addText)
                .textFieldStyle(.roundedBorder)
                .onSubmit { submitAdd(d, type: type) }
            if type == .action || type == .decision || type == .risk {
                TextField("Owner (optional)", text: $ui.addOwner).textFieldStyle(.roundedBorder)
            }
            HStack(spacing: 8) {
                Button("Save") { submitAdd(d, type: type) }
                    .buttonStyle(.dsSolid)
                    .disabled(ui.addText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button("Cancel") { ui.addingType = nil }.buttonStyle(.dsSecondary)
                Spacer()
            }
        }
        .dsCard(padding: DS.Space.s4)
    }

    private func submitAdd(_ d: SharedNoteDoc, type: SharedItemType) {
        let text = ui.addText, owner = ui.addOwner
        ui.addingType = nil
        Task { await app.addItem(to: d.id, type: type, text: text, owner: owner) }
    }

    // MARK: Kosong

    private var emptyWorkspace: some View {
        VStack(spacing: 8) {
            Image(systemName: "note.text")
                .font(.system(size: 48, weight: .light)).foregroundStyle(DS.Colors.textFaint)
            Text("No meeting notes yet")
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(DS.Colors.textStrong)
            Text("Press Start Recording — stopping saves the meeting here. Or push one from the browser extension via the Native Helper.")
                .font(.system(size: 13)).foregroundStyle(DS.Colors.textSubtle)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Ekspor & salin

    private func copyTranscript(_ d: SharedNoteDoc) {
        let text = d.transcript.map { l in
            l.translation.isEmpty ? l.source : "\(l.source)\n\(l.translation)"
        }.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    private func export(_ d: SharedNoteDoc, markdown: Bool) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        let base = d.title.replacingOccurrences(of: "/", with: "-")
        panel.nameFieldStringValue = markdown ? "\(base).md" : "\(base).txt"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            try? SharedNoteExport.text(d, markdown: markdown)
                .write(to: url, atomically: true, encoding: .utf8)
        }
    }
}

/// Ekspor dokumen bersama — dipakai MeetingView dan tes probe.
enum SharedNoteExport {
    static func text(_ d: SharedNoteDoc, markdown: Bool) -> String {
        var out: [String] = []
        if markdown {
            out.append("# \(d.title)")
            out.append("")
            var meta = [d.date].filter { !$0.isEmpty }
            if let s = d.meeting?.seriesLabel { meta.append(s) }
            if let c = d.meeting?.chair, !c.isEmpty { meta.append("Chair: \(c)") }
            if !meta.isEmpty { out.append("_\(meta.joined(separator: " · "))_"); out.append("") }
            if !d.summary.isEmpty { out.append(d.summary); out.append("") }
            for t in SharedItemType.allCases {
                let items = d.register.filter { $0.type == t }
                guard !items.isEmpty else { continue }
                out.append("## \(t.label)")
                out.append("")
                for i in items {
                    var line = "- "
                    if t == .action { line += i.isClosed ? "[x] " : "[ ] " }
                    if !i.ref.isEmpty { line += "**\(i.ref)** " }
                    line += i.text
                    var tail: [String] = []
                    if let o = i.ownerLabel { tail.append(o) }
                    if let due = i.due { tail.append("due \(due)") }
                    if let r = i.riskLabel { tail.append(r) }
                    if let m = i.metric { tail.append(m.display) }
                    if let tc = i.tc { tail.append(tc) }
                    if !tail.isEmpty { line += " — " + tail.joined(separator: " · ") }
                    out.append(line)
                }
                out.append("")
            }
            if !d.transcript.isEmpty {
                out.append("## Transcript")
                out.append("")
                for l in d.transcript {
                    out.append("[\(DS.clock(l.t0))] \(l.source)" + (l.translation.isEmpty ? "" : "  \n\(l.translation)"))
                }
                out.append("")
            }
            out.append("Prepared on this Mac. Nothing left the device.")
        } else {
            out.append(d.title)
            if !d.date.isEmpty { out.append(d.date) }
            out.append("")
            if !d.summary.isEmpty { out.append("Summary"); out.append(d.summary); out.append("") }
            for t in SharedItemType.allCases {
                let items = d.register.filter { $0.type == t }
                guard !items.isEmpty else { continue }
                out.append(t.label)
                for i in items {
                    var line = "- "
                    if !i.ref.isEmpty { line += "\(i.ref) " }
                    line += i.text
                    var tail: [String] = []
                    if let o = i.ownerLabel { tail.append(o) }
                    if let due = i.due { tail.append("due \(due)") }
                    if i.isClosed { tail.append("done") }
                    if !tail.isEmpty { line += " — " + tail.joined(separator: " · ") }
                    out.append(line)
                }
                out.append("")
            }
            if !d.transcript.isEmpty {
                out.append("Transcript")
                for l in d.transcript {
                    out.append("[\(DS.clock(l.t0))] \(l.source)")
                    if !l.translation.isEmpty { out.append("         \(l.translation)") }
                }
                out.append("")
            }
            out.append("Prepared on this Mac. Nothing left the device.")
        }
        return out.joined(separator: "\n")
    }
}
