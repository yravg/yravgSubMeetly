// UserDefaults-backed preferences (no accounts, no telemetry, no cloud).
import Foundation

public enum PrefKey {
    public static let sourceLocale = "sourceLocale"
    public static let targetLanguage = "targetLanguage"
    public static let translateEnabled = "translateEnabled"
    public static let dualLine = "dualLine"
    public static let fontSize = "overlayFontSize"
    public static let opacity = "overlayOpacity"
    public static let captureTarget = "captureTargetBundleID"
    public static let launchAtLogin = "launchAtLogin"
    public static let hideDockIcon = "hideDockIcon"
    public static let dictationHotkey = "dictationHotkey"
    public static let dictationCleanup = "dictationCleanup"
    public static let restoreClipboard = "restoreClipboard"
    public static let overlayFrame = "overlayFrame"
    public static let overlayPosition = "overlayPosition" // top | center | bottom
    public static let a11yLargeContrast = "a11yLargeContrast"
    public static let maxOverlayLines = "maxOverlayLines"
    public static let overlayAutoScroll = "overlayAutoScroll"
    public static let overlayPanelMode = "overlayPanelMode"
    public static let refineTranslation = "refineTranslation"
    public static let maxOverlayCues = "maxOverlayCues"
    public static let audioSourceMode = "audioSourceMode" // app | system | mic
    public static let languageMode = "languageMode" // transcribe | translate
    public static let reskin = "reskin" // yraverage | coretax | modern
}

public final class Prefs: @unchecked Sendable {
    public static let shared = Prefs()
    private let d = UserDefaults.standard

    private init() {
        d.register(defaults: [
            PrefKey.sourceLocale: "en-US",
            PrefKey.targetLanguage: "zh-Hans",
            PrefKey.translateEnabled: false,
            PrefKey.dualLine: true,
            PrefKey.fontSize: 26.0,
            PrefKey.opacity: 0.82,
            PrefKey.launchAtLogin: false,
            PrefKey.dictationHotkey: "fn",
            PrefKey.dictationCleanup: true,
            PrefKey.restoreClipboard: false,
            PrefKey.maxOverlayLines: 2,
            PrefKey.hideDockIcon: false,
            PrefKey.overlayAutoScroll: true,
            PrefKey.overlayPanelMode: true,
            PrefKey.refineTranslation: false,
            PrefKey.maxOverlayCues: 400,
            PrefKey.audioSourceMode: "app",
            PrefKey.languageMode: "transcribe",
            PrefKey.overlayPosition: "bottom",
            PrefKey.a11yLargeContrast: false,
            PrefKey.reskin: "yraverage",
        ])
    }

    public var sourceLocale: String {
        get { d.string(forKey: PrefKey.sourceLocale) ?? "en-US" }
        set { d.set(newValue, forKey: PrefKey.sourceLocale) }
    }
    public var targetLanguage: String {
        get { d.string(forKey: PrefKey.targetLanguage) ?? "zh-Hans" }
        set { d.set(newValue, forKey: PrefKey.targetLanguage) }
    }
    public var translateEnabled: Bool {
        get { d.bool(forKey: PrefKey.translateEnabled) }
        set { d.set(newValue, forKey: PrefKey.translateEnabled) }
    }
    public var dualLine: Bool {
        get { d.bool(forKey: PrefKey.dualLine) }
        set { d.set(newValue, forKey: PrefKey.dualLine) }
    }
    public var fontSize: Double {
        get { d.double(forKey: PrefKey.fontSize) }
        set { d.set(newValue, forKey: PrefKey.fontSize) }
    }
    public var opacity: Double {
        get { d.double(forKey: PrefKey.opacity) }
        set { d.set(newValue, forKey: PrefKey.opacity) }
    }
    public var captureTarget: String {
        get { d.string(forKey: PrefKey.captureTarget) ?? "" }
        set { d.set(newValue, forKey: PrefKey.captureTarget) }
    }
    public var dictationCleanup: Bool {
        get { d.bool(forKey: PrefKey.dictationCleanup) }
        set { d.set(newValue, forKey: PrefKey.dictationCleanup) }
    }
    public var dictationHotkey: String {
        get { d.string(forKey: PrefKey.dictationHotkey) ?? "fn" }
        set { d.set(newValue, forKey: PrefKey.dictationHotkey) }
    }
    public var restoreClipboard: Bool {
        get { d.bool(forKey: PrefKey.restoreClipboard) }
        set { d.set(newValue, forKey: PrefKey.restoreClipboard) }
    }
    public var maxOverlayLines: Int {
        get { max(1, d.integer(forKey: PrefKey.maxOverlayLines)) }
        set { d.set(newValue, forKey: PrefKey.maxOverlayLines) }
    }
    public var hideDockIcon: Bool {
        get { d.bool(forKey: PrefKey.hideDockIcon) }
        set { d.set(newValue, forKey: PrefKey.hideDockIcon) }
    }
    public var overlayAutoScroll: Bool {
        get { d.bool(forKey: PrefKey.overlayAutoScroll) }
        set { d.set(newValue, forKey: PrefKey.overlayAutoScroll) }
    }
    /// true = extension-style scrollable panel, false = compact caption bar.
    public var overlayPanelMode: Bool {
        get { d.bool(forKey: PrefKey.overlayPanelMode) }
        set { d.set(newValue, forKey: PrefKey.overlayPanelMode) }
    }
    public var refineTranslation: Bool {
        get { d.bool(forKey: PrefKey.refineTranslation) }
        set { d.set(newValue, forKey: PrefKey.refineTranslation) }
    }
    public var maxOverlayCues: Int {
        get { max(50, d.integer(forKey: PrefKey.maxOverlayCues)) }
        set { d.set(newValue, forKey: PrefKey.maxOverlayCues) }
    }
    /// app = single application · system = all system audio · mic = microphone
    public var audioSourceMode: String {
        get { d.string(forKey: PrefKey.audioSourceMode) ?? "app" }
        set { d.set(newValue, forKey: PrefKey.audioSourceMode) }
    }
    /// transcribe = ASR only · translate = ASR + translation
    public var languageMode: String {
        get { d.string(forKey: PrefKey.languageMode) ?? "transcribe" }
        set { d.set(newValue, forKey: PrefKey.languageMode) }
    }
    /// Pola aksen lokal — selalu salah satu dari tiga nilai yang dikenal.
    public var reskin: String {
        get {
            let v = d.string(forKey: PrefKey.reskin) ?? "yraverage"
            return ["yraverage", "coretax", "modern"].contains(v) ? v : "yraverage"
        }
        set {
            d.set(["yraverage", "coretax", "modern"].contains(newValue) ? newValue : "yraverage",
                  forKey: PrefKey.reskin)
        }
    }
    public var overlayFrame: String {
        get { d.string(forKey: PrefKey.overlayFrame) ?? "" }
        set { d.set(newValue, forKey: PrefKey.overlayFrame) }
    }
    /// Teks besar + kontras tinggi di overlay.
    public var a11yLargeContrast: Bool {
        get { d.bool(forKey: PrefKey.a11yLargeContrast) }
        set { d.set(newValue, forKey: PrefKey.a11yLargeContrast) }
    }
    /// top | center | bottom — preset posisi overlay.
    public var overlayPosition: String {
        get {
            let v = d.string(forKey: PrefKey.overlayPosition) ?? "bottom"
            return ["top", "center", "bottom"].contains(v) ? v : "bottom"
        }
        set {
            d.set(["top", "center", "bottom"].contains(newValue) ? newValue : "bottom",
                  forKey: PrefKey.overlayPosition)
        }
    }
}
