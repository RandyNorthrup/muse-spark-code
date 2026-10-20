// The standalone runtime's daily budget entry: missing records fall back
// to the default cap, while damaged or unreadable ones refuse as a typed
// spend-ledger failure (PLAN.md D208) and keep the cause.
import { mkdir, writeFile } from 'node:fs/promises'
import { usingTempDir } from './helpers/temporaryFolders'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { DAILY_SPEND_FOLDER, PAID_DAILY_BUDGET, SETTING_DEFAULTS } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const NOW = Date.UTC(2026, 9, 16, 12)
function day(): string {
  const date = new Date(NOW)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}

function refusesLedgerFailure(work: () => unknown, kind: 'damaged' | 'unreadable') {
  let failure: unknown
  try {
    work()
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toMatchObject({ name: 'SpendLedgerError', kind })
  expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
}

async function refusesEntryDamage(
  damage: (directory: string) => Promise<void>,
  kind: 'damaged' | 'unreadable',
) {
  setUiText(EN, BASE_LOCALE)
  await usingTempDir('muse-runtime-budget-', async (directory) => {
    await damage(directory)
    const entry = createRuntimeDailyBudget({
      dataFolder: directory,
      now: () => NOW,
      sleep: () => Promise.resolve(),
    })
    refusesLedgerFailure(() => entry.capUsd(), kind)
  })
}

describe('runtime daily budget entry', () => {
  it('falls back to the default cap when nothing is stored', async () => {
    setUiText(EN, BASE_LOCALE)
    await usingTempDir('muse-runtime-budget-', (directory) => {
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      expect(entry.capUsd()).toBe(Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount())
    })
  })

  it('refuses damaged settings with the ledger failure and keeps the cause', async () => {
    await refusesEntryDamage(
      (directory) => writeFile(path.join(directory, 'settings.json'), 'not json', 'utf8'),
      'damaged',
    )
  })

  it('refuses an unreadable settings file with the ledger failure and keeps the cause', async () => {
    await refusesEntryDamage(
      (directory) => mkdir(path.join(directory, 'settings.json')),
      'unreadable',
    )
  })

  it('refuses admission when the daily spend record is damaged', async () => {
    setUiText(EN, BASE_LOCALE)
    await usingTempDir('muse-runtime-budget-', async (directory) => {
      await writeFile(path.join(directory, 'settings.json'), '{"paidDailyBudgetUsd":10}', 'utf8')
      const records = path.join(directory, PAID_DAILY_BUDGET.directory, day(), DAILY_SPEND_FOLDER)
      await mkdir(records, { recursive: true })
      await writeFile(path.join(records, 'damaged.json'), '{', 'utf8')
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      refusesLedgerFailure(
        () => entry.admit(Usd.from(5).toAmount(), new AbortController().signal),
        'damaged',
      )
    })
  })
})
