// `--dictation-probe`: membuktikan jalur sisip teks dikte benar-benar bekerja.
//
// Butuh izin Accessibility (untuk ⌘V sintetis). Probe menempel ke aplikasi
// yang sedang di depan, lalu pemanggil (skrip) membaca kembali isinya untuk
// memastikan teks benar-benar mendarat di sana — bukan sekadar "tidak error".
import AppKit
import TransSubKit

@MainActor
enum DictationProbe {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-dictation.txt")

    static func run(text: String, restoreClipboard: Bool, delay: Double, expect: String?) async {
        var out: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[dictation] %@", s)
            try? out.joined(separator: "\n").write(to: reportPath, atomically: true, encoding: .utf8)
        }

        // Peluncuran aplikasi ini merebut fokus sesaat; jeda memberi kesempatan
        // menyiapkan aplikasi sasaran sebelum ⌘V dikirim.
        if delay > 0 {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
        let me = Bundle.main.bundleIdentifier ?? "unknown"
        say("accessibility      : \(AXIsProcessTrusted())")
        guard AXIsProcessTrusted() else {
            say("RESULT: UNKNOWN — Accessibility belum diberikan; ⌘V tidak akan terkirim")
            return
        }

        let pb = NSPasteboard.general
        let previous = pb.string(forType: .string)
        say("clipboard sebelum  : \(previous?.prefix(40).description ?? "(kosong)")")

        let before = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        say("frontmost sebelum  : \(before ?? "nil")")
        guard before != me else {
            say("RESULT: UNKNOWN — aplikasi ini sendiri yang di depan; tidak ada sasaran tempel")
            return
        }
        // Pengaman: probe ini mengirim ⌘V ke aplikasi yang sedang di depan.
        // Tanpa sasaran eksplisit ia bisa menempelkan teks uji ke pekerjaan
        // pengguna yang sesungguhnya. Menolak lebih baik daripada merusak.
        guard let expect else {
            say("RESULT: REFUSED — sebutkan --expect <bundle id> (mis. com.apple.TextEdit). "
                + "Tanpa itu teks uji bisa mendarat di aplikasi yang sedang dipakai.")
            return
        }
        guard before == expect else {
            say("RESULT: REFUSED — sasaran yang diminta \(expect) tidak di depan (yang di depan: \(before ?? "nil")). "
                + "Tidak ada teks yang dikirim.")
            return
        }

        Inserter.insert(text, restoreClipboard: restoreClipboard)
        say("teks dikirim       : \(text)")

        // Baca clipboard SEBELUM pemulihan terjadwal (0,6 s) menimpanya.
        let pasted = pb.string(forType: .string) ?? ""
        say("clipboard saat paste: cocok=\(pasted == text)")

        try? await Task.sleep(nanoseconds: 900_000_000)
        let after = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        say("frontmost sesudah  : \(after ?? "nil")")
        if after == me { say("PERINGATAN: fokus berpindah ke aplikasi ini") }

        let onBoard = pb.string(forType: .string) ?? ""
        say("clipboard sesudah  : \(onBoard.prefix(40))")

        if restoreClipboard {
            // Pemulihan clipboard berjadwal 0.6 s setelah paste.
            try? await Task.sleep(nanoseconds: 1_200_000_000)
            let restored = pb.string(forType: .string) ?? ""
            let ok = restored == (previous ?? "")
            say("clipboard dipulihkan: \(ok) (\(restored.prefix(40)))")
        }
        say("RESULT: SENT — periksa isi aplikasi sasaran untuk konfirmasi akhir")
    }
}
