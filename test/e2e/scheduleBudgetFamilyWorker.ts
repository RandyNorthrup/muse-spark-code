import process from 'node:process'
import path from 'node:path'
import * as z from 'zod/mini'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { PAID_DAILY_BUDGET } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

async function main() {
  const [data, family, ownCap, sharedCap] = process.argv.slice(2)
  if (data === undefined || family === undefined || ownCap === undefined || sharedCap === undefined)
    throw new Error('missing budget family arguments')
  const now = new Date(2026, 9, 11, 12).getTime()
  const cap = Usd.from(sharedCap).toAmount()
  const budget =
    family === 'window'
      ? createPaidDailyBudget({
          directory: path.join(data, PAID_DAILY_BUDGET.directory),
          now: () => now,
          capUsd: () => cap,
          sleep: () => Promise.resolve(),
          isModelApi: () => true,
        })
      : createRuntimeDailyBudget({
          dataFolder: data,
          now: () => now,
          sleep: () => Promise.resolve(),
        })
  const job = fakeSchedule({
    paidCapUsd: Usd.from(ownCap).toAmount(),
    grant: { rules: [], destinationIds: [], paidCapUsd: Usd.from(ownCap).toAmount() },
    paidConsent: {
      scope: 'schedule',
      modelId: 'muse-spark-1.3',
      accountId: 'family-account',
      priceTier: 'standard',
      grantedAtMs: now,
      dailyCapUsd: Usd.from(ownCap).toAmount(),
      sharedDailyBudgetUsd: cap,
      extras: [],
      payerKind: 'paidKey',
    },
  })
  process.send?.({ phase: 'ready' })
  await new Promise<void>((resolve) =>
    process.once('message', (input: unknown) => {
      z.literal('reserve').parse(input)
      resolve()
    }),
  )
  try {
    const claim = await budget.reserveSchedule(
      job,
      Usd.from('0.6').toAmount(),
      new AbortController().signal,
    )
    await claim.settle(Usd.from('0.6').toAmount())
    process.send?.({ phase: 'reserved' })
  } catch {
    process.send?.({ phase: 'refused' })
  }
  process.disconnect()
}
void main().catch((error: unknown) => {
  process.stderr.write(String(error))
  process.exitCode = 1
})
