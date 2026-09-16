// Dokumen notulen bersama dari Native Helper — berkas JSON yang sama
// (~/.yraveragesubmin/notes.json) yang ditulis ekstensi lewat POST /notes.
// Baca-saja, toleran terhadap skema (lihat _normalize_note_doc).
//
// Dua versi dokumen hidup berdampingan di disk pengguna:
//   v1 — hanya summary/decisions/actions
//   v2 — ditambah `items` (register penuh: 6 tipe, nomor ref, pemilik,
//        tenggat, status, jejak waktu) dan `meeting` (seri, ketua, agenda)
// Berkas v1 tidak ditulis ulang saat helper diperbarui, jadi pembaca ini
// harus tetap masuk akal untuk keduanya: bila `items` kosong, register
// disusun ulang dari decisions/actions.
import Foundation

// MARK: - Butir register

enum SharedItemType: String, Decodable, CaseIterable {
    case decision, action, question, risk, metric, info

    /// Warna sejajar TYPE_COLOR di src/lib/notes-schema.js — satu bahasa
    /// visual untuk butir yang sama di ekstensi maupun aplikasi ini.
    var hex: String {
        switch self {
        case .decision: return "7fb3d5"
        case .action: return "e0b05c"
        case .question: return "b79ce0"
        case .risk: return "e06c75"
        case .metric: return "4fb8c9"
        case .info: return "9a9a9a"
        }
    }

    var label: String {
        switch self {
        case .decision: return "Keputusan"
        case .action: return "Tindak lanjut"
        case .question: return "Pertanyaan"
        case .risk: return "Risiko"
        case .metric: return "Metrik"
        case .info: return "Info"
        }
    }
}

struct SharedNoteMetric: Decodable {
    var measure: String = ""
    var value: Double = 0
    var unit: String = ""
    var baseline: Double? = nil
    var variance: Double? = nil
    var asOf: String? = nil

    private enum CodingKeys: String, CodingKey { case measure, value, unit, baseline, variance, asOf }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        measure = (try? c.decode(String.self, forKey: .measure)) ?? ""
        value = (try? c.decode(Double.self, forKey: .value)) ?? 0
        unit = (try? c.decode(String.self, forKey: .unit)) ?? ""
        baseline = try? c.decodeIfPresent(Double.self, forKey: .baseline)
        variance = try? c.decodeIfPresent(Double.self, forKey: .variance)
        asOf = try? c.decodeIfPresent(String.self, forKey: .asOf)
    }

    /// "1.11% (baseline 0.90%)" — apa adanya bila tanpa baseline.
    var display: String {
        let main = "\(Self.trim(value))\(unit)"
        guard let b = baseline else { return main }
        return "\(main) (baseline \(Self.trim(b))\(unit))"
    }

    private static func trim(_ d: Double) -> String {
        d == d.rounded() ? String(Int(d)) : String(format: "%.2f", d)
    }
}

struct SharedNoteItem: Identifiable, Decodable {
    var ref: String = ""
    var type: SharedItemType = .info
    var topic: String = ""
    var text: String = ""
    var owner: String? = nil
    var org: String? = nil
    var due: String? = nil
    var status: String = "open"
    var priority: String? = nil
    var likelihood: String? = nil
    var review: String = "ai"
    var confidence: Double = 1
    var needsReview: Bool = false
    var tc: String? = nil
    var speaker: String? = nil
    var carriedFrom: String? = nil
    var links: [String] = []
    var metric: SharedNoteMetric? = nil

    var id: String { ref }

    private enum CodingKeys: String, CodingKey {
        case ref, type, topic, text, owner, org, due, status, priority
        case likelihood, review, confidence, needsReview, tc, speaker, carriedFrom, links, metric
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ref = (try? c.decode(String.self, forKey: .ref)) ?? ""
        type = (try? c.decode(SharedItemType.self, forKey: .type)) ?? .info
        topic = (try? c.decode(String.self, forKey: .topic)) ?? ""
        text = (try? c.decode(String.self, forKey: .text)) ?? ""
        owner = try? c.decodeIfPresent(String.self, forKey: .owner)
        org = try? c.decodeIfPresent(String.self, forKey: .org)
        due = try? c.decodeIfPresent(String.self, forKey: .due)
        status = (try? c.decode(String.self, forKey: .status)) ?? "open"
        priority = try? c.decodeIfPresent(String.self, forKey: .priority)
        likelihood = try? c.decodeIfPresent(String.self, forKey: .likelihood)
        review = (try? c.decode(String.self, forKey: .review)) ?? "ai"
        confidence = (try? c.decode(Double.self, forKey: .confidence)) ?? 1
        needsReview = (try? c.decode(Bool.self, forKey: .needsReview)) ?? false
        tc = try? c.decodeIfPresent(String.self, forKey: .tc)
        speaker = try? c.decodeIfPresent(String.self, forKey: .speaker)
        carriedFrom = try? c.decodeIfPresent(String.self, forKey: .carriedFrom)
        links = (try? c.decode([String].self, forKey: .links)) ?? []
        metric = try? c.decodeIfPresent(SharedNoteMetric.self, forKey: .metric)
    }

    /// Konstruktor untuk butir yang disusun ulang dari dokumen v1.
    init(ref: String, type: SharedItemType, text: String, owner: String? = nil,
         due: String? = nil, status: String = "open") {
        self.ref = ref
        self.type = type
        self.text = text
        self.owner = owner
        self.due = due
        self.status = status
    }

    var isClosed: Bool { status == "closed" }

    /// Bentuk yang dikirim ke helper — nama field persis CodingKeys.
    var json: [String: Any] {
        var j: [String: Any] = [
            "ref": ref, "type": type.rawValue, "topic": topic, "text": text,
            "status": status, "review": review, "confidence": confidence,
            "needsReview": needsReview, "links": links,
        ]
        if let v = owner { j["owner"] = v }
        if let v = org { j["org"] = v }
        if let v = due { j["due"] = v }
        if let v = priority { j["priority"] = v }
        if let v = likelihood { j["likelihood"] = v }
        if let v = tc { j["tc"] = v }
        if let v = speaker { j["speaker"] = v }
        if let v = carriedFrom { j["carriedFrom"] = v }
        if let m = metric {
            var mj: [String: Any] = ["measure": m.measure, "value": m.value, "unit": m.unit]
            if let b = m.baseline { mj["baseline"] = b }
            if let v = m.variance { mj["variance"] = v }
            if let a = m.asOf { mj["asOf"] = a }
            j["metric"] = mj
        }
        return j
    }

    var ownerLabel: String? {
        guard let o = owner, !o.isEmpty else { return nil }
        if let g = org, !g.isEmpty { return "\(o) · \(g)" }
        return o
    }

    /// "High × Possible" — matriks risiko hanya berarti bila kedua sumbunya ada.
    var riskLabel: String? {
        guard type == .risk, let p = priority, let l = likelihood else { return nil }
        return "\(p.capitalized) × \(l.capitalized)"
    }
}

/// Satu baris transkrip yang direkam aplikasi ini (t0/t1 detik).
struct SharedTranscriptLine: Identifiable, Decodable {
    var t0: Double = 0
    var t1: Double = 0
    var source: String = ""
    var translation: String = ""
    var id: String { "\(t0)-\(source.hashValue)" }

    private enum CodingKeys: String, CodingKey { case t0, t1, source, translation }

    init(t0: Double, t1: Double, source: String, translation: String = "") {
        self.t0 = t0; self.t1 = t1; self.source = source; self.translation = translation
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t0 = (try? c.decode(Double.self, forKey: .t0)) ?? 0
        t1 = (try? c.decode(Double.self, forKey: .t1)) ?? 0
        source = (try? c.decode(String.self, forKey: .source)) ?? ""
        translation = (try? c.decode(String.self, forKey: .translation)) ?? ""
    }

    var json: [String: Any] { ["t0": t0, "t1": t1, "source": source, "translation": translation] }
}

// MARK: - Metadata rapat

struct SharedAgendaCount: Decodable {
    var total: Int = 0
    var covered: Int = 0

    private enum CodingKeys: String, CodingKey { case total, covered }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = (try? c.decode(Int.self, forKey: .total)) ?? 0
        covered = (try? c.decode(Int.self, forKey: .covered)) ?? 0
    }
}

struct SharedEngineStamp: Decodable {
    var asr: String = ""
    var mt: String? = nil
    var segments: Int = 0
    var durationSec: Int? = nil

    private enum CodingKeys: String, CodingKey { case asr, mt, segments, durationSec }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        asr = (try? c.decode(String.self, forKey: .asr)) ?? ""
        mt = try? c.decodeIfPresent(String.self, forKey: .mt)
        segments = (try? c.decode(Int.self, forKey: .segments)) ?? 0
        durationSec = try? c.decodeIfPresent(Int.self, forKey: .durationSec)
    }
}

struct SharedMeetingMeta: Decodable {
    var seriesId: String = ""
    var seq: Int? = nil
    var projectType: String = "general"
    var locale: String = "en"
    var tz: String = ""
    var start: String? = nil
    var end: String? = nil
    var chair: String? = nil
    var attendees: [String] = []
    var agenda = SharedAgendaCount()
    var issuedAt: String? = nil
    var generatedAt: String = ""
    var engine: SharedEngineStamp? = nil

    private enum CodingKeys: String, CodingKey {
        case seriesId, seq, projectType, locale, tz, start, end
        case chair, attendees, agenda, issuedAt, generatedAt, engine
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        seriesId = (try? c.decode(String.self, forKey: .seriesId)) ?? ""
        seq = try? c.decodeIfPresent(Int.self, forKey: .seq)
        projectType = (try? c.decode(String.self, forKey: .projectType)) ?? "general"
        locale = (try? c.decode(String.self, forKey: .locale)) ?? "en"
        tz = (try? c.decode(String.self, forKey: .tz)) ?? ""
        start = try? c.decodeIfPresent(String.self, forKey: .start)
        end = try? c.decodeIfPresent(String.self, forKey: .end)
        chair = try? c.decodeIfPresent(String.self, forKey: .chair)
        attendees = (try? c.decode([String].self, forKey: .attendees)) ?? []
        agenda = (try? c.decode(SharedAgendaCount.self, forKey: .agenda)) ?? SharedAgendaCount()
        issuedAt = try? c.decodeIfPresent(String.self, forKey: .issuedAt)
        generatedAt = (try? c.decode(String.self, forKey: .generatedAt)) ?? ""
        engine = try? c.decodeIfPresent(SharedEngineStamp.self, forKey: .engine)
    }

    /// "CPOC7-WEEKLY · #36" bila serinya diketahui.
    var seriesLabel: String? {
        guard !seriesId.isEmpty else { return nil }
        guard let n = seq else { return seriesId }
        return "\(seriesId) · #\(n)"
    }
}

// MARK: - Dokumen

struct SharedNoteAction: Decodable {
    var id: String = ""
    var text: String = ""
    var owner: String? = nil
    var due: String? = nil
    var status: String = "open"

    private enum CodingKeys: String, CodingKey { case id, text, owner, due, status }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        if let s = try? c.decode(String.self, forKey: .text) {
            text = s
        } else {
            text = ""
        }
        owner = try? c.decodeIfPresent(String.self, forKey: .owner)
        due = try? c.decodeIfPresent(String.self, forKey: .due)
        status = (try? c.decode(String.self, forKey: .status)) ?? "open"
    }
}

struct SharedNoteDoc: Identifiable, Decodable {
    var id: String = ""
    var title: String = "Notulen sesi"
    var date: String = ""
    var source: String = "helper"
    var status: String = "ready"
    var summary: String = ""
    var decisions: [String] = []
    var actions: [SharedNoteAction] = []
    var schemaVersion: Int = 1
    var meeting: SharedMeetingMeta? = nil
    var items: [SharedNoteItem] = []
    var transcript: [SharedTranscriptLine] = []

    private enum CodingKeys: String, CodingKey {
        case id, title, date, source, status, summary, decisions, actions
        case schemaVersion, meeting, items, transcript
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? "Notulen sesi"
        date = (try? c.decode(String.self, forKey: .date)) ?? ""
        source = (try? c.decode(String.self, forKey: .source)) ?? "helper"
        status = (try? c.decode(String.self, forKey: .status)) ?? "ready"
        if let s = try? c.decode(String.self, forKey: .summary) {
            summary = s
        } else {
            summary = ""
        }
        decisions = (try? c.decode([String].self, forKey: .decisions)) ?? []
        actions = (try? c.decode([SharedNoteAction].self, forKey: .actions)) ?? []
        schemaVersion = (try? c.decode(Int.self, forKey: .schemaVersion)) ?? 1
        meeting = try? c.decodeIfPresent(SharedMeetingMeta.self, forKey: .meeting)
        items = (try? c.decode([SharedNoteItem].self, forKey: .items)) ?? []
        transcript = (try? c.decode([SharedTranscriptLine].self, forKey: .transcript)) ?? []
    }

    /// Register yang ditampilkan. Dokumen v1 tidak punya `items`, jadi
    /// keputusan dan tindak lanjutnya disusun menjadi butir — tanpa nomor
    /// register asli, karena v1 memang tidak pernah menyimpannya.
    var register: [SharedNoteItem] {
        if !items.isEmpty { return items }
        var out: [SharedNoteItem] = []
        for (n, d) in decisions.enumerated() where !d.isEmpty {
            out.append(SharedNoteItem(ref: "D-\(n + 1)", type: .decision, text: d))
        }
        for (n, a) in actions.enumerated() where !a.text.isEmpty {
            out.append(SharedNoteItem(
                ref: a.id.isEmpty ? "A-\(n + 1)" : a.id,
                type: .action,
                text: a.text,
                owner: a.owner,
                due: a.due,
                status: a.status
            ))
        }
        return out
    }

    /// Berapa butir per tipe — dipakai baris filter.
    func count(of type: SharedItemType) -> Int {
        register.filter { $0.type == type }.count
    }

    var openActions: Int {
        register.filter { $0.type == .action && !$0.isClosed }.count
    }

    var needsReviewCount: Int {
        register.filter(\.needsReview).count
    }

    var isIssued: Bool { status == "issued" }

    /// Dokumen utuh untuk dikirim/ditulis ulang. `items` selalu diisi dari
    /// `register`, jadi dokumen v1 yang disunting naik ke v2 saat disimpan.
    var json: [String: Any] {
        var j: [String: Any] = [
            "id": id, "title": title, "date": date, "source": source, "status": status,
            "summary": summary, "decisions": decisions,
            "actions": actions.map { a -> [String: Any] in
                var aj: [String: Any] = ["id": a.id, "text": a.text, "status": a.status]
                if let o = a.owner { aj["owner"] = o }
                if let d = a.due { aj["due"] = d }
                return aj
            },
            "schemaVersion": 2,
            "items": register.map(\.json),
            "transcript": transcript.map(\.json),
        ]
        if let m = meeting {
            var mj: [String: Any] = [
                "seriesId": m.seriesId, "projectType": m.projectType, "locale": m.locale, "tz": m.tz,
                "attendees": m.attendees, "generatedAt": m.generatedAt,
                "agenda": ["total": m.agenda.total, "covered": m.agenda.covered],
            ]
            if let v = m.seq { mj["seq"] = v }
            if let v = m.start { mj["start"] = v }
            if let v = m.end { mj["end"] = v }
            if let v = m.chair { mj["chair"] = v }
            if let v = m.issuedAt { mj["issuedAt"] = v }
            if let e = m.engine {
                var ej: [String: Any] = ["asr": e.asr, "segments": e.segments]
                if let v = e.mt { ej["mt"] = v }
                if let v = e.durationSec { ej["durationSec"] = v }
                mj["engine"] = ej
            }
            j["meeting"] = mj
        }
        return j
    }
}

private struct SharedNotesEnvelope: Decodable {
    var notes: [SharedNoteDoc] = []
}

enum HelperSharedStore {
    /// Home pengguna. `$HOME` didahulukan karena BAIK
    /// `homeDirectoryForCurrentUser` MAUPUN `NSHomeDirectory()` mengabaikannya
    /// (keduanya membaca catatan akun, bukan lingkungan) — padahal launchd
    /// memasang $HOME ke home yang sama saat aplikasi dibuka dari Finder, jadi
    /// perilakunya identik di produksi dan bisa diarahkan saat dijalankan dari
    /// shell atau tes.
    private static var homeDir: URL {
        let env = ProcessInfo.processInfo.environment["HOME"]
        if let h = env, !h.isEmpty {
            return URL(fileURLWithPath: h, isDirectory: true)
        }
        return URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
    }

    /// Direktori state helper. `YSM_STATE_DIR` dihormati karena native/server.py
    /// juga menghormatinya — tanpa ini, pengguna yang memindahkan direktori
    /// state-nya akan melihat notulennya hilang dari aplikasi ini saja.
    static var stateDir: URL {
        if let override = ProcessInfo.processInfo.environment["YSM_STATE_DIR"],
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return homeDir.appendingPathComponent(".yraveragesubmin", isDirectory: true)
    }

    static var fileURL: URL {
        stateDir.appendingPathComponent("notes.json", isDirectory: false)
    }

    /// Lokasi sebelum produk berganti nama. Helper memindahkan direktorinya
    /// saat pertama kali dijalankan, tapi pengguna bisa saja membuka aplikasi
    /// ini lebih dulu — tanpa jalur cadangan, notulen mereka terlihat hilang.
    static var legacyFileURL: URL {
        homeDir.appendingPathComponent(".localtranssub/notes.json", isDirectory: false)
    }

    /// Cadangan jalur tulis saat helper tidak hidup. Aturannya sama dengan
    /// POST /notes di helper: ganti per id, sisip di depan, maksimal 50.
    /// Dokumen lain disalin apa adanya (dict mentah) supaya field yang tidak
    /// dikenal aplikasi ini tidak ikut hilang.
    @discardableResult
    static func upsertLocally(_ note: [String: Any]) -> SharedNoteDoc? {
        guard let id = note["id"] as? String, !id.isEmpty else { return nil }
        var notes = rawNotes().filter { ($0["id"] as? String) != id }
        notes.insert(note, at: 0)
        write(Array(notes.prefix(50)))
        return (try? JSONSerialization.data(withJSONObject: note))
            .flatMap { try? JSONDecoder().decode(SharedNoteDoc.self, from: $0) }
    }

    static func removeLocally(id: String) {
        write(rawNotes().filter { ($0["id"] as? String) != id })
    }

    private static func rawNotes() -> [[String: Any]] {
        guard let data = try? Data(contentsOf: fileURL),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let notes = obj["notes"] as? [[String: Any]] else { return [] }
        return notes
    }

    private static func write(_ notes: [[String: Any]]) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        guard let data = try? JSONSerialization.data(
            withJSONObject: ["updatedAt": stamp, "notes": notes], options: [.prettyPrinted]) else { return }
        try? FileManager.default.createDirectory(at: stateDir, withIntermediateDirectories: true)
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Muat dokumen bersama; [] bila berkas belum ada / korup.
    static func load() -> [SharedNoteDoc] {
        for url in [fileURL, legacyFileURL] {
            guard
                let data = try? Data(contentsOf: url),
                let env = try? JSONDecoder().decode(SharedNotesEnvelope.self, from: data)
            else { continue }
            return env.notes.filter { !$0.id.isEmpty }
        }
        return []
    }
}
