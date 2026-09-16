// State panel notulen. Tampilannya kini MeetingView (register bersama) dan
// SidebarView (daftar rapat); data contoh yang dulu di-hardcode di sini sudah
// tidak ada — sidebar hanya menampilkan rapat yang benar-benar ada di
// ~/.yraveragesubmin/notes.json.
//
// Dipisah ke ObservableObject karena @State adalah makro pada SDK macOS 26 dan
// plugin-nya hanya ikut Xcode penuh; proyek ini dibangun dengan Command Line
// Tools. Pemiliknya AppController agar isinya tidak hilang tiap kali rute
// berpindah.
import SwiftUI

@MainActor
final class NotesViewState: ObservableObject {
    @Published var sharedDocs: [SharedNoteDoc] = []
    @Published var sharedSelectedId = ""
    @Published var sharedTypeFilter: SharedItemType? = nil
}
