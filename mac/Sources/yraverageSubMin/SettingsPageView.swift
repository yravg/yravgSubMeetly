// Settings ala Meetily: header lengket, tab bergaris-bawah, kartu bertumpuk
// (satu bentuk kartu, jarak 24 px), konten dibatasi 72 rem.
//
// Setiap kendali SettingsView lama ada di sini, dipetakan ke lima tab:
//   General             ← Hide Dock, Launch at login, Accent pattern, Large text (+ lokasi data)
//   Capture             ← Audio source, target tangkapan + Refresh
//   Subtitles & Overlay ← Language mode, Spoken, Translate into, dual line,
//                         font size, opacity, overlay position, reset, preview
//   Dictation           ← Hotkey + status, filler cleanup, restore clipboard
//   Languages & Perms   ← model terjemahan terpasang + install, Language & Region,
//                         Check current pair; Screen Recording / Accessibility /
//                         Input Monitoring
// Dipakai dua tempat: halaman di dalam kerangka (dengan header) dan jendela
// Settings ⌘, (tanpa header).
import AppKit
import ApplicationServices
import ServiceManagement
import SwiftUI
import SubMinKit

struct SettingsPageView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var prefs: PrefsBridge
    @ObservedObject var installer: LanguagePackInstaller
    @StateObject private var langStatus = LanguageStatusModel()
    @Namespace private var underline
    var showHeader = true

    init(app: AppController, showHeader: Bool = true) {
        self.app = app
        self.ui = app.ui
        self.prefs = PrefsBridge.shared
        self.installer = app.packInstaller
        self.showHeader = showHeader
    }

    private let tabs: [(String, String)] = [
        ("General", "slider.horizontal.3"),
        ("Capture", "waveform"),
        ("Subtitles & Overlay", "captions.bubble"),
        ("Dictation", "mic"),
        ("Languages & Permissions", "globe"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            if showHeader { header }
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.s6) {
                    tabBar
                    Group {
                        switch ui.settingsTab {
                        case 1: captureTab
                        case 2: subtitlesTab
                        case 3: dictationTab
                        case 4: languagesTab
                        default: generalTab
                        }
                    }
                }
                .padding(.horizontal, DS.Space.s8)
                .padding(.vertical, DS.Space.s6)
                .frame(maxWidth: DS.Width.settingsMax, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
        }
        .background(DS.Colors.app)
        .task { await langStatus.refresh() }
        .onChange(of: prefs.sourceLocale) { _, _ in Task { await langStatus.refresh() } }
        .onChange(of: prefs.targetLanguage) { _, _ in Task { await langStatus.refresh() } }
        .onChange(of: installer.status) { _, _ in Task { await langStatus.refresh() } }
    }

    private var header: some View {
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
        .frame(maxWidth: .infinity)
        .background(DS.Colors.app)
        .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }
    }

    /// Tab bergaris-bawah; garisnya meluncur antar tab (matchedGeometryEffect).
    private var tabBar: some View {
        HStack(spacing: 4) {
            ForEach(Array(tabs.enumerated()), id: \.offset) { i, t in
                let active = ui.settingsTab == i
                Button {
                    withAnimation(.easeInOut(duration: DS.Motion.base)) { ui.settingsTab = i }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: t.1).font(.system(size: 12))
                        Text(t.0)
                    }
                    .font(.system(size: 13, weight: active ? .semibold : .medium))
                    .foregroundStyle(active ? DS.Colors.textStrong : DS.Colors.textMuted)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .overlay(alignment: .bottom) {
                        if active {
                            Rectangle().fill(DS.Colors.live).frame(height: 2)
                                .matchedGeometryEffect(id: "underline", in: underline)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .overlay(alignment: .bottom) { DS.Colors.line.frame(height: 1) }
    }

    // MARK: General

    private var generalTab: some View {
        VStack(spacing: DS.Space.s6) {
            SettingsCard(title: "Appearance", description: "Accent pattern for this app and the browser extension — same local identity, no outside branding.") {
                Picker("Accent pattern", selection: $prefs.reskin) {
                    ForEach(ReskinPattern.allCases) { Text($0.title).tag($0.rawValue) }
                }
                .frame(maxWidth: 360)
                if prefs.reskin != ReskinPattern.yraverage.rawValue {
                    Button("Reset to Yraverage Klasik") { prefs.reskin = ReskinPattern.yraverage.rawValue }
                        .buttonStyle(.dsOutlineSm)
                }
                Toggle("Large text & high contrast in the overlay", isOn: $prefs.a11yLargeContrast)
            }

            SettingsCard(title: "Hide Dock icon", description: "Run as a menu-bar-only app. The window still opens from the menu bar icon.",
                         action: AnyView(Toggle("", isOn: $prefs.hideDockIcon).labelsHidden().toggleStyle(.switch)
                            .onChange(of: prefs.hideDockIcon) { _, _ in app.applyDockVisibility() }))

            SettingsCard(title: "Launch at login", description: "Start silently when you sign in. Nothing records until you press Start.",
                         action: AnyView(Toggle("", isOn: $ui.launchAtLogin).labelsHidden().toggleStyle(.switch)
                            .onChange(of: ui.launchAtLogin) { _, on in
                                do {
                                    if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
                                } catch { NSLog("[yraverageSubMin] launch at login failed: \(error)") }
                            }))

            SettingsCard(title: "Data storage locations", description: "Where this app keeps your data. Nothing is stored anywhere else.") {
                storageRow("Meeting minutes (shared with the browser extension)", path: HelperSharedStore.stateDir.path)
                storageRow("Preferences", path: "~/Library/Preferences (UserDefaults)")
                DSCallout(tone: .info, title: "Note", icon: "info.circle") {
                    Text("The register file is written by the Native Helper when it is running, and by this app directly when it is not. Delete the folder to remove every meeting.")
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private func storageRow(_ label: String, path: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.Colors.textBody)
            Text(path).font(.system(size: 11, design: .monospaced)).foregroundStyle(DS.Colors.textMuted)
                .textSelection(.enabled)
            if path.hasPrefix("/") {
                Button { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)]) } label: {
                    Label("Open Folder", systemImage: "folder")
                }
                .buttonStyle(.dsOutlineSm)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DS.Space.s4)
        .background(DS.Colors.sunken)
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.lg).stroke(DS.Colors.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
    }

    // MARK: Capture

    private var captureTab: some View {
        VStack(spacing: DS.Space.s6) {
            SettingsCard(title: "Audio source", description: prefs.audioSourceMode == "mic"
                ? "Uses the default input device for live dictation-style capture."
                : (prefs.audioSourceMode == "system" ? "Captures all system audio via ScreenCaptureKit."
                   : "Captures a single app chosen below.")) {
                Picker("Audio source", selection: $prefs.audioSourceMode) {
                    Text("Application").tag("app")
                    Text("System audio").tag("system")
                    Text("Microphone").tag("mic")
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 360)
            }

            SettingsCard(title: "Capture target", description: "Any app — browser, Zoom, VLC — or all system audio. Also changeable from the Home toolbar.") {
                HStack(spacing: 8) {
                    Picker("Capture", selection: Binding(
                        get: { app.selectedTarget.id },
                        set: { id in if let t = app.targets.first(where: { $0.id == id }) { app.selectedTarget = t } }
                    )) {
                        ForEach(app.targets) { Text($0.name).tag($0.id) }
                    }
                    .labelsHidden()
                    .frame(maxWidth: 360)
                    Button("Refresh") { Task { await app.refreshTargets() } }.buttonStyle(.dsOutlineSm)
                }
                if !app.hasScreenPermission {
                    DSCallout(tone: .warning, title: "Screen Recording permission required", icon: "exclamationmark.triangle") {
                        Text("Grant it under Languages & Permissions, then relaunch.")
                    }
                }
            }
        }
    }

    // MARK: Subtitles & overlay

    private var subtitlesTab: some View {
        VStack(spacing: DS.Space.s6) {
            SettingsCard(title: "Task & languages", description: "What the session does with the audio it hears.") {
                Picker("Language mode", selection: $prefs.languageMode) {
                    Text("Transcribe only").tag("transcribe")
                    Text("Transcribe + Translate").tag("translate")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(maxWidth: 360)
                Picker("Spoken language", selection: $prefs.sourceLocale) {
                    ForEach(Languages.sources) { Text($0.name).tag($0.id) }
                }
                .frame(maxWidth: 360)
                Picker("Translate into", selection: $prefs.targetLanguage) {
                    ForEach(Languages.targets) { Text($0.name).tag($0.id) }
                }
                .frame(maxWidth: 360)
                .disabled(prefs.languageMode != "translate")
                Toggle("Show original + translation", isOn: $prefs.dualLine)
                    .disabled(prefs.languageMode != "translate")
            }

            SettingsCard(title: "Overlay", description: "The floating subtitle panel shown over other apps while a session runs.") {
                Slider(value: $prefs.fontSize, in: 14...48, step: 1) { Text("Font size  \(Int(prefs.fontSize))") }
                    .frame(maxWidth: 420)
                Slider(value: $prefs.opacity, in: 0.2...1.0) { Text("Background opacity") }
                    .frame(maxWidth: 420)
                Picker("Overlay position", selection: $prefs.overlayPosition) {
                    Text("Top").tag("top"); Text("Center").tag("center"); Text("Bottom").tag("bottom")
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 360)
                .onChange(of: prefs.overlayPosition) { _, pos in app.overlay.move(to: pos) }
                HStack(spacing: 8) {
                    Button("Reset subtitle position") { app.overlay.resetPosition() }.buttonStyle(.dsOutlineSm)
                    Button("Preview overlay") { app.showOverlayDemo() }.buttonStyle(.dsOutlineSm)
                }
            }
        }
    }

    // MARK: Dictation

    private var dictationTab: some View {
        VStack(spacing: DS.Space.s6) {
            SettingsCard(title: "Hold-to-talk hotkey", description: "Hold to dictate; release to paste at the cursor. Double-tap for hands-free; Esc cancels.") {
                Picker("Hotkey", selection: $prefs.dictationHotkey) {
                    Text("fn (Globe)").tag("fn")
                    Text("Right ⌥ Option").tag("rightOption")
                    Text("Right ⌘ Command").tag("rightCommand")
                    Text("F5").tag("f5")
                }
                .frame(maxWidth: 360)
                HStack(spacing: 8) {
                    DSStatusDot(kind: app.dictation.tapActive ? .ok : .warn, size: 8)
                    Text(app.dictation.tapActive
                         ? "Hotkey armed: \(hotkeyName(prefs.dictationHotkey)) — hold to dictate"
                         : "Hotkey listener off — grant Input Monitoring, then relaunch")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textMuted)
                }
                .accessibilityElement(children: .combine)
                if !app.dictation.lastError.isEmpty {
                    Text(app.dictation.lastError).font(.system(size: 12)).foregroundStyle(DS.Colors.warn)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            SettingsCard(title: "Remove filler words", description: "Drops um, uh and similar before pasting.",
                         action: AnyView(Toggle("", isOn: $prefs.dictationCleanup).labelsHidden().toggleStyle(.switch)))
            SettingsCard(title: "Restore my previous clipboard afterwards", description: "Dictation pastes through the clipboard; put back what was there when it is done.",
                         action: AnyView(Toggle("", isOn: $prefs.restoreClipboard).labelsHidden().toggleStyle(.switch)))
            SettingsCard(title: "Auto-stop", description: "Sessions stop automatically after 5 minutes so a forgotten one can't keep recording.")
        }
    }

    private func hotkeyName(_ id: String) -> String {
        switch id {
        case "fn": "fn (Globe)"
        case "rightOption": "Right ⌥ Option"
        case "rightCommand": "Right ⌘ Command"
        case "f5": "F5"
        default: id
        }
    }

    // MARK: Languages & permissions

    private var languagesTab: some View {
        VStack(spacing: DS.Space.s6) {
            SettingsCard(title: "Translation models", description: "Translation uses Apple's on-device models. The low-latency model is a separate download only an app can request.",
                         action: AnyView(Button {
                            Task { await langStatus.refresh() }
                         } label: {
                            if langStatus.checking { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
                         }.buttonStyle(.dsGhost).disabled(langStatus.checking).help("Re-check"))) {
                if langStatus.pairs.isEmpty {
                    Text(langStatus.checking ? "Checking…" : "No status yet.")
                        .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                }
                ForEach(langStatus.pairs) { pair in
                    HStack(alignment: .top, spacing: 12) {
                        DSStatusDot(kind: pair.isGood ? .ok : (pair.isUsable ? .warn : .idle), size: 8).padding(.top, 5)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(pair.label).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.Colors.textBody)
                                Spacer()
                                Text(pair.summary).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                            }
                            HStack(spacing: 14) {
                                modelBadge("Low-latency", pair.fast)
                                modelBadge("High-fidelity", pair.standard)
                                Spacer()
                                if pair.fast != .ready && pair.fast != .unsupported {
                                    Button(installer.busy ? "Requesting…" : "Install fast model") {
                                        let parts = pair.id.split(separator: ">")
                                        if parts.count == 2 { installer.install(from: String(parts[0]), to: String(parts[1])) }
                                    }
                                    .buttonStyle(.dsOutlineSm)
                                    .disabled(installer.busy)
                                }
                            }
                        }
                    }
                    .padding(12)
                    .background(DS.Colors.sunken)
                    .overlay(RoundedRectangle(cornerRadius: DS.Radius.lg).stroke(DS.Colors.line, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
                }
                if !installer.status.isEmpty {
                    Text(installer.status).font(.system(size: 12)).foregroundStyle(DS.Colors.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Button { langStatus.openSystemSettings() } label: {
                        Label("Open Language & Region settings", systemImage: "arrow.up.forward.app")
                    }
                    .buttonStyle(.dsOutlineSm)
                    Button("Check current pair") { Task { await checkPair() } }.buttonStyle(.dsOutlineSm)
                }
                if !ui.packStatus.isEmpty {
                    Text(ui.packStatus).font(.system(size: 12)).foregroundStyle(DS.Colors.textMuted)
                }
                Text("System Settings → General → Language & Region → Translation Languages installs the standard model; the low-latency model needs the button above.")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                    .fixedSize(horizontal: false, vertical: true)
            }

            SettingsCard(title: "Permissions", description: "macOS asks once per identity. If a switch is on in System Settings but the app still can't hear, relaunch.") {
                PermissionRowView(name: "Screen Recording", why: "Capture audio from other apps.",
                                  granted: app.hasScreenPermission,
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                PermissionRowView(name: "Accessibility", why: "Paste dictated text at the cursor.",
                                  granted: AXIsProcessTrusted(),
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
                PermissionRowView(name: "Input Monitoring", why: "Detect the dictation hotkey.",
                                  granted: app.dictation.lastError.isEmpty,
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
                HStack(spacing: 8) {
                    Button { Task { await app.refreshTargets() } } label: { Label("Recheck", systemImage: "arrow.clockwise") }
                        .buttonStyle(.dsOutlineSm)
                    if app.needsRelaunch {
                        Button("Quit & Reopen") { app.relaunch() }.buttonStyle(.dsOutlineSm)
                    }
                }
            }
        }
    }

    private func modelBadge(_ title: String, _ status: TranslationAvailability) -> some View {
        HStack(spacing: 4) {
            DSStatusDot(kind: status == .ready ? .ok : (status == .unsupported ? .warn : .idle), size: 7)
            Text(title).font(.system(size: 12)).foregroundStyle(DS.Colors.textBody)
            Text(status == .ready ? "installed" : (status == .unsupported ? "unsupported" : "not installed"))
                .font(.system(size: 11)).foregroundStyle(DS.Colors.textSubtle)
        }
    }

    private func checkPair() async {
        guard #available(macOS 26.0, *) else { ui.packStatus = "Requires macOS 26+."; return }
        let src = Languages.baseCode(prefs.sourceLocale)
        let tgt = prefs.targetLanguage
        switch await Translator.availability(from: src, to: tgt) {
        case .ready: ui.packStatus = "\(src) → \(tgt) installed"
        case .needsDownload: ui.packStatus = "\(src) → \(tgt) not installed — install it in System Settings"
        case .unsupported: ui.packStatus = "\(src) → \(tgt) isn't supported"
        }
    }
}

/// Kartu pengaturan Meetily: judul + deskripsi di kiri, aksi (switch/tombol) di
/// kanan, isi opsional di bawah. Satu bentuk kartu, diulang.
struct SettingsCard<Content: View>: View {
    let title: String
    let description: String
    var action: AnyView? = nil
    @ViewBuilder var content: Content

    init(title: String, description: String, action: AnyView? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.description = description
        self.action = action
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.s4) {
            HStack(alignment: .top, spacing: DS.Space.s4) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.system(size: 15, weight: .semibold)).foregroundStyle(DS.Colors.textStrong)
                    Text(description).font(.system(size: 13)).foregroundStyle(DS.Colors.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if let a = action { a }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .dsCard()
    }
}

extension SettingsCard where Content == EmptyView {
    init(title: String, description: String, action: AnyView? = nil) {
        self.init(title: title, description: description, action: action) { EmptyView() }
    }
}

/// Baris izin Meetily: ikon status, nama, alasan, tombol buka System Settings.
struct PermissionRowView: View {
    let name: String
    let why: String
    let granted: Bool
    let url: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: granted ? "checkmark.circle.fill" : "exclamationmark.circle")
                .font(.system(size: 18))
                .foregroundStyle(granted ? DS.Colors.ok : DS.Colors.warn)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.Colors.textBody)
                Text(why).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            }
            Spacer()
            Text(granted ? "Granted" : "Not granted")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(granted ? DS.Colors.ok : DS.Colors.warnText)
            Button(granted ? "Open" : "Grant…") { NSWorkspace.shared.open(URL(string: url)!) }
                .buttonStyle(.dsOutlineSm)
        }
        .padding(12)
        .background(DS.Colors.sunken)
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.xl2).stroke(DS.Colors.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.xl2))
    }
}
