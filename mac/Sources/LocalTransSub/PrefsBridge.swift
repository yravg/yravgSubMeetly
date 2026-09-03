// Observable wrapper so SwiftUI can bind directly to Prefs.
import Combine
import SwiftUI
import TransSubKit

@MainActor
final class PrefsBridge: ObservableObject {
    static let shared = PrefsBridge()

    @Published var sourceLocale: String { didSet { Prefs.shared.sourceLocale = sourceLocale } }
    @Published var targetLanguage: String { didSet { Prefs.shared.targetLanguage = targetLanguage } }
    @Published var translateEnabled: Bool { didSet { Prefs.shared.translateEnabled = translateEnabled } }
    @Published var dualLine: Bool { didSet { Prefs.shared.dualLine = dualLine } }
    @Published var fontSize: Double { didSet { Prefs.shared.fontSize = fontSize } }
    @Published var opacity: Double { didSet { Prefs.shared.opacity = opacity } }
    @Published var dictationCleanup: Bool { didSet { Prefs.shared.dictationCleanup = dictationCleanup } }
    @Published var restoreClipboard: Bool { didSet { Prefs.shared.restoreClipboard = restoreClipboard } }
    @Published var hideDockIcon: Bool { didSet { Prefs.shared.hideDockIcon = hideDockIcon } }
    @Published var refineTranslation: Bool { didSet { Prefs.shared.refineTranslation = refineTranslation } }
    @Published var overlayPanelMode: Bool { didSet { Prefs.shared.overlayPanelMode = overlayPanelMode } }
    @Published var audioSourceMode: String { didSet { Prefs.shared.audioSourceMode = audioSourceMode } }
    @Published var languageMode: String {
        didSet {
            Prefs.shared.languageMode = languageMode
            translateEnabled = languageMode == "translate"
        }
    }
    @Published var dictationHotkey: String { didSet { Prefs.shared.dictationHotkey = dictationHotkey } }

    private init() {
        let p = Prefs.shared
        sourceLocale = p.sourceLocale
        targetLanguage = p.targetLanguage
        translateEnabled = p.translateEnabled
        dualLine = p.dualLine
        fontSize = p.fontSize
        opacity = p.opacity
        dictationCleanup = p.dictationCleanup
        restoreClipboard = p.restoreClipboard
        hideDockIcon = p.hideDockIcon
        refineTranslation = p.refineTranslation
        overlayPanelMode = p.overlayPanelMode
        audioSourceMode = p.audioSourceMode
        languageMode = p.languageMode
        dictationHotkey = p.dictationHotkey
    }
}
