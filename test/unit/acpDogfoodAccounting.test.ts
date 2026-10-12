import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
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
  const deps = {
    ...dogfoodAgentDeps(host, log),
    defaultCwd: cwd,
    accounting: {
      readRecords: () =>
        isAvailable ? Promise.resolve(records) : Promise.reject(new Error('private journal path')),
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
  it('sends journal-exact per-turn and session figures during the turn and on the response', async () => {
    const h = scene()
    await h.run(async (client) => {
      const { sessionId } = await dogfoodSession(client, cwd)
      h.records.push(record(sessionId, 'old-turn', 'old'))
      const running = dogfoodPrompt(client, sessionId, 'task')
      await vi.waitFor(() => {
        expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
      })
      const session = h.host.sessions[0]!
      h.records.push(record(sessionId, 'turn-1', 'current'))
      session.emit({
        type: 'tokenUsage',
        modelId: session.modelId,
        inputTokens: 200,
        outputTokens: 20,
        cachedTokens: 40,
      })
      await vi.waitFor(() => {
        expect(h.updates.some((update) => update._meta?.['museSpark.usage'] !== undefined)).toBe(
          true,
        )
      })
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      const response = await running
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
