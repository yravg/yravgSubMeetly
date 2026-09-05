// `--hotkey-probe`: menguji pemetaan DictationHotkey dengan event sintetis.
//
// Alur dikte utuh butuh Accessibility + Input Monitoring, jadi tak bisa diuji
// tanpa izin. Tapi pencocokan hotkey adalah fungsi murni: event bisa dibuat
// sendiri dan hasilnya diperiksa — tanpa memposting apa pun ke sistem.
import AppKit
import Carbon.HIToolbox

@MainActor
enum HotkeyProbe {
    static let reportPath = URL(fileURLWithPath: "/tmp/transsub-hotkey.txt")

    private static func flagsEvent(_ raw: UInt64) -> CGEvent? {
        let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
        e?.type = .flagsChanged
        e?.flags = CGEventFlags(rawValue: raw)
        return e
    }

    private static func keyEvent(_ code: Int, down: Bool) -> CGEvent? {
        CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(code), keyDown: down)
    }

    static func run() {
        var out: [String] = []
        var failures: [String] = []
        func say(_ s: String) {
            out.append(s)
            NSLog("[hotkey] %@", s)
            try? out.joined(separator: "\n").write(to: reportPath, atomically: true, encoding: .utf8)
        }
        func expect(_ label: String, _ got: Bool?, _ want: Bool?) {
            let ok = got == want
            say("\(ok ? "ok  " : "FAIL") \(label): got=\(String(describing: got)) want=\(String(describing: want))")
            if !ok { failures.append(label) }
        }

        let fnMask = CGEventFlags.maskSecondaryFn.rawValue
        let rOpt: UInt64 = 0x0000_0040
        let rCmd: UInt64 = 0x0000_0010

        // Setiap hotkey harus mengenali dirinya sendiri...
        if let e = flagsEvent(fnMask) { expect("fn ditekan", DictationHotkey.state("fn", type: .flagsChanged, event: e), true) }
        if let e = flagsEvent(0) { expect("fn dilepas", DictationHotkey.state("fn", type: .flagsChanged, event: e), false) }
        if let e = flagsEvent(rOpt) { expect("rightOption ditekan", DictationHotkey.state("rightOption", type: .flagsChanged, event: e), true) }
        if let e = flagsEvent(0) { expect("rightOption dilepas", DictationHotkey.state("rightOption", type: .flagsChanged, event: e), false) }
        if let e = flagsEvent(rCmd) { expect("rightCommand ditekan", DictationHotkey.state("rightCommand", type: .flagsChanged, event: e), true) }
        if let e = keyEvent(kVK_F5, down: true) { expect("F5 ditekan", DictationHotkey.state("f5", type: .keyDown, event: e), true) }
        if let e = keyEvent(kVK_F5, down: false) { expect("F5 dilepas", DictationHotkey.state("f5", type: .keyUp, event: e), false) }

        // ...dan TIDAK terpicu oleh hotkey lain — ini bug yang diperbaiki:
        // dulu semuanya terkunci ke fn.
        if let e = flagsEvent(fnMask) { expect("rightOption abai fn", DictationHotkey.state("rightOption", type: .flagsChanged, event: e), false) }
        if let e = flagsEvent(rOpt) { expect("rightCommand abai rightOption", DictationHotkey.state("rightCommand", type: .flagsChanged, event: e), false) }
        if let e = keyEvent(kVK_ANSI_A, down: true) { expect("f5 abai tombol lain", DictationHotkey.state("f5", type: .keyDown, event: e), nil) }
        if let e = keyEvent(kVK_F5, down: true) { expect("fn abai keyDown F5", DictationHotkey.state("fn", type: .keyDown, event: e), nil) }

        say(failures.isEmpty ? "RESULT: PASS — \(out.count - 1) pemeriksaan"
                             : "RESULT: FAIL — " + failures.joined(separator: "; "))
    }
}
