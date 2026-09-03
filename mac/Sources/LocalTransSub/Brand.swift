// yraverage brand palette, sampled from the wordmark.
import SwiftUI

enum Brand {
    /// The tag colour from the logo.
    static let teal = Color(red: 0x38 / 255, green: 0x90 / 255, blue: 0x8E / 255)
    static let tealDeep = Color(red: 0x2B / 255, green: 0x73 / 255, blue: 0x72 / 255)
    /// Lifted for dark backgrounds, where the base teal reads muddy.
    static let tealLight = Color(red: 0x5C / 255, green: 0xB8 / 255, blue: 0xB5 / 255)
    static let charcoal = Color(red: 0x30 / 255, green: 0x2F / 255, blue: 0x2C / 255)
    static let cream = Color(red: 0xF7 / 255, green: 0xF6 / 255, blue: 0xEE / 255)

    /// Accent that stays legible in both appearances.
    static func accent(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? tealLight : teal
    }
}

/// The wordmark, redrawn as text so it scales crisply: "yraverage" + a teal
/// "Sub" tag, matching the logo's construction.
struct Wordmark: View {
    var size: CGFloat = 17
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 0) {
            Text("yraverage")
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(scheme == .dark ? Color.white.opacity(0.92) : Brand.charcoal)
            Text("Sub")
                .font(.system(size: size, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, size * 0.3)
                .padding(.vertical, size * 0.12)
                .background(
                    RoundedRectangle(cornerRadius: size * 0.32, style: .continuous)
                        .fill(Brand.teal)
                )
                .padding(.leading, size * 0.06)
        }
        .accessibilityLabel("yraverageSub")
    }
}
