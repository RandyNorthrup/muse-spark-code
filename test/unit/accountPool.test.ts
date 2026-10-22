// M108 pool composition: the real AccountPool over the real journal,
// gate, confirmations, bundled policy and model catalogue, with durable
// state in a scratch directory. No fakes: every seam is bound the way the
// runtime owner binds it.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AccountPool,
  AccountPoolBusyError,
  AccountPoolStoppedError,
  accountColdCacheEstimate,
  type AccountPoolRequest,
} from '../../src/core/accounts/pool'
import { AccountPolicyGate } from '../../src/core/accounts/policyGate'
import { AccountConfirmations } from '../../src/core/accounts/confirmations'
import { accountPolicyFor } from '../../src/core/providers/accountPolicy'
import { AccountRequestJournal } from '../../src/runtime/providers/accountRequestJournal'
import { accountPeriodRange } from '../../src/core/accounts/thresholds'
import { modelPolicyFor } from '../../src/core/backends/modelapi/modelPolicy'
import { parseUsd, usdDecimal } from '../../src/shared/accountUsd'
import { Usd } from '../../src/shared/usd'
import { ACCOUNT_REQUEST_STORE, TOKENS_PER_MILLION, UI_TEXT } from '../../src/shared/constants'
import { accountEventSchema, type Account, type AccountEvent } from '../../src/shared/accounts'

const MODEL = 'muse-spark-1.3'
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

function account(id: string, order: number, overrides: Partial<Account> = {}): Account {
  return { id, label: `Label ${id}`, order, thresholds: {}, ...overrides }
}

function conversation(retryAccount?: string): AccountPoolRequest {
  return {
    ...(retryAccount !== undefined && { retryAccount }),
    owner: 'chat-1',
    budgetOwner: 'chat-1',
    modelId: MODEL,
    kind: 'conversation',
    account: 's1',
    estimate: { costUsd: parseUsd('0.05'), inputTokens: 100, outputTokens: 50, requests: 1 },
    isInteractive: true,
    checkSharedCaps: () => undefined,
  }
}

function worker(owner: string): AccountPoolRequest {
  return {
    owner,
    budgetOwner: owner,
    modelId: MODEL,
    kind: 'worker',
    account: 's1',
    estimate: { costUsd: parseUsd('0.05'), inputTokens: 100, outputTokens: 50, requests: 1 },
    isInteractive: false,
    hasPoolFlag: true,
    checkSharedCaps: () => undefined,
  }
}

async function storedEvents(directory: string): Promise<AccountEvent[]> {
  const events: AccountEvent[] = []
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.startsWith('event-') && entry.name.endsWith('.json'))
        events.push(accountEventSchema.parse(JSON.parse(await readFile(full, 'utf8'))))
    }
  }
  await walk(directory)
  return events
}

async function setup(rows: Account[]) {
  const dir = await mkdtemp(path.join(tmpdir(), 'account-pool-'))
  folders.push(dir)
  const journalDir = path.join(dir, ACCOUNT_REQUEST_STORE.directory)
  const journal = new AccountRequestJournal(journalDir, () => NOW)
  const asked = { count: 0, answers: [] as unknown[] }
  const confirmations = new AccountConfirmations({
    machineId: 'pool-test-machine',
    now: () => NOW,
    ask: () => {
      asked.count += 1
      const answer = asked.answers.shift()
      return answer === undefined
        ? Promise.reject(new Error('unexpected policy question'))
        : Promise.resolve(answer)
    },
    store: {
      read: async (provider, product) => {
        try {
          return JSON.parse(
            await readFile(path.join(dir, `confirmation-${provider}-${product}.json`), 'utf8'),
          ) as unknown
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return undefined
          throw error
        }
      },
      write: async (provider, product, value) => {
        await mkdir(dir, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
        await writeFile(
          path.join(dir, `confirmation-${provider}-${product}.json`),
          JSON.stringify(value),
          { mode: ACCOUNT_REQUEST_STORE.fileMode },
        )
      },
      remove: async (provider, product) => {
        await rm(path.join(dir, `confirmation-${provider}-${product}.json`), { force: true })
      },
    },
  })
  const published: AccountEvent[] = []
  const pool = new AccountPool({
    provider: 'meta',
    readSelection: (owner) => journal.selection('meta', owner),
    writeSelection: (owner, selected) => {
      journal.select('meta', owner, selected)
    },
    accounts: () => rows,
    policy: () => accountPolicyFor('meta', 'model-api'),
    journal,
    limits: () => ({
      read: (provider, id) =>
        journal.limits(
          provider,
          id,
          rows.find((row) => row.id === id),
        ),
    }),
    gate: new AccountPolicyGate(confirmations),
    now: () => NOW,
    usageUrl: 'https://example.test/usage',
    settings: () => ({ isSwapOn: true, isParallelOn: true }),
    headroom: (row) => journal.headroom(row, 'meta'),
    canUseModel: (_row, request) => modelPolicyFor(request.modelId).identity.provider === 'meta',
    coldCache: (_previous, _next, request) => {
      const pricing = modelPolicyFor(request.modelId).pricing
      if (pricing.kind !== 'priced') throw new Error(UI_TEXT.execModelUnpriced)
      return accountColdCacheEstimate(
        request.estimate.inputTokens,
        Usd.from(pricing.card.input).times(TOKENS_PER_MILLION).toAmount(),
      )
    },
    reserve: (row, estimate, request) =>
      Promise.resolve(journal.reserve('meta', row.id, estimate, request)),
    record: (event) => {
      journal.record(event)
      return Promise.resolve()
    },
    commit: (event, adopt) => {
      journal.commit(event, adopt)
      published.push(event)
    },
    sharedGroupNotice: () => Promise.reject(new Error(UI_TEXT.accounts.vendorLimit)),
  })
  return { dir, journalDir, journal, pool, asked, published }
}

function totalsOf(harness: Awaited<ReturnType<typeof setup>>, id: string) {
  return harness.journal.read({
    provider: 'meta',
    account: id,
    ...accountPeriodRange('day', NOW),
  })
}

/** A pid the operating system reports as never having run. */
function findDeadPid(): number {
  for (let pid = 1_000_000_000; pid < 1_000_001_000; pid += 1) {
    try {
      process.kill(pid, 0)
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH')
        return pid
    }
  }
  throw new Error('no dead pid found')
}

describe('M108 account pool composition', () => {
  it('uses the priced catalogue tariff for the swap cold-cache estimate', () => {
    const pricing = modelPolicyFor(MODEL).pricing
    expect(pricing.kind).toBe('priced')
  })

  it('admits the current account and settles its spend to its own journal', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const request = conversation()
    const admitted = await harness.pool.acquire(request)
    expect(admitted.account).toBe('s1')
    expect(admitted.estimate).toEqual(request.estimate)
    admitted.beforeSend()
    await admitted.settle(parseUsd('0.04'))
    expect(totalsOf(harness, 's1').settledUsd).toBe('0.04')
    expect(totalsOf(harness, 's2')).toEqual({
      settledUsd: '0',
      reservedUsd: '0',
      uncertainUsd: '0',
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    })
    expect(harness.published).toEqual([])
  })

  it('fails over to s2 when s1 is out of credit, and records the swap durably', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    harness.asked.answers.push('confirm')
    const resetAt = new Date(NOW + 3_600_000).toISOString()
    harness.journal.block('meta', 's1', resetAt)
    const request = conversation()
    const admitted = await harness.pool.acquire(request)
    expect(admitted.account).toBe('s2')
    // The reservation carries the re-read of the context on the new account.
    expect(admitted.estimate.costUsd > request.estimate.costUsd).toBe(true)
    admitted.beforeSend()
    await admitted.settle(parseUsd('0.02'))
    expect(harness.published).toHaveLength(1)
    const swap = harness.published[0]
    expect(swap).toMatchObject({
      type: 'swap',
      provider: 'meta',
      account: 's2',
      previousAccount: 's1',
      trigger: { kind: 'vendorLimit', reason: 'rateLimited', resetAt },
    })
    const stored = await storedEvents(harness.journalDir)
    expect(stored.filter((event) => event.type === 'swap')).toHaveLength(1)
    expect(totalsOf(harness, 's2').settledUsd).toBe('0.02')
    expect(totalsOf(harness, 's1').settledUsd).toBe('0')
    // A reopened journal keeps the spend on s2 and the live block on s1.
    const reopened = new AccountRequestJournal(harness.journalDir, () => NOW)
    expect(
      reopened.read({ provider: 'meta', account: 's2', ...accountPeriodRange('day', NOW) })
        .settledUsd,
    ).toBe('0.02')
    expect(reopened.limits('meta', 's1', { id: 's1' })).toEqual({
      blocked: { reason: 'rateLimited', resetAt },
    })
  })

  it('stops with the earliest recovery when every account is limited', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    harness.asked.answers.push('confirm')
    const later = new Date(NOW + 7_200_000).toISOString()
    const earlier = new Date(NOW + 3_600_000).toISOString()
    harness.journal.block('meta', 's1', later)
    harness.journal.block('meta', 's2', earlier)
    let failure: unknown = 'admitted'
    try {
      await harness.pool.acquire(conversation())
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AccountPoolStoppedError)
    const stopped = failure as AccountPoolStoppedError
    expect(stopped.trigger?.kind).toBe('vendorLimit')
    expect(stopped.resetAt).toBe(earlier)
    expect(stopped.usageUrl).toBe('https://example.test/usage')
    expect(harness.asked.count).toBe(1)
    const stored = await storedEvents(harness.journalDir)
    expect(stored.filter((event) => event.type === 'stop')).toHaveLength(1)
  })

  it('swaps on a user cap without asking, since no vendor limit is crossed', async () => {
    const harness = await setup([
      account('s1', 0, { thresholds: { spendUsd: { day: '0.01' } } }),
      account('s2', 1),
    ])
    const admitted = await harness.pool.acquire(conversation())
    expect(admitted.account).toBe('s2')
    expect(harness.asked.count).toBe(0)
    admitted.beforeSend()
    await admitted.settle(parseUsd('0.04'))
    expect(harness.published).toHaveLength(1)
    expect(harness.published[0]).toMatchObject({
      type: 'swap',
      previousAccount: 's1',
      account: 's2',
      trigger: { kind: 'userCap', metric: 'spendUsd', period: 'day' },
    })
  })

  it('queues a mid-chat selection for the next request, never the admitted payer', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const first = await harness.pool.acquire(conversation())
    expect(first.account).toBe('s1')
    expect(() => {
      harness.pool.use('conversation', 'chat-1', 's2', () => true)
    }).toThrow(AccountPoolBusyError)
    first.beforeSend()
    harness.pool.useNext('conversation', 'chat-1', 's2', () => true)
    expect(harness.pool.current('conversation', 'chat-1')).toBe('s2')
    expect(harness.pool.currentWithoutNext('conversation', 'chat-1')).toBe('s1')
    await first.settle(parseUsd('0.01'))
    const second = await harness.pool.acquire(conversation())
    expect(second.account).toBe('s2')
    second.beforeSend()
    await second.settle(parseUsd('0.01'))
    expect(totalsOf(harness, 's1').settledUsd).toBe('0.01')
    expect(totalsOf(harness, 's2').settledUsd).toBe('0.01')
  })

  it('spreads worker requests by headroom and records the spread', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const priming = await harness.pool.acquire(conversation())
    priming.beforeSend()
    await priming.settle(parseUsd('0.01'))
    const admitted = await harness.pool.acquire(worker('worker-1'))
    expect(admitted.account).toBe('s2')
    expect(harness.asked.count).toBe(0)
    admitted.beforeSend()
    await admitted.settle(parseUsd('0.01'))
    expect(harness.published).toEqual([
      expect.objectContaining({ type: 'spread', account: 's2', workerId: 'worker-1' }),
    ])
  })

  it('refunds a reservation that never sends to zero', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const admitted = await harness.pool.acquire(conversation())
    await admitted.settle(parseUsd('0'))
    expect(totalsOf(harness, 's1')).toEqual({
      settledUsd: '0',
      reservedUsd: '0',
      uncertainUsd: '0',
      inputTokens: 0,
      outputTokens: 0,
      requests: 0,
    })
  })

  it('keeps a crashed send as full liability on its own account', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const request = conversation()
    const claim = harness.journal.reserve('meta', 's1', request.estimate, request)
    claim.started()
    // The owning process is gone; only its open claim row survives.
    const bucket = new Date(NOW).toISOString().slice(0, '2026-10-22'.length)
    const names = await readdir(path.join(harness.journalDir, bucket))
    const claimName = names.find((name) => name.startsWith('claim-'))
    if (claimName === undefined) throw new Error('missing claim row')
    const claimFile = path.join(harness.journalDir, bucket, claimName)
    const row = JSON.parse(await readFile(claimFile, 'utf8')) as { processId: number }
    await writeFile(claimFile, JSON.stringify({ ...row, processId: findDeadPid() }))
    const reopened = new AccountRequestJournal(harness.journalDir, () => NOW)
    const recovered = reopened.read({
      provider: 'meta',
      account: 's1',
      ...accountPeriodRange('day', NOW),
    })
    expect(recovered.settledUsd).toBe('0')
    expect(recovered.uncertainUsd).toBe(usdDecimal(request.estimate.costUsd))
    expect(recovered.requests).toBe(1)
    expect(totalsOf(harness, 's2').uncertainUsd).toBe('0')
    // Recovery closes the row: a second read is stable, not doubled.
    const again = reopened.read({
      provider: 'meta',
      account: 's1',
      ...accountPeriodRange('day', NOW),
    })
    expect(again.uncertainUsd).toBe(recovered.uncertainUsd)
    expect((JSON.parse(await readFile(claimFile, 'utf8')) as { isClosed: boolean }).isClosed).toBe(
      true,
    )
  })

  it('stops a pinned retry on its own payer instead of swapping it away', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    const resetAt = new Date(NOW + 3_600_000).toISOString()
    harness.journal.block('meta', 's1', resetAt)
    // The Judge pins its side request so it stops rather than paying on
    // an account nobody chose for it: no question, no swap.
    let failure: unknown = 'admitted'
    try {
      await harness.pool.acquire(conversation('s1'))
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AccountPoolStoppedError)
    expect((failure as AccountPoolStoppedError).trigger).toMatchObject({
      kind: 'vendorLimit',
      reason: 'rateLimited',
      resetAt,
    })
    expect(harness.asked.count).toBe(0)
    expect(harness.published).toEqual([])
  })

  it('fails a dropped pin over to the healthy account on the next admission', async () => {
    const harness = await setup([account('s1', 0), account('s2', 1)])
    harness.asked.answers.push('confirm')
    const first = await harness.pool.acquire(conversation())
    expect(first.account).toBe('s1')
    first.beforeSend()
    await first.settle(parseUsd('0.01'))
    // The transport's 429 observation durably blocks s1; the host drops
    // the payer pin and retries, so the pool re-admits unpinned.
    const resetAt = new Date(NOW + 3_600_000).toISOString()
    harness.journal.block('meta', 's1', resetAt)
    const second = await harness.pool.acquire(conversation())
    expect(second.account).toBe('s2')
    second.beforeSend()
    await second.settle(parseUsd('0.01'))
    expect(harness.published).toHaveLength(1)
    expect(harness.published[0]).toMatchObject({
      type: 'swap',
      previousAccount: 's1',
      account: 's2',
      trigger: { kind: 'vendorLimit', reason: 'rateLimited', resetAt },
    })
    expect(totalsOf(harness, 's1').settledUsd).toBe('0.01')
    expect(totalsOf(harness, 's2').settledUsd).toBe('0.01')
  })

  it('refuses to escape a live group block onto a second key', async () => {
    const harness = await setup([
      account('s1', 0, { limitGroup: 'team' }),
      account('s2', 1, { limitGroup: 'team' }),
    ])
    harness.asked.answers.push('confirm')
    const resetAt = new Date(NOW + 3_600_000).toISOString()
    harness.journal.block('meta', 's1', resetAt, {
      account: 's1',
      limitGroup: 'team',
      scope: 'group',
      expiresAt: Date.parse(resetAt),
    })
    await expect(harness.pool.acquire(conversation())).rejects.toThrow(UI_TEXT.accounts.vendorLimit)
  })
})
