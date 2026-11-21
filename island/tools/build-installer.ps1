# Builds dist\Kasi-Setup-<version>.exe: poni.exe, submeetly-engine.exe, then Inno Setup 6.
# Usage (from anywhere): powershell -File island\tools\build-installer.ps1 [-Target E:\cargo-target\x]
# The version comes from island\Cargo.toml. Nothing is signed or published here.
param([string]$Target = $(if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $PSScriptRoot '..\target' }))
$ErrorActionPreference = 'Stop'
$island = Resolve-Path (Join-Path $PSScriptRoot '..')
$root = Resolve-Path (Join-Path $island '..')
$version = (Select-String -Path (Join-Path $island 'Cargo.toml') -Pattern '^version = "([0-9.]+)"' | Select-Object -First 1).Matches[0].Groups[1].Value
$env:CARGO_TARGET_DIR = $Target
Push-Location $island; cargo build -p poni --release; if ($LASTEXITCODE) { throw 'poni build failed' }; Pop-Location
# The engine's GPU speech (whisper.cpp + Vulkan) needs the Vulkan SDK, CMake and libclang to build; the PC
# that runs it needs none of them (vulkan-1.dll ships in the installer).
# whisper.cpp's Vulkan shader tool builds in folders that pass Windows' 260-character path limit (MSBuild
# cannot write its logs there) when the target folder is longer than 22 characters.
if ($Target.Length -gt 22) { throw "target folder too long for the whisper.cpp build ($($Target.Length) > 22 characters): use -Target E:\cargo-target\rel" }
if (-not $env:VULKAN_SDK) { throw 'VULKAN_SDK is not set: winget install KhronosGroup.VulkanSDK' }
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
  $vsCmake = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin'
  if (-not (Test-Path $vsCmake)) { throw 'cmake not found: install CMake or the VS Build Tools CMake component' }
  $env:PATH = "$vsCmake;$env:PATH"
}
if (-not $env:LIBCLANG_PATH -and -not (Get-Command clang -ErrorAction SilentlyContinue)) { throw 'libclang not found: set LIBCLANG_PATH (winget install LLVM.LLVM)' }
Push-Location (Join-Path $root 'engine-rs'); cargo build -p submeetly-engine --release --features vulkan; if ($LASTEXITCODE) { throw 'engine build failed' }; Pop-Location
Push-Location $root; npm run build; if ($LASTEXITCODE) { throw 'extension build failed' }; Pop-Location
# The add-on data the installer carries (installer\yravgsubmeetly.iss): present, and the very bytes the app pins.
# A file that doesn't match its pin is ignored by the app, which then tries the download, so fail here instead.
Push-Location $island; cargo test -p poni-core addons --release; if ($LASTEXITCODE) { throw 'add-on files do not match their pins' }; Pop-Location
foreach ($f in 'addons\sholat\places.json', 'addons\sholat\adzan.m4a', 'addons\sholat\NOTICE.txt', 'addons\ja\NOTICE.txt', 'addons\downloader\NOTICE.txt', 'crates\poni-core\data\ja-readings.dic.zst') {
  if (-not (Test-Path (Join-Path $island $f))) { throw "missing add-on file for the installer: $f" }
}
# Copied out first: ISCC is 32-bit, and System32 read from a 32-bit process is SysWOW64 (the 32-bit loader).
Copy-Item "$env:SystemRoot\System32\vulkan-1.dll" "$Target\vulkan-1.dll" -Force
$iscc = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe'
& $iscc "/DAppVersion=$version" "/DExeSource=$Target\release\poni.exe" "/DEngineSource=$Target\release\submeetly-engine.exe" "/DVulkanLoader=$Target\vulkan-1.dll" "/DExtensionSource=$root\dist" (Join-Path $island 'installer\yravgsubmeetly.iss')
if ($LASTEXITCODE) { throw 'ISCC failed' }
$setup = Join-Path $island "dist\Kasi-Setup-$version.exe"
'{0}  {1:N1} MB  sha256 {2}' -f $setup, ((Get-Item $setup).Length / 1MB), (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
