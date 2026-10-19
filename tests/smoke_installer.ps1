param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
# Run only on a disposable Windows runner: setup registers a synthetic extension ID.
$installRoot = Join-Path $env:RUNNER_TEMP 'VideoBridge installed test'
$downloads = Join-Path $env:RUNNER_TEMP 'VideoBridge downloads test'
$process = Start-Process -FilePath (Resolve-Path $Installer) -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installRoot`"") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
& (Join-Path $installRoot 'install.ps1') -ExtensionId ('a' * 32) -OutputDirectory $downloads
& (Join-Path $installRoot 'install.ps1') -ExtensionId ('b' * 32)
$config = Get-Content (Join-Path $installRoot 'native/config.json') | ConvertFrom-Json
if ($config.output -ne $downloads) { throw 'Reconnection changed the output directory.' }
$manifest = Get-Content (Join-Path $installRoot 'native/com.videobridge.downloader.json') | ConvertFrom-Json
if ($manifest.allowed_origins.Count -ne 2) { throw 'Reconnection lost a browser ID.' }
$registered = (Get-Item 'HKCU:/Software/Google/Chrome/NativeMessagingHosts/com.videobridge.downloader').GetValue('')
if ($registered -ne (Join-Path $installRoot 'native/com.videobridge.downloader.json')) { throw 'Native messaging registration failed.' }
$python = Join-Path $installRoot 'runtime/python/python.exe'
@'
import io, json, pathlib, struct, subprocess, sys
root = pathlib.Path(sys.executable).parents[2]
payload = json.dumps({'action': 'check'}).encode()
result = subprocess.run([sys.executable, str(root / 'native/host.py')], input=struct.pack('<I', len(payload)) + payload, capture_output=True, check=True, timeout=30)
size = struct.unpack('<I', result.stdout[:4])[0]
assert len(result.stdout) == size + 4, result.stdout
reply = json.loads(result.stdout[4:])
assert reply['status'] == 'ready', reply
assert (root / 'extension/manifest.json').is_file()
print('PASS: silent installer, bundled setup without system Python/Node, reconnect preservation, native helper framing/check')
'@ | & $python -
if ($LASTEXITCODE -ne 0) { throw 'Installed helper check failed.' }
& $python -m pip install --dry-run --no-index 'yt-dlp[default,curl-cffi]'
if ($LASTEXITCODE -ne 0) { throw 'Bundled downloader dependency/update check failed.' }
