# Panduan pengguna — yraverageSubMin untuk macOS

Aplikasi macOS menambahkan tiga hal yang tidak bisa dilakukan ekstensi Chrome:
menangkap **audio sistem** dari aplikasi mana pun, menampilkan **overlay subtitel
di atas seluruh layar**, dan **dikte global** yang mengetikkan hasilnya ke
aplikasi yang sedang Anda pakai. Semuanya berjalan di perangkat.

---

## Pasang dan jalankan

```bash
cd mac
./build-app.sh      # membangun, menandatangani, lalu memasang bundel .app
./doctor.sh         # memeriksa tanda tangan, ikon, dan izin
```

Aplikasi hidup di **menu bar**. Ikon Dock bisa disembunyikan lewat
**Settings → Hide Dock icon (menu bar only)**, dan **Launch at login** membuatnya
otomatis menyala.

> `build-app.sh` menolak membangun bila sertifikat penanda tangan tidak ada.
> Itu disengaja: bundel yang ditandatangani ad-hoc membuat macOS mencabut semua
> izin yang sudah Anda berikan, dan aplikasi akan meminta ulang seolah baru.

---

## Izin yang diminta

macOS memberi izin per-aplikasi. Buka **Settings → Permissions** di dalam
aplikasi untuk melihat statusnya, atau **System Settings → Privacy & Security**.

| Izin | Untuk apa | Tanpa itu |
| --- | --- | --- |
| **Screen Recording** | Menangkap audio sistem (ScreenCaptureKit) | Sumber "Capture" tidak menghasilkan suara |
| **Microphone** | Sumber mikrofon dan dikte | Dikte dan mode mikrofon mati |
| **Accessibility** | Menempelkan hasil dikte ke aplikasi lain | Teks dikte tidak masuk ke mana-mana |
| **Input Monitoring** | Mendengar hotkey tahan-untuk-bicara | Hotkey dikte tidak bereaksi |

Setelah memberi izin baru, tekan **Re-check** — atau **Quit & Reopen** bila macOS
masih menahan status lamanya.

---

## Subtitel langsung

1. Buka jendela utama dari ikon menu bar.
2. **Source** → pilih **Capture** (audio sistem) atau mikrofon.
3. **Task & languages** → tentukan **Spoken language** dan, bila ingin
   diterjemahkan, bahasa tujuan di **Into**.
4. Tekan **Start subtitles**.

Subtitel muncul di panel melayang yang **tidak mencuri fokus keyboard** — Anda
tetap bisa mengetik di aplikasi lain sementara subtitel berjalan di atasnya.

Klik kanan sebuah baris untuk **Copy line** atau **Copy original**.

### Menyetel tampilan overlay

Di **Settings → Overlay**:

- **Overlay position** — Bottom atau Center; **Reset subtitle position**
  mengembalikannya bila panel tergeser terlalu jauh.
- **Background opacity** — seberapa pekat latar panel.
- **Large text & high contrast** — teks lebih besar dan kontras tinggi.
- **Preview overlay** — menampilkan contoh tanpa perlu menyalakan penangkapan.

Perubahan ini langsung terlihat pada overlay yang sedang berjalan.

---

## Model terjemahan

macOS memakai kerangka Translation bawaan sistem. Ada **dua paket berbeda** untuk
tiap pasangan bahasa, dan keduanya diunduh terpisah:

- **Low-latency** — cepat, dipakai untuk subtitel langsung.
- **High-fidelity** — lebih teliti, dipakai untuk hasil akhir dan berkas.

Di **Settings → Languages**:

- **Check current pair** memastikan pasangan bahasa yang sedang dipilih ada.
- **Install fast model** mengunduh paket low-latency untuk pasangan itu.
- **Open Translation Languages** membuka panel unduhan milik macOS.
- **Installed translation models** menampilkan apa yang sudah tersedia.

Kalau terjemahan langsung terasa kosong sementara hasil akhirnya benar,
biasanya paket **low-latency** untuk pasangan itu yang belum terpasang.

---

## Dikte global

Bicara di aplikasi mana pun, teksnya diketikkan di tempat kursor berada.

1. **Settings → Dictation** → pilih **Hold-to-talk hotkey**: `fn`,
   `rightOption`, `rightCommand`, atau `F5`.
2. Tahan tombol itu, bicara, lalu lepaskan.
3. Teks ditempelkan ke aplikasi yang sedang aktif.

Pil kecil muncul selama merekam. Pil itu **tidak menerima klik** dan tidak
memindahkan fokus, jadi tidak mengganggu apa yang sedang Anda kerjakan.

- **Restore my previous clipboard afterwards** mengembalikan isi papan klip Anda
  setelah teks ditempelkan.
- Aplikasi tujuan dicatat saat Anda mulai bicara dan diaktifkan kembali sebelum
  menempel, jadi hasilnya tidak nyasar ke jendela lain.

Butuh **Accessibility** dan **Input Monitoring**. Tanpa keduanya hotkey tidak
bereaksi atau teks tidak pernah masuk.

---

## Berkas audio / video

1. **Transcribe a file** → **Choose an audio or video file**.
2. Kemajuan tampil di **Actions & results**.
3. Hasilnya bisa diekspor lewat panel **Export**.

---

## Notulen rapat

Panel **Meeting notes** menyusun ringkasan, keputusan, dan action item beserta
pemiliknya dari transkrip sesi.

- **Buat ringkasan otomatis** menyusun ringkasannya; **Gunakan ringkasan**
  memasukkannya ke notulen, **Buang draf** membatalkannya.
- **Tandai selesai** menutup satu action item; pemilik yang belum jelas tercatat
  sebagai **Belum ditugaskan**.
- Ekspor tersedia dalam **Markdown** dan teks polos.

Catatan disimpan di `~/.yraveragesubmin/notes.json` — berkas yang sama dibaca
ekstensi Chrome, jadi notulen dari kedua sisi tampil di satu register.

---

## Tema

**Settings → Accent pattern** mengganti corak warna aplikasi.
**Reset to Yraverage Klasik** mengembalikannya ke bawaan.

---

## Privasi

- Pengenalan suara memakai SpeechAnalyzer di perangkat; terjemahan memakai
  kerangka Translation di perangkat.
- Tidak ada akun dan tidak ada inferensi awan.
- Audio, transkrip, dan catatan tidak meninggalkan Mac Anda.

---

## Kalau ada yang tidak beres

| Gejala | Yang biasanya terjadi |
| --- | --- |
| Sumber Capture sunyi | **Screen Recording** belum diberikan — beri izin lalu **Quit & Reopen** |
| Hotkey dikte tidak bereaksi | **Input Monitoring** belum diberikan |
| Dikte merekam tapi teks tidak muncul | **Accessibility** belum diberikan |
| Terjemahan langsung kosong | Paket **low-latency** pasangan itu belum terpasang — **Install fast model** |
| Izin tiba-tiba diminta ulang | Aplikasi dibangun tanpa sertifikat; bangun ulang dengan `./build-app.sh` |
| Overlay mencuri fokus keyboard | Bangun ulang — panel yang benar tidak pernah menjadi jendela kunci |

`./doctor.sh` memeriksa tanda tangan, ikon, dan izin sekaligus. Pemeriksaannya
tri-state: yang tidak bisa dipastikan dilaporkan **unknown**, bukan lulus.
