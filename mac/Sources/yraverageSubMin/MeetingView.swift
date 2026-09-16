// Workspace rapat — Tahap 1: kepala rapat + register bersama dalam kolom baca,
// dengan ekspor TXT/Markdown dari dokumen itu. Tahap 2 mengubahnya menjadi
// split transkrip | register yang bisa diseret (30–50 %) dan menambah jalur
// tulis ke helper (ubah nama, hapus, tambah butir).
//
// Ekspor dipindahkan dari NotesView lama: dulu ia mengekspor data contoh,
// sekarang mengekspor dokumen bersama yang sungguhan.
import AppKit
import SwiftUI

struct MeetingView: View {
    @ObservedObject var notes: NotesViewState
    @ObservedObject var prefs: PrefsBridge
    @Environment(\.colorScheme) private var scheme
    let id: String?

    init(app: AppController, id: String?) {
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
                    ScrollView {
                        ReadingColumn {
                            SharedRegisterView(
                                docs: [d],
                                selectedId: .constant(d.id),
                                typeFilter: $notes.sharedTypeFilter,
                                accent: Brand.reskinAccent(prefs.reskin, scheme),
                                embedded: true
                            )
                            .padding(.top, DS.Space.s4)
                        }
                        .padding(.bottom, DS.Space.s8)
                    }
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "note.text")
                        .font(.system(size: 48, weight: .light)).foregroundStyle(DS.Colors.textFaint)
                    Text("No meeting notes yet")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(DS.Colors.textStrong)
                    Text("Record a meeting here, or push one from the browser extension via the Native Helper.")
                        .font(.system(size: 13)).foregroundStyle(DS.Colors.textSubtle)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 380)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(DS.Colors.panel)
    }

    private func header(_ d: SharedNoteDoc) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(d.title)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(DS.Colors.textStrong)
                    .lineLimit(2)
                Text(meta(d))
                    .font(.system(size: 12))
                    .foregroundStyle(DS.Colors.textFaint)
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
        if let e = d.meeting?.engine, e.segments > 0 { parts.append("\(e.segments) segments") }
        parts.append("processed locally")
        return parts.joined(separator: " · ")
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
            out.append("Prepared on this Mac. Nothing left the device.")
        }
        return out.joined(separator: "\n")
    }
}
