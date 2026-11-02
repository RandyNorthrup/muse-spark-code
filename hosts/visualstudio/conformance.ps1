# M104g's Visual Studio conformance (Windows only): builds the VSIX this tree ships and runs the [IdeFact] cases
# in an experimental instance under the root suffix MuseConf. NuGet's Microsoft.VSSDK.BuildTools carries the build, so
# Visual Studio's extension-development workload is not needed here. The harness writes a desktop screenshot on a
# failure and every 5 minutes of a long launch: its log folder stays in the ignored temp/ and is removed after the run.
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
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
$logs = Join-Path $root 'temp\vs-ide-logs'
New-Item -ItemType Directory -Force $logs | Out-Null
# Everything the harness and the instance's scratch workspaces write stays in the ignored temp/.
$scratch = Join-Path $root 'temp\tmp'
New-Item -ItemType Directory -Force $scratch | Out-Null
$env:TEMP = $scratch
$env:TMP = $scratch
$env:XUNIT_LOGS = $logs
$env:MSBUILDDISABLENODEREUSE = '1'
# The scratch workspaces live under temp/: none of them belongs to this checkout's repository.
$env:GIT_CEILING_DIRECTORIES = Join-Path $root 'temp'
$env:MUSE_CONFORMANCE_ROOT = $root
try {
  & $msbuild (Join-Path $PSScriptRoot 'MuseSpark.VisualStudio.csproj') /t:Restore /p:Configuration=Release /v:minimal /nologo | Write-Host
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node (Join-Path $PSScriptRoot 'build-assets.mjs') | Write-Host
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $msbuild (Join-Path $PSScriptRoot 'MuseSpark.VisualStudio.csproj') /p:Configuration=Release /v:minimal /nologo | Write-Host
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  # The packed agent where a person's npm install puts it, found by the product's own locator through PATH.
  # A global install would be found first and is another runtime, so it refuses here.
  if (Test-Path (Join-Path $env:APPDATA 'npm\node_modules\muse-spark-code-acp')) {
    Write-Error 'MHP_CONFORMANCE_GLOBAL_AGENT'
    exit 1
  }
  Push-Location $root
  try {
    & node scripts/package-acp.mjs --target win32-x64 | Write-Host
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $packed = Get-ChildItem -Path (Join-Path $root 'dist') -Filter 'muse-spark-code-acp-*-win32-x64.tgz' | Select-Object -First 1
    $agent = Join-Path $root 'temp\vs-runtime'
    New-Item -ItemType Directory -Force $agent | Out-Null
    & npm.cmd install --prefix $agent $packed.FullName --no-audit --no-fund --no-save | Write-Host
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
  finally { Pop-Location }
  $env:PATH = "$agent;$env:PATH"
  & dotnet test (Join-Path $PSScriptRoot 'Conformance\MuseSpark.VisualStudio.Conformance.csproj') --nologo --logger 'console;verbosity=normal' --filter 'FullyQualifiedName~Conformance' | Write-Host
  exit $LASTEXITCODE
}
finally {
  Get-ChildItem -Path $logs -Recurse -Filter '*.png' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $scratch -Filter 'muse-vs-conformance-*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}
