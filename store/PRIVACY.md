# Privacy Policy — Local TransSub

**Effective:** 3 September 2026  
**Product:** Local TransSub (Chrome MV3 extension, optional Native Helper, optional macOS app)

## Summary
Local TransSub does **not** collect, sell, or upload your audio, transcripts, or personal content to servers we operate. Speech recognition and translation run **on your device** after any required model files are present locally.

## Data processed on device
- **Tab / file / microphone / screen audio** you explicitly start capturing — processed in the browser (WASM/WebGPU) and/or an optional Native Helper bound to `127.0.0.1`, or the macOS app.
- **Transcripts & subtitles** — may be kept in `chrome.storage`, Origin Private File System (OPFS), or local app storage if you use history/export features.
- **Preferences** — language, engine, font size, and similar settings stored locally.

## Network activity that is not “our cloud”
- **Model weight downloads** you trigger (for example from Hugging Face or a mirror you select) land in a local cache; they are not our inference API.
- **Chrome Translator** language packs (when you use that path) are fetched by the browser from Google’s on-device translation infrastructure, not by a Local TransSub backend.
- We do **not** send audio or transcript text to a Local TransSub server for recognition or translation.

## What we do not do
- No user accounts for the extension.
- No analytics telemetry or advertising trackers from this extension.
- No remote code loading from CDNs for the packaged extension runtime (ORT/VAD assets ship inside the package).

## Extension permissions
Permissions such as `tabCapture`, `desktopCapture`, `storage` / `unlimitedStorage`, `offscreen`, `scripting`, `sidePanel`, `tabs` / `activeTab`, `contextMenus`, `nativeMessaging`, and host access needed to inject the overlay on the page you are captioning exist only to implement those features. They are not used to scrape unrelated browsing for a remote service.

## Native Helper
The optional helper listens on **loopback only** (`127.0.0.1`). It does not open a public internet port. First-time helper model installs may download weights to local disk.

## Contact
For privacy questions about this open-source project, open an issue on the source repository you obtained the extension from.

## Changes
Material updates to this policy will be noted in the product changelog / store listing.
