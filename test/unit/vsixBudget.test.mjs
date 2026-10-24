import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// The package job stops a release on this gate (PLAN.md D6, D209): a package
// of exactly the budget ships, one byte more does not. The number is the
// owner's decision of 2026-10-24 ("Move budget to measured +15%"): the
// win32-x64 VSIX measured 4,273,804 bytes, +15%, rounded up to 25 KiB.
const OWNERS_BUDGET_BYTES = 4_915_200
const SCRIPT = path.resolve('scripts', 'check-vsix-size.mjs')

const dir = mkdtempSync(path.join(tmpdir(), 'vsix-budget-'))
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

function packageOfSize(name, size) {
  const file = path.join(dir, name)
  writeFileSync(file, '')
  truncateSync(file, size)
  return file
}

function runGate(...files) {
  return spawnSync(process.execPath, [SCRIPT, ...files], { encoding: 'utf8' })
}

describe('the VSIX size gate', () => {
  it('accepts a package of exactly the budget and refuses one byte more', () => {
    const exact = runGate(packageOfSize('exact.vsix', OWNERS_BUDGET_BYTES))
    expect(exact.status).toBe(0)
    expect(exact.stdout).toContain(
      `VSIX: ${OWNERS_BUDGET_BYTES} bytes (budget ${OWNERS_BUDGET_BYTES})`,
    )

    const over = runGate(packageOfSize('over.vsix', OWNERS_BUDGET_BYTES + 1))
    expect(over.status).toBe(1)
    expect(over.stderr).toContain(
      `is ${OWNERS_BUDGET_BYTES + 1} bytes; budget is ${OWNERS_BUDGET_BYTES} bytes (4800 KiB)`,
    )
  })

  it('checks every package it is given, not only the first', () => {
    const ok = packageOfSize('first.vsix', 1000)
    const over = packageOfSize('second.vsix', OWNERS_BUDGET_BYTES + 1)
    const result = runGate(ok, over)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('second.vsix')
  })

  it('refuses a call with no package', () => {
    const result = runGate()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('At least one VSIX path required')
  })
})
