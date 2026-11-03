// Whether this machine answers OS process-birth probes: Linux /proc, macOS
// ps, and on Windows the compiler the product's birth reader is built with.
// Suites that assert birth-dependent behavior run a real probe once and assert
// the matching reality on both sides — the birth contract where the table
// answers, the documented degraded contract (an unreadable birth proves nothing)
// where it does not. Never a skip: both branches end in assertions over real
// behavior.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { WINDOWS_FRAMEWORK_RELATIVE_PATH } from '../../../src/shared/constants'

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
    // No process start, so no clock: this used to ask Windows PowerShell with a
    // 5 s limit, a cold start on a fresh VM can pass that (15 s in PR 165's run),
    // and a slow start then read as a machine with no process table.
    const systemRoot = process.env['SystemRoot']
    return (
      systemRoot !== undefined &&
      existsSync(path.win32.join(systemRoot, WINDOWS_FRAMEWORK_RELATIVE_PATH, 'csc.exe'))
    )
  }
  return canRunProbe('/bin/ps', ['-o', 'lstart=', '-p', String(process.pid)])
}
