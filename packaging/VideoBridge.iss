#ifndef AppVersion
  #error AppVersion must be supplied by the release build
#endif
#ifndef SourceRoot
  #error SourceRoot must be supplied by the release build
#endif
#ifndef OutputRoot
  #error OutputRoot must be supplied by the release build
#endif

[Setup]
AppId={{72301994-3992-4969-AEBF-A481C968861E}
AppName=VideoBridge
AppVersion={#AppVersion}
AppPublisher=VideoBridge
AppPublisherURL=https://github.com/addy1243/Video-Bridge
DefaultDirName={localappdata}\Programs\VideoBridge
DefaultGroupName=VideoBridge
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputRoot}
OutputBaseFilename=VideoBridge-{#AppVersion}-Setup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=no
RestartApplications=no
Uninstallable=no
SetupLogging=yes
SetupMutex=VideoBridgeSetup

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Connect VideoBridge to browser"; Filename: "{app}\Connect-browser.cmd"
Name: "{group}\VideoBridge extension folder"; Filename: "{app}\extension"

[Run]
Filename: "{app}\Connect-browser.cmd"; Description: "Connect the extension to Chrome or Edge"; Flags: postinstall shellexec skipifsilent
