# M104g distribution build for the Visual Studio host (Windows only).
# Transcribes the README's win11-receipted commands; MSBuild is located
# through vswhere so Community, Enterprise and Build Tools all work.
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) {
  Write-Error 'MHP_VS_NO_VSWHERE'
  exit 1
}
$msbuild = & $vswhere -latest -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
if (-not $msbuild) {
  Write-Error 'MHP_VS_NO_MSBUILD'
  exit 1
}
& $msbuild (Join-Path $PSScriptRoot 'MuseSpark.VisualStudio.csproj') /restore /p:Configuration=Release /v:minimal
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
& dotnet test (Join-Path $PSScriptRoot 'Test\MuseSpark.VisualStudio.Test.csproj') --no-restore
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
& node --test (Join-Path $PSScriptRoot 'Test\embedded-bridge.test.mjs')
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
$rigSources = @(Get-ChildItem -Path $PSScriptRoot -Recurse -Filter '*.cs' | Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } | ForEach-Object { $_.FullName })
& dotnet format whitespace $PSScriptRoot --folder --include $rigSources --verify-no-changes
exit $LASTEXITCODE
