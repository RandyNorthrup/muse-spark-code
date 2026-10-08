import { evaluateAccountThresholds } from '../../src/core/accounts/thresholds'
import { readFileSync } from 'node:fs'
import { verifyReport } from '../../src/core/reporting/render/canonical'
import { describe, expect, it } from 'vitest'
import { scheduleBudgetUsd } from '../../src/runtime/schedules/args'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { backgroundWakeRecordSchema } from '../../src/runtime/schedules/registration'
import { scrubUsage } from '../../src/core/reporting/sources/session'
import { batchTranscriptionQuestion } from '../../src/core/voice/transcribeBatch'
import { Usd, usdInputSchema } from '../../src/shared/usd'
import { schedulePaidConsentSchema, scheduleV2Schema } from '../../src/shared/scheduleV2'
import { isScheduleConsentCurrent } from '../../src/core/paid/paidConsent'
import { fakeSchedule } from './helpers/schedules/fixtures'

const usd = (value: string) => usdInputSchema.parse(value)
const rawUsage = {
  period: 'day',
  inputTokens: 1,
  outputTokens: 2,
  cachedTokens: null,
  costUsd: 0.1,
  certainty: 'reported',
  breakdown: [],
  limits: [],
}

describe('PORTS017 boundary precision and historical reads', () => {
  it('keeps account headroom below one nano-USD without rounding a cap or liability', () => {
    const zero = {
      settledUsd: usd('0'),
      reservedUsd: usd('0'),
      uncertainUsd: usd('0'),
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    }
    expect(
      evaluateAccountThresholds({
        provider: 'meta',
        account: { id: 'work', thresholds: { spendUsd: { day: 0.10000000001 } } },
        now: Date.parse('2026-10-08T12:00:00Z'),
        journal: { read: () => ({ ...zero, settledUsd: usd('0.1') }) },
        request: { ...zero, reservedUsd: usd('0.00000000001') },
      }),
    ).toEqual([])
  })

  it('verifies and migrates a saved numeric report without changing its file', () => {
    const bytes = readFileSync(
      new URL('../fixtures/reports/usage.money-v1.json.golden', import.meta.url),
      'utf8',
    )
    const input: unknown = JSON.parse(bytes)
    const migrated = verifyReport(input)
    expect(migrated.moneyVersion).toBe(2)
    const cells = migrated.sections.flatMap((section) =>
      section.rows.flatMap((row) => Object.values(row.cells)),
    )
    expect(cells.filter((cell) => cell.type === 'usd')).toHaveLength(2)
    expect(cells.find((cell) => cell.type === 'usd')).toMatchObject({ value: '0.1' })
    expect(
      cells
        .filter((cell) => cell.type === 'usd' && cell.value !== null)
        .every((cell) => typeof cell.value === 'string'),
    ).toBe(true)
  })
  it('keeps CLI and ACP schedule authorization exact below a binary float ulp', () => {
    expect(scheduleBudgetUsd('0.3000000000000000000000000001')).toBe(
      '0.3000000000000000000000000001',
    )
    expect(parseCommandLine(['--max-budget-usd', '0.3000000000000000000000000001'])).toMatchObject({
      options: { maxBudgetUsd: '0.3000000000000000000000000001' },
    })
    expect(
      Usd.from(scheduleBudgetUsd('0.1')!)
        .add(Usd.from(scheduleBudgetUsd('0.2')!))
        .toAmount(),
    ).toBe('0.3')
  })
  it.each(['NaN', 'Infinity', '-1', '1e999', '0x10'])('refuses invalid CLI budget %s', (input) => {
    expect(scheduleBudgetUsd(input)).toBeUndefined()
  })
  it('normalizes old numeric wake records at their versioned read boundary', () => {
    const record = backgroundWakeRecordSchema.parse({
      id: 'fixture',
      nextWakeAtMs: 1,
      executable: '/node',
      agentFile: '/agent',
      files: [],
      definitionSha256: 'a'.repeat(64),
      scheduledPrompts: true,
      maxBudgetUsd: 0.3,
    })
    expect(record.maxBudgetUsd).toBe('0.3')
    expect(record).toMatchObject({ moneyVersion: 2 })
  })
  it('parses historical reporting costs once and keeps canonical facts exact', () => {
    const legacy = scrubUsage(rawUsage, (text) => text)
    expect(legacy.costUsd).toBe('0.1')
    const exact = scrubUsage(
      { ...rawUsage, costUsd: usd('0.20000000000000000000001') },
      (text) => text,
    )
    expect(Usd.from(legacy.costUsd!).add(Usd.from(exact.costUsd!)).toAmount()).toBe(
      '0.30000000000000000000001',
    )
  })
  it.each([NaN, Infinity, -1, '0.10', '1e999'])('refuses corrupt reporting cost %s', (costUsd) => {
    expect(() => scrubUsage({ ...rawUsage, costUsd }, (text) => text)).toThrow()
  })
  it('reads legacy schedule v2 numeric consent into exact current amounts', () => {
    const schedule = scheduleV2Schema.parse({
      ...fakeSchedule(),
      paidCapUsd: 0.3,
      grant: { rules: [], destinationIds: [], paidCapUsd: 0.3 },
      paidConsent: {
        modelId: 'model',
        accountId: 'account',
        priceTier: 'tier',
        grantedAtMs: 0,
        dailyCapUsd: 0.3,
        sharedDailyBudgetUsd: 0.3,
        extras: [],
      },
    })
    expect(schedule.paidCapUsd).toBe('0.3')
    expect(schedule.paidConsent?.sharedDailyBudgetUsd).toBe('0.3')
    expect(
      isScheduleConsentCurrent(schedule, {
        modelId: 'model',
        accountId: 'account',
        priceTier: 'tier',
        price: 'fixture',
        sharedDailyBudgetUsd: usd('0.3'),
      }),
    ).toBe(true)
    expect(
      schedulePaidConsentSchema.safeParse({ ...schedule.paidConsent, dailyCapUsd: -1 }).success,
    ).toBe(false)
  })
  it('formats an exact batch voice budget without binary coercion', () => {
    expect(
      batchTranscriptionQuestion('fixture.wav', usd('0.3000000000000000000001')).detail,
    ).toContain('$0.31')
  })
})
