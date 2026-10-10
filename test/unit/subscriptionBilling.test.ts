// C-M95-SUB: subscription-billed Meta turns price as plan. Drives one
// fake turn per case and reads the recorded call the journal would settle.
import { describe, expect, it } from 'vitest'
import { Usd } from '../../src/shared/usd'
import type { Usage } from '../../src/core/backends/modelapi/schemas'
import type { RecordedCall, UsageRecording } from '../../src/core/usage/recording'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { FakeLogOutputChannel } from './helpers/fakes'
import { watchSessionTurns } from './helpers/sessionTurns'

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

async function runTurn(options: { subscriptionBilling: boolean; capUsd?: number }): Promise<{
  terminal: string | undefined
  contexts: { usage: Partial<Usage> | undefined; context: RecordedCall }[]
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
    return {
      terminal: completed?.type === 'turnCompleted' ? completed.terminal : undefined,
      contexts,
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
})
