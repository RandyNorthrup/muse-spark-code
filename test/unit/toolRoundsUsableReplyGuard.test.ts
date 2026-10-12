import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scripts', 'check-usable-reply.mjs')

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

function run(args: readonly string[], cwd = REPO): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    })
    return { status: 0, output }
  } catch (error: unknown) {
    return { status: childStatus(error), output: childOutput(error) }
  }
}

describe('usable-reply guard', () => {
  it('passes on the shipped source', () => {
    const result = run([path.join(REPO, 'src')])
    expect(result.status).toBe(0)
    expect(result.output).toContain('no raw completed-terminal reads')
  })

  it('fails a planted raw read with the file and line', () => {
    const dir = path.join(osTmpdir(), `usable-reply-guard-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(
        path.join(dir, 'consumer.ts'),
        'export function verdict(tracked: { terminal: string; reply: string }): string | undefined {\n  return tracked.terminal === "completed" ? tracked.reply : undefined\n}\n',
      )
      writeFileSync(path.join(dir, 'clean.ts'), 'export const ok = 1\n')
      const result = run([dir])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('consumer.ts:2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails on missing or empty input, never passes', () => {
    expect(run([]).status).not.toBe(0)
    expect(run([]).output).toContain('pass the source root')
    const dir = path.join(osTmpdir(), `usable-reply-guard-empty-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      const result = run([dir])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('empty input')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes through a symlinked directory', () => {
    const dir = path.join(osTmpdir(), `usable-reply-guard-link-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      symlinkSync(path.join(REPO, 'scripts'), path.join(dir, 'scripts'))
      const output = execFileSync(
        'node',
        [path.join(dir, 'scripts', 'check-usable-reply.mjs'), path.join(REPO, 'src')],
        {
          cwd: REPO,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120_000,
        },
      )
      expect(output).toContain('no raw completed-terminal reads')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
