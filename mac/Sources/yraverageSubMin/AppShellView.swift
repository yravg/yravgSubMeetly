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
        // Onboarding menutupi seluruh kerangka sampai selesai / dilewati.
        .overlay {
            if !ui.onboardingDone {
                OnboardingView(app: app).transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: DS.Motion.slow), value: ui.onboardingDone)
        .sheet(isPresented: $ui.showAbout) { AboutSheet(ui: ui) }
        .sheet(isPresented: Binding(get: { ui.renamingId != nil }, set: { if !$0 { ui.renamingId = nil } })) {
            RenameSheet(app: app, ui: ui)
        }
        // Konfirmasi destruktif menyebut akibatnya — kalimat Meetily sendiri.
        .alert("Delete this meeting?",
               isPresented: Binding(get: { ui.deletingId != nil }, set: { if !$0 { ui.deletingId = nil } })) {
            Button("Delete", role: .destructive) {
                if let id = ui.deletingId { Task { await app.deleteMeeting(id: id) } }
                ui.deletingId = nil
            }
            Button("Cancel", role: .cancel) { ui.deletingId = nil }
        } message: {
            Text("This action cannot be undone. The meeting is removed from the shared register used by the browser extension too.")
        }
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
            SettingsPageView(app: app)
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

/// Dialog "Edit Meeting Title" — satu kolom, Simpan/Batal.
private struct RenameSheet: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s4) {
            Text("Edit meeting title").font(.system(size: 17, weight: .semibold)).foregroundStyle(DS.Colors.textStrong)
            TextField("Meeting title", text: $ui.renameText)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 13))
                .onSubmit { save() }
            HStack {
                Spacer()
                Button("Cancel") { ui.renamingId = nil }.buttonStyle(.dsSecondary).keyboardShortcut(.cancelAction)
                Button("Save") { save() }.buttonStyle(.dsSolid).keyboardShortcut(.defaultAction)
                    .disabled(ui.renameText.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .padding(DS.Space.s6)
        .frame(width: 424)
        .background(DS.Colors.panel)
    }

    private func save() {
        guard let id = ui.renamingId else { return }
        let t = ui.renameText
        ui.renamingId = nil
        Task { await app.renameMeeting(id: id, title: t) }
    }
}
