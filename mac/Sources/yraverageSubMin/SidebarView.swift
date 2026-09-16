// Sidebar ala Meetily: 256 px terbuka / 64 px terlipat, putih, garis kanan,
// shadow-sm. Isi dari atas: ruang lampu lalu-lintas, pil wordmark, pencarian,
// nav (Home · Files · Meeting Notes), daftar rapat dari register bersama,
// lalu kaki: Start Recording merah, Settings, About, versi.
//
// Daftar rapat dibaca dari ~/.yraveragesubmin/notes.json — satu sumber yang
// sama dengan ekstensi. Data contoh yang dulu di-hardcode ("Tersimpan (2)")
// tidak ada lagi: sidebar hanya menampilkan rapat yang benar-benar ada.
import SwiftUI

struct SidebarView: View {
    @ObservedObject var app: AppController
    @ObservedObject var ui: UIState
    @ObservedObject var notes: NotesViewState

    init(app: AppController) {
        self.app = app
        self.ui = app.ui
        self.notes = app.notesUI
    }

    private var filtered: [SharedNoteDoc] {
        let q = ui.search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return notes.sharedDocs }
        return notes.sharedDocs.filter { d in
            d.title.lowercased().contains(q)
                || d.summary.lowercased().contains(q)
                || d.register.contains { $0.text.lowercased().contains(q) }
        }
    }

    /// Cuplikan yang cocok, ditampilkan sebagai baris "Match:" seperti Meetily.
    private func matchSnippet(_ d: SharedNoteDoc) -> String? {
        let q = ui.search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty, !d.title.lowercased().contains(q) else { return nil }
        if let hit = d.register.first(where: { $0.text.lowercased().contains(q) }) {
            return hit.text
        }
        return d.summary.lowercased().contains(q) ? d.summary : nil
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: 0) {
                // Ruang untuk lampu lalu-lintas: jendela memakai konten ukuran
                // penuh dengan bilah judul transparan, jadi tombol tutup/kecilkan
                // duduk di sini.
                Color.clear.frame(height: 34)

                if ui.sidebarCollapsed { collapsedRail } else { expanded }
            }
            .frame(width: ui.sidebarCollapsed ? DS.Width.sidebarCollapsed : DS.Width.sidebar)
            .frame(maxHeight: .infinity)
            .background(DS.Colors.panel)
            .overlay(alignment: .trailing) { DS.Colors.line.frame(width: 1) }
            .shadow(color: .black.opacity(0.05), radius: 1, x: 1)

            // Tombol lipat melayang di tepi kanan, top 80 — persis Meetily.
            Button {
                withAnimation(.easeInOut(duration: DS.Motion.slow)) { ui.sidebarCollapsed.toggle() }
            } label: {
                Image(systemName: ui.sidebarCollapsed ? "chevron.right.circle" : "chevron.left.circle")
                    .font(.system(size: 20, weight: .regular))
                    .foregroundStyle(DS.Colors.textSecondary)
                    .padding(4)
                    .background(DS.Colors.panel)
                    .overlay(Circle().stroke(DS.Colors.line, lineWidth: 1))
                    .clipShape(Circle())
                    .dsFloating()
            }
            .buttonStyle(.plain)
            // Di bawah kotak pencarian (34 spacer + 12 + wordmark + 8 + 36 + 12).
            .offset(x: 12, y: 128)
            .help(ui.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar")
            .zIndex(50)
        }
        .onAppear { app.refreshSharedNotes() }
    }

    // MARK: Terbuka

    private var expanded: some View {
        VStack(spacing: 0) {
            VStack(spacing: DS.Space.s2) {
                Button { ui.showAbout = true } label: { Wordmark(size: 15) }
                    .buttonStyle(.plain)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .help("About yraverageSubMin")

                searchField
            }
            .padding(DS.Space.s3)

            navRow("Home", icon: "house", active: ui.route == .home) { ui.route = .home }
            navRow("Files", icon: "doc.text", active: ui.route == .files) { ui.route = .files }

            HStack(spacing: 8) {
                Image(systemName: "note.text").font(.system(size: 13))
                Text("Meeting Notes")
                Spacer()
                Text("\(notes.sharedDocs.count)")
                    .font(.system(size: 11))
                    .foregroundStyle(DS.Colors.textFaint)
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(DS.Colors.textSecondary)
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 4)
            .padding(.horizontal, DS.Space.s3)

            ScrollView {
                LazyVStack(spacing: 2) {
                    if filtered.isEmpty {
                        Text(ui.search.isEmpty
                             ? "No meetings yet — record one, or push from the extension."
                             : "No meeting matches \"\(ui.search)\".")
                            .font(.system(size: 12))
                            .foregroundStyle(DS.Colors.textSubtle)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    ForEach(filtered) { d in
                        MeetingRow(
                            title: d.title,
                            subtitle: [d.date, d.meeting?.seq.map { "#\($0)" }].compactMap { $0 }
                                .filter { !$0.isEmpty }.joined(separator: " · "),
                            match: matchSnippet(d),
                            active: ui.route == .meeting(d.id),
                            onRename: { ui.renameText = d.title; ui.renamingId = d.id },
                            onDelete: { ui.deletingId = d.id }
                        ) { ui.route = .meeting(d.id) }
                    }
                }
                .padding(.horizontal, DS.Space.s3)
            }

            footer
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12))
                .foregroundStyle(DS.Colors.textFaint)
            TextField("Search meeting content…", text: $ui.search)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
            if !ui.search.isEmpty {
                Button { ui.search = "" } label: {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(DS.Colors.textFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: DS.Width.control)
        .background(DS.Colors.panel)
        .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Colors.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md))
        .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
    }

    private func navRow(_ title: String, icon: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.system(size: 13))
                Text(title)
                Spacer()
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(active ? DS.Colors.textStrong : DS.Colors.textSecondary)
            .padding(.horizontal, 12)
            .frame(height: 34)
            .background(active ? DS.Colors.muted : .clear)
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
        }
        .buttonStyle(.plain)
        .padding(.horizontal, DS.Space.s3)
        .padding(.top, 12)
    }

    private var footer: some View {
        VStack(spacing: 4) {
            Button { app.toggle() } label: {
                HStack(spacing: 8) {
                    Image(systemName: app.isRunning ? "stop.fill" : "mic.fill").font(.system(size: 13))
                    Text(app.isRunning ? "Stop recording" : "Start Recording")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.dsRecord)
            .disabled(!app.hasScreenPermission && !app.isRunning)
            .help(app.hasScreenPermission ? "Start live subtitles (⌘⇧S)" : "Grant Screen Recording first")

            Button { ui.route = .settings } label: {
                HStack(spacing: 8) { Image(systemName: "gearshape").font(.system(size: 13)); Text("Settings") }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.dsSecondary)
            .frame(height: DS.Width.controlSm)

            Button { ui.showAbout = true } label: {
                HStack(spacing: 8) { Image(systemName: "info.circle").font(.system(size: 13)); Text("About") }
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.dsSecondary)
            .frame(height: DS.Width.controlSm)

            Text(AppInfo.versionLabel)
                .font(.system(size: 11))
                .foregroundStyle(DS.Colors.textFaint)
                .padding(.vertical, 4)
        }
        .padding(DS.Space.s2)
        .overlay(alignment: .top) { DS.Colors.lineSubtle.frame(height: 1) }
    }

    // MARK: Terlipat

    private var collapsedRail: some View {
        VStack(spacing: 16) {
            Button { ui.showAbout = true } label: {
                Text("S")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Brand.teal)
                    .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
            }
            .buttonStyle(.plain)
            .help("About yraverageSubMin")

            railButton("house", active: ui.route == .home, help: "Home") { ui.route = .home }

            Button { app.toggle() } label: {
                Image(systemName: app.isRunning ? "stop.fill" : "mic.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(DS.Colors.record)
                    .clipShape(Circle())
                    .shadow(color: .black.opacity(0.05), radius: 1, y: 1)
            }
            .buttonStyle(.plain)
            .help(app.isRunning ? "Stop recording" : "Start Recording")

            railButton("doc.text", active: ui.route == .files, help: "Files") { ui.route = .files }
            railButton("note.text", active: ui.route.isMeeting, help: "Meeting Notes") {
                withAnimation(.easeInOut(duration: DS.Motion.slow)) { ui.sidebarCollapsed = false }
            }
            railButton("gearshape", active: ui.route == .settings, help: "Settings") { ui.route = .settings }
            railButton("info.circle", active: false, help: "About") { ui.showAbout = true }
            Spacer()
        }
        .padding(.top, 8)
    }

    private func railButton(_ icon: String, active: Bool, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 16))
                .foregroundStyle(DS.Colors.textMuted)
                .frame(width: 36, height: 36)
                .background(active ? DS.Colors.muted : .clear)
                .clipShape(RoundedRectangle(cornerRadius: DS.Radius.lg))
        }
        .buttonStyle(.plain)
        .help(help)
    }
}

/// Satu baris rapat di sidebar. Ubah nama / hapus lewat menu konteks —
/// Meetily menampilkannya sebagai ikon saat hover; menu konteks lebih jujur di
/// macOS dan tidak menyembunyikan aksi destruktif di balik gerakan mouse.
private struct MeetingRow: View {
    let title: String
    let subtitle: String
    let match: String?
    let active: Bool
    var onRename: () -> Void = {}
    var onDelete: () -> Void = {}
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "doc.text")
                    .font(.system(size: 12))
                    .foregroundStyle(active ? DS.Colors.live : DS.Colors.textFaint)
                    .frame(width: 22, height: 22)
                    .background(active ? DS.Colors.selected : DS.Colors.muted)
                    .clipShape(Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: active ? .semibold : .regular))
                        .foregroundStyle(active ? DS.Colors.textStrong : DS.Colors.textBody)
                        .lineLimit(2)
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 11))
                            .foregroundStyle(DS.Colors.textFaint)
                    }
                    if let m = match {
                        (Text("Match: ").fontWeight(.medium) + Text(m))
                            .font(.system(size: 11))
                            .foregroundStyle(DS.Colors.textMuted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(active ? DS.Colors.selected : .clear)
            .clipShape(RoundedRectangle(cornerRadius: DS.Radius.md))
            .contentShape(RoundedRectangle(cornerRadius: DS.Radius.md))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Rename…", action: onRename)
            Button("Delete…", role: .destructive, action: onDelete)
        }
    }
}

enum AppInfo {
    static var versionLabel: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        return "v\(v ?? "dev")"
    }
}
