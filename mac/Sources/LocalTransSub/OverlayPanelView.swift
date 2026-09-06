// The floating subtitle panel — native equivalent of the browser extension's
// in-page overlay: a toolbar of live controls, a scrollable transcript with
// timestamps and per-line selection, and a status footer.
import AppKit
import SwiftUI
import TransSubKit

/// What a "Force translate" run should cover.
enum ForceScope: Hashable {
    case all
    case selected
    case untranslated
}

struct OverlayPanelView: View {
    @ObservedObject var model: OverlayModel
    @ObservedObject private var prefs = PrefsBridge.shared
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Mode aksesibilitas: teks 25% lebih besar, putih penuh, bingkai tegas.
    private var a11y: Bool { prefs.a11yLargeContrast }
    private func big(_ v: CGFloat) -> CGFloat { a11y ? v * 1.25 : v }
    private func ink(_ normal: Double) -> Double { a11y ? 1.0 : normal }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider().opacity(0.35)
            if model.minimized {
                compactCaption
            } else {
                transcript
                Divider().opacity(0.35)
                footer
            }
        }
        .background(.black.opacity(model.opacity))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(.white.opacity(prefs.a11yLargeContrast ? 0.4 : 0.12), lineWidth: prefs.a11yLargeContrast ? 2 : 1)
        )
    }

    // MARK: toolbar

    private var toolbar: some View {
        // Dragged narrow, checkbox labels silently truncate to nothing, which
        // looks broken. Fall back to icons (with tooltips) instead.
        ViewThatFits(in: .horizontal) {
            toolbarBody(compact: false)
            toolbarBody(compact: true)
        }
        .buttonStyle(.plain)
        .toggleStyle(.checkbox)
        .controlSize(.small)
        .font(.system(size: 11))
        .foregroundStyle(.white.opacity(0.85))
        .tint(Brand.tealLight)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(.white.opacity(0.06))
    }

    private func toolbarBody(compact: Bool) -> some View {
        HStack(spacing: compact ? 6 : 10) {
            Text(compact ? "ySub" : "yraverageSub")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .fixedSize()

            if !model.minimized {
                Toggle(isOn: $model.refine) {
                    if compact { Image(systemName: "wand.and.stars") } else { Text("Refine") }
                }
                .help("Re-translate finished lines with the higher-quality on-device model")
                .fixedSize()

                Toggle(isOn: $model.dualLine) {
                    if compact { Image(systemName: "text.alignleft") } else { Text("Dual line") }
                }
                .help("Show the original above the translation")
                .fixedSize()

                Menu {
                    Button("Re-translate all (\(model.cues.count))") {
                        model.onForceTranslate?(.all)
                    }
                    Button("Selected lines (\(model.selected.count))") {
                        model.onForceTranslate?(.selected)
                    }
                    .disabled(model.selected.isEmpty)
                    Button("Untranslated only (\(model.untranslatedCount))") {
                        model.onForceTranslate?(.untranslated)
                    }
                    .disabled(model.untranslatedCount == 0)
                } label: {
                    if compact {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    } else {
                        Text("Force translate")
                    }
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(compact ? .hidden : .visible)
                .fixedSize()
                .help("Re-run translation over existing lines")
                .disabled(model.busy || model.cues.isEmpty)

                Toggle(isOn: $model.autoScroll) {
                    if compact { Image(systemName: "arrow.down.to.line") } else { Text("Auto scroll") }
                }
                .help("Follow the newest line")
                .fixedSize()
            }

            Spacer(minLength: 4)

            Button(model.minimized ? "▣" : "—") { model.minimized.toggle() }
                .help(model.minimized ? "Expand" : "Minimise to a caption bar")
            Button("✕") { model.onClose?() }
                .help("Hide the overlay (reopen from the menu bar)")
        }
    }

    // MARK: transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 3) {
                    ForEach(model.cues) { cue in
                        row(cue)
                            .id(cue.id)
                    }
                    if let interim = model.interim {
                        interimRow(interim).id("interim")
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
            .onChange(of: model.scrollTick) { _, _ in
                guard model.autoScroll else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    if model.interim != nil {
                        proxy.scrollTo("interim", anchor: .bottom)
                    } else if let last = model.cues.last?.id {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }
        }
        .frame(minHeight: 40)
    }

    private func row(_ cue: SubtitleLine) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Toggle("", isOn: Binding(
                get: { model.selected.contains(cue.id) },
                set: { on in
                    if on { model.selected.insert(cue.id) } else { model.selected.remove(cue.id) }
                }))
                .toggleStyle(.checkbox)
                .labelsHidden()
                .controlSize(.small)

            Text(clock(cue.start))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.white.opacity(0.45))
                .frame(width: 38, alignment: .trailing)
                .padding(.top, 3)

            VStack(alignment: .leading, spacing: 2) {
                if model.dualLine, !cue.source.isEmpty, cue.source != cue.translation {
                    Text(cue.source)
                        .font(.system(size: big(model.fontSize * 0.6)))
                        .foregroundStyle(.white.opacity(ink(0.72)))
                }
                Text(cue.display)
                    .font(.system(size: big(model.fontSize * 0.78), weight: .semibold))
                    .foregroundStyle(cue.translation.isEmpty && !cue.source.isEmpty
                                     ? .white.opacity(ink(0.65)) : .white)
                    // Sengaja BUKAN .textSelection: menyeleksi teks menuntut
                    // status first responder, yang memaksa panel jadi key window
                    // dan merampas fokus ketikan pengguna. Menu konteks bekerja
                    // di jendela non-key, jadi menyalin tetap bisa.
                    .lineSpacing(2)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
        .contextMenu {
            Button("Copy line") { copyToPasteboard(cue.display) }
            if !cue.source.isEmpty, cue.source != cue.display {
                Button("Copy original") { copyToPasteboard(cue.source) }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 7)
                .fill(cue.id == model.activeID ? Brand.tealDeep.opacity(0.35) : .white.opacity(0.05))
        )
    }

    private func interimRow(_ cue: SubtitleLine) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle().fill(Brand.tealLight).frame(width: 6, height: 6).padding(.top, 7)
                .padding(.leading, 4)
            Text("…")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.white.opacity(0.4))
                .frame(width: 38, alignment: .trailing)
            VStack(alignment: .leading, spacing: 2) {
                if model.dualLine, !cue.source.isEmpty, cue.source != cue.translation {
                    Text(cue.source)
                        .font(.system(size: big(model.fontSize * 0.6)))
                        .foregroundStyle(.white.opacity(ink(0.5)))
                }
                Text(cue.display.isEmpty ? "● ● ●" : cue.display)
                    .font(.system(size: big(model.fontSize * 0.78), weight: .medium))
                    .foregroundStyle(.white.opacity(ink(0.75)))
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
    }

    // MARK: minimised + footer

    private var compactCaption: some View {
        VStack(spacing: 4) {
            let cue = model.interim ?? model.cues.last
            if model.dualLine, let c = cue, !c.source.isEmpty, c.source != c.translation {
                Text(c.source)
                    .font(.system(size: big(model.fontSize * 0.7)))
                    .foregroundStyle(.white.opacity(ink(0.75)))
                    .lineLimit(2)
            }
            Text(cue?.display ?? "Listening…")
                .font(.system(size: big(model.fontSize), weight: .semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(3)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var footer: some View {
        HStack(spacing: 6) {
            if model.busy { ProgressView().controlSize(.mini).scaleEffect(0.7) }
            Text(model.footer.isEmpty ? model.status : model.footer)
                .font(.system(size: 10.5))
                .foregroundStyle(.white.opacity(0.6))
                .lineLimit(1)
            Spacer(minLength: 0)
            if !model.cues.isEmpty {
                Text("\(model.cues.count) lines")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.white.opacity(0.4))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(.white.opacity(0.04))
    }

    private func copyToPasteboard(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
    }

    private func clock(_ seconds: Double) -> String {
        let t = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", t / 60, t % 60)
    }
}

