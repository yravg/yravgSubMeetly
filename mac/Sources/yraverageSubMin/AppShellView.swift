// Kerangka aplikasi ala Meetily: dua panel tetap — sidebar + konten — jendela
// tidak pernah menggulir, panel-panelnya yang menggulir. Menggantikan MainView
// (pemilih tab bersegmen + tiga tab) sebagai akar jendela.
//
// Rute: Home (subtitel langsung) · Files · Meeting (register bersama) ·
// Settings. Bilah status bawah dipertahankan karena ia satu-satunya tempat
// klaim "100% local · on-device" selalu terlihat.
import SwiftUI
import SubMinKit

struct AppShellView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var prefs: PrefsBridge
    @Environment(\.colorScheme) private var scheme

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
        self.prefs = PrefsBridge.shared
    }

    var body: some View {
        HStack(spacing: 0) {
            SidebarView(app: app)

            VStack(spacing: 0) {
                content
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                StatusFooter(app: app)
            }
            .background(DS.Colors.app)
        }
        .frame(minWidth: 900, minHeight: 600)
        .background(DS.Colors.app)
        .tint(Brand.reskinAccent(prefs.reskin, scheme))
        .languagePackHost(app.packInstaller)
        .sheet(isPresented: $ui.showAbout) { AboutSheet(ui: ui) }
    }

    @ViewBuilder
    private var content: some View {
        switch ui.route {
        case .home:
            HomeView(app: app)
        case .files:
            FilesView(app: app)
        case .meeting(let id):
            MeetingView(app: app, id: id)
        case .settings:
            SettingsPage(app: app)
        }
    }
}

/// Bilah status bawah: mengikuti rute aktif; kanan selalu "100% local".
private struct StatusFooter: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var session: SubtitleSession
    @ObservedObject var fileModel: FileTranscribeModel

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
        self.session = app.session
        self.fileModel = app.fileModel
    }

    var body: some View {
        HStack(spacing: 8) {
            switch ui.route {
            case .home:
                DSStatusDot(kind: session.isRunning ? .recording : .idle, size: 7, pulse: session.isRunning)
                Text(session.isRunning
                     ? "Listening · \(session.lines.count) lines"
                     : (session.lines.isEmpty ? "Idle" : "Stopped · \(session.lines.count) lines"))
            case .files:
                if fileModel.busy { ProgressView().controlSize(.mini) }
                Text(fileModel.busy
                     ? (fileModel.status.isEmpty ? "Working…" : fileModel.status)
                     : (fileModel.lines.isEmpty ? "No file transcribed yet" : "\(fileModel.lines.count) lines"))
            case .meeting:
                DSStatusDot(kind: session.isRunning ? .recording : .idle, size: 7, pulse: session.isRunning)
                Text(session.isRunning ? "Recording — notes capture live" : "Meeting notes")
            case .settings:
                Text("Settings")
            }
            Spacer()
            Text("100% local · on-device")
        }
        .font(.system(size: 11))
        .foregroundStyle(DS.Colors.textSubtle)
        .padding(.horizontal, 14)
        .frame(height: 30)
        .background(DS.Colors.sunken)
        .overlay(alignment: .top) { DS.Colors.line.frame(height: 1) }
        .accessibilityElement(children: .combine)
    }
}

/// Settings di dalam konten (Tahap 1: tampilan Settings yang ada, dibingkai
/// halaman ber-judul; Tahap 3 memecahnya jadi tab bergaris-bawah + kartu).
private struct SettingsPage: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Button { ui.route = .home } label: {
                    Label("Back", systemImage: "arrow.left").font(.system(size: 14))
                }
                .buttonStyle(.plain)
                .foregroundStyle(DS.Colors.textMuted)
                Text("Settings").font(.system(size: 28, weight: .bold)).foregroundStyle(DS.Colors.textStrong)
                Spacer()
            }
            .padding(.horizontal, DS.Space.s8)
            .padding(.vertical, DS.Space.s6)
            .frame(maxWidth: DS.Width.settingsMax)
            .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }

            ScrollView {
                SettingsView(app: app)
                    .dsCard(padding: DS.Space.s2)
                    .padding(DS.Space.s8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(DS.Colors.app)
    }
}

/// Dialog About — versi, klaim privasi, dan empat hal yang membedakan.
private struct AboutSheet: View {
    @ObservedObject var ui: UIState

    private let cards: [(String, String)] = [
        ("Privacy-first", "Audio, transcripts and minutes never leave this Mac. There is no account and no server."),
        ("Live subtitles + translation", "Any app's audio, subtitled and translated on-device, with a floating overlay you can place anywhere."),
        ("Hold-to-talk dictation", "A global hotkey turns speech into text at the cursor in any app — with filler-word cleanup."),
        ("One register, two surfaces", "Meeting minutes are shared with the browser extension through the local Native Helper."),
    ]

    var body: some View {
        VStack(spacing: DS.Space.s4) {
            Wordmark(size: 22)
            Text(AppInfo.versionLabel).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            Text("Real-time subtitles, dictation and meeting minutes that never leave your machine.")
                .font(.system(size: 13)).foregroundStyle(DS.Colors.textMuted)
                .multilineTextAlignment(.center)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(cards, id: \.0) { c in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(c.0).font(.system(size: 13, weight: .bold)).foregroundStyle(DS.Colors.textStrong)
                        Text(c.1).font(.system(size: 11)).lineSpacing(2).foregroundStyle(DS.Colors.textMuted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(DS.Colors.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.sm))
                }
            }

            HStack {
                Spacer()
                Button("Close") { ui.showAbout = false }.buttonStyle(.dsSolid).keyboardShortcut(.cancelAction)
            }
        }
        .padding(DS.Space.s6)
        .frame(width: 480)
        .background(DS.Colors.panel)
    }
}
