// Whether this machine answers OS process-birth probes: Linux /proc, macOS
// ps, Windows PowerShell. Suites that assert birth-dependent behavior run a
// real probe once and assert the matching reality on both sides — the birth
// contract where the table answers, the documented degraded contract (an
// unreadable birth proves nothing) where it does not. Never a skip: both
// branches end in assertions over real behavior.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../src/shared/constants'

function canRunProbe(file: string, args: readonly string[]): boolean {
  try {
    execFileSync(file, [...args], { timeout: 5000, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function canReadProcessBirth(): boolean {
  if (process.platform === 'linux') {
    try {
      readFileSync(`/proc/${String(process.pid)}/stat`, 'utf8')
      return true
    } catch {
      return false
    }
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot']
    if (systemRoot === undefined) return false
    return canRunProbe(path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH), [
      ...WINDOWS_POWERSHELL_COMMAND_ARGS,
      `try { [Diagnostics.Process]::GetProcessById(${String(process.pid)}).StartTime.ToFileTimeUtc() } catch [ArgumentException] { }`,
    ])
  }
  return canRunProbe('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)])
}
