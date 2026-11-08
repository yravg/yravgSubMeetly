// Onboarding pertama kali, empat langkah seperti Meetily:
//   1 Welcome → 2 Setup overview → 3 Models → 4 Permissions → Finish Setup.
// Bedanya dengan Meetily: langkah "Models" kita tidak mengunduh model ASR
// (pengenalan suara sudah bawaan macOS) — ia menampilkan status model
// terjemahan Apple untuk pasangan bahasa yang dipilih, dengan tombol install.
// Langkah "Permissions" memakai ketiga izin yang memang diperlukan aplikasi ini.
//
// Overlay menutupi seluruh kerangka sampai Prefs.onboardingDone = true.
// "Skip for now" selalu tersedia: pengguna lama tidak boleh disandera.
import AppKit
import ApplicationServices
import SwiftUI
import SubMinKit

struct OnboardingView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var prefs: PrefsBridge
    @ObservedObject var installer: LanguagePackInstaller
    @StateObject private var langStatus = LanguageStatusModel()

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
        self.prefs = PrefsBridge.shared
        self.installer = app.packInstaller
    }

    var body: some View {
        ZStack {
            DS.Colors.app.ignoresSafeArea()
            VStack(spacing: 0) {
                if ui.onboardingStep > 1 { progress.padding(.bottom, DS.Space.s6) }
                VStack(spacing: DS.Space.s3) {
                    Text(title)
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(DS.Colors.textStrong)
                        .multilineTextAlignment(.center)
                    Text(subtitle)
                        .font(.system(size: 15))
                        .foregroundStyle(DS.Colors.textMuted)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 448)
                }
                .padding(.bottom, DS.Space.s6)

                ScrollView {
                    Group {
                        switch ui.onboardingStep {
                        case 2: overviewStep
                        case 3: modelsStep
                        case 4: permissionsStep
                        default: welcomeStep
                        }
                    }
                    .frame(maxWidth: 480)
                    .frame(maxWidth: .infinity)
                }

                Button("Skip for now") { finish() }
                    .buttonStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(DS.Colors.textFaint)
                    .padding(.top, DS.Space.s3)
            }
            .padding(DS.Space.s6)
            .frame(maxWidth: 672)
        }
        .task { await langStatus.refresh() }
        .onChange(of: installer.status) { _, _ in Task { await langStatus.refresh() } }
    }

    private var title: String {
        switch ui.onboardingStep {
        case 2: "Setup overview"
        case 3: "Translation models"
        case 4: "Grant permissions"
        default: "Welcome to yravgSubMeetly"
        }
    }

    private var subtitle: String {
        switch ui.onboardingStep {
        case 2: "Two short steps, then you're recording. Everything stays on this Mac."
        case 3: "Speech recognition is built into macOS — nothing to download. Translation uses Apple's on-device models; install the pair you use."
        case 4: "macOS needs your approval before yravgSubMeetly can hear anything or paste dictation."
        default: "Subtitle. Translate. Dictate. Take minutes. All on your device."
        }
    }

    /// Titik-titik langkah dengan rel; langkah selesai bisa diklik kembali.
    private var progress: some View {
        HStack(spacing: 0) {
            ForEach(2...4, id: \.self) { step in
                let done = ui.onboardingStep > step
                let current = ui.onboardingStep == step
                Button { if done { ui.onboardingStep = step } } label: {
                    ZStack {
                        Circle().fill(done ? DS.Colors.live : (current ? DS.Colors.panel : DS.Colors.sunken))
                            .overlay(Circle().stroke(current ? DS.Colors.live : DS.Colors.line, lineWidth: current ? 2 : 1))
                            .frame(width: 28, height: 28)
                        if done {
                            Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                        } else {
                            Text("\(step - 1)").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(current ? DS.Colors.live : DS.Colors.textFaint)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(!done)
                if step < 4 {
                    Rectangle().fill(ui.onboardingStep > step ? DS.Colors.live : DS.Colors.line)
                        .frame(width: 56, height: 1)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: 1 Welcome

    private var welcomeStep: some View {
        VStack(spacing: DS.Space.s8) {
            Rectangle().fill(DS.Colors.lineStrong).frame(width: 64, height: 1)
            VStack(alignment: .leading, spacing: DS.Space.s4) {
                featureRow("lock.fill", "Your audio, transcripts and minutes never leave this Mac")
                featureRow("captions.bubble", "Live subtitles and translation for any app, in a floating overlay")
                featureRow("mic", "Hold-to-talk dictation into any app, with filler-word cleanup")
                featureRow("note.text", "Meeting minutes shared with the browser extension — no account, no cloud")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .dsCard()
            VStack(spacing: DS.Space.s3) {
                Button("Get Started") { ui.onboardingStep = 2 }
                    .buttonStyle(.dsSolid).frame(maxWidth: 320).keyboardShortcut(.defaultAction)
                Text("Takes less than 2 minutes").font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
            }
        }
    }

    private func featureRow(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).font(.system(size: 11, weight: .medium))
                .foregroundStyle(DS.Colors.textSecondary)
                .frame(width: 20, height: 20).background(DS.Colors.muted).clipShape(Circle())
            Text(text).font(.system(size: 13)).lineSpacing(3).foregroundStyle(DS.Colors.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: 2 Overview

    private var overviewStep: some View {
        VStack(spacing: DS.Space.s8) {
            VStack(alignment: .leading, spacing: DS.Space.s4) {
                overviewRow("1", "Translation models", "Check the pair you'll use and install the low-latency model if you want instant subtitles.")
                overviewRow("2", "Permissions", "Screen Recording to hear other apps; Accessibility and Input Monitoring for dictation.")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .dsCard(padding: DS.Space.s4)
            Button("Let's go") { ui.onboardingStep = 3 }
                .buttonStyle(.dsSolid).frame(maxWidth: 320).keyboardShortcut(.defaultAction)
        }
    }

    private func overviewRow(_ n: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(n).font(.system(size: 12, weight: .bold)).foregroundStyle(DS.Colors.actionSolidText)
                .frame(width: 22, height: 22).background(DS.Colors.actionSolid).clipShape(Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Step \(n): \(title)").font(.system(size: 14, weight: .medium)).foregroundStyle(DS.Colors.textStrong)
                Text(detail).font(.system(size: 12)).foregroundStyle(DS.Colors.textMuted).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: 3 Models

    private var modelsStep: some View {
        VStack(spacing: DS.Space.s6) {
            VStack(alignment: .leading, spacing: DS.Space.s4) {
                Picker("Spoken language", selection: $prefs.sourceLocale) {
                    ForEach(Languages.sources) { Text($0.name).tag($0.id) }
                }
                Picker("Translate into", selection: $prefs.targetLanguage) {
                    ForEach(Languages.targets) { Text($0.name).tag($0.id) }
                }
                Divider()
                if langStatus.pairs.isEmpty {
                    HStack(spacing: 8) {
                        if langStatus.checking { ProgressView().controlSize(.small) }
                        Text(langStatus.checking ? "Checking installed models…" : "No status yet.")
                            .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                    }
                }
                ForEach(langStatus.pairs) { pair in
                    HStack(spacing: 12) {
                        DSStatusDot(kind: pair.isGood ? .ok : (pair.isUsable ? .warn : .idle), size: 8)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(pair.label).font(.system(size: 13, weight: .medium)).foregroundStyle(DS.Colors.textBody)
                            Text(pair.summary).font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle)
                        }
                        Spacer()
                        if pair.fast != .ready && pair.fast != .unsupported {
                            Button(installer.busy ? "Requesting…" : "Install") {
                                let parts = pair.id.split(separator: ">")
                                if parts.count == 2 { installer.install(from: String(parts[0]), to: String(parts[1])) }
                            }
                            .buttonStyle(.dsOutlineSm).disabled(installer.busy)
                        } else if pair.fast == .ready {
                            Text("Ready").font(.system(size: 12, weight: .medium)).foregroundStyle(DS.Colors.ok)
                        }
                    }
                }
                if !installer.status.isEmpty {
                    Text(installer.status).font(.system(size: 12)).foregroundStyle(DS.Colors.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .dsCard()
            VStack(spacing: DS.Space.s3) {
                Button("Continue") { ui.onboardingStep = 4 }
                    .buttonStyle(.dsSolid).frame(maxWidth: 320).keyboardShortcut(.defaultAction)
                Text("You can install more pairs later under Settings → Languages & Permissions")
                    .font(.system(size: 12)).foregroundStyle(DS.Colors.textSubtle).multilineTextAlignment(.center)
            }
        }
    }

    // MARK: 4 Permissions

    private var permissionsStep: some View {
        VStack(spacing: DS.Space.s6) {
            VStack(spacing: DS.Space.s3) {
                PermissionRowView(name: "Screen Recording", why: "Captures what other apps and participants say",
                                  granted: app.hasScreenPermission,
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                PermissionRowView(name: "Accessibility", why: "Pastes dictated text at the cursor",
                                  granted: AXIsProcessTrusted(),
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
                PermissionRowView(name: "Input Monitoring", why: "Detects the hold-to-talk hotkey",
                                  granted: app.dictation.lastError.isEmpty,
                                  url: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
            }
            if app.needsRelaunch {
                DSCallout(tone: .info, title: "Relaunch after granting Screen Recording", icon: "arrow.clockwise") {
                    HStack {
                        Text("macOS only applies it to a freshly launched app.")
                        Spacer()
                        Button("Quit & Reopen") { app.relaunch() }.buttonStyle(.dsOutlineSm)
                    }
                }
            }
            VStack(spacing: DS.Space.s3) {
                Button("Finish Setup") { finish() }
                    .buttonStyle(.dsSolid).frame(maxWidth: 320).keyboardShortcut(.defaultAction)
                Button { Task { await app.refreshTargets() } } label: { Label("Recheck", systemImage: "arrow.clockwise") }
                    .buttonStyle(.dsOutlineSm)
            }
        }
    }

    private func finish() {
        ui.onboardingDone = true
        ui.onboardingStep = 1
    }
}
