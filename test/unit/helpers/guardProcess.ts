import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import path from 'node:path'

/**
One runner for the source-guard drills: `node <script> <args>` as a
process, resolving the exit status and both streams instead of throwing.
The tool-rounds guards (`check-wrap-up-request`, `check-usable-reply`)
share it so the drill harness itself is not a duplication-clone pair.
*/
export function runGuardProcess(
  script: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): { status: number; output: string } {
  try {
    const output = execFileSync('node', [script, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })
    return { status: 0, output }
  } catch (error: unknown) {
    return { status: childStatus(error), output: childOutput(error) }
  }
}

function childText(error: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof error !== 'object' || error === null) return ''
  if (key === 'stdout') {
    if (!('stdout' in error)) return ''
    return typeof error.stdout === 'string' ? error.stdout : ''
  }
  if (!('stderr' in error)) return ''
  return typeof error.stderr === 'string' ? error.stderr : ''
}

function childOutput(error: unknown): string {
  return `${childText(error, 'stdout')}${childText(error, 'stderr')}`
}

function childStatus(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status: unknown = error.status
    if (typeof status === 'number') return status
  }
  return 1
}

/**
Runs `body` with a fresh pid-scoped scratch directory, removed
afterwards. The guard drills share it so the scratch skeleton is written
once.
*/
export function withGuardScratch<T>(tag: string, body: (dir: string) => T): T {
  const dir = path.join(osTmpdir(), `${tag}-${String(process.pid)}`)
  mkdirSync(dir, { recursive: true })
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
Runs a guard script through a symlinked `scripts` directory, proving the
guard follows the link instead of reading its own location. Returns the
guard's stdout; removes the scratch directory afterwards.
*/
export function execGuardViaSymlinkedScripts(
  repo: string,
  scriptName: string,
  args: readonly string[],
  tag: string,
  timeoutMs: number,
): string {
  const dir = path.join(osTmpdir(), `${tag}-${String(process.pid)}`)
  mkdirSync(dir, { recursive: true })
  try {
    symlinkSync(path.join(repo, 'scripts'), path.join(dir, 'scripts'))
    return execFileSync('node', [path.join(dir, 'scripts', scriptName), ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
