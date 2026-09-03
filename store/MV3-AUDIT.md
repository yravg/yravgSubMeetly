# Audit izin & kepatuhan Manifest V3

## Izin yang dipakai

| Permission | Alasan |
|---|---|
| `storage` / `unlimitedStorage` | Preferensi, riwayat, cache model |
| `tabCapture` | Audio tab untuk subtitel real-time |
| `offscreen` | Pipeline audio + VAD (SW tidak boleh audio) |
| `scripting` / host akses terbatas | Inject overlay content script |
| `sidePanel` | UI kontrol |
| `nativeMessaging` | Start/stop helper lokal (opsional) |

## Larangan yang dipatuhi
- Tidak memuat skrip remote (CDN) — ORT/VAD di-bundle.
- Tidak memakai `background.scripts` event pages lama — service worker MV3.
- Native helper hanya loopback `127.0.0.1`.
- Tidak ada remote code execution dari string.

## Catatan peninjauan toko
Jelaskan di listing bahwa audio tidak pernah meninggalkan perangkat kecuali unduhan bobot model yang dipicu pengguna.
