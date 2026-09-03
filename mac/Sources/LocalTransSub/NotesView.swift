// Meeting notes panel (Fase 2) — stub lokal, selaras dengan Side Panel ekstensi.
import SwiftUI

struct MeetingNoteAction: Identifiable {
    let id: String
    let text: String
    let owner: String
    let due: String?
    let done: Bool
}

struct MeetingNote: Identifiable {
    let id: String
    let title: String
    let source: String
    let statusLabel: String
    let summary: String
    let decisions: [String]
    let actions: [MeetingNoteAction]
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

    static let emptyDecisionsMessage = "Belum ada poin keputusan pada notulen ini."
    static let emptyActionsMessage = "Belum ada tindak lanjut. Tambahkan setelah notulen dibuat."
}

struct NotesView: View {
    @State private var note = MeetingNotesStub.sample
    @State private var showTranscript = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(note.statusLabel)
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Brand.teal.opacity(0.15))
                        .foregroundStyle(Brand.teal)
                        .clipShape(Capsule())
                    Spacer()
                    Text(note.savedLocally ? "Tersimpan di perangkat" : "Draft lokal")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

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
                        Text(note.summary)
                            .font(.body)
                            .fixedSize(horizontal: false, vertical: true)
                        DisclosureGroup("Transkrip contoh", isExpanded: $showTranscript) {
                            Text(note.transcriptPreview)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(.secondary)
                                .textSelection(.enabled)
                        }
                    }
                    .padding(6)
                }

                GroupBox("Poin Keputusan") {
                    if note.decisions.isEmpty {
                        Text(MeetingNotesStub.emptyDecisionsMessage)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(6)
                    } else {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(note.decisions, id: \.self) { d in
                                Label(d, systemImage: "checkmark.circle")
                                    .font(.callout)
                            }
                        }
                        .padding(6)
                    }
                }

                GroupBox("Tindak Lanjut") {
                    if note.actions.isEmpty {
                        Text(MeetingNotesStub.emptyActionsMessage)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(6)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            ForEach(note.actions) { a in
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.text)
                                        .font(.callout.weight(.medium))
                                    Text("\(a.owner) · \(a.due ?? "tanpa tenggat")")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                        .padding(6)
                    }
                }

                HStack {
                    Button("Buat Notulen dari contoh") {
                        note = MeetingNotesStub.sample
                    }
                    .buttonStyle(.borderedProminent)
                    Spacer()
                }
            }
            .padding(14)
        }
    }
}
