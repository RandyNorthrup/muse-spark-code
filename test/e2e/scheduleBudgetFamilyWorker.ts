import process from 'node:process'
import path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as z from 'zod/mini'
import { PaidAuthority } from '../../src/core/paid/paidAuthority'
import { readSharedDailyCapUsd, sharedDayScope } from '../../src/core/paid/sharedDailyCap'
import { createPaidDailyBudget } from '../../src/host/paid/paidDailyBudget'
import { createRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { PAID_DAILY_BUDGET } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { fakeSchedule } from '../unit/helpers/schedules/fixtures'

async function main() {
  const [data, family, ownCap, fileCap, settingCap] = process.argv.slice(2)
  if (
    data === undefined ||
    family === undefined ||
    ownCap === undefined ||
    fileCap === undefined ||
    settingCap === undefined
  )
    throw new Error('missing budget family arguments')
  // The single source both families read: the data-folder settings file. The
  // window's VS Code setting (settingCap) must NOT feed schedule caps, so the
  // two families can never enforce different shared caps on one ledger.
  mkdirSync(data, { recursive: true })
  writeFileSync(
    path.join(data, 'settings.json'),
    JSON.stringify({ paidDailyBudgetUsd: Number(fileCap) }),
  )
  const now = new Date(2026, 9, 11, 12).getTime()
  const budget =
    family === 'window'
      ? createPaidDailyBudget({
          authority: new PaidAuthority(),
          directory: path.join(data, PAID_DAILY_BUDGET.directory),
          legacyDirectory: path.join(data, 'legacy-paid-daily'),
          now: () => now,
          capUsd: () => Usd.from(settingCap).toAmount(),
          scheduleSharedCapUsd: () => readSharedDailyCapUsd(data, sharedDayScope(now)),
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
      sharedDailyBudgetUsd: Usd.from(ownCap).toAmount(),
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
