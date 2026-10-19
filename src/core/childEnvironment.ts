// Shaping a child process's environment on every platform: Windows treats
// names case-insensitively (Node passes the first spelling in sort order),
// and Windows PowerShell 5.1 needs its own module directories. Every
// launcher reaches these here — the Muse Code backend, the tool and MCP
// spawners, the tree kill, the resource commands and the voice helpers —
// so no lazy bundle carries a backend for an environment fact (PLAN.md D6).
import path from 'node:path'
import { WINDOWS_PSMODULEPATH_SEGMENTS } from '../shared/constants'

/**
Sets `name` in a copied environment. Windows names are case-insensitive
and Node passes the first of several spellings in sort order, so an
inherited `PSMODULEPATH` would beat a new `PSModulePath`: every other
spelling goes first.
*/
export function setEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
  value: string,
): void {
  if (platform === 'win32') {
    const lower = name.toLowerCase()
    for (const key of Object.keys(env)) {
      if (key !== name && key.toLowerCase() === lower) {
        Reflect.deleteProperty(env, key)
      }
    }
  }
  env[name] = value
}

/** Removes `name` (every spelling of it on Windows) from a copied environment. */
export function deleteEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): void {
  const lower = name.toLowerCase()
  for (const key of Object.keys(env)) {
    if (key === name || (platform === 'win32' && key.toLowerCase() === lower)) {
      Reflect.deleteProperty(env, key)
    }
  }
}

/** Reads `name` from a copied environment, ignoring case on Windows. */
export function environmentValue(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): string | undefined {
  if (platform !== 'win32') {
    return env[name]
  }
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}

/**
Windows PowerShell 5.1's own module directories. A pwsh 7 `PSModulePath`
inherited by powershell.exe makes it load 7.x modules it cannot use
(verified failure: `Get-FileHash` not recognised).
*/
export function windowsPowerShellModulePath(
  systemRoot: string,
  programFiles: string | undefined,
): string {
  const base = programFiles ?? path.win32.join(systemRoot, '..', 'Program Files')
  return [
    path.win32.join(base, ...WINDOWS_PSMODULEPATH_SEGMENTS.programFiles),
    path.win32.join(systemRoot, ...WINDOWS_PSMODULEPATH_SEGMENTS.systemRoot),
  ].join(';')
}
