# Build the Windows single-file executable (frontend assets are embedded).
# ASCII only on purpose: Windows PowerShell 5.1 reads BOM-less .ps1 as ANSI,
# so non-ASCII comments would be garbled.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$env:CGO_ENABLED = '0'
$env:GOFLAGS = '-mod=mod'

$ver = 'v4.0.0-local'
$commit = (git rev-parse --short HEAD 2>$null)
if (-not $commit) { $commit = 'unknown' }
$built = (Get-Date).ToString('yyyy-MM-dd_HH:mm:ss')

$ldflags = "-s -w " +
  "-X github.com/OpenListTeam/OpenList/v4/internal/conf.Version=$ver " +
  "-X github.com/OpenListTeam/OpenList/v4/internal/conf.GitCommit=$commit " +
  "-X github.com/OpenListTeam/OpenList/v4/internal/conf.BuiltAt=$built " +
  "-X github.com/OpenListTeam/OpenList/v4/internal/conf.WebVersion=local"

if (-not (Test-Path 'build')) { New-Item -ItemType Directory -Path 'build' | Out-Null }
go build -trimpath -ldflags $ldflags -o build/openlist.exe .
if ($LASTEXITCODE -ne 0) { throw "go build failed with exit code $LASTEXITCODE" }

Write-Host "built: build/openlist.exe"
