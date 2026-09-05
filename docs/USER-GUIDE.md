# Panduan pengguna — yraverageSub (ekstensi Chrome)

Subtitel dan terjemahan langsung untuk tab Chrome dan berkas media, berjalan **di
perangkat Anda**. Tidak ada akun, tidak ada server. Setelah model terunduh sekali,
semuanya jalan luring.

---

## Pasang

1. Buka `chrome://extensions` dan nyalakan **Developer mode**.
2. **Load unpacked** → pilih folder `dist/` hasil `npm run build`.
3. Sematkan ikonnya di bilah alat agar mudah dijangkau.

Panel utama terbuka di **Side Panel** Chrome (klik ikon ekstensi). Semua kontrol
ada di situ: sumber audio, bahasa, ekspor, notulen, dan pengaturan.

---

## Menjalankan pertama kali

Whisper perlu diunduh sekali sebelum bisa mengenali suara.

1. Buka Side Panel → **Settings** (ikon ⚙️).
2. Periksa **Speed vs accuracy**:
   - **Fast** — model terkecil, paling ringan.
   - **Balanced** — Whisper Base (~210 MB). Titik awal yang disarankan.
   - **Accurate** — model besar, paling lambat, paling teliti.
3. Tekan tombol unduh pada kartu model, atau biarkan terunduh otomatis saat
   pertama kali menekan **Start**.
4. Bila unduhan tersendat, ganti **Download source** dari HuggingFace ke
   **HF-Mirror**, lalu coba lagi.

Setelah selesai, bobot model tersimpan lokal dan tidak diunduh ulang.

---

## Subtitel langsung dari sebuah tab

1. Buka tab berisi video atau panggilan.
2. Buka Side Panel, pastikan **Source** di posisi **Realtime**.
3. Pilih **From (speech)** — bahasa yang diucapkan — dan **To (translation)**.
4. Tekan **Start**.

Subtitel muncul sebagai overlay di halaman dan sebagai baris transkrip di panel.

**Task Mode** menentukan hasilnya:

| Pilihan | Hasil |
| --- | --- |
| **Transcribe** | Teks dalam bahasa aslinya saja |
| **+ Translate** | Terjemahan ke bahasa tujuan |
| **Dual line** | Teks asli dan terjemahannya bersamaan |
| **Refine** | Draf cepat saat berbicara, diperbaiki setelah kalimat selesai |

### Mode interpreter (dua arah)

Untuk percakapan dua bahasa, tekan **Change** di baris *Interpreter mode*:

- **One-way** — satu arah tetap; bawaan **ZH → EN** (Chinese → English).
- **Two-way** — mengenali kedua bahasa bergantian dan menerjemahkan ke lawan
  bicaranya, seperti juru bahasa konsekutif.

Arah tiap baris ikut tercatat, jadi ekspor dan notulen tetap benar.

---

## Tab Performance (analitik kecepatan)

Di atas kartu-kartu Captions ada dua *child tab*: **Live** dan **Performance**.
Performance mencatat waktu tiap langkah pipeline secara otomatis — pengenalan
(ASR), draft helper, terjemahan (MT), refine — beserta mesin (helper native,
browser WebGPU, browser WASM), platform, pasangan bahasa, dan durasi audio.

- **KPI:** p50 ASR, p50 MT, RTF (waktu proses ÷ durasi audio; < 1 lebih cepat
  dari realtime), jumlah sampel.
- **Grafik:** p50 per pasangan bahasa (bar, dengan garis target 500 ms), latensi
  vs durasi audio (scatter per mesin), latensi sepanjang sampel (garis per mesin).
  Arahkan kursor ke tanda untuk nilai persisnya; tombol **Table** menampilkan
  angka yang sama sebagai tabel.
- **Filter:** tahap, pasangan bahasa, sumber (perangkat ini / bench lab / impor),
  dan chip mesin.
- **Float** melepaskan panel menjadi jendela mengapung yang bisa digeser (posisi
  diingat); **Dock** mengembalikannya.
- **Export report (JSON/Markdown)** menghasilkan laporan yang bisa Anda bagikan —
  misalnya untuk melaporkan kecepatan di Windows/Linux — dan **Import** membaca
  laporan dari mesin lain atau keluaran `scripts/bench-lab.py` untuk dibandingkan.

Semua sampel tersimpan lokal (`perfSamples`, maksimal 3000) dan bisa dihapus.

---

## Berkas audio / video (mode Offline)

1. Side Panel → **Source** → **Offline**.
2. Seret berkas ke area unggah, atau klik untuk memilih.
   Format: mp3, wav, m4a, mp4, webm, ogg.
3. Tekan **Start**. Kemajuan dan tombol **Batalkan** muncul selama proses.

Berkas besar (di atas ~1,5 GiB) dialirkan ke Native Helper sebagai job — panel
menampilkan progres unggah, transkripsi, dan finalisasinya. Berkas berjam-jam
diproses per jendela, jadi pemakaian memori tetap datar.

---

## Ekspor

Blok **Export subtitles** (di bawah kartu **History**) membuat berkas dari transkrip sesi:

| Format | Untuk apa |
| --- | --- |
| **SRT** | Semua pemutar, Premiere, unggah YouTube |
| **VTT** | Browser, `<track>`, unggah Teams/Zoom |
| **TXT** | Transkrip polos bertanda waktu |
| **MD** | Dokumen, notulen, dibagikan |
| **CSV** | Baris spreadsheet dengan durasi |
| **JSON** | Data lengkap untuk diimpor ulang |

Tiga sakelar di bawahnya menyesuaikan berkasnya dengan sistem operasi:

- **CRLF** — akhir baris Windows. Menyala otomatis di Windows; Notepad dan
  pemutar lama paling aman dengan ini.
- **BOM** — penanda UTF-8 di awal berkas, juga untuk Windows.
- **Language suffix** — menyisipkan pasangan bahasa ke nama berkas, misalnya
  `rapat.ja-en.srt`.

Tombol **Reset** mengembalikannya ke bawaan sistem operasi Anda. Ekspor
tersimpan ke folder Downloads, atau ke folder pilihan Anda lewat
**Save exports to folder**.

---

## Notulen rapat

Tab **Notes** mengubah transkrip menjadi notulen: ringkasan, keputusan, action
item beserta pemiliknya, pertanyaan terbuka, risiko, dan metrik.

- **End & draft** menutup sesi berjalan lalu menyusun notulennya.
- **Flag this moment** (⌘⇧F) menandai detik penting saat rapat berlangsung.
- **Paste a Teams transcript → minutes** menerima salinan transkrip Microsoft
  Teams apa adanya dan langsung mengubahnya menjadi notulen — berguna untuk
  rapat yang sudah terlanjur direkam Teams.
- **Open minutes register** membuka tabel lengkap di tab tersendiri, dengan
  jejak asal tiap butir dan dokumen MoM yang siap diterbitkan.
- **Project type** di kartu rekam menandai rapat (progres mingguan, K3, tinjauan
  desain, stand-up, sprint, penjualan, keuangan, hukum, pelatihan, riset,
  kesehatan, pendidikan, umum). Pilih **sebelum** menekan Start; register
  mengelompokkan pengalih rapat per tipe dan menyediakan filter tipe. Pilihan
  terakhir diingat untuk rapat berikutnya.
- **End & draft** kini menyusun draf notulen dari baris transkrip sesi itu
  sendiri (bukan hanya bendera), digabung dengan yang sudah Anda tandai.

### Pustaka contoh (Library)

Tombol **📚 Library** di register membuka 200+ transkrip contoh dari 13 bidang
(EPC/offshore, K3, tinjauan desain, klien, stand-up, sprint, penjualan,
keuangan, hukum, pelatihan, riset, rumah sakit, sekolah). Sebagian besar
berupa **seri mingguan** — butir terbuka minggu ini muncul lagi minggu depan.
Navigasi: bidang → seri → minggu (tombol Prev/Next), pratinjau transkrip, lalu
**Import whole series** atau **Import this week only**. Impor melewati pipeline
notulen yang sama dengan rekaman sungguhan.

### Latihan & gamifikasi (Training)

Tombol **🎓 Training** membuka panel kemajuan ala DCS_DocConSystem:

| Tab | Isi |
| --- | --- |
| **Progress** | Level & XP, skor pemahaman, rentetan harian, hitungan aktivitas |
| **Tours** | Tur terpandu **Watch** (otomatis) atau **Practise** (klik kontrol yang disorot): merekam, register, pustaka |
| **Quiz** | 5 pertanyaan dari rapat yang terbuka (siapa pemilik, tipe butir, jatuh tempo, …) |
| **Achievements** | 21 pencapaian, terbuka saat syaratnya tercapai |

XP diberikan sekali per kejadian: memulai/menyelesaikan tur, jawaban kuis benar,
menerima butir AI di register, menerbitkan MoM, mengimpor seri, dan aktivitas
harian. Semuanya tersimpan lokal di perangkat.


Semua tersimpan di `chrome.storage.local`; tidak ada audio, transkrip, atau teks
yang meninggalkan perangkat.

---

## Native Helper (opsional)

Helper lokal di `127.0.0.1:17865` memberi ASR lebih cepat, berkas besar, dan
terjemahan LLM lokal. Tanpa helper, ekstensi tetap jalan penuh di browser.

- Nyalakan lewat kartu **Native Helper** di Side Panel (**Start / Stop / Restart**).
- Kartu itu **terlipat secara bawaan** — klik judulnya untuk membuka; Install steps dan
  Troubleshooting di dalamnya juga terlipat sampai diklik.
- Kartu itu menampilkan mesin, model, perangkat (CPU/GPU), dan status bridge.
- **Panduan & diagnostik** di dalamnya memuat langkah pemasangan per sistem
  operasi dan pemeriksaan yang menunjuk langsung ke penyebab masalah.

Pemasangan lengkap: [`native/SETUP.md`](../native/SETUP.md).

---

## Privasi

- Pengenalan suara dan terjemahan berjalan di perangkat Anda.
- Tidak ada akun, tidak ada inferensi awan.
- Bobot model diunduh sekali dari sumber yang Anda pilih, lalu di-cache lokal.
- Native Helper hanya menerima koneksi dari mesin ini (loopback); situs web
  biasa ditolak.

---

## Kalau ada yang tidak beres

| Gejala | Yang biasanya terjadi |
| --- | --- |
| Tidak ada subtitel setelah Start | Model belum selesai diunduh — lihat kartu model di Settings |
| Unduhan model tertahan | Ganti **Download source** ke HF-Mirror, lalu ulangi |
| Tombol Start/Stop helper mati | Native Messaging Host belum terpasang — lihat `native/SETUP.md` |
| Subtitel tertinggal jauh | Turunkan **Speed vs accuracy** ke Fast, atau pakai Native Helper |
| Berkas >2 GiB gagal di browser | Nyalakan Native Helper; berkas sebesar itu diproses sebagai job |
| Ekspor terlihat kacau di Notepad | Nyalakan **CRLF** dan **BOM** di kartu Export |

Diagnostik yang lebih rinci ada di kartu **Native Helper → Panduan & diagnostik**.
