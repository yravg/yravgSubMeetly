// Settings: appearance, dictation, permissions, language packs.
import AppKit
import ApplicationServices
import ServiceManagement
import SwiftUI
import TransSubKit

struct SettingsView: View {
    @ObservedObject var app: AppController
    @ObservedObject var installer: LanguagePackInstaller
    @ObservedObject var prefs: PrefsBridge
    @ObservedObject var ui: UIState
    @Environment(\.colorScheme) private var scheme
    @StateObject private var langStatus = LanguageStatusModel()

    init(app: AppController) {
        self.app = app
        self.installer = app.packInstaller
        self.prefs = PrefsBridge.shared
        self.ui = app.ui
    }

    var body: some View {
        TabView {
            captureTab.tabItem { Label("Capture", systemImage: "waveform") }
            appearance.tabItem { Label("Subtitles", systemImage: "captions.bubble") }
            dictationTab.tabItem { Label("Dictation", systemImage: "mic") }
            languagesTab.tabItem { Label("Languages", systemImage: "globe") }
            permissions.tabItem { Label("Permissions", systemImage: "lock.shield") }
        }
        .frame(width: 470, height: 420)
        // The Settings window needs its own host: .translationTask only
        // fires on a visible view, and the main window may be closed.
        .languagePackHost(installer)
        .padding(14)
        .tint(Brand.reskinAccent(prefs.reskin, scheme))
    }

    /// Which translation models are installed, without having to start a
    /// session to find out.
    private var languagesTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Installed translation models").font(.headline)
                Spacer()
                Button {
                    Task { await langStatus.refresh() }
                } label: {
                    if langStatus.checking {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .help("Re-check")
                .disabled(langStatus.checking)
            }

            if langStatus.pairs.isEmpty {
                Text(langStatus.checking ? "Checking…" : "No status yet.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            ForEach(langStatus.pairs) { pair in
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: pair.isGood
                              ? "checkmark.circle.fill"
                              : (pair.isUsable ? "exclamationmark.circle.fill" : "xmark.circle.fill"))
                            .foregroundStyle(pair.isGood ? .green : (pair.isUsable ? .orange : .red))
                        Text(pair.label).font(.system(size: 13, weight: .medium))
                        Spacer()
                        Text(pair.summary).font(.caption).foregroundStyle(.secondary)
                    }
                    HStack(spacing: 14) {
                        badge("Low-latency", pair.fast)
                        badge("High-fidelity", pair.standard)
                        Spacer()
                        if pair.fast != .ready && pair.fast != .unsupported {
                            Button(installer.busy ? "Requesting…" : "Install fast model") {
                                let parts = pair.id.split(separator: ">")
                                if parts.count == 2 {
                                    installer.install(from: String(parts[0]), to: String(parts[1]))
                                }
                            }
                            .controlSize(.small)
                            .disabled(installer.busy)
                        }
                    }
                }
                .padding(8)
                .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 8))
            }

            if !installer.status.isEmpty {
                Text(installer.status).font(.caption).foregroundStyle(.secondary)
            }

            Divider()

            Button {
                langStatus.openSystemSettings()
            } label: {
                Label("Open Language & Region settings…", systemImage: "arrow.up.forward.app")
            }
            Text("""
                System Settings → General → Language & Region → Translation Languages.                 That sheet installs the standard model for a language; the low-latency                 model is a separate download only an app can request, using the button                 above.
                """)
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()
        }
        .padding(4)
        .task { await langStatus.refresh() }
        // Re-check when the pair changes or a download finishes.
        .onChange(of: prefs.sourceLocale) { _, _ in Task { await langStatus.refresh() } }
        .onChange(of: prefs.targetLanguage) { _, _ in Task { await langStatus.refresh() } }
        .onChange(of: installer.status) { _, _ in Task { await langStatus.refresh() } }
    }

    private func badge(_ title: String, _ status: TranslationAvailability) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(status == .ready ? Color.green : (status == .unsupported ? .red : .secondary))
                .frame(width: 7, height: 7)
            Text(title).font(.caption)
            Text(status == .ready ? "installed"
                 : (status == .unsupported ? "unsupported" : "not installed"))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private var captureTab: some View {
        Form {
            Picker("Audio source", selection: $prefs.audioSourceMode) {
                Text("Application").tag("app")
                Text("System audio").tag("system")
                Text("Microphone").tag("mic")
            }
            Text(prefs.audioSourceMode == "mic"
                  ? "Uses the default input device for live dictation-style capture."
                  : (prefs.audioSourceMode == "system"
                     ? "Captures all system audio via ScreenCaptureKit."
                     : "Captures a single app chosen in the main window."))
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Divider()

            Picker("Language mode", selection: $prefs.languageMode) {
                Text("Transcribe only").tag("transcribe")
                Text("Transcribe + Translate").tag("translate")
            }
            .onChange(of: prefs.languageMode) { _, mode in
                prefs.translateEnabled = mode == "translate"
            }

            Picker("Spoken language", selection: $prefs.sourceLocale) {
                ForEach(Languages.sources) { Text($0.name).tag($0.id) }
            }
            Picker("Translate into", selection: $prefs.targetLanguage) {
                ForEach(Languages.targets) { Text($0.name).tag($0.id) }
            }
            .disabled(prefs.languageMode != "translate")

            Toggle("Show original + translation", isOn: $prefs.dualLine)
                .disabled(prefs.languageMode != "translate")
        }
    }

    private var appearance: some View {
        Form {
            Picker("Accent pattern", selection: $prefs.reskin) {
                ForEach(ReskinPattern.allCases) { pattern in
                    Text(pattern.title).tag(pattern.rawValue)
                }
            }
            if prefs.reskin != ReskinPattern.yraverage.rawValue {
                Button("Reset to Yraverage Klasik") {
                    prefs.reskin = ReskinPattern.yraverage.rawValue
                }
                .controlSize(.small)
            }
            Text("Yraverage Klasik, Coretax interaction pattern, or Yraverage Modern — same local identity, no outside branding.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Slider(value: $prefs.fontSize, in: 14...48, step: 1) {
                Text("Font size  \(Int(prefs.fontSize))")
            }
            Slider(value: $prefs.opacity, in: 0.2...1.0) {
                Text("Background opacity")
            }
            Toggle("Show original + translation", isOn: $prefs.dualLine)
            Toggle("Large text & high contrast", isOn: $prefs.a11yLargeContrast)
            Picker("Overlay position", selection: $prefs.overlayPosition) {
                Text("Top").tag("top")
                Text("Center").tag("center")
                Text("Bottom").tag("bottom")
            }
            .onChange(of: prefs.overlayPosition) { _, pos in
                app.overlay.move(to: pos)
            }
            HStack(spacing: 8) {
                Button("Reset subtitle position") { app.overlay.resetPosition() }
                Button("Preview overlay") { app.showOverlayDemo() }
            }
            Divider()
            Toggle("Hide Dock icon (menu bar only)", isOn: $prefs.hideDockIcon)
                .onChange(of: prefs.hideDockIcon) { _, _ in app.applyDockVisibility() }
            Toggle("Launch at login", isOn: $ui.launchAtLogin)
                .onChange(of: ui.launchAtLogin) { _, on in
                    do {
                        if on { try SMAppService.mainApp.register() }
                        else { try SMAppService.mainApp.unregister() }
                    } catch {
                        NSLog("[TransSub] launch at login failed: \(error)")
                    }
                }
        }
    }

    private var dictationTab: some View {
        Form {
            Picker("Hold-to-talk hotkey", selection: $prefs.dictationHotkey) {
                Text("fn (Globe)").tag("fn")
                Text("Right ⌥ Option").tag("rightOption")
                Text("Right ⌘ Command").tag("rightCommand")
                Text("F5").tag("f5")
            }
            HStack(spacing: 6) {
                Circle()
                    .fill(app.dictation.tapActive ? Color.green : Color.orange)
                    .frame(width: 7, height: 7)
                Text(app.dictation.tapActive
                     ? "Hotkey armed: \(hotkeyName(prefs.dictationHotkey)) — hold to dictate"
                     : "Hotkey listener off — grant Input Monitoring, then relaunch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .combine)
            Text("Hold to dictate; release to paste at the cursor. Double-tap for hands-free; Esc cancels.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Divider()
            Toggle("Remove filler words (um, uh…)", isOn: $prefs.dictationCleanup)
            Toggle("Restore my previous clipboard afterwards", isOn: $prefs.restoreClipboard)
            Text("Sessions stop automatically after 5 minutes so a forgotten one can't keep recording.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if !app.dictation.lastError.isEmpty {
                Text(app.dictation.lastError)
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var permissions: some View {
        Form {
            permissionRow(
                "Screen Recording", granted: app.hasScreenPermission,
                why: "Capture audio from other apps.",
                url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            permissionRow(
                "Accessibility", granted: AXIsProcessTrusted(),
                why: "Paste dictated text at the cursor.",
                url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            permissionRow(
                "Input Monitoring", granted: app.dictation.lastError.isEmpty,
                why: "Detect the dictation hotkey.",
                url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            Divider()
            VStack(alignment: .leading, spacing: 6) {
                Text("Translation language packs").font(.headline)
                Text(
                    "Translation uses Apple's on-device models. Install the pairs you need in "
                        + "System Settings → General → Language & Region → Translation Languages."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button(app.packInstaller.busy ? "Requesting…" : "Install fast model") {
                        app.packInstaller.install(
                            from: Languages.baseCode(prefs.sourceLocale),
                            to: prefs.targetLanguage)
                    }
                    .disabled(app.packInstaller.busy)
                    Button("Open Translation Languages") {
                        NSWorkspace.shared.open(
                            URL(string: "x-apple.systempreferences:com.apple.Localization-Settings.extension")!)
                    }
                    Button("Check current pair") { Task { await checkPair() } }
                }
                if !app.packInstaller.status.isEmpty {
                    Text(app.packInstaller.status)
                        .font(.caption)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !ui.packStatus.isEmpty {
                    Text(ui.packStatus).font(.caption)
                }
            }
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

    private func checkPair() async {
        guard #available(macOS 26.0, *) else {
            ui.packStatus = "Requires macOS 26+."
            return
        }
        let src = Languages.baseCode(prefs.sourceLocale)
        let tgt = prefs.targetLanguage
        switch await Translator.availability(from: src, to: tgt) {
        case .ready:
            ui.packStatus = "✅ \(src) → \(tgt) installed"
        case .needsDownload:
            ui.packStatus = "⚠️ \(src) → \(tgt) not installed — install it in System Settings"
        case .unsupported:
            ui.packStatus = "✗ \(src) → \(tgt) isn't supported"
        }
    }

    private func permissionRow(_ name: String, granted: Bool, why: String, url: String)
        -> some View
    {
        HStack(alignment: .top) {
            Image(systemName: granted ? "checkmark.circle.fill" : "exclamationmark.circle")
                .foregroundStyle(granted ? .green : .orange)
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                Text(why).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button("Open") { NSWorkspace.shared.open(URL(string: url)!) }
                .controlSize(.small)
        }
        .padding(.vertical, 3)
    }
}
