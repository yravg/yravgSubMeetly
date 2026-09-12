// Register notulen bersama — detail dokumen yang didorong ekstensi lewat
// Native Helper (lihat HelperSharedNotes.swift).
//
// Sebelumnya aplikasi ini hanya menampilkan judul dan dua angka ("N keputusan ·
// M tindak lanjut"). Yang sebenarnya dicatat register jauh lebih banyak, dan
// justru bagian itu yang dipakai saat rapat: nomor ref yang diucapkan orang,
// pemilik, tenggat, status, serta pertanyaan, risiko, dan metrik yang pada
// bentuk lama tidak terbawa sama sekali.
import SwiftUI

// MARK: - Warna tipe

extension Color {
    /// "e0b05c" → Color. Nil untuk masukan yang bukan 6 digit heksadesimal.
    init?(registerHex hex: String) {
        guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return nil }
        self.init(
            red: Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8) & 0xFF) / 255,
            blue: Double(v & 0xFF) / 255
        )
    }
}

private extension SharedItemType {
    var color: Color { Color(registerHex: hex) ?? .secondary }

    var symbol: String {
        switch self {
        case .decision: return "checkmark.seal"
        case .action: return "arrow.right.circle"
        case .question: return "questionmark.circle"
        case .risk: return "exclamationmark.triangle"
        case .metric: return "chart.bar"
        case .info: return "info.circle"
        }
    }
}

// MARK: - Satu baris butir

private struct RegisterRow: View {
    let item: SharedNoteItem

    private var statusLabel: String? {
        switch item.status {
        case "closed": return "Selesai"
        case "progress": return "Berjalan"
        case "carried": return "Dibawa"
        default: return item.type == .action ? "Terbuka" : nil
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: item.type.symbol)
                .foregroundStyle(item.type.color)
                .frame(width: 16)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if !item.ref.isEmpty {
                        Text(item.ref)
                            .font(.caption.monospaced().weight(.medium))
                            .foregroundStyle(item.type.color)
                    }
                    if !item.topic.isEmpty {
                        Text(item.topic)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    // Keyakinan rendah ditandai di sini, bukan disembunyikan:
                    // butir inilah yang paling perlu dibaca ulang manusia.
                    if item.needsReview {
                        Label("perlu dicek", systemImage: "flag")
                            .font(.caption2)
                            .foregroundStyle(.orange)
                            .labelStyle(.titleAndIcon)
                    }
                    Spacer(minLength: 0)
                    if let tc = item.tc {
                        Text(tc)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                }

                Text(item.text)
                    .font(.callout)
                    .fixedSize(horizontal: false, vertical: true)
                    .strikethrough(item.isClosed, color: .secondary)
                    .foregroundStyle(item.isClosed ? Color.secondary : Color.primary)

                let facts = metaFacts
                if !facts.isEmpty {
                    Text(facts.joined(separator: "  ·  "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 3)
    }

    /// Baris fakta di bawah teks. Hanya yang benar-benar ada yang ikut —
    /// placeholder kosong membuat register sulit dipindai.
    private var metaFacts: [String] {
        var out: [String] = []
        if let o = item.ownerLabel { out.append(o) }
        if let d = item.due, !d.isEmpty { out.append("tenggat \(d)") }
        if let s = statusLabel { out.append(s) }
        if let r = item.riskLabel { out.append(r) }
        if let m = item.metric { out.append(m.display) }
        if let c = item.carriedFrom, !c.isEmpty { out.append("bawaan \(c)") }
        if let sp = item.speaker, !sp.isEmpty { out.append(sp) }
        return out
    }
}

// MARK: - Kepala dokumen

private struct RegisterHeader: View {
    let doc: SharedNoteDoc
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(doc.title)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 0)
                if doc.isIssued {
                    Text("Terbit")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(accent.opacity(0.15))
                        .foregroundStyle(accent)
                        .clipShape(Capsule())
                }
            }

            let facts = headerFacts
            if !facts.isEmpty {
                Text(facts.joined(separator: "  ·  "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let m = doc.meeting, m.agenda.total > 0 {
                HStack(spacing: 6) {
                    ProgressView(value: Double(m.agenda.covered), total: Double(m.agenda.total))
                        .frame(maxWidth: 140)
                    Text("agenda \(m.agenda.covered)/\(m.agenda.total)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if !doc.summary.isEmpty {
                Text(doc.summary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var headerFacts: [String] {
        var out: [String] = []
        if !doc.date.isEmpty { out.append(doc.date) }
        guard let m = doc.meeting else { return out }
        if let s = m.seriesLabel { out.append(s) }
        if m.projectType != "general" { out.append(m.projectType) }
        if let c = m.chair, !c.isEmpty { out.append("ketua \(c)") }
        if !m.attendees.isEmpty { out.append("\(m.attendees.count) hadir") }
        if let e = m.engine, !e.asr.isEmpty { out.append("\(e.asr) · \(e.segments) segmen") }
        return out
    }
}

// MARK: - Panel register

struct SharedRegisterView: View {
    let docs: [SharedNoteDoc]
    @Binding var selectedId: String
    @Binding var typeFilter: SharedItemType?
    let accent: Color

    private var doc: SharedNoteDoc? {
        docs.first { $0.id == selectedId } ?? docs.first
    }

    private var visibleItems: [SharedNoteItem] {
        guard let d = doc else { return [] }
        guard let f = typeFilter else { return d.register }
        return d.register.filter { $0.type == f }
    }

    var body: some View {
        GroupBox("Register bersama · helper (\(docs.count))") {
            if docs.isEmpty {
                Text("Belum ada dokumen bersama — dorong dari ekstensi via Native Helper.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
            } else if let d = doc {
                VStack(alignment: .leading, spacing: 10) {
                    if docs.count > 1 {
                        Picker("Rapat", selection: $selectedId) {
                            ForEach(docs) { Text($0.title).tag($0.id) }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    }

                    RegisterHeader(doc: d, accent: accent)

                    Divider()

                    filterRow(d)

                    if visibleItems.isEmpty {
                        Text("Tidak ada butir pada filter ini.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 4)
                    } else {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(Array(visibleItems.enumerated()), id: \.offset) { _, item in
                                RegisterRow(item: item)
                            }
                        }
                    }

                    footer(d)
                }
                .padding(6)
            }
        }
    }

    /// Filter per tipe. Tipe tanpa butir sengaja tidak ditampilkan — chip yang
    /// selalu kosong hanya menambah lebar tanpa memberi informasi.
    @ViewBuilder
    private func filterRow(_ d: SharedNoteDoc) -> some View {
        let present = SharedItemType.allCases.filter { d.count(of: $0) > 0 }
        if !present.isEmpty {
            HStack(spacing: 6) {
                chip(label: "Semua", count: d.register.count, color: accent, active: typeFilter == nil) {
                    typeFilter = nil
                }
                ForEach(present, id: \.self) { t in
                    chip(label: t.label, count: d.count(of: t), color: t.color, active: typeFilter == t) {
                        typeFilter = (typeFilter == t) ? nil : t
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private func chip(label: String, count: Int, color: Color, active: Bool,
                      action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text("\(label) \(count)")
                .font(.caption2.weight(active ? .semibold : .regular))
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(color.opacity(active ? 0.22 : 0.10))
                .foregroundStyle(active ? color : Color.secondary)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private func footer(_ d: SharedNoteDoc) -> some View {
        var parts: [String] = ["\(d.register.count) butir"]
        if d.openActions > 0 { parts.append("\(d.openActions) tindak lanjut terbuka") }
        if d.needsReviewCount > 0 { parts.append("\(d.needsReviewCount) perlu dicek") }
        // Dokumen v1 tidak menyimpan register, jadi yang tampil di atas adalah
        // susunan ulang — katakan apa adanya, jangan biarkan pengguna mengira
        // nomor refnya asli.
        if d.items.isEmpty { parts.append("dokumen format lama") }
        return Text(parts.joined(separator: "  ·  "))
            .font(.caption2)
            .foregroundStyle(.tertiary)
    }
}
