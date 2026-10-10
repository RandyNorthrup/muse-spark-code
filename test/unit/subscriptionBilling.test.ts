// C-M95-SUB: subscription-billed Meta turns price as plan. Drives one
// fake turn per case and reads the recorded call the journal would settle.
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { Usage } from '../../src/core/backends/modelapi/schemas'
import type { RecordedCall, UsageRecording } from '../../src/core/usage/recording'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { memorySubscriptionFile } from './helpers/subscriptionFile'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'
import { certaintyLabel } from '../../src/webview/usage/display'

const MODEL = 'muse-spark-1.3'

function captureRecording(seen: { usage: Partial<Usage> | undefined; context: RecordedCall }[]) {
  const recording: UsageRecording = {
    note: (usage, context) => {
      seen.push({ usage, context })
    },
    limit: () => undefined,
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
  return recording
}

async function runTurn(options: {
  subscriptionBilling: boolean
  capUsd?: number
  showReplyUsage?: boolean
  searchOn?: boolean
}): Promise<{
  terminal: string | undefined
  contexts: { usage: Partial<Usage> | undefined; context: RecordedCall }[]
  spentUsd: number[]
  replyCosts: unknown[]
  searchNotices: string[]
  isSearchBound: boolean
}> {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const client = fakeModelApiClient(api, log)
  const contexts: { usage: Partial<Usage> | undefined; context: RecordedCall }[] = []
  const host = new ModelApiHost({
    ...fakeModelApiHostDeps({
      client,
      workspaceRoot: '/workspace',
      io: memoryToolIo({}, '/workspace'),
      log,
    }),
    usageRecording: captureRecording(contexts),
    ...(options.showReplyUsage === true && { showReplyUsage: () => true }),
    ...(options.searchOn === true && { isPaidFeatureOn: () => true }),
    ...(options.capUsd !== undefined && {
      sessionBudgetUsd: () => Usd.from(options.capUsd ?? 0).toAmount(),
      store: memorySessionStore(),
    }),
    isSubscriptionBilling: () => Promise.resolve(options.subscriptionBilling),
  })
  try {
    const session = await host.startSession({
      workspaceRoot: '/workspace',
      modelId: MODEL,
      approvalMode: 'allowAll',
    })
    const turns = watchSessionTurns(session)
    api.script({ text: 'answer', usage: { input: 100, output: 10, cached: 0 } })
    const done = turns.turnDone()
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await done
    const completed = turns.events.findLast((event) => event.type === 'turnCompleted')
    const budgets = await host.readUsageBudgets()
    const searchNotices = turns.events.flatMap((event) =>
      event.type === 'backendNotice' ? [event.text] : [],
    )
    const isSearchBound = api
      .responseBodies()
      .some((body) => JSON.stringify(body['tools'] ?? []).includes('web_search'))
    // The reply line's dollar cost rides beside its usage on the updated
    // item: present for pay-as-you-go, absent for a plan turn.
    const replyCosts: unknown[] = []
    for (const event of turns.events) {
      if (event.type === 'itemUpdated' && 'usage' in event.item) {
        replyCosts.push((event.item as { readonly costUsd?: unknown }).costUsd)
      }
    }
    return {
      terminal: completed?.type === 'turnCompleted' ? completed.terminal : undefined,
      contexts,
      spentUsd: budgets.map((budget) => budget.budget.spentUsd),
      replyCosts,
      searchNotices,
      isSearchBound,
    }
  } finally {
    await host.close()
  }
}

describe('subscription billing', () => {
  it('records plan pricing for a subscription-billed Meta turn', async () => {
    const turn = await runTurn({ subscriptionBilling: true })
    expect(turn.terminal).toBe('completed')
    expect(turn.contexts).toHaveLength(1)
    const first = turn.contexts[0]
    if (first === undefined) throw new Error('expected the subscription turn to record one call')
    // RecordedCall's explicit-undefined extras cannot spread into the
    // journal context under exactOptionalPropertyTypes; the fake turn sets
    // none of them, so they stay absent while the recorded pricing carries.
    const { pricing, providerCostUsd, uncertain, retainedLiabilityUsd, ...rest } = first.context
    expect(pricing).toEqual({ kind: 'plan' })
    expect(providerCostUsd).toBeUndefined()
    expect(uncertain).toBeDefined()
    expect(retainedLiabilityUsd).toBeUndefined()
    const record = createUsageRecord(first.usage, {
      ...rest,
      ...(pricing !== undefined && { pricing }),
      ...(uncertain !== undefined && { uncertain }),
      id: 'record',
      at: Date.now(),
      client: 'test',
    })
    expect(record.cost.certainty).toBe('plan')
    expect(record.cost).not.toHaveProperty('usd')
  })
  it('keeps pay-as-you-go pricing while the opt-in is off', async () => {
    const turn = await runTurn({ subscriptionBilling: false })
    expect(turn.terminal).toBe('completed')
    expect(turn.contexts).toHaveLength(1)
    expect(turn.contexts[0]?.context.pricing).toBeUndefined()
  })
  it('sends under a tiny dollar cap only on subscription billing', async () => {
    const denied = await runTurn({ subscriptionBilling: false, capUsd: 0.000001 })
    expect(denied.terminal).toBe('failed')
    expect(denied.contexts).toHaveLength(0)
    const allowed = await runTurn({ subscriptionBilling: true, capUsd: 0.000001 })
    expect(allowed.terminal).toBe('completed')
    expect(allowed.contexts[0]?.context.pricing).toEqual({ kind: 'plan' })
  })
  it('persists no dollar spend for a subscription-billed Meta turn', async () => {
    const plan = await runTurn({ subscriptionBilling: true, capUsd: 1 })
    expect(plan.terminal).toBe('completed')
    expect(plan.spentUsd).toEqual([0])
    const payg = await runTurn({ subscriptionBilling: false, capUsd: 1 })
    expect(payg.terminal).toBe('completed')
    expect(payg.spentUsd).toHaveLength(1)
    expect(payg.spentUsd[0]).toBeGreaterThan(0)
  })
  it('carries no dollar cost on the reply usage of a subscription turn', async () => {
    const plan = await runTurn({ subscriptionBilling: true, showReplyUsage: true })
    expect(plan.terminal).toBe('completed')
    expect(plan.replyCosts.length).toBeGreaterThan(0)
    for (const cost of plan.replyCosts) {
      expect(cost).toBeUndefined()
    }
    const payg = await runTurn({ subscriptionBilling: false, showReplyUsage: true })
    expect(payg.replyCosts.length).toBeGreaterThan(0)
    for (const cost of payg.replyCosts) {
      expect(cost).toBeDefined()
    }
  })
  it('keeps hosted search off a plan-billed turn instead of settling dollars', async () => {
    const plan = await runTurn({ subscriptionBilling: true, searchOn: true })
    expect(plan.terminal).toBe('completed')
    expect(plan.isSearchBound).toBe(false)
    expect(plan.searchNotices).toContain(UI_TEXT.subscriptionKey.paidNeedsKey)
    expect(plan.spentUsd).toEqual([0])
  })
})

describe('subscription rotation', () => {
  it('rebinds the account fences when the CLI rotates the key mid-conversation', async () => {
    // P2: the CLI rotates the credential between two turns of one
    // conversation. The fake wire accepts one hardcoded key, so both
    // turns fail there; what matters is that the second turn is
    // dispatched at all (the stale account fence no longer refuses the
    // new digest) and fails exactly like the first. Without the rebind
    // only one request is dispatched and the second turn fails refusing
    // the account instead of reaching the wire.
    const log = new FakeLogOutputChannel()
    const api = fakeModelApi()
    const { source, writeAccessToken } = memorySubscriptionFile()
    writeAccessToken('subscription-key-one')
    const credential = new SubscriptionCredential({
      credentials: { getApiKey: () => Promise.resolve(undefined) },
      isEnabled: () => true,
      platform: 'linux',
      homeDir: '/home/u',
      xdgConfigHome: undefined,
      source,
    })
    const digest = async (): Promise<string | undefined> => {
      const key = await credential.getApiKey()
      return key === undefined ? undefined : createHash('sha256').update(key).digest('hex')
    }
    const client = new ModelApiClient({
      ...fakeModelApiClientSettings(log),
      fetch: api.fetch,
      apiKey: () => credential.getApiKey(),
    })
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({
        client,
        workspaceRoot: '/workspace',
        io: memoryToolIo({}, '/workspace'),
        log,
      }),
      getAccountId: digest,
      isSubscriptionBilling: () => credential.isSubscriptionBilling(),
    })
    try {
      const session = await host.startSession({
        workspaceRoot: '/workspace',
        modelId: MODEL,
        approvalMode: 'allowAll',
      })
      const turns = watchSessionTurns(session)
      api.script({ text: 'first answer' })
      await session.sendTurn([{ type: 'text', text: 'hi' }])
      await turns.turnDone()
      writeAccessToken('subscription-key-two')
      api.script({ text: 'second answer' })
      await session.sendTurn([{ type: 'text', text: 'again' }])
      await turns.turnDone()
      const completed = turns.events.filter((event) => event.type === 'turnCompleted')
      expect(completed).toHaveLength(2)
      const reasons = turns.events.flatMap((event) =>
        event.type === 'turnCompleted' ? [event.reason] : [],
      )
      // Both turns reach the wire and fail on its hardcoded key alike.
      expect(reasons).toEqual(['bad key', 'bad key'])
      expect(api.requests.filter((request) => request.path === '/responses')).toHaveLength(2)
    } finally {
      await host.close()
    }
  })
})

describe('Muse Code plan label', () => {
  it('names a Meta plan row Muse Code plan and keeps every other plan row Plan', () => {
    expect(certaintyLabel('plan', 'meta')).toBe('Muse Code plan')
    expect(certaintyLabel('plan', undefined)).toBe('Plan')
    expect(certaintyLabel('plan', 'other')).toBe('Plan')
    expect(certaintyLabel('reported', 'meta')).toBe('Reported')
  })
})
