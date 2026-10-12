import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { estimateCostUsd } from '../../src/core/usage/insights'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import type { UsageRecord } from '../../src/shared/usageJournal'
import { UI_TEXT, CREDENTIAL_STORE_ERROR_KIND } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import { FakeAgentHost } from './helpers/fakeAgent'
import { dogfoodAgentDeps, dogfoodSession, dogfoodPrompt } from './helpers/acpDogfood'

const cwd = path.resolve('/work/app')
function scene(isAvailable = true) {
  const host = new FakeAgentHost()
  const records: UsageRecord[] = []
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const readRecords = vi.fn(() =>
    isAvailable ? Promise.resolve(records) : Promise.reject(new Error('private journal path')),
  )
  const deps = {
    ...dogfoodAgentDeps(host, log),
    defaultCwd: cwd,
    accounting: {
      readRecords,
      readBudgets: () =>
        Promise.resolve([
          {
            scope: 'daily' as const,
            capUsd: Usd.from(1).toAmount(),
            spentUsd: Usd.from('0.000548').toAmount(),
            remainingUsd: Usd.from('0.999452').toAmount(),
            uncertainUsd: Usd.from(0).toAmount(),
            hasUnknownCost: false,
          },
        ]),
    },
  }
  const agent = createAcpAgent(deps)
  const client = acp.client({ name: 'accounting' }).onNotification('session/update', (context) => {
    updates.push(context.params.update)
  })
  return {
    host,
    records,
    updates,
    log,
    reads: readRecords,
    run: <T>(work: (client: acp.ClientContext) => Promise<T>) => client.connectWith(agent, work),
  }
}
function record(sessionId: string, turn: string, id: string) {
  const context = {
    id,
    at: 100,
    startedAt: 1,
    client: 'accounting',
    backend: 'modelApi',
    provider: 'anthropic',
    model: 'claude',
    kind: 'turn',
    outcome: 'completed',
    session: sessionId,
    turn,
    pricing: {
      kind: 'priced',
      card: {
        input: 0.000004,
        cachedInput: 0.0000004,
        cacheWrite: 0.000005,
        cacheWrite1h: 0.000008,
        output: 0.000016,
        source: 'catalogue',
      },
    },
  } as const
  return createUsageRecord(
    {
      input_tokens: 100,
      output_tokens: 10,
      input_tokens_details: {
        cached_tokens: 20,
        cache_write_tokens: 30,
        cache_write_tokens_1h: 10,
      },
      output_tokens_details: { reasoning_tokens: 2 },
    },
    context,
  )
}

describe('ACPDOG ACP accounting extensions', () => {
  it('reads the settled figures once, on completion, never per token event', async () => {
    const h = scene()
    await h.run(async (client) => {
      const { sessionId } = await dogfoodSession(client, cwd)
      h.records.push(record(sessionId, 'old-turn', 'old'))
      const running = dogfoodPrompt(client, sessionId, 'task')
      await vi.waitFor(() => {
        expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
      })
      const session = h.host.sessions[0]!
      // Token events never touch the journal (finding 4): three samples and
      // no read.
      for (let sample = 0; sample < 3; sample++) {
        session.emit({
          type: 'tokenUsage',
          modelId: session.modelId,
          inputTokens: 200,
          outputTokens: 20,
          cachedTokens: 40,
        })
      }
      h.records.push(record(sessionId, 'turn-1', 'current'))
      // A usage update during the turn carries the turn's own running tally,
      // which includes the request it describes, not the previous journal
      // snapshot (finding 3).
      session.emit({ type: 'contextUsage', usedTokens: 100, windowTokens: 1000, pressure: 'low' })
      await vi.waitFor(() => {
        expect(h.updates.some((update) => update.sessionUpdate === 'usage_update')).toBe(true)
      })
      expect(h.reads).not.toHaveBeenCalled()
      const during = h.updates.filter((update) => update.sessionUpdate === 'usage_update')
      expect(during).toHaveLength(1)
      expect(during[0]).toMatchObject({
        used: 100,
        size: 1000,
        cost: {
          amount: Number(
            estimateCostUsd(
              { inputTokens: 200, outputTokens: 20, cachedTokens: 40 },
              'muse-spark-1.3',
            ),
          ),
          currency: 'USD',
        },
      })
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      const response = await running
      // Exactly one journal read for the completed request (findings 3+4).
      expect(h.reads).toHaveBeenCalledTimes(1)
      expect(response).toMatchObject({
        stopReason: 'end_turn',
        _meta: {
          'museSpark.usage': {
            v: 1,
            available: true,
            turn: {
              requests: 1,
              tokens: {
                input: 100,
                cached: 20,
                cacheWrite: 30,
                cacheWrite5m: 20,
                cacheWrite1h: 10,
                output: 10,
                reasoning: 2,
              },
              settledUsd: '0.000548',
            },
            session: { requests: 2, settledUsd: '0.001096' },
            budgets: [{ scope: 'daily', remainingUsd: '0.999452' }],
          },
        },
      })
      // ACP's SDK has validated both messages against its pinned response/update schemas.
      const strictBase = z
        .strictObject({
          stopReason: z.literal('end_turn'),
          _meta: z.optional(z.record(z.string(), z.unknown())),
        })
        .parse(response)
      const { _meta: _ignored, ...base } = strictBase
      expect(base).toEqual({ stopReason: 'end_turn' })
      expect(h.records[1]?.cost.usdAmount).toBe('0.000548')
      expect(h.updates.filter((update) => update.sessionUpdate === 'agent_message_chunk')).toEqual(
        [],
      )
    })
  })
  it('delivers answers while a hung journal read is still outstanding (finding 4)', async () => {
    const host = new FakeAgentHost()
    const updates: acp.SessionUpdate[] = []
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    // The journal never answers until the test releases it.
    const journal = Promise.withResolvers<readonly UsageRecord[]>()
    const reads = vi.fn(() => journal.promise)
    const deps = {
      ...dogfoodAgentDeps(host, log),
      defaultCwd: cwd,
      accounting: {
        readRecords: reads,
        readBudgets: () => Promise.resolve([]),
      },
    }
    const agent = createAcpAgent(deps)
    const client = acp
      .client({ name: 'accounting' })
      .onNotification('session/update', (context) => {
        updates.push(context.params.update)
      })
    await client.connectWith(agent, async (context) => {
      const { sessionId } = await dogfoodSession(context, cwd)
      const running = dogfoodPrompt(context, sessionId, 'task')
      await vi.waitFor(() => {
        expect(host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
      })
      const session = host.sessions[0]!
      for (let sample = 0; sample < 3; sample++) {
        session.emit({
          type: 'tokenUsage',
          modelId: session.modelId,
          inputTokens: 200,
          outputTokens: 20,
          cachedTokens: 40,
        })
      }
      // An answer chunk behind three token samples: with a read queued per
      // sample on the same outbox it could not arrive until the hung journal
      // answered. It arrives now, with the journal still shut.
      session.emit({
        type: 'itemUpdated',
        item: { itemId: 'm1', kind: 'agentMessage', status: 'streaming', text: 'visible answer' },
      })
      await vi.waitFor(() => {
        expect(
          updates.some(
            (update) =>
              update.sessionUpdate === 'agent_message_chunk' &&
              'content' in update &&
              update.content.type === 'text' &&
              update.content.text === 'visible answer',
          ),
        ).toBe(true)
      })
      expect(reads).not.toHaveBeenCalled()
      journal.resolve([])
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      const response = await running
      expect(reads).toHaveBeenCalledTimes(1)
      expect(response).toMatchObject({
        stopReason: 'end_turn',
        _meta: { 'museSpark.usage': { v: 1, available: true } },
      })
    })
  })
  it('reports journal unavailability explicitly instead of inventing free usage', async () => {
    const h = scene(false)
    await h.run(async (client) => {
      const { sessionId } = await dogfoodSession(client, cwd)
      const running = dogfoodPrompt(client, sessionId, 'task')
      await vi.waitFor(() => {
        expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
      })
      h.host.sessions[0]?.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      expect(await running).toMatchObject({
        _meta: { 'museSpark.usage': { v: 1, available: false } },
      })
      expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain('private')
    })
  })
  it('publishes incurred costs even when a subsequent credential request is refused', async () => {
    const h = scene()
    await h.run(async (client) => {
      const { sessionId } = await dogfoodSession(client, cwd)
      const running = dogfoodPrompt(client, sessionId, 'task')
      const failure = expect(running).rejects.toMatchObject({
        data: { _meta: { 'museSpark.usage': { turn: { requests: 1, settledUsd: '0.000548' } } } },
      })
      await vi.waitFor(() => {
        expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
      })
      h.records.push(record(sessionId, 'turn-1', 'paid'))
      h.host.sessions[0]?.emit({
        type: 'turnCompleted',
        turnId: 'turn-1',
        terminal: 'failed',
        errorKind: CREDENTIAL_STORE_ERROR_KIND,
        reason: UI_TEXT.acpCredentialStoreNoAnswer,
      })
      await failure
    })
  })
})
