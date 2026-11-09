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
| Release workflow (draft) | `.github/workflows/release.yml` |

## The installer

Per user, no admin, no UAC. It installs into `%LOCALAPPDATA%\Programs\yravgSubMeetly`:
`poni.exe` (the island), `submeetly-engine.exe` (the local helper), `submeetly-host.bat` (what Chrome starts for Native Messaging), the licence files.

- **Start menu:** the app and the engine.
- **Start with Windows:** an optional task, off by default (`HKCU\...\Run\yravgSubMeetly`).
- **Native Messaging host `com.yraveragesubmin.helper`:** written under `HKCU\Software\{Google\Chrome,Microsoft\Edge,Chromium}\NativeMessagingHosts`, the same manifest `native/install-host.bat` writes. Chrome needs the extension's ID in `allowed_origins`, so the wizard asks for it (32 letters a-p) and prefills it from the manifest already there, which is why silent updates keep it. Left empty, no host is registered.
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

State 2026-11-08: the `release` environment exists (deployment limited to `v*` tags) and holds `UPDATE_FEED_KEY`; the spare key is made and listed in `update-keys.txt`. Still open: steps 1 and 3.

1. **Make the repository public.** The app downloads without a token, so `yravg/yravgSubMeetly` must be public. Until then a check says it could not read the file; nothing breaks. `gh repo edit yravg/yravgSubMeetly --visibility public --accept-visibility-change-consequences`
2. **Keys (done).** Signing key: private half at `%USERPROFILE%\.yravg\update-feed-key.pem` and in the `UPDATE_FEED_KEY` secret. Spare key `5693fbeec7bd596f`: private half written to `%USERPROFILE%\.yravg\update-feed-key-spare-OFFLINE.pem`; move it to offline storage (a USB stick kept apart) and delete it from the PC. Never print or commit either.
3. **Release.** Bump `version` in `island/Cargo.toml`, commit, then `git tag v<version>` and `git push origin v<version>`. `release.yml` checks the tag matches `Cargo.toml`, runs `cargo test -p poni-core`, builds the Setup, publishes the release, signs `latest.json` and attaches it. It is a draft: read it once before the first tag.
4. **Offline signing** (no secret in CI): `python tools/make_update_feed.py --check` prints the payload; save it, then `python tools/make_update_feed.py latest.json --payload payload.json` signs it with the key file, and you upload `latest.json` by hand.
5. **Taking a release back:** mark the previous release as latest; the file follows GitHub's latest.

## Try the pop-up without GitHub

Debug builds only: set `YRAVG_UPDATE_BASE=http://127.0.0.1:PORT` (and `PONI_HOME=<empty folder>` so the real settings stay untouched). The feed is read from `<base>/latest.json` and the Setup from `<base>/download/v<version>/<file>`. The signature is still checked, so sign a payload with `--payload`. Release builds ignore the variable.

## Checks

`cargo test -p poni-core` runs `tests/update_feed.rs`: a signed file is believed, a changed file refused, an unlisted key refused, a feed outside the repo refused, and the exact Install command. (`cargo test -p poni` itself does not build on this branch's base; that is older than this work.)
