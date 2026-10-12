import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildConfine } from '../../scripts/build-confine.mjs'
import { normaliseCaptureText } from '../../scripts/lib/inspectCapture.mjs'

const script = path.resolve('scripts/inspect-capture.mjs')
const PROGRAMS = ['ls', 'cat', 'head', 'tail', 'wc', 'stat', 'du', 'grep', 'find']

function runScript(
  args: string[],
  cwd: string = process.cwd(),
): { status: number | null; output: string } {
  try {
    const output = execFileSync(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, PATH: '/usr/bin:/bin' },
      encoding: 'utf8',
      timeout: 240_000,
    })
    return { status: 0, output }
  } catch (error) {
    const child = error as { status?: number | null; stdout?: string; stderr?: string }
    return { status: child.status ?? 1, output: `${child.stdout ?? ''}${child.stderr ?? ''}` }
  }
}

if (process.platform === 'linux') {
  describe('inspect capture command', () => {
    // Its own helper build directory: test files run in parallel workers and
    // must not rewrite temp/confine under each other.
    let helper = ''
    beforeAll(async () => {
      try {
        helper = await buildConfine(mkdtempSync(path.join(os.tmpdir(), 'inspect-capture-helper-')))
      } catch (error) {
        throw new Error('inspect capture helper build failed', { cause: error })
      }
    }, 120_000) // C compile plus esbuild under a loaded rig; measured ~2 s here.
    // Building the helper and running nine programs is genuinely long.
    it(
      'prints one row per started program with no machine paths or names',
      { timeout: 60_000 },
      () => {
        // No --helper: the command builds it the way the tests do. Every row
        // is data, so this also runs inside the lane sandbox (where every
        // started program refuses with systemFile and stat answers).
        const { output, status } = runScript([])
        expect(status, output).toBe(0)
        for (const program of PROGRAMS) expect(output, program).toContain(`\n${program} |`)
        expect(output).toContain('program output')
        expect(output).toContain('binary (owner)')
        expect(output).toContain('<scratch>')
        expect(output).not.toContain(os.homedir())
        expect(output).not.toContain(os.tmpdir())
      },
    )
    it('writes the rows to --json and refuses a missing helper', () => {
      const directory = mkdtempSync(path.join(os.tmpdir(), 'inspect-capture-test-'))
      try {
        const file = path.join(directory, 'rows.json')
        const { output, status } = runScript(['--helper', helper, '--json', file])
        expect(status, output).toBe(0)
        const rows = JSON.parse(readFileSync(file, 'utf8')) as { rows: { program: string }[] }
        expect(rows.rows.map((row) => row.program)).toEqual(PROGRAMS)
        const missing = runScript(['--helper', path.join(directory, 'no-such-helper')])
        expect(missing.status).not.toBe(0)
        expect(missing.output).toContain('helper not found')
        const usage = runScript(['--frobnicate'])
        expect(usage.status).not.toBe(0)
        expect(usage.output).toContain('usage:')
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
    it('runs when reached through a symlinked directory', () => {
      const link = path.join(os.tmpdir(), `inspect-capture-link-${String(process.pid)}`)
      try {
        symlinkSync(process.cwd(), link)
        const { output, status } = runScript(['--helper', helper], link)
        expect(status, output).toBe(0)
        expect(output).toContain('\nstat |')
      } finally {
        rmSync(link, { force: true })
      }
    })
  })
} else {
  it('rejects unknown flags without a helper', () => {
    const { status, output } = runScript(['--frobnicate'])
    expect(status).not.toBe(0)
    expect(output).toContain('usage:')
  })
}

describe('capture normalisation', () => {
  it('replaces home and tmp prefixes', () => {
    const text = normaliseCaptureText(`at ${os.homedir()}/x and ${os.tmpdir()}/y`, [])
    expect(text).not.toContain(os.homedir())
    expect(text).not.toContain(os.tmpdir())
    expect(text).toContain('<scratch>')
  })
})
