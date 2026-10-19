param(
    [ValidatePattern('^[a-p]{32}$')]
    [string[]]$ExtensionId,
    [string]$OutputDirectory = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nativeRoot = Join-Path $projectRoot 'native'
$manifestPath = Join-Path $nativeRoot 'com.videobridge.downloader.json'
$configPath = Join-Path $nativeRoot 'config.json'
$savedIds = @()
if (Test-Path -LiteralPath $manifestPath) {
    $previousManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $savedIds = @($previousManifest.allowed_origins | ForEach-Object {
        if ($_ -match '^chrome-extension://([a-p]{32})/$') { $Matches[1] }
    })
}
if (-not $ExtensionId -and -not $savedIds) {
    Write-Host 'Load the extension first, then copy its ID from the VideoBridge popup or extensions page.'
    $ExtensionId = @((Read-Host 'Paste the extension ID').Trim())
}
$ExtensionId = @(@($savedIds) + @($ExtensionId) | Where-Object { $_ } | Sort-Object -Unique)
foreach ($id in $ExtensionId) {
    if ($id -notmatch '^[a-p]{32}$') { throw 'The extension ID must contain 32 lowercase letters from a through p.' }
}
if (-not $OutputDirectory -and (Test-Path -LiteralPath $configPath)) {
    $previousConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $OutputDirectory = $previousConfig.output
}
$venvPython = Join-Path $projectRoot '.venv/Scripts/python.exe'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $nodePath --version
if ([version]$nodeVersion.TrimStart('v') -lt [version]'22.0.0') { throw 'Install Node.js 22 or newer, then run setup again.' }
$pythonPath = (Get-Command python.exe -ErrorAction Stop).Source
& $pythonPath -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10+ required"'
if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.10 or newer.' }
if (-not (Test-Path -LiteralPath $venvPython)) {
    & $pythonPath -m venv (Join-Path $projectRoot '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the local Python environment.' }
}
& $venvPython -m pip install --upgrade 'yt-dlp[default,curl-cffi]' imageio-ffmpeg
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Browser registration was not changed.' }
$ffmpegPath = & $venvPython -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ffmpegPath)) { throw 'Could not find bundled FFmpeg.' }
if (-not $OutputDirectory) {
    $folders = Get-ItemProperty 'HKCU:/Software/Microsoft/Windows/CurrentVersion/Explorer/User Shell Folders'
    $OutputDirectory = [Environment]::ExpandEnvironmentVariables($folders.'{374DE290-123F-4565-9164-39C4925E467B}')
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $env:USERPROFILE 'Downloads' }
    $OutputDirectory = Join-Path $OutputDirectory 'VideoBridge'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
@{ output = $OutputDirectory; node = $nodePath; ffmpeg = $ffmpegPath } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $nativeRoot 'config.json') -Encoding UTF8
$launcherPath = Join-Path $nativeRoot 'host.cmd'
$hostPath = Join-Path $nativeRoot 'host.py'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
# Batch files expand percent signs even inside quotes.
$batchPython = $venvPython.Replace('%', '%%')
$batchHost = $hostPath.Replace('%', '%%')
[IO.File]::WriteAllText($launcherPath, "@echo off`r`nchcp 65001 >nul`r`n`"$batchPython`" -u `"$batchHost`" %*`r`n", $utf8NoBom)
$manifestJson = @{
    name = 'com.videobridge.downloader'
    description = 'VideoBridge local video downloader'
    path = $launcherPath
    type = 'stdio'
    allowed_origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)
foreach ($browserKey in @('Google/Chrome', 'Microsoft/Edge')) {
    $registryPath = "HKCU:/Software/$browserKey/NativeMessagingHosts/com.videobridge.downloader"
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -Path $registryPath -Value $manifestPath
}
Write-Host "VideoBridge helper installed for Chrome and Edge. Downloads: $OutputDirectory"
Write-Host 'Open the extension and click Check local helper. Keep this project folder in place.'
