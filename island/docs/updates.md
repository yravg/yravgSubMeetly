# Installer and updates

yravgSubMeetly installs with one Setup and learns about new versions from one signed file. Structure follows Oyenza Studio's installer and update file (MIT, see `LICENSE` and `THIRD-PARTY-NOTICES.txt`); the keys, the repository, the art and the installer script are ours.

## The pieces

| What | Where |
|---|---|
| Installer script (Inno Setup 6.5) | `installer/yravgsubmeetly.iss`, art by `installer/make_art.py` |
| Build the Setup | `tools/build-installer.ps1` -> `dist/yravgSubMeetly-Setup-<version>.exe` (git-ignored) |
| Make and sign the update file | `tools/make_update_feed.py` |
| Public keys the app trusts | `crates/poni-core/data/update-keys.txt` |
| Release repository (one constant) | `poni_core::update::REPO` = `yravg/yravgSubMeetly` |
| Mac app bundle and DMG | `tools/make_mac_app.sh` (+ `make_mac_dmg.sh`, `make_mac_icon.py`, `installer/mac/Info.plist`) -> `dist/yravgSubMeetly-<version>-mac.dmg` |
| Mac update self-test | `tools/mac-update-test.sh` (an installed copy swaps in a newer one) |
| Release workflow | `.github/workflows/release.yml`: `windows` and `mac` build in parallel, `publish` releases both and signs `latest.json` |

## The installer

Per user, no admin, no UAC. It installs into `%LOCALAPPDATA%\Programs\yravgSubMeetly`:
`poni.exe` (the island), `submeetly-engine.exe` (the local helper), `submeetly-host.bat` (what Chrome starts for Native Messaging), `extension\` (the built Chrome extension, loaded unpacked), the licence files.

- **Start menu:** the app, the Minutes register (`--open minutes`), "Set up the Chrome extension" (`--open setup-extension`) and the engine. The island starts the engine itself when nothing answers; the engine serves the extension pages at `http://127.0.0.1:17865/app/<file>`.
- **Start with Windows:** an optional task, off by default (`HKCU\...\Run\yravgSubMeetly`).
- **Native Messaging host `com.yraveragesubmin.helper`:** written under `HKCU\Software\{Google\Chrome,Microsoft\Edge,Chromium}\NativeMessagingHosts`, the same manifest `native/install-host.bat` writes. The extension ID is fixed (`llhpkcjflnepbpgldhbceifjbjgcbapi`, the manifest `key`), so the host is always registered with it in `allowed_origins`. `/EXTID=<id>` (or an ID kept from an earlier install) is allowed next to it, for a Web Store copy. There is no ID page in the wizard.
- **Uninstall** removes the program, the Run value, the host keys and the cache in `%LOCALAPPDATA%\Poni`. It keeps `%APPDATA%\Poni` and `~/.yraveragesubmin` (settings, minutes, notes).
- **Silent update** (what the app's Install runs): `Setup /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /reopen`. A running copy is closed first, Start with Windows stays as the person set it, `/reopen` starts the new version. Inno does not read NSIS's `/S`.
- Never change the `AppId` in the `.iss`: upgrades and the uninstaller find the install by it.

## The update file

`latest.json` is an asset of every release, so `https://github.com/yravg/yravgSubMeetly/releases/latest/download/latest.json` always answers with the newest.

```json
{ "about": "...", "payload": "{\"schema\":1,\"version\":\"1.2.1\",...}", "signature": "base64 of r and s, 64 bytes", "key": "ad662e29df0544ce" }
```

`payload` is JSON kept as a string so its exact bytes are the ones signed: `version`, `date`, `headline`, `notes` (release page) and `windows` with `url`, `size`, `sha256` of `yravgSubMeetly-Setup-<version>.exe`. The signature is ECDSA P-256 over the SHA-256 of the payload's UTF-8 bytes. `key` is the first 16 hex digits of the SHA-256 of the public point.

The app refuses the file when the signature fails, when `key` is not in `update-keys.txt`, or when any URL is outside `github.com/yravg/yravgSubMeetly/releases/download/v<version>/` (or the release page `tag/v<version>`). It then downloads the Setup, keeps it only if size and SHA-256 match, and shows the pop-up.

## What the person sees

About two minutes after start, then hourly, the app reads the file. A later version shows on the island as **Update available x** over the release headline, with **Hide**. A click opens the Update sheet: what is new, **Install now**, **Install on next start**, **Not now**, and the release-notes link. Install now runs the downloaded Setup silently and the new version opens.

## Owner steps

State 2026-11-11: the repository is public, the `release` environment exists (deployment limited to `v*` tags) and holds `UPDATE_FEED_KEY`; the spare key is made and listed in `update-keys.txt`. No release has been published yet; the first tag is the workflow's first real run.

1. **Repository public (done).** The app downloads without a token.
2. **Keys (done).** Signing key: private half at `%USERPROFILE%\.yravg\update-feed-key.pem` and in the `UPDATE_FEED_KEY` secret. Spare key `5693fbeec7bd596f`: private half written to `%USERPROFILE%\.yravg\update-feed-key-spare-OFFLINE.pem`; move it to offline storage (a USB stick kept apart) and delete it from the PC. Never print or commit either.
3. **Release.** Bump `version` in `island/Cargo.toml`, commit, then `git tag v<version>` and `git push origin v<version>`. `release.yml` checks the tag matches `Cargo.toml` and builds the Windows Setup and the Mac DMG (both Apple Silicon and Intel, one universal app); only when both pass does `publish` create the release with both files, sign `latest.json` (which then carries a `windows` and a `mac` entry) and attach it. Before the first tag, read the workflow once.
4. **Offline signing** (no secret in CI): `python tools/make_update_feed.py --check` prints the payload; save it, then `python tools/make_update_feed.py latest.json --payload payload.json` signs it with the key file, and you upload `latest.json` by hand.
5. **Taking a release back:** mark the previous release as latest; the file follows GitHub's latest.

## Try the pop-up without GitHub

Debug builds only: set `YRAVG_UPDATE_BASE=http://127.0.0.1:PORT` (and `PONI_HOME=<empty folder>` so the real settings stay untouched). The feed is read from `<base>/latest.json` and the Setup from `<base>/download/v<version>/<file>`. The signature is still checked, so sign a payload with `--payload`. Release builds ignore the variable.

## Checks

`cargo test -p poni-core` runs `tests/update_feed.rs`: a signed file is believed, a changed file refused, an unlisted key refused, a feed outside the repo refused, and the exact Install command. (`cargo test -p poni` itself does not build on this branch's base; that is older than this work.)

## The Mac app

`tools/make_mac_app.sh` makes `yravgSubMeetly.app` (bundle id `com.yraverage.submeetly`, fixed: the updater refuses another) from the arm64 and x86_64 binaries, signs it ad hoc and wraps it in `yravgSubMeetly-<version>-mac.dmg`. Without an Apple Developer ID the first open needs System Settings > Privacy & Security > **Open Anyway** (the DMG says so in `READ ME FIRST.txt`). The updater's own checks (bundle id, version, `codesign --verify --deep --strict`) pass with an ad-hoc signature, and the app replaces itself in place: the new app is taken out of the DMG, swapped into the old one's place, and opened.

When an Apple Developer ID exists: sign with `--options runtime --entitlements installer/mac/poni.entitlements`, notarize the DMG (`xcrun notarytool submit ... --wait`), staple it, and keep the same team on every release (the updater refuses a different team).

Locally: `cargo build -p poni --release --target aarch64-apple-darwin` (and `x86_64-apple-darwin`), `python3 tools/make_mac_icon.py build/y.iconset && iconutil -c icns build/y.iconset -o build/yravgSubMeetly.icns`, then `tools/make_mac_app.sh <arm64> <x86_64> build/yravgSubMeetly.icns dist` and `bash tools/mac-update-test.sh dist/yravgSubMeetly.app`.
