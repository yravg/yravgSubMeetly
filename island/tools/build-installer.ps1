# Builds dist\yravgSubMeetly-Setup-<version>.exe: poni.exe, submeetly-engine.exe, then Inno Setup 6.
# Usage (from anywhere): powershell -File island\tools\build-installer.ps1 [-Target E:\cargo-target\x]
# The version comes from island\Cargo.toml. Nothing is signed or published here.
param([string]$Target = $(if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $PSScriptRoot '..\target' }))
$ErrorActionPreference = 'Stop'
$island = Resolve-Path (Join-Path $PSScriptRoot '..')
$root = Resolve-Path (Join-Path $island '..')
$version = (Select-String -Path (Join-Path $island 'Cargo.toml') -Pattern '^version = "([0-9.]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
$env:CARGO_TARGET_DIR = $Target
Push-Location $island; cargo build -p poni --release; if ($LASTEXITCODE) { throw 'poni build failed' }; Pop-Location
Push-Location (Join-Path $root 'engine-rs'); cargo build -p submeetly-engine --release; if ($LASTEXITCODE) { throw 'engine build failed' }; Pop-Location
Push-Location $root; npm run build; if ($LASTEXITCODE) { throw 'extension build failed' }; Pop-Location
# The add-on data the installer carries (installer\yravgsubmeetly.iss): present, and the very bytes the app pins.
# A file that doesn't match its pin is ignored by the app, which then tries the download, so fail here instead.
Push-Location $island; cargo test -p poni-core addons --release; if ($LASTEXITCODE) { throw 'add-on files do not match their pins' }; Pop-Location
foreach ($f in 'addons\sholat\places.json', 'addons\sholat\adzan.m4a', 'addons\sholat\NOTICE.txt', 'addons\ja\NOTICE.txt', 'addons\downloader\NOTICE.txt', 'crates\poni-core\data\ja-readings.dic.zst') {
  if (-not (Test-Path (Join-Path $island $f))) { throw "missing add-on file for the installer: $f" }
}
$iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
& $iscc "/DAppVersion=$version" "/DExeSource=$Target\release\poni.exe" "/DEngineSource=$Target\release\submeetly-engine.exe" "/DExtensionSource=$root\dist" (Join-Path $island 'installer\yravgsubmeetly.iss')
if ($LASTEXITCODE) { throw 'ISCC failed' }
$setup = Join-Path $island "dist\yravgSubMeetly-Setup-$version.exe"
'{0}  {1:N1} MB  sha256 {2}' -f $setup, ((Get-Item $setup).Length / 1MB), (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
