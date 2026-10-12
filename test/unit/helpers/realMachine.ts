/**
 * Where the real machine's tools live. test/unit/setup.ts captures the real
 * home and data folders BEFORE redirecting them at a temp worker home: a
 * test's DATA must live under the temp home, but installed TOOLS (a browser,
 * bun, the Muse Code CLI) are the real machine's. Under the live vitest
 * project there is no redirect, so these read the current environment.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'

/** The developer's real home folder, even under the unit redirect. */
export function realHome(): string {
  const saved = process.env['MUSE_UNIT_REAL_HOME']
  if (saved !== undefined && saved !== '') return saved
  const home = process.env['HOME']
  if (home === undefined || home === '') throw new Error('realMachine: no HOME to read')
  return home
}

/** The installed bun, where the machine has one (a rig's `~/.bun`). */
export function bunPath(): string | undefined {
  const candidate = path.join(
    realHome(),
    '.bun',
    'bin',
    process.platform === 'win32' ? 'bun.exe' : 'bun',
  )
  return existsSync(candidate) ? candidate : undefined
}

/** A Node.js new enough to run plugin children, off Windows (M91b's gate). */
export function hasPluginNode(): boolean {
  const match = /^v(\d+)\.(\d+)\./.exec(process.version)
  return (
    process.platform !== 'win32' &&
    match !== null &&
    (Number(match[1]) > 22 || (Number(match[1]) === 22 && Number(match[2]) >= 18))
  )
}

/**
 * One line naming the tool when a tool-gated suite skips, so a suite cannot
 * start skipping unnoticed. Call it at load time beside the runIf/skipIf,
 * naming the same tool the condition probes.
 */
export function noteToolSkip(tool: string, suite: string, isPresent: boolean): void {
  if (!isPresent) process.stdout.write(`[env-skip] ${suite}: ${tool} not present, skipping\n`)
}
