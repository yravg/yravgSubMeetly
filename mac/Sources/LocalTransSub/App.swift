// yraverageSub — menu bar app.
// No accounts, no telemetry; all speech and translation run on-device.
import AppKit
import Combine
import SwiftUI
import TransSubKit

@main
struct LocalTransSubApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        MenuBarExtra {
            MenuContent(app: delegate.controller)
        } label: {
            Image(systemName: delegate.controller.isRunning ? "captions.bubble.fill" : "captions.bubble")
        }

        Settings {
            SettingsView(app: delegate.controller)
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    @MainActor let controller = AppController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Dock icon unless the user asked for menu-bar-only.
        NSApp.setActivationPolicy(Prefs.shared.hideDockIcon ? .accessory : .regular)
        // Diagnostic mode: report real permission state from inside the app's
        // own bundle identity, then exit.
        if CommandLine.arguments.contains("--check-perms") {
            Task { @MainActor in
                await PermissionReport.run()
                NSApp.terminate(nil)
            }
            return
        }
        // Translation latency benchmark.
        if CommandLine.arguments.contains("--bench-translate") {
            let args = CommandLine.arguments
            let from = args.firstIndex(of: "--from").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            } ?? "en"
            let to = args.firstIndex(of: "--to").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            } ?? "zh-Hans"
            Task { @MainActor in
                if #available(macOS 26.0, *) {
                    await BenchTranslate.run(source: from, target: to)
                }
                NSApp.terminate(nil)
            }
            return
        }
        // End-to-end self test.
        if CommandLine.arguments.contains("--selftest") {
            let args = CommandLine.arguments
            let wav = args.firstIndex(of: "--wav").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            }
            let secs = args.firstIndex(of: "--secs").flatMap { i in
                i + 1 < args.count ? Double(args[i + 1]) : nil
            } ?? 25
            MainActor.assumeIsolated {
                controller.bootstrap()
                Task { @MainActor in
                    await SelfTest.run(controller: controller, wav: wav, seconds: secs)
                    NSApp.terminate(nil)
                }
            }
            return
        }
        // Overlay move/resize probe.
        if CommandLine.arguments.contains("--overlay-probe") {
            MainActor.assumeIsolated {
                Task { @MainActor in
                    await OverlayProbe.run(controller: controller)
                    NSApp.terminate(nil)
                }
            }
            return
        }
        // Probe sisip teks dikte (butuh Accessibility).
        if CommandLine.arguments.contains("--dictation-probe") {
            let args = CommandLine.arguments
            let text = args.firstIndex(of: "--text").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            } ?? "yraverageSub dictation probe"
            let restore = args.contains("--restore-clipboard")
            let delay = args.firstIndex(of: "--delay").flatMap { i in
                i + 1 < args.count ? Double(args[i + 1]) : nil
            } ?? 0
            let expect = args.firstIndex(of: "--expect").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            }
            MainActor.assumeIsolated {
                Task { @MainActor in
                    await DictationProbe.run(text: text, restoreClipboard: restore, delay: delay, expect: expect)
                    NSApp.terminate(nil)
                }
            }
            return
        }
        // Probe pemetaan hotkey dikte (tidak butuh izin apa pun).
        if CommandLine.arguments.contains("--hotkey-probe") {
            MainActor.assumeIsolated {
                HotkeyProbe.run()
                NSApp.terminate(nil)
            }
            return
        }
        // Probe fokus: apakah menampilkan overlay merampas fokus dari aplikasi
        // yang sedang dipakai pengguna?
        if CommandLine.arguments.contains("--focus-probe") {
            let args = CommandLine.arguments
            let decoy = args.firstIndex(of: "--decoy").flatMap { i in
                i + 1 < args.count ? args[i + 1] : nil
            }
            let settle = args.firstIndex(of: "--settle").flatMap { i in
                i + 1 < args.count ? Double(args[i + 1]) : nil
            } ?? 2.0
            MainActor.assumeIsolated {
                Task { @MainActor in
                    await FocusProbe.run(controller: controller, decoy: decoy, settle: settle)
                    NSApp.terminate(nil)
                }
            }
            return
        }
        // Demo mode: render the subtitle overlay with sample text so the
        // floating-window behaviour can be verified without any permissions.
        if CommandLine.arguments.contains("--overlay-demo") {
            MainActor.assumeIsolated { controller.showOverlayDemo() }
            return
        }
        MainActor.assumeIsolated {
            controller.bootstrap()
            // Always show the window when the user launches the app. It is a
            // menu-bar app, so without this a double-click looks like nothing
            // happened — the only feedback is a small icon in a crowded menu
            // bar. Launch-at-login starts it silently instead (see below).
            UserDefaults.standard.set(true, forKey: "hasLaunchedBefore")
            controller.openMainWindow()
        }
    }

    /// Clicking the app in Finder/Dock while it is already running sends a
    /// "reopen" — without handling it, nothing at all happens.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool)
        -> Bool
    {
        MainActor.assumeIsolated { controller.openMainWindow() }
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated { controller.shutdown() }
    }
}

/// Top-level app state shared by the menu, main window and settings.
@MainActor
final class AppController: ObservableObject {
    let overlayModel = OverlayModel()
    let ui = UIState()
    let fileModel = FileTranscribeModel()
    let packInstaller = LanguagePackInstaller()
    let notesUI = NotesViewState()
    lazy var overlay = OverlayController(model: overlayModel)
    lazy var session = SubtitleSession(model: overlayModel, overlay: overlay)
    lazy var dictation = DictationController()
    lazy var mainWindow = MainWindowController(app: self)

    @Published var targets: [CaptureTarget] = [.systemWide]
    @Published var selectedTarget: CaptureTarget = .systemWide
    @Published var isRunning = false
    @Published var status = ""
    @Published var error = ""
    @Published var hasScreenPermission = true
    @Published var needsRelaunch = false

    private var observers: [NSObjectProtocol] = []

    private var permissionTimer: Timer?
    private var prefObservers: Set<AnyCancellable> = []

    /// Hook the overlay panel's controls up to the session.
    private func wireOverlay() {
        overlayModel.onClose = { [weak self] in self?.overlay.hide() }
        overlayModel.onForceTranslate = { [weak self] scope in
            guard let self, #available(macOS 26.0, *) else { return }
            self.session.forceTranslate(scope: scope)
        }
    }

    /// Teruskan preferensi tampilan ke overlay yang sedang tampil.
    ///
    /// Tanpa ini, nilai hanya terbaca saat OverlayModel dibuat dan saat sesi
    /// dimulai — menggeser slider di Settings tidak mengubah apa pun sampai
    /// sesi berikutnya, padahal pengguna sedang melihat hasilnya.
    private func observeOverlayPrefs() {
        let bridge = PrefsBridge.shared
        bridge.$fontSize
            .removeDuplicates()
            .sink { [weak self] v in self?.overlayModel.fontSize = v }
            .store(in: &prefObservers)
        bridge.$opacity
            .removeDuplicates()
            .sink { [weak self] v in self?.overlayModel.opacity = v }
            .store(in: &prefObservers)
        bridge.$dualLine
            .removeDuplicates()
            .sink { [weak self] v in self?.overlayModel.dualLine = v }
            .store(in: &prefObservers)
    }

    func bootstrap() {
        wireOverlay()
        observeOverlayPrefs()
        hasScreenPermission = AudioCapture.hasPermission()
        Task { await refreshTargets() }
        dictation.start()
        startPermissionWatch()
        // Re-check whenever the user comes back from System Settings.
        observers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.recheckPermission() }
            })
        // Mirror session state for the menu/UI.
        observers.append(
            NotificationCenter.default.addObserver(
                forName: .init("TransSubSessionChanged"), object: nil, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.syncFromSession() }
            })
    }

    func shutdown() {
        dictation.stop()
        Task { await session.stop() }
    }

    private func syncFromSession() {
        isRunning = session.isRunning
        status = session.statusText
        error = session.errorText
    }

    func refreshTargets() async {
        guard AudioCapture.hasPermission() else {
            hasScreenPermission = false
            return
        }
        hasScreenPermission = true
        do {
            let list = try await AudioCapture.availableTargets()
            targets = list
            let saved = Prefs.shared.captureTarget
            if let match = list.first(where: { $0.id == saved }) {
                selectedTarget = match
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func toggle() {
        Task {
            if session.isRunning {
                await session.stop()
            } else {
                Prefs.shared.captureTarget = selectedTarget.id
                await session.start(target: selectedTarget)
            }
            syncFromSession()
        }
    }

    /// Poll while permission is missing so the banner clears by itself once the
    /// user flips the switch in System Settings.
    private func startPermissionWatch() {
        permissionTimer?.invalidate()
        permissionTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.recheckPermission() }
        }
    }

    private func recheckPermission() {
        let granted = AudioCapture.hasPermission()
        guard granted != hasScreenPermission else { return }
        hasScreenPermission = granted
        if granted {
            needsRelaunch = false
            Task { await refreshTargets() }
        }
    }

    func requestScreenPermission() {
        // Ask macOS to prompt, and open the settings pane as well — once a
        // decision has been recorded the prompt never reappears, and the pane
        // is the only way back from a denial.
        AudioCapture.requestPermission()
        NSWorkspace.shared.open(
            URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")!)
        // A screen-recording grant only takes effect for a freshly launched
        // process, so offer the relaunch explicitly.
        needsRelaunch = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await refreshTargets()
        }
    }

    /// Relaunch so a newly granted Screen Recording permission takes effect.
    func relaunch() {
        let url = Bundle.main.bundleURL
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
            Task { @MainActor in NSApp.terminate(nil) }
        }
    }

    func openMainWindow() {
        mainWindow.show()
    }

    /// Show or hide the Dock icon without relaunching.
    func applyDockVisibility() {
        NSApp.setActivationPolicy(Prefs.shared.hideDockIcon ? .accessory : .regular)
        if !Prefs.shared.hideDockIcon {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    /// Renders the overlay with sample text (used by --overlay-demo).
    func showOverlayDemo() {
        overlayModel.fontSize = Prefs.shared.fontSize
        overlayModel.opacity = Prefs.shared.opacity
        overlayModel.loadMockSession()
        overlay.show()
    }
}

private struct MenuContent: View {
    @ObservedObject var app: AppController
    @ObservedObject private var prefs = PrefsBridge.shared

    var body: some View {
        Button(app.isRunning ? "Stop subtitles" : "Start subtitles") { app.toggle() }
            .keyboardShortcut("s", modifiers: [.command, .shift])

        if !app.status.isEmpty {
            Text(app.status)
        }

        Divider()

        Picker("Audio source", selection: Binding(
            get: { app.selectedTarget.id },
            set: { id in
                if let t = app.targets.first(where: { $0.id == id }) { app.selectedTarget = t }
            })
        ) {
            ForEach(app.targets) { t in Text(t.name).tag(t.id) }
        }

        Button("Refresh app list") { Task { await app.refreshTargets() } }

        Divider()

        Toggle("Translate", isOn: $prefs.translateEnabled)
        Toggle("Show original + translation", isOn: $prefs.dualLine)

        Divider()

        Button("Open window…") { app.openMainWindow() }
        SettingsLink { Text("Settings…") }
            .keyboardShortcut(",", modifiers: .command)
        Button("Quit") { NSApp.terminate(nil) }
            .keyboardShortcut("q", modifiers: .command)
    }
}
