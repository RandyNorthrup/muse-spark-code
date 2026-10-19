import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  execGuardViaSymlinkedScripts,
  runGuardProcess,
  withGuardScratch,
} from './helpers/guardProcess'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scripts', 'check-usable-reply.mjs')

function run(args: readonly string[]): { status: number; output: string } {
  return runGuardProcess(SCRIPT, args, REPO, 120_000)
}

describe('usable-reply guard', () => {
  // A whole-tree static scan as a child process takes seconds on a loaded
  // rig; the ceiling stays named and small.
  it('passes on the shipped source', { timeout: 20_000 }, () => {
    const result = run([path.join(REPO, 'src')])
    expect(result.status).toBe(0)
    expect(result.output).toContain('no raw completed-terminal reads')
  })

  it('fails a planted raw read with the file and line', () => {
    withGuardScratch('usable-reply-guard', (dir) => {
      writeFileSync(
        path.join(dir, 'consumer.ts'),
        'export function verdict(tracked: { terminal: string; reply: string }): string | undefined {\n  return tracked.terminal === "completed" ? tracked.reply : undefined\n}\n',
      )
      writeFileSync(path.join(dir, 'clean.ts'), 'export const ok = 1\n')
      const result = run([dir])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('consumer.ts:2')
    })
  })

  it('fails on missing or empty input, never passes', () => {
    expect(run([]).status).not.toBe(0)
    expect(run([]).output).toContain('pass the source root')
    withGuardScratch('usable-reply-guard-empty', (dir) => {
      const result = run([dir])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('empty input')
    })
  })

  it('passes through a symlinked directory', { timeout: 20_000 }, () => {
    const output = execGuardViaSymlinkedScripts(
      REPO,
      'check-usable-reply.mjs',
      [path.join(REPO, 'src')],
      'usable-reply-guard-link',
      120_000,
    )
    expect(output).toContain('no raw completed-terminal reads')
  })
})
