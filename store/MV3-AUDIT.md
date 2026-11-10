# Manifest V3 permission audit — yravgSubMeetly 1.1.1

Use these justifications in the Chrome Web Store “single purpose” / permission justification fields.

| Permission | Justification |
|---|---|
| `tabCapture` | Capture audio from the active tab the user starts captioning. |
| `desktopCapture` | Optional capture of another tab/window/screen when the user picks a non-current target. |
| `offscreen` | Audio + VAD pipeline (service workers cannot play/process media directly). |
| `storage` / `unlimitedStorage` | Preferences, transcript history, and on-device model/cache metadata. |
| `scripting` | Inject the Shadow DOM subtitle overlay into the captured page. |
| `host_permissions: <all_urls>` | Overlay injection must work on whatever HTTPS/HTTP page the user is watching; access is used for that feature path, not remote scraping. |
| `sidePanel` | Primary control UI (start/stop, languages, export, notes, helper status). |
| `activeTab` / `tabs` | Resolve the current tab title/URL for the Side Panel target card and capture targeting. |
| `contextMenus` | Optional right-click entry points into extension actions. |
| `nativeMessaging` | Optional start/stop of the local Native Helper (loopback ASR). |
| `downloads` (optional) | Not requested at install. Asked once, from a click, when the user exports from Ask Tide, so the file is saved with `chrome.downloads.download` and "Open" can show it in its folder with `chrome.downloads.show`. If declined, the export falls back to a normal browser download. |

## Policy compliance notes
- No remote script tags / CDN runtime — ORT and VAD ship in the package.
- Background is a MV3 service worker (`background.js`, `type: module`).
- Native helper binds to `127.0.0.1` only.
- First-run model downloads are user-triggered and documented in privacy + listing copy.

## Store review talking points
1. Audio and transcripts are not uploaded to a yravgSubMeetly backend.
2. “On-device” means inference after weights are local; HF/mirror downloads are explicit user actions.
3. `<all_urls>` exists so the overlay can attach to the media page being captioned.
