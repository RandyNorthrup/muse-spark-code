import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir as osTmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO = process.cwd()
const SCRIPT = path.join(REPO, 'scripts', 'check-wrap-up-request.mjs')
const HOST = path.join(REPO, 'src', 'core', 'backends', 'modelapi', 'ModelApiHost.ts')

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
      timeout: 60_000,
    })
    return { status: 0, output }
  } catch (error: unknown) {
    return { status: childStatus(error), output: childOutput(error) }
  }
}

describe('wrap-up single-builder guard', () => {
  it('passes on the shipped host', () => {
    const result = run([HOST])
    expect(result.status).toBe(0)
    expect(result.output).toContain('single builder ok')
  })

  it('fails a planted second writer with the line that names the problem', () => {
    const dir = path.join(osTmpdir(), `wrap-up-guard-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      const planted = path.join(dir, 'ModelApiHost.ts')
      cpSync(HOST, planted)
      writeFileSync(
        planted,
        `${readFileSync(planted, 'utf8')}\n// planted second builder\nturn.wrapUpLimit = 0\n`,
      )
      const result = run([planted])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('expected exactly one wrapUpLimit write, found 2')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails on missing input, never passes', () => {
    expect(run([]).status).not.toBe(0)
    expect(run([]).output).toContain('pass the ModelApiHost.ts path')
    const dir = path.join(osTmpdir(), `wrap-up-guard-empty-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      const empty = path.join(dir, 'empty.ts')
      writeFileSync(empty, '')
      const result = run([empty])
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('empty input')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('passes through a symlinked directory', () => {
    const dir = path.join(osTmpdir(), `wrap-up-guard-link-${String(process.pid)}`)
    mkdirSync(dir, { recursive: true })
    try {
      symlinkSync(path.join(REPO, 'scripts'), path.join(dir, 'scripts'))
      const output = execFileSync(
        'node',
        [path.join(dir, 'scripts', 'check-wrap-up-request.mjs'), HOST],
        {
          cwd: REPO,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 60_000,
        },
      )
      expect(output).toContain('single builder ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
