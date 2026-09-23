#!/usr/bin/env node
// PSScriptAnalyzer gate for the bundled PowerShell (native/windows). It runs
// on Windows, where the script runs in production; elsewhere it reports a
// skip and exits 0, and CI's Windows job is where the gate is real. The
// analyzer is loaded in PowerShell 7 when `pwsh` is on the PATH (where
// Install-Module puts it on a developer machine and on the CI runner), and
// in Windows PowerShell otherwise. The exit code is the finding count.
//
// The analyzer version is pinned (M26, PLAN.md D29): a new release can add
// or retune rules, and a gate that changes under an unchanged tree is not a
// gate. CI installs exactly this version (`--print-version` feeds the
// workflow); raise it here, with a clean run, to move.

import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PSSCRIPTANALYZER_VERSION = '1.25.0'

if (process.argv.includes('--print-version')) {
  console.log(PSSCRIPTANALYZER_VERSION)
  process.exit(0)
}

if (process.platform !== 'win32') {
  console.log(
    `lint:ps skipped: PSScriptAnalyzer runs on Windows only (this is ${process.platform})`,
  )
  process.exit(0)
}

const SCRIPT_DIR = path.join('native', 'windows')
const SETTINGS = 'PSGallery'
const POWERSHELL_7 = 'pwsh'
const WINDOWS_POWERSHELL = ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe']
const SHELL_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

const command = [
  `Import-Module PSScriptAnalyzer -RequiredVersion ${PSSCRIPTANALYZER_VERSION} -ErrorAction Stop;`,
  `$findings = @(Invoke-ScriptAnalyzer -Path '${SCRIPT_DIR}' -Recurse -Settings ${SETTINGS});`,
  '$findings | Format-Table -AutoSize RuleName, Severity, ScriptName, Line, Message | Out-String -Width 200 | Write-Output;',
  '"PSScriptAnalyzer findings: $($findings.Count)";',
  'exit $findings.Count',
].join(' ')

function shells() {
  const systemRoot = process.env.SystemRoot
  return systemRoot === undefined
    ? [POWERSHELL_7]
    : [POWERSHELL_7, path.join(systemRoot, ...WINDOWS_POWERSHELL)]
}

for (const shell of shells()) {
  const result = spawnSync(shell, [...SHELL_ARGS, command], { stdio: 'inherit', windowsHide: true })
  if (result.error === undefined) {
    process.exit(result.status ?? 1)
  }
  console.log(`lint:ps: ${shell} not available (${result.error.message}); trying the next shell`)
}
console.error('lint:ps: no PowerShell could run PSScriptAnalyzer')
process.exit(1)
