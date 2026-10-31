// M110os: the Node OS suites' shared harness. Child processes run through
// runNodeScript (Node scripts) and runCommand (executables); scratch
// directories come from scratch and leave through cleanup; sha256File
// hashes a file. Every runner returns the exit status with the joined
// output the tests assert on. hasTool and canReachUrl gate the suites that
// need a real tool or the real network.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

export interface NodeOsRun {
  readonly status: number | null
  readonly out: string
}

export interface NodeOsRunOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
}

function spawnAndJoin(file: string, args: readonly string[], options: NodeOsRunOptions): NodeOsRun {
  const run = spawnSync(file, [...args], {
    encoding: 'utf8',
    env: options.env ?? process.env,
    input: options.input,
  })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

/** A Node script under the test runner's own Node. */
export function runNodeScript(
  script: string,
  args: readonly string[],
  options: NodeOsRunOptions = {},
): NodeOsRun {
  return spawnAndJoin(process.execPath, [script, ...args], options)
}

/** An executable directly (shell scripts, system tools). */
export function runCommand(
  file: string,
  args: readonly string[],
  options: NodeOsRunOptions = {},
): NodeOsRun {
  return spawnAndJoin(file, args, options)
}

/** The hex SHA-256 of a file's bytes. */
export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** A fresh temporary directory, prefixed for the calling suite. */
export function scratch(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix))
}

/** A scratch directory gone, whatever it holds. */
export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/** Whether a real tool answers (gates the suites that need it). */
export function hasTool(command: string, args: readonly string[]): boolean {
  try {
    execFileSync(command, [...args], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Whether a URL answers HEAD ok within the bound (gates live downloads). */
export async function canReachUrl(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return response.ok
  } catch {
    return false
  }
}
