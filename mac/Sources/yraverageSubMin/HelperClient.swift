// Klien HTTP ke Native Helper (127.0.0.1:17865) untuk jalur TULIS notulen.
//
// Membaca tetap lewat berkas (HelperSharedStore) supaya aplikasi berfungsi
// tanpa helper. Menulis diutamakan lewat helper karena ia satu-satunya penulis
// yang dilihat ekstensi secara langsung dan yang menormalkan dokumen
// (_normalize_note_doc); bila helper tidak hidup, pemanggil jatuh ke
// HelperSharedStore.upsertLocally — dengan aturan yang sama (ganti-per-id,
// sisip di depan, maksimal 50).
import Foundation

enum HelperClient {
    static let base = URL(string: "http://127.0.0.1:17865")!

    struct Failure: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private struct NoteEnvelope: Decodable { var note: SharedNoteDoc }
    private struct NotesEnvelope: Decodable { var notes: [SharedNoteDoc] }

    /// Cepat gagal: helper yang mati tidak boleh membuat Stop terasa macet.
    private static var session: URLSession {
        let c = URLSessionConfiguration.ephemeral
        c.timeoutIntervalForRequest = 4
        c.timeoutIntervalForResource = 8
        return URLSession(configuration: c)
    }

    static func getNotes() async throws -> [SharedNoteDoc] {
        let (data, _) = try await session.data(from: base.appendingPathComponent("notes"))
        return try JSONDecoder().decode(NotesEnvelope.self, from: data).notes
    }

    /// Simpan (upsert per `id`). Menerima body `{"note": …}` yang sudah
    /// diserialisasi — `[String: Any]` tidak Sendable, Data iya. Mengembalikan
    /// dokumen versi helper (sudah dinormalkan), bukan yang kita kirim.
    static func save(body: Data) async throws -> SharedNoteDoc {
        var req = URLRequest(url: base.appendingPathComponent("notes"))
        req.httpMethod = "POST"
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await session.data(for: req)
        try check(resp, data)
        return try JSONDecoder().decode(NoteEnvelope.self, from: data).note
    }

    static func delete(id: String) async throws {
        var req = URLRequest(url: base.appendingPathComponent("notes/\(id)"))
        req.httpMethod = "DELETE"
        let (data, resp) = try await session.data(for: req)
        try check(resp, data)
    }

    /// Draf heuristik dari baris transkrip: summary, decisions, actions (v1).
    /// Body `{"lines":[{"text":…}],"title":…}` sudah diserialisasi; hasilnya
    /// JSON mentah `{"note": …}` untuk diurai pemanggil. Tidak menyimpan apa pun.
    static func generate(body: Data) async throws -> Data {
        var req = URLRequest(url: base.appendingPathComponent("notes/generate"))
        req.httpMethod = "POST"
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.httpBody = body
        let (data, resp) = try await session.data(for: req)
        try check(resp, data)
        return data
    }

    private static func check(_ resp: URLResponse, _ data: Data) throws {
        guard let http = resp as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw Failure(message: msg ?? "helper HTTP \(http.statusCode)")
        }
    }
}
