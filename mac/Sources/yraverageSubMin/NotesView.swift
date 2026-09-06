// Meeting notes panel (Fase 2) — stub lokal, selaras dengan Side Panel ekstensi.
import AppKit
import SwiftUI

struct MeetingNoteAction: Identifiable {
    let id: String
    var text: String
    var owner: String
    var due: String?
    var done: Bool
}

struct MeetingNote: Identifiable {
    let id: String
    let title: String
    let source: String
    let statusLabel: String
    var summary: String
    var decisions: [String]
    var actions: [MeetingNoteAction]
    let transcriptPreview: String
    let savedLocally: Bool
}

enum MeetingNotesStub {
    static let sample = MeetingNote(
        id: "note-demo-001",
        title: "Standup rilis Fase 1 — contoh",
        source: "transkrip contoh (lokal)",
        statusLabel: "Siap (lokal)",
        summary:
            "Tim meninjau gerbang rilis Fase 1. Smoke katalog 26 sub-fitur sudah lulus; fokus sisa adalah E2E pemilih tab, helper native, dan berkas offline.",
        decisions: [
            "Soft-launch internal setelah E2E --pick dan e2e-file --browser lulus.",
            "Target draft native ≤500 ms tidak memblokir soft-launch; masuk backlog Fase 2.1.",
        ],
        actions: [
            MeetingNoteAction(
                id: "act-1",
                text: "Jalankan dan arsipkan hasil e2e.mjs --pick",
                owner: "Citra",
                due: "2026-09-04",
                done: false
            ),
            MeetingNoteAction(
                id: "act-2",
                text: "Verifikasi e2e.mjs --native dengan helper hidup",
                owner: "Bima",
                due: "2026-09-04",
                done: false
            ),
        ],
        transcriptPreview:
            "Alya: Mari kita mulai…\nBima: Smoke 26 sub-fitur sudah hijau…\nCitra: Usul geser target draft 500 ms…",
        savedLocally: true
    )

    static let samples = [
        sample,
        MeetingNote(
            id: "note-demo-002",
            title: "Sinkron corak lintas permukaan — contoh",
            source: "transkrip contoh (lokal)",
            statusLabel: "Draf (lokal)",
            summary: "Tim memverifikasi corak aktif tersinkron ke side panel, overlay, dan aplikasi macOS tanpa reload.",
            decisions: ["Corak bawaan tetap Yraverage Klasik."],
            actions: [
                MeetingNoteAction(
                    id: "act-3",
                    text: "Uji matriks 3 corak × 2 mode di lab",
                    owner: "Dimas",
                    due: nil,
                    done: true
                ),
            ],
            transcriptPreview: "Dimas: Matriks corak hijau semua…",
            savedLocally: true
        ),
    ]

    static let emptyDecisionsMessage = "Belum ada poin keputusan pada notulen ini."
    static let emptyActionsMessage = "Belum ada tindak lanjut. Tambahkan setelah notulen dibuat."
}

/// State lokal panel notulen. Dipisah ke ObservableObject karena @State adalah
/// makro pada SDK macOS 26 dan plugin-nya hanya ikut Xcode penuh; proyek ini
/// dibangun dengan Command Line Tools. Pemiliknya AppController agar isinya
/// tidak hilang tiap kali tab berpindah.
@MainActor
final class NotesViewState: ObservableObject {
    @Published var notes = MeetingNotesStub.samples
    @Published var selectedId = MeetingNotesStub.sample.id
    @Published var sharedDocs: [SharedNoteDoc] = []
    @Published var showTranscript = false
    @Published var summaryDraft: String? = nil
    @Published var addingDecision = false
    @Published var decisionText = ""
    @Published var addingAction = false
    @Published var actionText = ""
    @Published var actionOwner = ""
}

struct NotesView: View {
    @ObservedObject private var vm: NotesViewState
    @ObservedObject private var prefs = PrefsBridge.shared
    @Environment(\.colorScheme) private var scheme

    init(vm: NotesViewState) {
        self.vm = vm
    }

    private var accent: Color { Brand.reskinAccent(prefs.reskin, scheme) }
    private var selectedIndex: Int {
        vm.notes.firstIndex(where: { $0.id == vm.selectedId }) ?? 0
    }
    private var note: MeetingNote { vm.notes[selectedIndex] }
    private var openActions: Int { note.actions.filter { !$0.done }.count }

    private func saveDecision() {
        let text = vm.decisionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        vm.notes[selectedIndex].decisions.append(text)
        vm.decisionText = ""
        vm.addingDecision = false
    }

    private func saveAction() {
        let text = vm.actionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let owner = vm.actionOwner.trimmingCharacters(in: .whitespacesAndNewlines)
        vm.notes[selectedIndex].actions.append(MeetingNoteAction(
            id: "act-\(UUID().uuidString.prefix(8))",
            text: text,
            owner: owner.isEmpty ? "Belum ditugaskan" : owner,
            due: nil,
            done: false
        ))
        vm.actionText = ""
        vm.actionOwner = ""
        vm.addingAction = false
    }

    private enum ExportKind { case txt, md }

    private func exportText(_ kind: ExportKind) -> String {
        switch kind {
        case .txt:
            var lines = [note.title, "\(note.id) · \(note.source)", ""]
            lines.append("Summary")
            lines.append(note.summary.isEmpty ? "(belum ada ringkasan)" : note.summary)
            lines.append("")
            if !note.decisions.isEmpty {
                lines.append("Decisions")
                lines += note.decisions.map { "- \($0)" }
                lines.append("")
            }
            if !note.actions.isEmpty {
                lines.append("Action items")
                lines += note.actions.map {
                    "- \($0.text) — \($0.owner)\($0.done ? " · selesai" : "")"
                }
                lines.append("")
            }
            lines.append("Disusun lokal di perangkat.")
            return lines.joined(separator: "\n")
        case .md:
            var lines = ["# \(note.title)", "", "_\(note.id)_ · \(note.source)", ""]
            lines.append(note.summary.isEmpty ? "_Belum ada ringkasan._" : note.summary)
            lines.append("")
            if !note.decisions.isEmpty {
                lines.append(contentsOf: ["## Decisions", ""])
                lines += note.decisions.map { "- \($0)" }
                lines.append("")
            }
            if !note.actions.isEmpty {
                lines.append(contentsOf: ["## Action items", ""])
                lines += note.actions.map {
                    "- [\($0.done ? "x" : " ")] \($0.text) — \($0.owner)"
                }
                lines.append("")
            }
            lines.append("Disusun lokal di perangkat.")
            return lines.joined(separator: "\n")
        }
    }

    private func exportNote(_ kind: ExportKind) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.plainText]
        panel.nameFieldStringValue = kind == .md ? "notulen.md" : "notulen.txt"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            try? exportText(kind).write(to: url, atomically: true, encoding: .utf8)
        }
    }

    /// Draf ringkasan otomatis (mock lokal): heuristik dari butir tertangkap.
    private func draftSummary() -> String? {
        let texts = note.decisions + note.actions.map(\.text)
        let trimmed = texts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        guard !trimmed.isEmpty else { return nil }
        if trimmed.count == 1 { return trimmed[0] }
        return "\(trimmed[0]) … \(trimmed[trimmed.count - 1]) (\(trimmed.count) butir)."
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(note.statusLabel)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(accent.opacity(0.15))
                        .foregroundStyle(accent)
                        .clipShape(Capsule())
                    Spacer()
                    Text(note.savedLocally ? "Tersimpan di perangkat" : "Draft lokal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                GroupBox("Tersimpan (\(vm.notes.count))") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(vm.notes) { m in
                            HStack(spacing: 6) {
                                Button {
                                    vm.selectedId = m.id
                                    vm.summaryDraft = nil
                                } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: m.id == vm.selectedId
                                              ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(m.id == vm.selectedId ? accent : .secondary)
                                        VStack(alignment: .leading, spacing: 1) {
                                            Text(m.title)
                                                .font(.callout.weight(.medium))
                                                .lineLimit(1)
                                            Text("\(m.decisions.count) keputusan · \(m.actions.count) tindak lanjut")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer(minLength: 0)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) {
                                    vm.notes.removeAll { $0.id == m.id }
                                    if vm.selectedId == m.id {
                                        vm.selectedId = vm.notes.first?.id ?? ""
                                    }
                                } label: {
                                    Label("Hapus", systemImage: "trash")
                                }
                                .disabled(vm.notes.count <= 1)
                            }
                        }
                    }
                    .padding(6)
                }

                GroupBox("Bersama · helper (\(vm.sharedDocs.count))") {
                    if vm.sharedDocs.isEmpty {
                        Text("Belum ada dokumen bersama — dorong dari ekstensi via Native Helper.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(6)
                    } else {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(vm.sharedDocs.prefix(5)) { d in
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(d.title)
                                        .font(.callout.weight(.medium))
                                        .lineLimit(1)
                                    Text("\(d.decisions.count) keputusan · \(d.actions.count) tindak lanjut")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(6)
                    }
                }
                .onAppear { vm.sharedDocs = HelperSharedStore.load() }

                GroupBox {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(note.title)
                            .font(.headline)
                        Text(note.source)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                }

                GroupBox("Ringkasan") {
                    VStack(alignment: .leading, spacing: 8) {
                        if let draft = vm.summaryDraft {
                            Text(draft)
                                .font(.body.italic())
                                .fixedSize(horizontal: false, vertical: true)
                                .padding(.leading, 8)
                                .overlay(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(accent)
                                        .frame(width: 3)
                                }
                            HStack(spacing: 8) {
                                Button("Gunakan ringkasan") {
                                    vm.notes[selectedIndex].summary = draft
                                    vm.summaryDraft = nil
                                }
                                .buttonStyle(.borderedProminent)
                                .controlSize(.small)
                                .tint(accent)
                                Button("Buang draf") { vm.summaryDraft = nil }
                                    .controlSize(.small)
                            }
                        } else {
                            Text(note.summary)
                                .font(.body)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Buat ringkasan otomatis") {
                                vm.summaryDraft = draftSummary()
                            }
                            .controlSize(.small)
                        }
                        DisclosureGroup("Transkrip contoh", isExpanded: $vm.showTranscript) {
                            Text(note.transcriptPreview)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(6)
                }

                GroupBox("Poin Keputusan (\(note.decisions.count))") {
                    if note.decisions.isEmpty && !vm.addingDecision {
                        Text(MeetingNotesStub.emptyDecisionsMessage)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(6)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(note.decisions, id: \.self) { d in
                                Label(d, systemImage: "checkmark.circle")
                                    .font(.callout)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            vm.notes[selectedIndex].decisions.removeAll { $0 == d }
                                        } label: {
                                            Label("Hapus", systemImage: "trash")
                                        }
                                    }
                            }
                            if vm.addingDecision {
                                HStack(spacing: 6) {
                                    TextField("Keputusan…", text: $vm.decisionText)
                                        .textFieldStyle(.roundedBorder)
                                        .onSubmit { saveDecision() }
                                    Button("Simpan") { saveDecision() }
                                        .buttonStyle(.borderedProminent)
                                        .controlSize(.small)
                                        .tint(accent)
                                        .disabled(vm.decisionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                    Button("Batal") {
                                        vm.addingDecision = false
                                        vm.decisionText = ""
                                    }
                                    .controlSize(.small)
                                }
                            } else {
                                Button("+ Keputusan") {
                                    vm.addingDecision = true
                                }
                                .controlSize(.small)
                            }
                        }
                        .padding(6)
                    }
                }

                GroupBox("Tindak Lanjut (\(openActions)/\(note.actions.count))") {
                    if note.actions.isEmpty && !vm.addingAction {
                        Text(MeetingNotesStub.emptyActionsMessage)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(6)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(note.actions) { a in
                                HStack(alignment: .top, spacing: 8) {
                                    Button {
                                        if let idx = vm.notes[selectedIndex].actions.firstIndex(where: { $0.id == a.id }) {
                                            vm.notes[selectedIndex].actions[idx].done.toggle()
                                        }
                                    } label: {
                                        Image(systemName: a.done ? "checkmark.circle.fill" : "circle")
                                            .foregroundStyle(a.done ? accent : .secondary)
                                    }
                                    .buttonStyle(.plain)
                                    .help(a.done ? "Buka lagi" : "Tandai selesai")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(a.text)
                                            .font(.callout.weight(.medium))
                                            .strikethrough(a.done)
                                        Text("\(a.owner) · \(a.due ?? "tanpa tenggat")")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .swipeActions(edge: .trailing) {
                                    Button(role: .destructive) {
                                        vm.notes[selectedIndex].actions.removeAll { $0.id == a.id }
                                    } label: {
                                        Label("Hapus", systemImage: "trash")
                                    }
                                }
                            }
                            if vm.addingAction {
                                VStack(alignment: .leading, spacing: 6) {
                                    TextField("Tugas…", text: $vm.actionText)
                                        .textFieldStyle(.roundedBorder)
                                    TextField("Pemilik", text: $vm.actionOwner)
                                        .textFieldStyle(.roundedBorder)
                                    HStack(spacing: 6) {
                                        Button("Simpan") { saveAction() }
                                            .buttonStyle(.borderedProminent)
                                            .controlSize(.small)
                                            .tint(accent)
                                            .disabled(vm.actionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                                        Button("Batal") {
                                            vm.addingAction = false
                                            vm.actionText = ""
                                            vm.actionOwner = ""
                                        }
                                        .controlSize(.small)
                                    }
                                }
                            } else {
                                Button("+ Tindak Lanjut") {
                                    vm.addingAction = true
                                }
                                .controlSize(.small)
                            }
                        }
                        .padding(6)
                    }
                }

                HStack {
                    Button("Muat ulang contoh") {
                        vm.notes = MeetingNotesStub.samples
                        vm.selectedId = MeetingNotesStub.sample.id
                        vm.summaryDraft = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(accent)
                    Menu("Ekspor") {
                        Button("TXT") { exportNote(.txt) }
                        Button("Markdown") { exportNote(.md) }
                    }
                    .menuStyle(.borderlessButton)
                    Spacer()
                }
            }
            .padding(14)
        }
    }
}
