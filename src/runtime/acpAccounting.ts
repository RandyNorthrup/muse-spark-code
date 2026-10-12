// Read-only views of the same runtime daily ledger and settled usage journal.
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import * as z from 'zod/mini'
import { acpBudget, type AcpAccounting } from '../acp/accounting'
import type { UsageRecording } from '../core/usage/recording'
import type { RuntimeBackend } from './backends'
import { createSessionBudgetJournal } from '../host/backend/sessionBudgetJournal'
import { storeErrorCode } from '../host/backend/storeErrors'
import { Usd } from '../shared/usd'
import { PAID_DAILY_BUDGET, RUNTIME_SETTINGS_FILE, SETTING_DEFAULTS } from '../shared/constants'

const settingsSchema = z.object({
  paidDailyBudgetUsd: z.optional(
    z
      .number()
      .check(z.minimum(PAID_DAILY_BUDGET.minimumUsd), z.maximum(PAID_DAILY_BUDGET.maximumUsd)),
  ),
})
export function createAcpAccounting(options: {
  recording: UsageRecording
  isEnabled: () => boolean
  runtime: Pick<RuntimeBackend, 'readUsageBudgets'>
  dataFolder: string
  now: () => number
  sleep: (ms: number) => Promise<void>
}): AcpAccounting {
  const daily = createSessionBudgetJournal({
    directory: path.join(options.dataFolder, PAID_DAILY_BUDGET.directory),
    sleep: options.sleep,
    initialBudget: () =>
      Promise.resolve({ spentUsd: Usd.from(0).toAmount(), hasUnknownHistoricalFees: false }),
  })
  return {
    async readRecords(sessionId) {
      if (!options.isEnabled()) throw new Error('Usage history unavailable')
      const records = await (options.recording.records?.() ?? options.recording.today())
      return records.filter(
        (record) => record.session === sessionId || record.parentSession === sessionId,
      )
    },
    async readBudgets(sessionId) {
      let cap: number = SETTING_DEFAULTS.paidDailyBudgetUsd
      try {
        cap =
          settingsSchema.parse(
            JSON.parse(
              await readFile(path.join(options.dataFolder, RUNTIME_SETTINGS_FILE), 'utf8'),
            ),
          ).paidDailyBudgetUsd ?? cap
      } catch (error: unknown) {
        if (storeErrorCode(error) !== 'ENOENT') throw error
      }
      const date = new Date(options.now())
      const day = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
      const total = await daily.readExisting(day, PAID_DAILY_BUDGET.accountId)
      const budgets = [
        acpBudget(
          'daily',
          Usd.from(cap).toAmount(),
          total?.spentUsd ?? Usd.from(0).toAmount(),
          total?.uncertainUsd ?? Usd.from(0).toAmount(),
          total?.hasUnknownHistoricalFees ?? false,
        ),
      ]
      const snapshots = await options.runtime.readUsageBudgets()
      for (const { budget, exact } of snapshots) {
        if (budget.id !== sessionId || budget.kind !== 'conversation') continue
        if (exact === undefined) throw new Error('Exact usage budget unavailable')
        budgets.push(
          acpBudget(
            'session',
            Usd.from(exact.capUsd).compare(Usd.from(0)) === 0 ? undefined : exact.capUsd,
            exact.spentUsd,
            exact.uncertainUsd,
            exact.hasUnknownCost,
          ),
        )
      }
      return budgets
    },
  }
}
