// Mock session/preferences state for UI development & screenshots (Fase 3).
import Foundation
import TransSubKit

enum MockSession {
    static let sampleCues: [SubtitleLine] = [
        SubtitleLine(start: 0, end: 3.2, source: "Let's start the standup.", translation: "Mari kita mulai standup."),
        SubtitleLine(start: 3.2, end: 7.5, source: "Smoke tests for twenty-six features are green.", translation: "Uji asap 26 sub-fitur sudah hijau."),
        SubtitleLine(start: 7.5, end: 12.0, source: "We still need the pick and native E2E paths.", translation: "Kita masih butuh jalur E2E pick dan native."),
        SubtitleLine(start: 12.0, end: 16.5, source: "Soft launch can proceed after those pass.", translation: "Soft launch bisa jalan setelah itu lulus."),
    ]

    static func apply(to model: OverlayModel) {
        model.clear()
        model.dualLine = true
        model.isListening = true
        model.status = "Mock session · listening"
        model.footer = "4 cues · demo"
        for c in sampleCues {
            model.appendFinal(c)
        }
        model.setInterim(source: "Action items go to Citra and Bima…", translation: "Tindak lanjut ke Citra dan Bima…")
    }
}
