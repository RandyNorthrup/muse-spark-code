// Shared B1 stat proofs: the Linux and macOS confinement suites assert the
// same confined stat behaviour against their own helper binary, so each case
// lives here once, parameterised by the binary (or variant) under test.
import { spawn, type StdioOptions } from 'node:child_process'
import { linkSync, mkdirSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect } from 'vitest'
import type { InspectCase } from './inspectCase'

export interface Receipt {
  stdout: Buffer
  stderr: string
  code: number | null
}

export function native(
  file: string,
  args: string[],
  cwd: string,
  ready?: () => void,
  stdio?: StdioOptions,
  marker = '"confined":true',
): Promise<Receipt> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: {}, stdio: stdio ?? ['ignore', 'pipe', 'pipe'] })
    const output: Buffer[] = [],
      errors: Buffer[] = []
    let hasReady = false
    child.stdout?.on('data', (chunk: Buffer) => {
      output.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      errors.push(chunk)
      if (hasReady || !chunk.toString().includes(marker)) {
        return
      }

      hasReady = true
      ready?.()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString(), code })
    })
  })
}

/** The report matches the kernel's own numbers, with no program started. */
export async function expectStatReportMatchesFs(h: InspectCase, noExec: string): Promise<void> {
  for (const [operand, kind] of [
    ['allowed.txt', 'regular file'],
    ['.', 'directory'],
  ] as const) {
    const result = await native(noExec, h.args('stat', [operand], [operand]), h.root)
    expect(result.code, operand).toBe(0)
    expect(result.stderr).toMatch(/^\{"confined":true,/u)
    const expected = statSync(path.join(h.workspace, operand))
    const stdout = result.stdout.toString()
    expect(stdout).toContain(`File: ${operand}\n`)
    expect(stdout).toContain(`Size: ${String(expected.size)} `)
    expect(stdout).toContain(`Inode: ${String(expected.ino)} `)
    expect(stdout).toContain(`Device: ${expected.dev.toString(16)}h/${String(expected.dev)}d `)
    expect(stdout).toContain(kind)
    expect(stdout).toContain(`Links: ${String(expected.nlink)}\n`)
    const octal = (expected.mode & 0o7777).toString(8).padStart(4, '0')
    expect(stdout).toContain(`Access: (${octal}/`)
    expect(stdout).toContain(`Uid: (${String(expected.uid).padStart(5)}/ UNKNOWN)`)
    expect(stdout).toContain(`Gid: (${String(expected.gid).padStart(5)}/ UNKNOWN)`)
    // Times print in UTC with nanoseconds; fs.statSync resolves
    // milliseconds, so the comparison tolerance is milliseconds.
    const instants: readonly (readonly [string, number])[] = [
      ['Access', expected.atimeMs],
      ['Modify', expected.mtimeMs],
      ['Change', expected.ctimeMs],
    ]
    for (const [label, ms] of instants) {
      const line = stdout
        .split('\n')
        .find((entry) => entry.startsWith(`${label}: `) && /\d{4}-/u.test(entry))
      const match =
        /^(\w+): (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{9}) \+0000$/u.exec(line ?? '')
      expect(match, `${operand} ${label}`).not.toBeNull()
      if (match === null) throw new Error('Missing reported time')
      const reported =
        Date.UTC(
          Number(match[2]),
          Number(match[3]) - 1,
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
          Number(match[7]),
        ) +
        Number(match[8]) / 1e6
      expect(Math.abs(reported - ms), `${operand} ${label}`).toBeLessThan(5)
    }
    if (expected.birthtimeMs === 0) expect(stdout).toContain('Birth: -\n')
    else {
      const line = stdout.split('\n').find((entry) => entry.startsWith('Birth:'))
      expect(line, `${operand} Birth`).toMatch(/^Birth: \d{4}-/u)
    }
  }
}

/** A recursive stat and tool arguments that do not mirror the operands refuse. */
export async function expectStatMirrorRefusals(h: InspectCase, binary: string): Promise<void> {
  const recursive = await native(
    binary,
    h.args('stat', ['allowed.txt'], ['allowed.txt'], true),
    h.root,
  )
  expect(recursive.code).toBe(125)
  expect(recursive.stdout.length).toBe(0)
  expect(recursive.stderr).toContain('request')
  const count = await native(
    binary,
    h.args('stat', ['allowed.txt'], ['allowed.txt', 'allowed.txt']),
    h.root,
  )
  expect(count.code).toBe(125)
  expect(count.stdout.length).toBe(0)
  expect(count.stderr).toContain('request')
  const spelling = await native(
    binary,
    h.args('stat', ['allowed.txt', '.'], ['allowed.txt', 'allowed.txt']),
    h.root,
  )
  expect(spelling.code).toBe(125)
  expect(spelling.stdout.length).toBe(0)
  expect(spelling.stderr).toContain('request')
}

/** Walk-level refusals: the link dies in the no-follow open and the hard
link in the walk's link-count check, both before any report. */
export async function expectStatWalkLinkRefusals(h: InspectCase, binary: string): Promise<void> {
  symlinkSync(h.outside, path.join(h.workspace, 'link'))
  linkSync(h.outside, path.join(h.workspace, 'hardlink'))
  for (const operand of ['link', 'hardlink']) {
    const result = await native(binary, h.args('stat', [operand], [operand]), h.root)
    expect(result.code, operand).toBe(125)
    expect(result.stdout.length).toBe(0)
    expect(result.stderr).toContain('operand')
  }
}

/** The post-walk check refuses a link count raised after the walk. The
variant signals the parent once the walk is done; the parent adds a second
hard link inside that window. */
export async function expectStatNlinkRefusal(h: InspectCase, nlink: string): Promise<void> {
  const pending = native(
    nlink,
    h.args('stat', ['allowed.txt'], ['allowed.txt']),
    h.root,
    () => {
      linkSync(h.allowed, path.join(h.workspace, 'allowed.second'))
    },
    undefined,
    '{"walked":true}',
  )
  const result = await pending
  expect(result.code).toBe(125)
  expect(result.stdout.length).toBe(0)
  expect(result.stderr).toContain('operand')
}

/** More operands than the process may hold open refuse with the limit
reason; the same list answers on the plain binary, so the count itself
is lawful. */
export async function expectStatLimitsRefusal(
  h: InspectCase,
  binary: string,
  runLimited: (h: InspectCase, operands: string[]) => Promise<Receipt>,
): Promise<void> {
  const operands = Array.from({ length: 100 }, () => 'allowed.txt')
  const limited = await runLimited(h, operands)
  expect(limited.code).toBe(125)
  expect(limited.stdout.length).toBe(0)
  expect(limited.stderr).toContain('limits')
  const ample = await native(binary, h.args('stat', operands, operands), h.root)
  expect(ample.code, ample.stderr).toBe(0)
}

/** The post-walk checks refuse hostile shapes and accept files and folders. */
export async function expectStatShapeChecks(h: InspectCase, checks: string): Promise<void> {
  const result = await native(checks, [], h.root)
  expect(result.code, result.stderr).toBe(0)
  const stdout = result.stdout.toString()
  for (const line of [
    'ok regular',
    'ok directory',
    'ok symlink-refused',
    'ok foreign-device-refused',
    'ok hardlink-refused',
    'ok fifo-refused',
  ])
    expect(stdout, line).toContain(`${line}\n`)
  expect(stdout).not.toContain('FAIL')
}

/** The report reads the walked file when an ancestor is swapped for a link
mid-report. Outcome-driven rounds, not one fixed sleep: on a loaded machine
the swap lands before the walk (a refusal), on a fast one inside the
report's 200 ms delay (exit 0 with the walked file's bytes). */
export async function expectStatAncestorRace(
  fixture: () => Promise<InspectCase>,
  race: string,
): Promise<void> {
  async function raceFixture() {
    const h = await fixture()
    mkdirSync(path.join(h.workspace, 'src'))
    writeFileSync(path.join(h.workspace, 'src/a.txt'), 'ALLOWED_CANARY\n')
    mkdirSync(path.join(h.root, 'foreign'))
    writeFileSync(path.join(h.root, 'foreign/a.txt'), 'FORBIDDEN_CANARY_IS_LONGER\n')
    const original = statSync(path.join(h.workspace, 'src/a.txt'))
    const outside = statSync(path.join(h.root, 'foreign/a.txt'))
    expect(outside.size).not.toBe(original.size)
    const swap = () => {
      renameSync(path.join(h.workspace, 'src'), path.join(h.workspace, 'src.old'))
      symlinkSync(path.join(h.root, 'foreign'), path.join(h.workspace, 'src'))
    }
    return { h, original, outside, swap }
  }
  const seen = new Set<string>()
  for (let round = 0; round < 3 && !(seen.has('report') && seen.has('refused')); round++) {
    for (const delay of [0, 100 + 100 * round]) {
      const { h, original, outside, swap } = await raceFixture()
      const pending = native(race, h.args('stat', ['src/a.txt'], ['src/a.txt']), h.root)
      await new Promise((resolve) => setTimeout(resolve, delay))
      swap()
      const result = await pending
      // It never reports the outside file, whichever side wins.
      expect(result.stdout.toString()).not.toContain(`Size: ${String(outside.size)} `)
      if (result.code === 0) {
        expect(result.stderr).toMatch(/^\{"confined":true,/u)
        expect(result.stdout.toString()).toContain(`Size: ${String(original.size)} `)
        expect(result.stdout.toString()).toContain(`Inode: ${String(original.ino)} `)
        seen.add('report')
      } else {
        expect(result.code).toBe(125)
        expect(result.stdout.length).toBe(0)
        seen.add('refused')
      }
    }
  }
  if (!seen.has('refused')) {
    const { h, swap } = await raceFixture()
    swap()
    const control = await native(race, h.args('stat', ['src/a.txt'], ['src/a.txt']), h.root)
    expect(control.code).toBe(125)
    seen.add('refused')
  }
  expect(seen.has('report'), 'the ancestor swap never landed after the walk in 6 timed runs').toBe(
    true,
  )
  expect(
    seen.has('refused'),
    'the ancestor swap never landed before the walk in 6 timed runs',
  ).toBe(true)
}
