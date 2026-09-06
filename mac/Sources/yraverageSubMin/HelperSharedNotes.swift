// Dokumen notulen bersama dari Native Helper — berkas JSON yang sama
// (~/.localtranssub/notes.json) yang ditulis ekstensi lewat POST /notes.
// Baca-saja, toleran terhadap skema (lihat _normalize_note_doc).
import Foundation

struct SharedNoteAction: Decodable {
    var id: String = ""
    var text: String = ""
    var owner: String? = nil

    private enum CodingKeys: String, CodingKey { case id, text, owner }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        if let s = try? c.decode(String.self, forKey: .text) {
            text = s
        } else {
            text = ""
        }
        owner = try? c.decodeIfPresent(String.self, forKey: .owner)
    }
}

struct SharedNoteDoc: Identifiable, Decodable {
    var id: String = ""
    var title: String = "Notulen sesi"
    var date: String = ""
    var source: String = "helper"
    var summary: String = ""
    var decisions: [String] = []
    var actions: [SharedNoteAction] = []

    private enum CodingKeys: String, CodingKey {
        case id, title, date, source, summary, decisions, actions
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        title = (try? c.decode(String.self, forKey: .title)) ?? "Notulen sesi"
        date = (try? c.decode(String.self, forKey: .date)) ?? ""
        source = (try? c.decode(String.self, forKey: .source)) ?? "helper"
        if let s = try? c.decode(String.self, forKey: .summary) {
            summary = s
        } else {
            summary = ""
        }
        decisions = (try? c.decode([String].self, forKey: .decisions)) ?? []
        actions = (try? c.decode([SharedNoteAction].self, forKey: .actions)) ?? []
    }
}

private struct SharedNotesEnvelope: Decodable {
    var notes: [SharedNoteDoc] = []
}

enum HelperSharedStore {
    static var fileURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".localtranssub/notes.json", isDirectory: false)
    }

    /// Muat dokumen bersama; [] bila berkas belum ada / korup.
    static func load() -> [SharedNoteDoc] {
        guard
            let data = try? Data(contentsOf: fileURL),
            let env = try? JSONDecoder().decode(SharedNotesEnvelope.self, from: data)
        else { return [] }
        return env.notes.filter { !$0.id.isEmpty }
    }
}
