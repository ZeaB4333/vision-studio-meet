# Script de packaging Chrome Web Store — Vision Studio for Google Meet
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $root 'dist'
$stageDir = Join-Path $distDir 'stage'
$zipPath = Join-Path $distDir "vision-studio-meet-v$version.zip"

if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

$includeFiles = @(
  'manifest.json',
  'inject.js',
  'content.js',
  'sandbox.html',
  'sandbox.js',
  'bg-timer.js',
  'popup.html',
  'popup.js'
)

$includeDirs = @(
  'icons',
  'vendor'
)

foreach ($f in $includeFiles) {
  Copy-Item (Join-Path $root $f) -Destination $stageDir -Force
}

foreach ($d in $includeDirs) {
  Copy-Item (Join-Path $root $d) -Destination $stageDir -Recurse -Force
}

[System.IO.Compression.ZipFile]::CreateFromDirectory($stageDir, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
Remove-Item $stageDir -Recurse -Force

$sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "Package genere : $zipPath ($sizeMB Mo)"
