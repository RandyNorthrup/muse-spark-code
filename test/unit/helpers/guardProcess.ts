import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One runner for the source-guard drills: `node <script> <args>` as a
 * process, resolving the exit status and both streams instead of throwing.
 * The tool-rounds guards (`check-wrap-up-request`, `check-usable-reply`)
 * share it so the drill harness itself is not a duplication-clone pair.
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
 * Runs `body` with a fresh pid-scoped scratch directory, removed
 * afterwards. The guard drills share it so the scratch skeleton is written
 * once.
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
 * Runs a guard script through a symlinked `scripts` directory, proving the
 * guard follows the link instead of reading its own location. Returns the
 * guard's stdout; removes the scratch directory afterwards.
 */
/**
 * One drill for the source-guard scripts (`check-no-round-cap`,
 * `check-no-output-continuation-cap`, `check-wrap-up-request`): the guard
 * passes on the shipped source, fails a planted trip with the line that
 * names the problem, never passes on missing input, and follows a symlinked
 * `scripts` directory. Shared so the guard suites are not a clone pair.
 */
export interface SourceGuardDrill {
  /** The suite title. */
  readonly title: string
  /** The guard script file name under `scripts/`. */
  readonly scriptName: string
  /** The guarded source, relative to the repository root. */
  readonly sourceRel: string
  /** The scratch tag for the planted, empty and symlinked runs. */
  readonly tag: string
  /** The snippet appended to a copy of the source to trip the guard. */
  readonly plantSnippet: string
  /** The guard output proving the plant tripped it. */
  readonly plantMessage: string
  /** The guard output proving it passes on the shipped source. */
  readonly passMessage: string
}

export function describeSourceGuard(drill: SourceGuardDrill): void {
  const repo = process.cwd()
  const script = path.join(repo, 'scripts', drill.scriptName)
  const source = path.join(repo, ...drill.sourceRel.split('/'))
  const run = (args: readonly string[], cwd: string = repo): { status: number; output: string } =>
    runGuardProcess(script, args, cwd, 60_000)
  describe(drill.title, () => {
    it('passes on the shipped source', () => {
      const result = run([source])
      expect(result.status).toBe(0)
      expect(result.output).toContain(drill.passMessage)
    })

    it('fails a planted trip with the line that names the problem', () => {
      withGuardScratch(drill.tag, (dir) => {
        const planted = path.join(dir, path.basename(source))
        cpSync(source, planted)
        writeFileSync(planted, `${readFileSync(planted, 'utf8')}${drill.plantSnippet}`)
        const result = run([planted])
        expect(result.status).not.toBe(0)
        expect(result.output).toContain(drill.plantMessage)
      })
    })

    it('fails on missing input, never passes', () => {
      expect(run([]).status).not.toBe(0)
      expect(run([]).output).toContain(`pass the ${path.basename(source)} path`)
      withGuardScratch(`${drill.tag}-empty`, (dir) => {
        const empty = path.join(dir, 'empty.ts')
        writeFileSync(empty, '')
        const result = run([empty])
        expect(result.status).not.toBe(0)
        expect(result.output).toContain('empty input')
      })
    })

    it('passes through a symlinked directory', () => {
      const output = execGuardViaSymlinkedScripts(
        repo,
        drill.scriptName,
        [source],
        `${drill.tag}-link`,
        60_000,
      )
      expect(output).toContain(drill.passMessage)
    })
  })
}

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
