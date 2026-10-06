import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import {
  accountSchema,
  accountThresholdsSchema,
  accountTriggerSchema,
  accountEventSchema,
  accountConfirmationSchema,
  type Account,
  type AccountThresholds,
  type AccountConfirmation,
} from '../../src/shared/accounts'
import { providersAccountsSchema } from '../../src/core/providers/providersFile'
import { usageAccountFields } from '../../src/shared/usageJournal'
import { deviceAccountHeadroomSchema } from '../../src/shared/devices'
import {
  accountsRequestSchema,
  accountsReplySchema,
  type AccountsRequest,
  type AccountsReply,
} from '../../src/shared/hostApi/accounts'
import { ACCOUNT_DEFAULT_ID, ACCOUNT_DEFAULTS } from '../../src/shared/constants'

const account: Account = { id: 'work', label: 'Work', order: 0, thresholds: {} }
const time = '2026-10-05T12:00:00.000Z'
const trigger = {
  kind: 'userCap',
  metric: 'spendUsd',
  period: 'day',
  value: 20,
  threshold: 20,
  resetAt: time,
}

describe('M108 local accounts contracts', () => {
  it('preserves the default credential identity and enhancement defaults', () => {
    expect(ACCOUNT_DEFAULT_ID).toBe('default')
    expect([ACCOUNT_DEFAULTS.isSwapOn, ACCOUNT_DEFAULTS.isParallelOn]).toEqual([true, true])
    expect(accountSchema.parse({ ...account, id: ACCOUNT_DEFAULT_ID })).toEqual({
      ...account,
      id: 'default',
    })
  })

  it.each(['A', '1a', '', 'a'.repeat(33), '../secret', 'work@example.com'])(
    'rejects invalid account id %s',
    (id) => {
      expect(accountSchema.safeParse({ ...account, id }).success).toBe(false)
    },
  )

  it('validates labels, order, groups, uniqueness and the pool bound', () => {
    for (const update of [
      { label: ' ' },
      { label: '\nWork' },
      { label: 'a'.repeat(129) },
      { order: -1 },
      { order: 0.5 },
      { limitGroup: '' },
    ]) {
      expect(accountSchema.safeParse({ ...account, ...update }).success).toBe(false)
    }
    expect(providersAccountsSchema.safeParse([account, account]).success).toBe(false)
    expect(
      providersAccountsSchema.safeParse(
        Array.from({ length: 65 }, (_, i) => ({ ...account, id: `a${String(i)}` })),
      ).success,
    ).toBe(false)
    expect(
      providersAccountsSchema.parse([account, { ...account, id: 'personal', limitGroup: 'team' }]),
    ).toHaveLength(2)
  })

  it('accepts all configured periods, zero caps and percentage endpoints', () => {
    const thresholds: AccountThresholds = accountThresholdsSchema.parse({
      spendUsd: { day: 0, week: 20, month: 50 },
      inputTokens: { day: 1, week: 2, month: 100 },
      outputTokens: { month: 100 },
      requests: { day: 1 },
      planWindowPercent: { 'five-hour': 100, weekly: 0 },
      rateLimitHeadroomPercent: { requests: 0, tokens: 100 },
    })
    expect(thresholds.spendUsd?.day).toBe(0)
  })

  it.each([
    { spendUsd: { day: -1 } },
    { spendUsd: { day: Infinity } },
    { inputTokens: { month: 0.5 } },
    { outputTokens: { day: NaN } },
    { requests: { day: Number.MAX_SAFE_INTEGER + 1 } },
    { planWindowPercent: { weekly: 101 } },
    { rateLimitHeadroomPercent: { tokens: -1 } },
    { spendUsd: { year: 1 } },
    { budgetUsd: 100 },
  ])('rejects malformed threshold %j', (thresholds) => {
    expect(accountThresholdsSchema.safeParse(thresholds).success).toBe(false)
  })

  it('keeps vendor limits distinct from user caps', () => {
    expect(accountTriggerSchema.parse(trigger).kind).toBe('userCap')
    expect(
      accountTriggerSchema.parse({ kind: 'vendorLimit', reason: 'rateLimited', resetAt: time })
        .kind,
    ).toBe('vendorLimit')
    expect(accountTriggerSchema.safeParse({ ...trigger, kind: 'vendorLimit' }).success).toBe(false)
  })

  it('rejects credentials at configuration and bridge boundaries', () => {
    const canary = 'planted-only-account-secret'
    const request: AccountsRequest = { type: 'accounts/add', provider: 'meta', account }
    for (const field of ['apiKey', 'accessToken', 'credential', 'secret']) {
      expect(accountSchema.safeParse({ ...account, [field]: canary }).success).toBe(false)
      expect(
        accountsRequestSchema.safeParse({
          ...request,
          [field]: canary,
        }).success,
      ).toBe(false)
    }
    expect(
      accountsRequestSchema.safeParse({
        type: 'accounts/add',
        provider: 'meta',
        account: { ...account, apiKey: canary },
      }).success,
    ).toBe(false)
  })

  it('rejects labels and secrets in persisted events and journal records', () => {
    const event = {
      type: 'swap',
      provider: 'meta',
      account: 'personal',
      previousAccount: 'work',
      time,
      trigger,
      coldCacheUsd: 0.01,
    }
    expect(accountEventSchema.parse(event)).toEqual(event)
    const journalRecord = z.strictObject({ time: z.iso.datetime(), ...usageAccountFields })
    expect(journalRecord.parse({ time })).toEqual({ time })
    expect(journalRecord.parse({ time, account: 'work' })).toEqual({ time, account: 'work' })
    for (const field of ['label', 'accountLabel', 'apiKey']) {
      expect(accountEventSchema.safeParse({ ...event, [field]: 'canary' }).success).toBe(false)
      expect(journalRecord.safeParse({ time, account: 'work', [field]: 'canary' }).success).toBe(
        false,
      )
    }
    expect(accountEventSchema.safeParse({ ...event, coldCacheUsd: -1 }).success).toBe(false)
  })

  it('offers only provider headroom to another device', () => {
    expect(
      deviceAccountHeadroomSchema.parse({ meta: 'ample', openai: 'some', groq: 'none' }),
    ).toEqual({ meta: 'ample', openai: 'some', groq: 'none' })
    for (const value of [
      { account: 'work' },
      { label: 'Work' },
      { credential: 'canary' },
      'work',
    ]) {
      expect(deviceAccountHeadroomSchema.safeParse({ meta: value }).success).toBe(false)
    }
  })

  it('binds local confirmations to machine, product and record', () => {
    const confirmation: AccountConfirmation = {
      machineId: 'rig',
      provider: 'meta',
      product: 'model-api',
      recordVersion: '2026-10-05.1',
      recordCheckedAt: '2026-10-05',
      answeredAt: time,
      choice: 'ownCapsOnly',
    }
    expect(accountConfirmationSchema.parse(confirmation)).toEqual(confirmation)
    expect(
      accountConfirmationSchema.safeParse({ ...confirmation, recordVersion: '' }).success,
    ).toBe(false)
    expect(
      accountConfirmationSchema.safeParse({ ...confirmation, recordCheckedAt: 'yesterday' })
        .success,
    ).toBe(false)
    expect(
      accountsRequestSchema.safeParse({
        type: 'accounts/confirm',
        provider: 'meta',
        product: 'model-api',
        choice: 'confirm',
        machineId: 'forged',
      }).success,
    ).toBe(false)
    expect(
      accountsRequestSchema.safeParse({
        type: 'accounts/order',
        provider: 'meta',
        accounts: ['work', 'work'],
      }).success,
    ).toBe(false)
  })

  it('validates account state and notices in replies without accepting raw errors', () => {
    const state: AccountsReply = {
      type: 'accounts/state',
      provider: 'meta',
      accounts: [account],
      currentAccount: 'work',
      isSwapOn: true,
      isParallelOn: true,
    }
    expect(accountsReplySchema.parse(state)).toEqual(state)
    expect(accountsReplySchema.safeParse({ ...state, currentAccount: 'missing' }).success).toBe(
      false,
    )
    expect(accountsReplySchema.safeParse({ ...state, accounts: [account, account] }).success).toBe(
      false,
    )
    expect(accountsReplySchema.safeParse({ ...state, apiKey: 'canary' }).success).toBe(false)
    const event = { type: 'stop', provider: 'meta', account: 'work', time, trigger }
    expect(accountsReplySchema.parse({ type: 'accounts/notice', event })).toEqual({
      type: 'accounts/notice',
      event,
    })
    expect(
      accountsReplySchema.safeParse({
        type: 'accounts/notice',
        event: { ...event, accountLabel: 'Work' },
      }).success,
    ).toBe(false)
    expect(accountsReplySchema.parse({ type: 'accounts/error', code: 'unavailable' })).toEqual({
      type: 'accounts/error',
      code: 'unavailable',
    })
    expect(
      accountsReplySchema.safeParse({
        type: 'accounts/error',
        code: 'unavailable',
        message: 'canary',
      }).success,
    ).toBe(false)
    expect(accountsReplySchema.safeParse({ type: 'accounts/error', code: 'canary' }).success).toBe(
      false,
    )
  })
})
