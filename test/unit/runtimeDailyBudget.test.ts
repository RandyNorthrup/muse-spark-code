// The standalone runtime's daily budget over its real journal: every budget on
// one data folder reads the one shared cap from the settings file, and spend
// settled through one instance is enforced against the others.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { RUNTIME_SETTINGS_FILE } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

const noon = new Date(2026, 9, 11, 12).getTime()

function budget(dataFolder: string) {
  return createRuntimeDailyBudget({
    dataFolder,
    now: () => noon,
    sleep: () => Promise.resolve(),
  })
}

async function cappedFolder(capUsd: number) {
  const root = await mkdtemp(path.join(tmpdir(), 'runtime-daily-budget-'))
  await writeFile(
    path.join(root, RUNTIME_SETTINGS_FILE),
    JSON.stringify({ paidDailyBudgetUsd: capUsd }),
  )
  return root
}

describe('runtime daily budget', () => {
  it('reads the shared cap from the data-folder settings file', async () => {
    const root = await cappedFolder(1)
    try {
      expect(budget(root).capUsd()).toBe('1')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces spend settled through one instance against another on the same folder', async () => {
    const root = await cappedFolder(1)
    try {
      const first = budget(root)
      const second = budget(root)
      const claim = await first.reserve(Usd.from('0.6').toAmount(), new AbortController().signal)
      await claim.settle(Usd.from('0.6').toAmount())
      await expect(
        second.reserve(Usd.from('0.5').toAmount(), new AbortController().signal),
      ).rejects.toThrow()
      const fits = await second.reserve(Usd.from('0.4').toAmount(), new AbortController().signal)
      await fits.settle(Usd.from('0.4').toAmount())
      await expect(
        first.reserve(Usd.from('0.1').toAmount(), new AbortController().signal),
      ).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
