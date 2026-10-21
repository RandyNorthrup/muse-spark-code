// PowerShell 7's module path (WINPSMOD): what VS Code, or the agent, inherits
// when it is started from a PowerShell 7 terminal. It is read from the
// installed pwsh itself, never written by hand; hosted Windows runners and
// this project's Windows rigs have PowerShell 7, and a machine without it
// fails here by name instead of passing without the check.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const MODULE_PATH = 'PSModulePath'

/** The `PSModulePath` a real PowerShell 7 process has, its own module folder first. */
export function powerShell7ModulePath(): string {
  const programFiles = process.env['ProgramFiles']
  if (programFiles === undefined) throw new Error('ProgramFiles is not set')
  const home = path.join(programFiles, 'PowerShell', '7')
  const pwsh = path.join(home, 'pwsh.exe')
  if (!existsSync(pwsh)) throw new Error(`PowerShell 7 is not installed at ${pwsh}`)
  const value = execFileSync(
    pwsh,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Environment]::GetEnvironmentVariable('${MODULE_PATH}')`,
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim()
  const ownModules = path.join(home, 'Modules').toLowerCase()
  if (!value.toLowerCase().split(';').includes(ownModules))
    throw new Error(`PowerShell 7's module path does not list ${ownModules}`)
  return value
}

/**
Runs `run` with this process's `PSModulePath` set to PowerShell 7's, as a
window started from a PowerShell 7 terminal has it, and puts the previous
value back afterwards.
*/
export async function withPowerShell7ModulePath<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env[MODULE_PATH]
  process.env[MODULE_PATH] = powerShell7ModulePath()
  try {
    return await run()
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, MODULE_PATH)
    else process.env[MODULE_PATH] = previous
  }
}
