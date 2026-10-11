import { usdAmountSchema } from '../../../../src/shared/usdSchema'
import { vi } from 'vitest'
import {
  AccountPool,
  type AccountPoolDeps,
  type AccountPoolRequest,
  type AccountRequestEstimate,
} from '../../../../src/core/accounts/pool'
import type {
  Account,
  AccountEvent,
  AccountJournalReader,
  AccountUsageTotals,
} from '../../../../src/shared/accounts'
import { parseUsd, usdDecimal, type Usd } from '../../../../src/shared/accountUsd'
import type { AccountLimitsSnapshot } from '../../../../src/core/accounts/thresholds'
import { policyRig } from './policy'

export const POOL_NOW = Date.parse('2026-10-06T12:00:00Z')
export function poolAccount(id: string, order: number, limitGroup?: string): Account {
  return {
    id,
    label: id,
    order,
    ...(limitGroup !== undefined && { limitGroup }),
    thresholds: {},
  }
}
export function poolRequest(patch: Partial<AccountPoolRequest> = {}): AccountPoolRequest {
  return {
    owner: 'main',
    budgetOwner: 'main',
    modelId: 'fake-model',
    kind: 'conversation',
    account: 'a',
    isInteractive: true,
    estimate: { costUsd: parseUsd('0.1'), inputTokens: 1, outputTokens: 1, requests: 1 },
    ...patch,
  }
}
export function poolRig(provider = 'anthropic', product = 'api') {
  const policy = policyRig(provider, product)
  const rows = [poolAccount('a', 0), poolAccount('b', 1), poolAccount('c', 2)]
  const blocks = new Map<string, AccountLimitsSnapshot>()
  const settled = new Map<string, Usd>()
  const counts = new Map<string, number>()
  const claims: {
    account: string
    estimate: AccountRequestEstimate
    actual: Usd | null | undefined
  }[] = []
  const events: AccountEvent[] = []
  const scores = new Map<string, bigint>([
    ['a', 1n],
    ['b', 2n],
    ['c', 3n],
  ])
  const settings = { isSwapOn: true, isParallelOn: true }
  const cap = { value: parseUsd('100') }
  const journal = (exclude?: (typeof claims)[number]): AccountJournalReader => ({
    read: (query): AccountUsageTotals => {
      let reserved = parseUsd(0),
        uncertain = parseUsd(0),
        requests = counts.get(query.account) ?? 0
      for (const claim of claims) {
        if (claim === exclude || claim.account !== query.account) continue
        if (claim.actual === undefined) {
          reserved += claim.estimate.costUsd
          requests += claim.estimate.requests
        } else if (claim.actual === null) {
          uncertain += claim.estimate.costUsd
          requests += claim.estimate.requests
        }
      }
      return {
        settledUsd: usdAmountSchema.parse(usdDecimal(settled.get(query.account) ?? parseUsd(0))),
        reservedUsd: usdAmountSchema.parse(usdDecimal(reserved)),
        uncertainUsd: usdAmountSchema.parse(usdDecimal(uncertain)),
        requests,
        inputTokens: 0,
        outputTokens: 0,
      }
    },
  })
  const total = () => {
    let value = parseUsd(0)
    for (const usd of settled.values()) value += usd
    for (const claim of claims)
      if (claim.actual === undefined || claim.actual === null) value += claim.estimate.costUsd
    return value
  }
  const deps: { -readonly [Key in keyof AccountPoolDeps]: AccountPoolDeps[Key] } = {
    provider,
    policy: policy.policy,
    accounts: () => rows,
    journal: journal(),
    limits: () => ({ read: (_provider, account) => blocks.get(account) ?? {} }),
    gate: policy.gate,
    now: () => POOL_NOW,
    usageUrl: 'https://example.test/usage',
    settings: () => settings,
    headroom: (account) => scores.get(account.id) ?? 0n,
    canUseModel: () => true,
    coldCache: vi.fn(() => parseUsd('0.02')),
    record: vi.fn((event: AccountEvent) => {
      events.push(event)
      return Promise.resolve()
    }),
    commit: vi.fn<AccountPoolDeps['commit']>((event, adopt) => {
      adopt()
      events.push(event)
    }),
    sharedGroupNotice: vi.fn(() => Promise.resolve()),
    reserve: vi.fn<AccountPoolDeps['reserve']>((account, estimate) => {
      const claim: (typeof claims)[number] = { account: account.id, estimate, actual: undefined }
      claims.push(claim)
      return Promise.resolve({
        journal: journal(claim),
        checkSharedCaps: () => {
          if (total() > cap.value) throw new Error('shared budget exceeded')
        },
        settle: (actual: Usd | null, hasSent: boolean) => {
          claim.actual = actual
          if (actual !== null && hasSent) {
            settled.set(account.id, (settled.get(account.id) ?? parseUsd(0)) + actual)
            counts.set(account.id, (counts.get(account.id) ?? 0) + estimate.requests)
          }
          return Promise.resolve()
        },
      })
    }),
  }
  const pool = new AccountPool(deps)
  const dispatch = vi.fn(async (admission: Parameters<Parameters<AccountPool['run']>[1]>[0]) => {
    admission.beforeSend()
    await Promise.resolve()
    return { value: admission.account, actualUsd: admission.estimate.costUsd }
  })
  const run = (patch: Partial<AccountPoolRequest> = {}) => pool.run(poolRequest(patch), dispatch)
  return {
    ...policy,
    pool,
    rows,
    blocks,
    settled,
    counts,
    claims,
    events,
    scores,
    settings,
    cap,
    deps,
    dispatch,
    run,
  }
}
