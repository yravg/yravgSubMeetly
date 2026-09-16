// Jendela Settings (⌘, dari menu bar). Isinya halaman Settings yang sama
// dengan yang ada di dalam kerangka — satu sumber, dua pintu.
import SwiftUI

struct SettingsView: View {
    @ObservedObject var app: AppController

    init(app: AppController) { self.app = app }

    var body: some View {
        SettingsPageView(app: app, showHeader: false)
            .frame(width: 760, height: 560)
            // Jendela ini perlu host-nya sendiri: .translationTask hanya
            // berjalan pada tampilan yang terlihat, dan jendela utama bisa tertutup.
            .languagePackHost(app.packInstaller)
    }
}
