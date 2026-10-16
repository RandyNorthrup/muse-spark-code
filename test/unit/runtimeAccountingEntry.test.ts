// The standalone runtime's daily budget entry: missing records fall back
// to the default cap, while damaged or unreadable ones refuse with the
// ledger sentence and keep the cause.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
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

async function removeFolder(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true })
}

describe('runtime daily budget entry', () => {
  it('falls back to the default cap when nothing is stored', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-runtime-budget-'))
    try {
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      expect(entry.capUsd()).toBe(Usd.from(SETTING_DEFAULTS.paidDailyBudgetUsd).toAmount())
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses damaged settings with the ledger sentence and keeps the cause', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-runtime-budget-'))
    try {
      await writeFile(path.join(directory, 'settings.json'), 'not json', 'utf8')
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      let failure: unknown
      try {
        entry.capUsd()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toBe(UI_TEXT.paidDailyLedgerUnavailable)
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses an unreadable settings file with the ledger sentence and keeps the cause', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-runtime-budget-'))
    try {
      await mkdir(path.join(directory, 'settings.json'))
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      let failure: unknown
      try {
        entry.capUsd()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toBe(UI_TEXT.paidDailyLedgerUnavailable)
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
    } finally {
      await removeFolder(directory)
    }
  })

  it('refuses a damaged daily limit with the ledger sentence and keeps the cause', async () => {
    setUiText(EN, BASE_LOCALE)
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-runtime-budget-'))
    try {
      await mkdir(path.join(directory, 'paid-daily', day()), { recursive: true })
      await writeFile(path.join(directory, 'paid-daily', day(), 'limit.json'), 'not json', 'utf8')
      const entry = createRuntimeDailyBudget({
        dataFolder: directory,
        now: () => NOW,
        sleep: () => Promise.resolve(),
      })
      let failure: unknown
      try {
        entry.capUsd()
      } catch (error: unknown) {
        failure = error
      }
      expect(failure).toBeInstanceOf(Error)
      expect(failure instanceof Error && failure.message).toBe(UI_TEXT.paidDailyLedgerUnavailable)
      expect(failure instanceof Error && failure.cause instanceof Error).toBe(true)
    } finally {
      await removeFolder(directory)
    }
  })
})
