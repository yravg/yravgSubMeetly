// Token desain — terjemahan Swift dari design system Meetily 0.4.1
// (tokens/colors.css, semantic.css, spacing.css, radius.css, shadows.css,
// motion.css), dengan satu penyimpangan yang disengaja: warna "interaktif"
// (baris terpilih, tautan, fokus, garis tab aktif) memakai teal merek kita,
// bukan biru Meetily. Selebihnya mengikuti disiplin mereka: abu-abu mengerjakan
// struktur, warna hanya bila bermakna — merah = merekam/destruktif, oranye =
// jeda, hijau = izin diberikan/selesai, amber = peringatan izin.
//
// Meetily tidak punya mode gelap di produknya, tapi aplikasi macOS wajib
// menghormati tampilan sistem. Tiap warna karena itu dinamis: nilai terang
// persis milik Meetily, nilai gelap dari token shadcn `.dark` yang mereka
// kirimkan di globals.css.
import AppKit
import SwiftUI

enum DS {
    // MARK: Warna

    enum Colors {
        /// Latar halaman di belakang panel (gray-50 / neutral-950).
        static let app = dyn("f9fafb", "0a0a0a")
        /// Sidebar, panel transkrip, kartu (white / neutral-900).
        static let panel = dyn("ffffff", "171717")
        static let card = panel
        /// Sumur bersarang di dalam kartu, bilah status (gray-50 / neutral-800).
        static let sunken = dyn("f9fafb", "262626")
        /// Baris di-hover, gelembung transkrip yang sedang mengalir.
        static let muted = dyn("f3f4f6", "2a2a2a")
        /// Baris rapat aktif — teal tipis, bukan blue-100 Meetily.
        static let selected = dyn("e0f2f1", "0f3d3b")

        static let textStrong = dyn("111827", "fafafa")
        static let textBody = dyn("1f2937", "e5e5e5")
        static let textSecondary = dyn("374151", "d4d4d4")
        static let textMuted = dyn("4b5563", "a3a3a3")
        static let textSubtle = dyn("6b7280", "8a8a8a")
        static let textFaint = dyn("9ca3af", "6b6b6b")

        static let line = dyn("e5e7eb", "262626")
        static let lineStrong = dyn("d1d5db", "3a3a3a")
        static let lineSubtle = dyn("f3f4f6", "1f1f1f")

        /// Aksi padat (tombol utama): gray-900 / neutral-100.
        static let actionSolid = dyn("111827", "f5f5f5")
        static let actionSolidText = dyn("fafafa", "171717")
        static let actionQuiet = dyn("e5e7eb", "2a2a2a")
        static let actionQuietHover = dyn("d1d5db", "3a3a3a")

        /// Merah hanya untuk merekam dan destruktif.
        static let record = dyn("ef4444", "ef4444")
        static let recordHover = dyn("dc2626", "dc2626")
        static let recordDisabled = dyn("fca5a5", "7f1d1d")
        static let recordTint = dyn("fef2f2", "2a1212")
        /// Oranye hanya untuk jeda.
        static let paused = dyn("f97316", "f97316")
        static let ok = dyn("16a34a", "22c55e")
        static let okTint = dyn("dcfce7", "052e16")
        static let warn = dyn("d97706", "f59e0b")
        static let warnTint = dyn("fffbeb", "2a2200")
        static let warnBorder = dyn("fde68a", "78350f")
        static let warnText = dyn("92400e", "fbbf24")
        static let idle = dyn("d4d4d4", "525252")
        static let live = dyn("38908e", "5cb8b5") // teal, bukan blue-500

        /// Gradasi "AI" Meetily (blue-50 → purple-50) dipetakan ke teal → ungu.
        static let aiFrom = dyn("e0f2f1", "0f3d3b")
        static let aiTo = dyn("faf5ff", "2e1065")
        static let aiBorder = dyn("99d5d3", "1f6f6c")

        private static func dyn(_ light: String, _ dark: String) -> Color {
            Color(nsColor: NSColor(name: nil) { appearance in
                let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                return NSColor(hex: isDark ? dark : light)
            })
        }
    }

    // MARK: Ukuran

    enum Space {
        static let s1: CGFloat = 4
        static let s2: CGFloat = 8
        static let s3: CGFloat = 12
        static let s4: CGFloat = 16
        static let s5: CGFloat = 20
        static let s6: CGFloat = 24
        static let s8: CGFloat = 32
        static let s12: CGFloat = 48
    }

    enum Radius {
        static let lg: CGFloat = 8   // kartu, dialog, nav sidebar
        static let md: CGFloat = 6   // tombol, input, butir menu
        static let sm: CGFloat = 4
        static let xl2: CGFloat = 16 // baris izin onboarding
        static let full: CGFloat = 9999
    }

    enum Width {
        static let sidebar: CGFloat = 256
        static let sidebarCollapsed: CGFloat = 64
        static let reading: CGFloat = 750
        static let control: CGFloat = 36
        static let controlSm: CGFloat = 32
        static let settingsMax: CGFloat = 1152 // 72rem
    }

    enum Motion {
        static let fast = 0.15
        static let base = 0.20
        static let slow = 0.30
    }

    // MARK: Format

    /// `MM:SS` berlapis nol — cara Meetily menulis waktu (`Recording • 04:12`).
    static func clock(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded(.down)))
        return String(format: "%02d:%02d", s / 60, s % 60)
    }
}

extension NSColor {
    convenience init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&v)
        self.init(
            red: CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8) & 0xFF) / 255,
            blue: CGFloat(v & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: - Modifier bentuk yang berulang

/// Satu bentuk kartu, diulang: isi panel, garis 1 px, radius 8, shadow-sm.
/// Tidak ada elevasi saat hover — hover hanya mengubah warna.
struct DSCard: ViewModifier {
    var padding: CGFloat = DS.Space.s6
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(DS.Colors.card)
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.lg).stroke(DS.Colors.line, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
            .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }
}

/// Bayangan chrome mengambang (pil rekam, toast, tombol lipat sidebar).
struct DSFloating: ViewModifier {
    func body(content: Content) -> some View {
        content
            .shadow(color: .black.opacity(0.10), radius: 12, y: 10)
            .shadow(color: .black.opacity(0.10), radius: 4, y: 4)
    }
}

extension View {
    func dsCard(padding: CGFloat = DS.Space.s6) -> some View { modifier(DSCard(padding: padding)) }
    func dsFloating() -> some View { modifier(DSFloating()) }
}

/// Tombol Meetily: `solid` (gray-900), `outline`, `secondary`, `record`, `ai`.
/// Hover = warna yang sama pada 90 %, atau satu langkah lebih gelap; tekan tidak
/// punya state sendiri; nonaktif = opasitas 50 %.
struct DSButtonStyle: ButtonStyle {
    enum Kind { case solid, outline, secondary, record, ai, ghost }
    var kind: Kind = .outline
    var size: CGFloat = DS.Width.control

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, kind == .ghost ? 8 : 12)
            .frame(height: size)
            .foregroundStyle(fg)
            .background(background(pressed: configuration.isPressed))
            .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.md))
    }

    private var fg: Color {
        switch kind {
        case .solid: DS.Colors.actionSolidText
        case .record: .white
        case .outline, .secondary, .ghost: DS.Colors.textSecondary
        case .ai: DS.Colors.textStrong
        }
    }

    private var border: Color {
        switch kind {
        case .outline: DS.Colors.lineStrong
        case .ai: DS.Colors.aiBorder
        default: .clear
        }
    }

    @ViewBuilder
    private func background(pressed: Bool) -> some View {
        switch kind {
        case .solid: DS.Colors.actionSolid.opacity(pressed ? 0.9 : 1)
        case .record: (pressed ? DS.Colors.recordHover : DS.Colors.record)
        case .secondary: (pressed ? DS.Colors.actionQuietHover : DS.Colors.actionQuiet)
        case .outline: (pressed ? DS.Colors.muted : DS.Colors.panel)
        case .ghost: (pressed ? DS.Colors.muted : Color.clear)
        case .ai:
            LinearGradient(colors: [DS.Colors.aiFrom, DS.Colors.aiTo],
                           startPoint: .leading, endPoint: .trailing)
        }
    }
}

extension ButtonStyle where Self == DSButtonStyle {
    static var dsSolid: DSButtonStyle { .init(kind: .solid) }
    static var dsOutline: DSButtonStyle { .init(kind: .outline) }
    static var dsOutlineSm: DSButtonStyle { .init(kind: .outline, size: DS.Width.controlSm) }
    static var dsSecondary: DSButtonStyle { .init(kind: .secondary) }
    static var dsRecord: DSButtonStyle { .init(kind: .record) }
    static var dsAI: DSButtonStyle { .init(kind: .ai, size: DS.Width.controlSm) }
    static var dsGhost: DSButtonStyle { .init(kind: .ghost, size: DS.Width.controlSm) }
}

/// Titik status Meetily: merekam / jeda / live / diberikan / memeriksa / idle.
struct DSStatusDot: View {
    enum Kind { case recording, paused, live, ok, checking, idle, warn }
    var kind: Kind
    var size: CGFloat = 8
    var pulse = false

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: size, height: size)
            .modifier(Pulse(active: pulse))
    }

    private var color: Color {
        switch kind {
        case .recording: DS.Colors.record
        case .paused: DS.Colors.paused
        case .live: DS.Colors.live
        case .ok: DS.Colors.ok
        case .checking: DS.Colors.warn
        case .idle: DS.Colors.idle
        case .warn: DS.Colors.warn
        }
    }

    /// Tailwind `animate-pulse`: opasitas 1 → 0.5 → 1 tiap 2 detik.
    private struct Pulse: ViewModifier {
        let active: Bool
        func body(content: Content) -> some View {
            if active {
                TimelineView(.periodic(from: .now, by: 1.0)) { ctx in
                    let t = ctx.date.timeIntervalSinceReferenceDate
                    content.opacity(Int(t) % 2 == 0 ? 1 : 0.5)
                        .animation(.easeInOut(duration: 1.0), value: Int(t))
                }
            } else {
                content
            }
        }
    }
}

/// Callout Meetily: `info` (teal tipis), `warning` (amber — data keluar
/// perangkat atau tak bisa dibatalkan). Judulnya adalah verdict.
struct DSCallout<Content: View>: View {
    enum Tone { case info, warning }
    var tone: Tone
    var title: String
    var icon: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.s3) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(tone == .warning ? DS.Colors.warn : DS.Colors.live)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tone == .warning ? DS.Colors.warnText : DS.Colors.textStrong)
                content
                    .font(.system(size: 13))
                    .foregroundStyle(tone == .warning ? DS.Colors.warnText : DS.Colors.textMuted)
            }
        }
        .padding(DS.Space.s4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone == .warning ? DS.Colors.warnTint : DS.Colors.selected)
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.lg)
            .stroke(tone == .warning ? DS.Colors.warnBorder : DS.Colors.aiBorder, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
    }
}
