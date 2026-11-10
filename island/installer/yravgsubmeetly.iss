; yravgSubMeetly installer (Inno Setup 6.5+, for the PNG wizard images).
;
; Structure follows Oyenza Studio's installer/poni.iss (MIT, see LICENSE and
; THIRD-PARTY-NOTICES.txt); the art, texts, native-host and engine parts are ours.
;
; Build with tools\build-installer.ps1 (builds poni.exe and submeetly-engine.exe, then
; runs ISCC with the right paths and version), or by hand:
;   iscc /DAppVersion=1.2.9 /DExeSource=...\poni.exe /DEngineSource=...\submeetly-engine.exe installer\yravgsubmeetly.iss
;   -> dist\yravgSubMeetly-Setup-1.2.9.exe   (the name tools/make_update_feed.py looks for)
;
; Per-user install: no admin rights, no UAC prompt. The app goes to
; %LOCALAPPDATA%\Programs\yravgSubMeetly. The person's own data stays when uninstalling:
; settings and data in %APPDATA%\yravgSubMeetly, the helper's notes and state in
; %USERPROFILE%\.yraveragesubmin. Only the cache and log in %LOCALAPPDATA%\yravgSubMeetly are removed.
;
; Silent update (what the app's Install runs, services/feed.rs setup_command):
;   Setup /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /reopen
; keeps "Start with Windows" and the Chrome extension ID as they were, and starts the new
; version when done (/reopen).

#ifndef AppVersion
  #define AppVersion "1.2.9"
#endif
#ifndef ExeSource
  #define ExeSource "..\target\release\poni.exe"
#endif
#ifndef ExtensionSource
  #define ExtensionSource "..\..\dist"
#endif
#ifndef EngineSource
  #define EngineSource "..\..\engine-rs\target\release\submeetly-engine.exe"
#endif
#define AppName "yravgSubMeetly"
#define AppDir "yravgSubMeetly"
#define AppPublisher "yraverage"
#define AppExe "yravgSubMeetly.exe"
#define EngineExe "submeetly-engine.exe"
; The island window's class (crates/poni/src/window.rs), used to ask a running copy to quit.
#define IslandClass "yravgSubMeetly.Island"
; The Native Messaging host the Chrome extension talks to (engine-rs native_host.rs, native/install-host.bat).
#define HostName "com.yraveragesubmin.helper"
; The extension ID every unpacked load of {app}\extension gets (the manifest "key" in src/manifest.json).
#define FixedExtId "llhpkcjflnepbpgldhbceifjbjgcbapi"

[Setup]
; Never change the AppId: upgrades and the uninstaller find the install by it.
AppId={{6F263CE0-5476-4A84-893C-B86D7E4BCE23}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright=Copyright (C) 2026 {#AppPublisher}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup
VersionInfoProductName={#AppName}
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\{#AppDir}
DisableDirPage=yes
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
SetupIconFile=art\yravgsubmeetly.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
; Our wordmark and tokens (installer/make_art.py). Setup picks the file closest to its image area.
WizardImageFile=art\wizard.png,art\wizard-150.png,art\wizard-200.png
WizardSmallImageFile=art\wizard-small-55.png,art\wizard-small-83.png,art\wizard-small-110.png
Compression=lzma2/max
SolidCompression=yes
; A running copy is asked to quit in PrepareToInstall; Restart Manager is the safety net.
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "Start with Windows"; GroupDescription: "Startup:"

[Files]
Source: "{#ExeSource}"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion
Source: "{#EngineSource}"; DestDir: "{app}"; Flags: ignoreversion
Source: "submeetly-host.bat"; DestDir: "{app}"; Flags: ignoreversion
; The built extension, loaded unpacked from here (Chrome: chrome://extensions > Load unpacked). The engine also
; serves its pages at /app/<file>, so the Minutes register opens without the extension.
Source: "{#ExtensionSource}\*"; DestDir: "{app}\extension"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
; Add-on data the island installs from here, offline, before it ever downloads (services/addons.rs bundle_dir):
; {app}\addons\<id>\<name>, checked there against the SHA-256 built into the app, so a changed file is ignored.
; Prayer times and Japanese readings carry their data. The Downloader carries only its notice: yt-dlp,
; QuickJS and FFmpeg download from their own official releases on first use.
Source: "..\addons\sholat\places.json"; DestDir: "{app}\addons\sholat"; Flags: ignoreversion
Source: "..\addons\sholat\adzan.m4a"; DestDir: "{app}\addons\sholat"; Flags: ignoreversion
Source: "..\addons\sholat\NOTICE.txt"; DestDir: "{app}\addons\sholat"; Flags: ignoreversion
Source: "..\crates\poni-core\data\ja-readings.dic.zst"; DestDir: "{app}\addons\ja"; Flags: ignoreversion
Source: "..\addons\ja\NOTICE.txt"; DestDir: "{app}\addons\ja"; Flags: ignoreversion
Source: "..\addons\downloader\NOTICE.txt"; DestDir: "{app}\addons\downloader"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; Comment: "Live transcription and minutes at the edge of your screen"
Name: "{autoprograms}\Open {#AppName} (full app)"; Filename: "{app}\{#AppExe}"; Parameters: "--open app"; Comment: "Today, live captions, minutes, history, files and settings in a window of their own"
Name: "{autoprograms}\{#AppName} Minutes register"; Filename: "{app}\{#AppExe}"; Parameters: "--open minutes"; Comment: "Meeting minutes in a window of their own"
Name: "{autoprograms}\Set up the {#AppName} Chrome extension"; Filename: "{app}\{#AppExe}"; Parameters: "--open setup-extension"; Comment: "Load the extension in Chrome, step by step"
Name: "{autoprograms}\{#AppName} engine"; Filename: "{app}\{#EngineExe}"; Comment: "The local transcription helper the Chrome extension talks to"

[Registry]
; Same value the app writes from its "Start with Windows" menu item (autostart.rs): the quoted exe path.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExe}"""; Flags: uninsdeletevalue; Tasks: autostart
; Native Messaging host for the Chrome extension: Chrome, Edge and Chromium find it by these keys
; (same keys native/install-host.bat writes). Always: the extension ID is fixed (see FixedExtId).
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Chromium\NativeMessagingHosts\{#HostName}"; ValueType: string; ValueName: ""; ValueData: "{app}\{#HostName}.json"; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent
; The app's own update: Setup runs silently and the new version opens when it is done.
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: ReopenRequested

[UninstallRun]
; Make sure no copy is still running before its files are removed.
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#AppExe} /F"; Flags: runhidden waituntilterminated; RunOnceId: "StopIsland"
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#EngineExe} /F"; Flags: runhidden waituntilterminated; RunOnceId: "StopEngine"

[UninstallDelete]
; The host manifest Setup wrote.
Type: files; Name: "{app}\{#HostName}.json"
; Cache and log only (poni.log, downloaded updates); settings and data in %APPDATA%\yravgSubMeetly and the
; helper's notes in %USERPROFILE%\.yraveragesubmin are kept.
Type: filesandordirs; Name: "{localappdata}\yravgSubMeetly"

[Code]
const
  RunKey = 'Software\Microsoft\Windows\CurrentVersion\Run';
  WM_CLOSE = $0010;

{ Dir, not the app constant: the wizard reads the old manifest before the app constant exists. }
function ManifestPath(Dir: String): String;
begin
  Result := AddBackslash(Dir) + '{#HostName}.json';
end;

{ The first extension ID other than the fixed one that a previous install wrote into the host manifest, so an
  update (silent or not) keeps it. }
function ExistingExtensionId(): String;
var
  Json: AnsiString;
  P: Integer;
  S, Id: String;
begin
  Result := '';
  if not LoadStringFromFile(ManifestPath(WizardDirValue()), Json) then
    Exit;
  S := String(Json);
  P := Pos('chrome-extension://', S);
  while (P > 0) and (Result = '') do
  begin
    Id := Copy(S, P + Length('chrome-extension://'), 32);
    if Id <> '{#FixedExtId}' then
      Result := Id;
    Delete(S, 1, P + 18);
    P := Pos('chrome-extension://', S);
  end;
end;

{ Chrome extension IDs are 32 letters a-p. }
function IsExtensionId(S: String): Boolean;
var
  I: Integer;
begin
  Result := Length(S) = 32;
  for I := 1 to Length(S) do
    if (S[I] < 'a') or (S[I] > 'p') then
      Result := False;
end;

{ An ID of another build (a Web Store copy): /EXTID=<id> wins, else the one a previous install kept. It is allowed
  next to the fixed ID, never instead of it. }
function OtherExtensionId(): String;
begin
  Result := Trim(ExpandConstant('{param:EXTID|}'));
  if not IsExtensionId(Result) then
    Result := ExistingExtensionId();
  if (not IsExtensionId(Result)) or (Result = '{#FixedExtId}') then
    Result := '';
end;

function ReopenRequested(): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/reopen') = 0 then
      Result := True;
end;

{ Ask a running island to quit (it saves its data on the way out); force it if it doesn't within 3 s. }
procedure StopIsland();
var
  I, ResultCode: Integer;
begin
  if FindWindowByClassName('{#IslandClass}') <> 0 then
  begin
    PostMessage(FindWindowByClassName('{#IslandClass}'), WM_CLOSE, 0, 0);
    for I := 1 to 30 do
    begin
      if FindWindowByClassName('{#IslandClass}') = 0 then
        Break;
      Sleep(100);
    end;
    if FindWindowByClassName('{#IslandClass}') <> 0 then
      Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#AppExe} /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  { The engine holds its own exe open; stop it so Setup can replace it. }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#EngineExe} /F', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopIsland();
  Result := '';
end;

procedure WriteHostManifest();
var
  Wrapper, Json, Other: String;
begin
  Other := OtherExtensionId();
  if Other <> '' then
    Other := ',' + #13#10 + '    "chrome-extension://' + Other + '/"';
  Wrapper := ExpandConstant('{app}\submeetly-host.bat');
  StringChangeEx(Wrapper, '\', '\\', True);
  { Same content native/install-host.bat writes, pointing at this install's launcher. }
  Json := '{' + #13#10 +
    '  "name": "{#HostName}",' + #13#10 +
    '  "description": "yravgSubMeetly native helper launcher",' + #13#10 +
    '  "path": "' + Wrapper + '",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_origins": [' + #13#10 +
    '    "chrome-extension://{#FixedExtId}/"' + Other + #13#10 +
    '  ]' + #13#10 + '}' + #13#10;
  SaveStringToFile(ManifestPath(ExpandConstant('{app}')), AnsiString(Json), False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteHostManifest();
    { Unticking "Start with Windows" on a reinstall turns it off, even if the app's menu turned it on.
      A silent update has no ticks to read: it leaves the value as the person set it. }
    if (not WizardSilent) and (not WizardIsTaskSelected('autostart')) then
      RegDeleteValue(HKEY_CURRENT_USER, RunKey, '{#AppName}');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  { Runs before [UninstallRun], so a running copy gets the chance to save and quit cleanly. }
  if CurUninstallStep = usUninstall then
    StopIsland();
  { The app may have written the Run value itself; never leave it pointing at a removed exe. }
  if CurUninstallStep = usPostUninstall then
    RegDeleteValue(HKEY_CURRENT_USER, RunKey, '{#AppName}');
end;
