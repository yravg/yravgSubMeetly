// Probe register bersama (`--register-probe`): membaca berkas notulen yang
// ditulis Native Helper dan mencetak apa yang akan ditampilkan
// SharedRegisterView, sebagai JSON, lalu keluar.
//
// Gunanya bukan diagnostik manual: aplikasi ini tidak punya target tes Swift,
// jadi tanpa probe ini satu-satunya bukti bahwa dekoder memahami dokumen v2
// adalah "ia ter-compile" — padahal dekodernya sengaja toleran dan akan
// diam-diam menghasilkan field kosong kalau nama field bergeser. Probe ini
// dijalankan test/shared-register.test.mjs terhadap berkas contoh.
import Foundation

enum RegisterProbe {
    /// Bentuk cetakan sengaja datar dan stabil — ia adalah kontrak tes.
    static func run() {
        // `--upsert <berkas.json>`: jalankan jalur tulis cadangan (encoder JSON
        // dokumen + tulis berkas) pada dokumen di berkas itu, lalu laporkan
        // keadaan sesudahnya. Inilah yang dipakai aplikasi saat helper mati.
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--upsert"), i + 1 < args.count,
           let data = FileManager.default.contents(atPath: args[i + 1]),
           let raw = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            // Lewatkan dekoder + encoder: itulah yang diuji — sebuah dokumen v1
            // yang disunting harus keluar sebagai v2 dengan field lamanya utuh.
            if let d = (try? JSONDecoder().decode(SharedNoteDoc.self, from: data)) {
                var j = d.json
                if let extra = raw["__addItem"] as? [String: Any] {
                    var items = (j["items"] as? [[String: Any]]) ?? []
                    items.append(extra)
                    j["items"] = items
                }
                if let t = raw["__rename"] as? String { j["title"] = t }
                HelperSharedStore.upsertLocally(j)
            }
        }
        if let i = args.firstIndex(of: "--remove"), i + 1 < args.count {
            HelperSharedStore.removeLocally(id: args[i + 1])
        }
        let docs = HelperSharedStore.load()
        let payload: [String: Any] = [
            "source": HelperSharedStore.fileURL.path,
            "docs": docs.map { doc -> [String: Any] in
                var out: [String: Any] = [
                    "id": doc.id,
                    "title": doc.title,
                    "date": doc.date,
                    "schemaVersion": doc.schemaVersion,
                    "isIssued": doc.isIssued,
                    "registerCount": doc.register.count,
                    "openActions": doc.openActions,
                    "needsReview": doc.needsReviewCount,
                    // Benar bila registernya disusun ulang dari decisions/actions
                    // karena dokumennya format lama.
                    "rebuiltFromV1": doc.items.isEmpty,
                    "transcriptLines": doc.transcript.count,
                    "counts": Dictionary(
                        uniqueKeysWithValues: SharedItemType.allCases.map { ($0.rawValue, doc.count(of: $0)) }
                    ),
                    "items": doc.register.map { item -> [String: Any] in
                        var i: [String: Any] = [
                            "ref": item.ref,
                            "type": item.type.rawValue,
                            "text": item.text,
                            "status": item.status,
                            "confidence": item.confidence,
                            "needsReview": item.needsReview,
                        ]
                        if !item.topic.isEmpty { i["topic"] = item.topic }
                        if let v = item.ownerLabel { i["ownerLabel"] = v }
                        if let v = item.due { i["due"] = v }
                        if let v = item.tc { i["tc"] = v }
                        if let v = item.speaker { i["speaker"] = v }
                        if let v = item.riskLabel { i["riskLabel"] = v }
                        if let v = item.carriedFrom { i["carriedFrom"] = v }
                        if let m = item.metric { i["metric"] = m.display }
                        return i
                    },
                ]
                if let m = doc.meeting {
                    out["meeting"] = [
                        "seriesLabel": m.seriesLabel ?? "",
                        "projectType": m.projectType,
                        "chair": m.chair ?? "",
                        "attendees": m.attendees.count,
                        "agendaTotal": m.agenda.total,
                        "agendaCovered": m.agenda.covered,
                        "asr": m.engine?.asr ?? "",
                        "segments": m.engine?.segments ?? 0,
                    ]
                }
                return out
            },
        ]

        guard
            let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
            let text = String(data: data, encoding: .utf8)
        else {
            print("{\"error\":\"gagal menyusun JSON\"}")
            return
        }
        print(text)
    }
}
