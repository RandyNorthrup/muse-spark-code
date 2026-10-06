import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PLAN_DRIFT_CASES } from './helpers/planDrift'
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
})
