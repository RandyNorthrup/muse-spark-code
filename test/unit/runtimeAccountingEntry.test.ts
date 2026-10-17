// The standalone runtime's daily budget entry: missing records fall back
// to the default cap, while damaged or unreadable ones refuse with the
// ledger sentence and keep the cause.
import { mkdir, writeFile } from 'node:fs/promises'
import { usingTempDir } from './helpers/temporaryFolders'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { SETTING_DEFAULTS, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'

const NOW = Date.UTC(2026, 9, 16, 12)
function day(): string {
  const date = new Date(NOW)
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
}

function refusesLedgerSentence(work: () => unknown) {
  let failure: unknown
  try {
    work()
  } catch (error: unknown) {
    failure = error
  }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof Error && failure.message).toBe(UI_TEXT.paidDailyLedgerUnavailable)
  expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
}

async function refusesEntryDamage(damage: (directory: string) => Promise<void>) {
  setUiText(EN, BASE_LOCALE)
  await usingTempDir('muse-runtime-budget-', async (directory) => {
    await damage(directory)
    const entry = createRuntimeDailyBudget({
      dataFolder: directory,
      now: () => NOW,
      sleep: () => Promise.resolve(),
    })
    refusesLedgerSentence(() => entry.capUsd())
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

  it('refuses damaged settings with the ledger sentence and keeps the cause', async () => {
    await refusesEntryDamage((directory) =>
      writeFile(path.join(directory, 'settings.json'), 'not json', 'utf8'),
    )
  })

  it('refuses an unreadable settings file with the ledger sentence and keeps the cause', async () => {
    await refusesEntryDamage((directory) => mkdir(path.join(directory, 'settings.json')))
  })

  it('refuses a damaged daily limit with the ledger sentence and keeps the cause', async () => {
    await refusesEntryDamage(async (directory) => {
      await mkdir(path.join(directory, 'paid-daily', day()), { recursive: true })
      await writeFile(path.join(directory, 'paid-daily', day(), 'limit.json'), 'not json', 'utf8')
    })
  })
})
