// M110c lanes F2 and R2: the model relay carries calls without credentials
// and settles usage on the payer, and the orchestrator host orders the
// merge queue with M96c's own ordering and assigns each item to a live,
// capable worker.
import { describe, expect, it } from 'vitest'
import type { MergeCandidate } from '../../src/core/team/mergeQueue'
import {
  decodeModelRelayRequest,
  decodeModelRelayResponse,
  encodeModelRelayRequest,
  encodeModelRelayResponse,
  modelRelayTotalsFor,
  settleModelRelayUsage,
} from '../../src/runtime/node/modelRelay'
import {
  nodeWorkerLiveness,
  planOrchestratorDuties,
  registerNodeWorker,
  setNodeRole,
} from '../../src/runtime/node/roles/orchestrator'

const CANARY = 'relay-canary-9f2c-key-material'

function candidate(id: string, overrides?: Partial<MergeCandidate>): MergeCandidate {
  return {
    id,
    dependsOn: [],
    priority: 'normal',
    conflictsWith: [],
    changedLines: 10,
    files: [],
    finishedAt: 1000,
    onConflict: 'rework',
    ...overrides,
  }
}

describe('model relay', () => {
  it('round-trips a call whose envelope cannot smuggle a key', () => {
    const encoded = encodeModelRelayRequest({
      provider: 'meta',
      model: 'muse-spark-1.3-contributor',
      payload: { prompt: 'hello' },
      attemptKey: 'attempt-1',
    })
    expect(encoded).not.toContain(CANARY)
    expect(decodeModelRelayRequest(encoded)).toEqual({
      provider: 'meta',
      model: 'muse-spark-1.3-contributor',
      payload: { prompt: 'hello' },
      attemptKey: 'attempt-1',
    })
    const smuggled = JSON.stringify({
      provider: 'meta',
      model: 'm',
      payload: {},
      attemptKey: 'a',
      apiKey: CANARY,
    })
    expect(() => decodeModelRelayRequest(smuggled)).toThrow()
    const answer = encodeModelRelayResponse({
      attemptKey: 'attempt-1',
      ok: true,
      body: { text: 'hi' },
      usage: { inputTokens: 9, outputTokens: 3 },
    })
    expect(decodeModelRelayResponse(answer).usage).toEqual({ inputTokens: 9, outputTokens: 3 })
  })

  it('settles every completed call on the payer ledger', () => {
    const ledger = settleModelRelayUsage(
      settleModelRelayUsage([], {
        payer: 'owner',
        provider: 'meta',
        model: 'm',
        attemptKey: 'a1',
        at: 100,
        usage: { inputTokens: 9, outputTokens: 3 },
      }),
      {
        payer: 'owner',
        provider: 'meta',
        model: 'm',
        attemptKey: 'a2',
        at: 200,
        usage: { inputTokens: 5, outputTokens: 7 },
      },
    )
    expect(modelRelayTotalsFor(ledger, 'owner')).toEqual({
      calls: 2,
      inputTokens: 14,
      outputTokens: 10,
    })
    expect(modelRelayTotalsFor(ledger, 'stranger')).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
    })
  })
})

describe('orchestrator host', () => {
  it('runs either role, both at once, and one registry row per node', () => {
    expect(setNodeRole({ mode: 'worker' }, 'both')).toEqual({ mode: 'both' })
    const registry = registerNodeWorker(
      registerNodeWorker([], { nodeId: 'a', capabilities: ['gpu'], lastHeartbeat: 100 }),
      { nodeId: 'a', capabilities: ['gpu', 'rust'], lastHeartbeat: 200 },
    )
    expect(registry).toEqual([{ nodeId: 'a', capabilities: ['gpu', 'rust'], lastHeartbeat: 200 }])
  })

  it('derives liveness from the person thresholds, never a default', () => {
    const worker = { nodeId: 'a', capabilities: [], lastHeartbeat: 1000 }
    const thresholds = { quietAfterMs: 500, goneAfterMs: 2000 }
    expect(nodeWorkerLiveness(worker, 1200, thresholds)).toBe('live')
    expect(nodeWorkerLiveness(worker, 1600, thresholds)).toBe('quiet')
    expect(nodeWorkerLiveness(worker, 3100, thresholds)).toBe('gone')
    expect(nodeWorkerLiveness(worker, 500, thresholds)).toBe('live')
    expect(() => nodeWorkerLiveness(worker, 1200, { quietAfterMs: 9, goneAfterMs: 1 })).toThrow(
      'liveness thresholds rise from zero',
    )
  })

  it('orders the queue and assigns each item to a capable worker', () => {
    const plan = planOrchestratorDuties({
      duties: [
        { candidate: candidate('low', { priority: 'low' }), needs: [] },
        { candidate: candidate('urgent', { priority: 'urgent' }), needs: ['gpu'] },
        {
          candidate: candidate('blocked', { dependsOn: ['missing'] }),
          needs: [],
        },
        { candidate: candidate('exotic', { priority: 'high' }), needs: ['tpu'] },
      ],
      merged: new Set(),
      workers: [{ nodeId: 'gpu-node', capabilities: ['gpu'], lastHeartbeat: 0 }],
    })
    expect([...plan.assignments]).toEqual([
      ['urgent', 'gpu-node'],
      ['low', 'gpu-node'],
    ])
    expect(plan.unassigned).toEqual(['exotic'])
    expect(plan.held).toEqual(['blocked'])
  })
})
