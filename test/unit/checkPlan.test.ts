import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Buffer } from 'node:buffer'
import { afterAll, describe, expect, it } from 'vitest'
import { PLAN_DRIFT_CASES, escapedCredentialCanary } from './helpers/planDrift'
import { REPORT_PLAN_MAX_BYTES } from '../../src/shared/constants'
import {
  PLAN_FORMAT_FIXTURE,
  QUALITY_LEDGER_FIXTURE,
  NO_PLAN_FIXTURE,
} from './helpers/reporting/plans'

const root = path.resolve(import.meta.dirname, '../..')
const env = {
  PATH: process.env['PATH'],
  SystemRoot: process.env['SystemRoot'],
  TEMP: process.env['TEMP'],
  TMP: process.env['TMP'],
}
const folder = mkdtempSync(path.join(os.tmpdir(), 'm113-check-plan-'))
afterAll(() => {
  rmSync(folder, { recursive: true, force: true })
})
function check(text: string, id?: string) {
  const file = path.join(folder, 'PLAN.md')
  writeFileSync(file, text)
  const args = [path.join(root, 'scripts/check-plan.mjs'), file]
  if (id) args.push(id)
  return spawnSync(process.execPath, args, { encoding: 'utf8', windowsHide: true, env })
}

describe('check:plan', () => {
  it('is mandatory in quality:gates and runs the entire repository without a baseline', () => {
    const pkg: unknown = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    expect(pkg).toHaveProperty('scripts.check:plan', 'node scripts/check-plan.mjs')
    expect(pkg).toHaveProperty('scripts.quality:gates', expect.stringContaining('check:plan'))
    const output = execFileSync(process.execPath, [path.join(root, 'scripts/check-plan.mjs')], {
      encoding: 'utf8',
      windowsHide: true,
      env,
    })
    expect(output).toContain('0 drift')
  })

  it.each(PLAN_DRIFT_CASES)(
    'fails $code with the parser message and original line',
    ({ code, text, line }) => {
      const result = check(text)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        `PLAN.md:${String(line)}: Plan format at line ${String(line)}: ${code}:`,
      )
    },
  )

  it.each([PLAN_FORMAT_FIXTURE, QUALITY_LEDGER_FIXTURE, NO_PLAN_FIXTURE])(
    'accepts the defined formats without inventing a plan',
    (text) => {
      expect(check(text).status).toBe(0)
    },
  )

  it('selects exact ids and returns exit 3 with nearest ids for an unknown milestone', () => {
    expect(check(PLAN_FORMAT_FIXTURE, '12').stdout).toContain('M12: planned')
    const unknown = check(PLAN_FORMAT_FIXTURE, 'M999')
    expect(unknown.status).toBe(3)
    expect(unknown.stderr).toContain('Nearest matches: M91b, M12')
  })

  it('fails malformed ledgers and missing files explicitly', () => {
    expect(check('```quality-ledger\n{}\n```').status).toBe(1)
    const missing = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-plan.mjs'), path.join(folder, 'absent.md')],
      { encoding: 'utf8', windowsHide: true, env },
    )
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain('could not be generated')
    const usage = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/check-plan.mjs'), '--unsupported'],
      { encoding: 'utf8', windowsHide: true, env },
    )
    expect(usage.status).toBe(2)
  })

  it('scrubs synthetic credential canaries from plan diagnostics and unknown ids', () => {
    const canary = `sk-${'A'.repeat(48)}`
    const broken = check(PLAN_FORMAT_FIXTURE.replace('planned.**', () => `${canary}.**`))
    expect(broken.status).toBe(1)
    expect(broken.stderr.includes(canary)).toBe(false)
    expect(broken.stderr).toContain('[redacted]')
    const unknown = check(PLAN_FORMAT_FIXTURE, canary)
    expect(unknown.status).toBe(3)
    expect(unknown.stderr.includes(canary)).toBe(false)
  })

  it('scrubs the decoded Unicode-escaped ledger reference canary from gate diagnostics', () => {
    const { canary, escaped } = escapedCredentialCanary()
    const text = QUALITY_LEDGER_FIXTURE.replace(
      '"depends_on":[]',
      () => `"depends_on":["${escaped}"]`,
    )
    const result = check(text)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('ledger-reference')
    expect(result.stderr.includes(canary)).toBe(false)
    expect(result.stderr).toContain('[redacted]')
    const unknown = check(PLAN_FORMAT_FIXTURE, escaped)
    expect(unknown.status).toBe(3)
    expect(unknown.stderr.includes(escaped)).toBe(false)
    expect(unknown.stderr).toContain('[redacted]')
  })

  it('refuses an oversized file with an explicit input-size diagnostic', () => {
    const result = check('x'.repeat(REPORT_PLAN_MAX_BYTES + 1))
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`input-size: maxUtf8Bytes=${String(REPORT_PLAN_MAX_BYTES)}`)
    expect(result.stdout).toBe('')
  })

  describe('archive guard', () => {
    // The gate fails well before the reader's bound, so the plan is archived
    // on a quiet day and not in the middle of the branch that crossed it.
    const archiveAt = Math.floor((REPORT_PLAN_MAX_BYTES * 85) / 100)
    /** The fixture padded, in its unparsed preamble, to exactly `total` bytes. */
    function sized(total: number): string {
      const cut = PLAN_FORMAT_FIXTURE.indexOf('\n## 2. ')
      const head = PLAN_FORMAT_FIXTURE.slice(0, cut)
      const tail = PLAN_FORMAT_FIXTURE.slice(cut)
      const line = `${'closed history, archived elsewhere. '.repeat(2)}\n`
      const room = total - Buffer.byteLength(head) - Buffer.byteLength(tail)
      const rest = room % line.length
      const text = `${head}${line.repeat(Math.floor(room / line.length))}${rest === 0 ? '' : `${'x'.repeat(rest - 1)}\n`}${tail}`
      expect(Buffer.byteLength(text)).toBe(total)
      return text
    }

    it('passes a plan at exactly 85% of the reader bound', () => {
      const result = check(sized(archiveAt))
      expect(result.stderr).toBe('')
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('0 drift')
    })

    it('fails one byte over, with the size, the line it crossed and the archive procedure', () => {
      const result = check(sized(archiveAt + 1))
      expect(result.status).toBe(1)
      expect(result.stdout).toBe('')
      expect(result.stderr).toContain(
        `PLAN.md is ${String(archiveAt + 1)} bytes, over 85% (${String(archiveAt)}) of the plan reader's ${String(REPORT_PLAN_MAX_BYTES)}-byte bound.`,
      )
      expect(result.stderr).toContain('Move closed history to docs/plan-archive/')
      expect(result.stderr).toContain('CONTRIBUTING.md, "Archiving closed history from PLAN.md"')
    })

    it('reports format drift first, as before, when an over-size plan also has it', () => {
      const result = check(sized(archiveAt + 1).replace('planned.**', 'not a status.**'))
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Plan format at line')
      expect(result.stderr).not.toContain('docs/plan-archive/')
    })

    it('names a procedure that CONTRIBUTING.md has, and applies to the repository plan', () => {
      const contributing = readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8')
      expect(contributing).toContain('\n## Archiving closed history from PLAN.md\n')
      const size = Buffer.byteLength(readFileSync(path.join(root, 'PLAN.md')))
      expect(size).toBeLessThanOrEqual(archiveAt)
    })
  })

  it.each(['oversized', 'growing'])(
    'bounds the actual gate file read for an %s file and always closes it',
    async (kind) => {
      const size = kind === 'oversized' ? REPORT_PLAN_MAX_BYTES + 1 : 0
      const gate = readFileSync(path.join(root, 'scripts/check-plan.mjs'), 'utf8')
        .replace(
          "import { open } from 'node:fs/promises'",
          () => `
          export const probe = { reads: 0, length: 0, closed: 0, messages: [], exitCode: 0 };
          const open = async () => ({
            stat: async () => ({ size: ${String(size)} }),
            read: async (_buffer, _offset, length) => {
              probe.reads += 1; probe.length = length;
              return { bytesRead: probe.reads === 1 && ${String(kind === 'growing')} ? ${String(REPORT_PLAN_MAX_BYTES + 1)} : 0 };
            },
            close: async () => { probe.closed += 1; }
          });
          const console = { error: (message) => probe.messages.push(message), log: () => {} };
        `,
        )
        .replace(
          "import process from 'node:process'",
          "const process = { argv: ['node', 'gate', 'fixture.md'], exitCode: 0 };",
        )
        .replace("'esbuild'", () => JSON.stringify(import.meta.resolve('esbuild')))
        .replace(
          "const root = path.resolve(import.meta.dirname, '..')",
          () => `const root = ${JSON.stringify(root)}`,
        )
      const result: unknown = await import(
        `data:text/javascript;base64,${Buffer.from(`${gate}\nprobe.exitCode = process.exitCode;`).toString('base64')}`
      )
      expect(result).toHaveProperty('probe.exitCode', 1)
      expect(result).toHaveProperty('probe.closed', 1)
      expect(result).toHaveProperty('probe.reads', kind === 'oversized' ? 0 : 1)
      expect(result).toHaveProperty(
        'probe.length',
        kind === 'oversized' ? 0 : REPORT_PLAN_MAX_BYTES + 1,
      )
      expect(result).toHaveProperty('probe.messages', [expect.stringContaining('input-size')])
    },
  )
})
