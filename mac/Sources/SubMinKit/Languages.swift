// Language lists shared by the UI.
import Foundation

public struct LanguageOption: Sendable, Identifiable, Hashable {
    public let id: String      // BCP-47, e.g. "ja", "zh-Hans"
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public enum Languages {
    /// Speech-recognition source languages (subset that Apple supports widely).
    public static let sources: [LanguageOption] = [
        .init(id: "en-US", name: "English"),
        .init(id: "ja-JP", name: "Japanese"),
        .init(id: "zh-CN", name: "Chinese (Mandarin)"),
        .init(id: "ko-KR", name: "Korean"),
        .init(id: "es-ES", name: "Spanish"),
        .init(id: "fr-FR", name: "French"),
        .init(id: "de-DE", name: "German"),
        .init(id: "it-IT", name: "Italian"),
        .init(id: "pt-BR", name: "Portuguese"),
        .init(id: "ru-RU", name: "Russian"),
        .init(id: "ar-SA", name: "Arabic"),
        .init(id: "hi-IN", name: "Hindi"),
        .init(id: "id-ID", name: "Indonesian"),
        .init(id: "th-TH", name: "Thai"),
        .init(id: "vi-VN", name: "Vietnamese"),
        .init(id: "tr-TR", name: "Turkish"),
    ]

    /// Translation targets (Translation framework language codes).
    public static let targets: [LanguageOption] = [
        .init(id: "en", name: "English"),
        .init(id: "zh-Hans", name: "Chinese (Simplified)"),
        .init(id: "zh-Hant", name: "Chinese (Traditional)"),
        .init(id: "ja", name: "Japanese"),
        .init(id: "ko", name: "Korean"),
        .init(id: "es", name: "Spanish"),
        .init(id: "fr", name: "French"),
        .init(id: "de", name: "German"),
        .init(id: "it", name: "Italian"),
        .init(id: "pt", name: "Portuguese"),
        .init(id: "ru", name: "Russian"),
        .init(id: "ar", name: "Arabic"),
        .init(id: "hi", name: "Hindi"),
        .init(id: "id", name: "Indonesian"),
        .init(id: "th", name: "Thai"),
        .init(id: "vi", name: "Vietnamese"),
        .init(id: "tr", name: "Turkish"),
    ]

    public static func sourceName(_ id: String) -> String {
        sources.first { $0.id == id }?.name ?? id
    }

    public static func targetName(_ id: String) -> String {
        targets.first { $0.id == id }?.name ?? id
    }

    /// "ja-JP" → "ja", so a speech locale can be matched to a translation language.
    public static func baseCode(_ localeID: String) -> String {
        String(localeID.split(separator: "-").first ?? "")
    }
}
