# Pre-fetches the NSIS toolchain into Tauri's cache (%LOCALAPPDATA%\tauri\NSIS).
# Use when `tauri build` fails with "timeout: global" while downloading nsis-3.11.zip on a
# slow connection: curl has no overall timeout, and the CLI skips its own download once the
# files are present. URLs and SHA-1s are the ones pinned by @tauri-apps/cli 2.x.
$ErrorActionPreference = 'Stop'

$tools = Join-Path $env:LOCALAPPDATA 'tauri'
$nsis = Join-Path $tools 'NSIS'
$zip = Join-Path $env:TEMP 'nsis-3.11.zip'

function Get-Checked($url, $out, $sha1) {
    curl.exe -L --fail --retry 3 --progress-bar -o $out $url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $url" }
    $actual = (Get-FileHash $out -Algorithm SHA1).Hash
    if ($actual -ne $sha1) { throw "Checksum mismatch for $url (got $actual)" }
}

New-Item -ItemType Directory -Force $tools | Out-Null

Write-Host 'Downloading nsis-3.11.zip (2.3 MB)...'
Get-Checked 'https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip' `
    $zip 'EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D'

$extracted = Join-Path $tools 'nsis-3.11'
if (Test-Path $extracted) { Remove-Item $extracted -Recurse -Force }
Expand-Archive $zip $tools -Force
if (-not (Test-Path (Join-Path $extracted 'makensis.exe'))) { throw "Unexpected zip layout: $extracted\makensis.exe not found" }
if (Test-Path $nsis) { Remove-Item $nsis -Recurse -Force }
Rename-Item $extracted 'NSIS'
Remove-Item $zip

$plugins = Join-Path $nsis 'Plugins\x86-unicode\additional'
New-Item -ItemType Directory -Force $plugins | Out-Null
Write-Host 'Downloading nsis_tauri_utils.dll (v0.5.3)...'
Get-Checked 'https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll' `
    (Join-Path $plugins 'nsis_tauri_utils.dll') '75197FEE3C6A814FE035788D1C34EAD39349B860'

Write-Host "NSIS toolchain ready in $nsis. Now run: npm run tauri build -- --bundles nsis"
