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
