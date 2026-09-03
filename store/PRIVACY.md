# Kebijakan Privasi — Local TransSub

**Berlaku sejak:** 3 September 2026  
**Produk:** Local TransSub (ekstensi Chrome MV3, Native Helper opsional, aplikasi macOS)

## Ringkasan
Local TransSub **tidak mengumpulkan**, **tidak menjual**, dan **tidak mengunggah** audio, transkrip, atau data pribadi ke server cloud milik kami. Semua pengenalan suara dan terjemahan berjalan **di perangkat Anda**.

## Data yang diproses
- **Audio tab / berkas / mikrofon** — diproses lokal di browser (WASM/WebGPU) atau Native Helper (`127.0.0.1`) / aplikasi macOS.
- **Transkrip & subtitel** — disimpan opsional di `chrome.storage`, OPFS, atau penyimpanan lokal aplikasi.
- **Preferensi** — bahasa, mesin, ukuran font, dll. disimpan lokal.

## Yang tidak kami lakukan
- Tidak ada akun pengguna.
- Tidak ada telemetri analitik atau pelacakan iklan.
- Tidak ada pengiriman audio/teks ke layanan pihak ketiga untuk inferensi (kecuali Anda sendiri mengunduh bobot model dari sumber yang Anda pilih, misalnya Hugging Face, ke cache lokal).

## Izin ekstensi
Izin Manifest V3 (tabCapture, storage, offscreen, dll.) dipakai semata untuk menangkap audio tab yang Anda mulai, menampilkan overlay, dan menyimpan preferensi — bukan untuk menjangkau situs arbitrary di luar alur fitur.

## Native Helper
Helper opsional mendengarkan **hanya** di `127.0.0.1` (loopback). Tidak membuka port publik.

## Kontak
Untuk pertanyaan privasi terkait proyek open-source ini, buka isu di repositori sumber Anda.

## Perubahan
Versi kebijakan ini dapat diperbarui bersama rilis aplikasi; perubahan material akan dicantumkan di riwayat rilis.
