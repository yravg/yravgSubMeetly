agent: pmm-lead (Opus 5.5, orchestrator, resumed session)
task: build PMM-001..027 on main (start HEAD 786aad0), island 1.2.9 -> 1.3.x
brief: docs/handoff/pill-media-meeting.md (status table, decisions, build notes); docs/roadmap/pill-media-meeting.md; docs/roadmap/caption-speed.md; canvas docs/design/pill-media-meeting-canvas/
worktree: E:\dev\yraverageSubMeetly
servers started: none (island 1.3.2 started via explorer.exe is the owner's installed app; leave it running)
unreverted change: none
not mine, never stage: .gitignore, CLAUDE.md, island/crates/poni/build.rs, scripts/*.bat, .ignore, engine-rs/engine/tests/zz_local_ics.rs, island/target/
workers: one Agent (sonnet, high) per step, checkpoint .checkpoints/pmm-<step>.md; 4.3 worker id a111592adc44025da (finished)
done:
  step 4.1 PMM-001 + PMM-024: c2f70e2, island 1.3.0
  step 4.2 PMM-004/014/017/018: cc286f5, island 1.3.1 (installed, confirmed)
  step 4.3 PMM-011/012/013: b18431d pushed, island 1.3.2 installed; poni 302/6 ignored, poni-core 544
  step 4.4 PMM-002/003/015: 0d8d466 pushed, island 1.3.3 installed; poni 303/6 ignored, poni-core 546; npm 687/673/2 fail (pre-existing: native-connection ping, web-host-captions; fail on HEAD engine-sync too)
  step 4.5 PMM-005..009 + 018 UI: e5471bd + 4e093a0 (lock) pushed, island 1.3.4 installed from D:\sm-dist (E: full); poni 304/6, poni-core 556
  model-catalog.md committed
  step 4.6 PMM-019/020/021: 75bca85 pushed, island 1.3.5 installed; poni 306/6, poni-core 563 (worker pmm-room finished)
  owner: remember Live source on restart -> 6162758 island 1.3.6 installed; room source enough
pushed / posted: model-catalog docs commit on origin/main
build recipe: PowerShell; RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc; CARGO_TARGET_DIR=E:\cargo-target\sm-calendar; TMP/TEMP=E:\orca\tmp\rusttmp; cargo test -p poni -p poni-core; cargo build --release -p poni; bump island/Cargo.toml + installer/yravgsubmeetly.iss (sed 1.3.x); engine exe = copy of installed one to E:\orca\tmp\rusttmp; ISCC "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" /Q /DAppVersion=X /DExeSource=E:\cargo-target\sm-calendar\release\poni.exe /DEngineSource=E:\orca\tmp\rusttmp\submeetly-engine.exe installer\yravgsubmeetly.iss; install Start-Process -Wait ... /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /LOG=... (first try may exit 1 while app runs: rerun); check HKCU Uninstall DisplayVersion; start explorer.exe <exe>
env for JS tests: python3.exe shim + PYTHONHOME=C:/Program Files/Python311; npm from PowerShell
rule (pass to every worker): no media URL via default browser/start/explorer/Start-Process/default Chrome profile (IDM); local files in-process (MediaPlayer, ffplay -nodisp, SAPI); browser tests only headless puppeteer Chrome for Testing
workers running: pmm-minutes (step 4.8, island, D:\cargo-target\pmm-minutes, ckpt .checkpoints/pmm-minutes.md); pmm-speed (step 4.7 engine half, engine-rs, D:\cargo-target\pmm-speed, port 17899, ckpt .checkpoints/pmm-speed.md)
build recipe change: E: full -> CARGO_TARGET_DIR on D:, installer /OD:\sm-dist
next: review + commit each worker's result; then 4.7 island half (interim text, PMM-026 options), 4.8
