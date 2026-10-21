// M124 (D106): the connector's pure logic through the real modules: the
// one-use approval ledger, the one operation state machine and the audit
// journal's failure behaviour. Each class gets its constructor values
// (a clock, a journal sink) as data; nothing stands in for another module.
// (RVMSM124: split out of connectorRegistry.test.ts, whose registry suites
// ran against hand-written fake owner ports, fake timers and spies that
// replaced Operation methods. Those suites are deleted under the owner's
// testing rules; their person-visible behaviours are covered for real by
// connectorServe.test.ts and test/e2e/connectorStdio.e2e.test.ts. The race
// interleavings that only held fake ports could stage — a receipt held
// open while the authority changes, a lease recorded after cancellation —
// have no real staging and are not re-created here.)
import { describe, expect, it } from 'vitest'
import { CONNECTOR_LIMITS } from '../../src/shared/constants'
import type { ConnectorCancelCause } from '../../src/shared/connector'
import { connectorTool } from '../../src/shared/connectorTools'
import { ApprovalLedger, bindingDigest } from '../../src/core/connector/approval'
import { ConnectorAudit } from '../../src/core/connector/audit'
import { Operation, TRANSITIONS } from '../../src/core/connector/operations'

/** Lets queued promise work run (real timers). */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('M124 one-use approvals', () => {
  it('binds the digest to every field and consumes once', () => {
    let now = 1000
    const settled: string[] = []
    const ledger = new ApprovalLedger(
      () => now,
      (_id, outcome) => {
        settled.push(outcome)
      },
    )
    const binding = {
      principal: 'codex/a',
      grantGeneration: 1,
      workspaceId: 'ws-1',
      tool: 'muse_prompt_save',
      toolClass: 'write' as const,
      payload: { title: 'x' },
      targetGeneration: 5,
      priceMicrousd: 0,
    }
    const id = ledger.open(binding, {
      client: 'c',
      connectionId: 'codex',
      workspace: 'repo',
      tool: 'muse_prompt_save',
      toolClass: 'write',
      generation: 5,
      priceMicrousd: 0,
      fields: [],
    })
    const [view] = ledger.pending()
    expect(view?.digest).toBe(bindingDigest(binding, view?.expiresAt ?? 0))
    expect(ledger.decide(id, view?.digest ?? '', true)).toBe('approved')
    for (const change of [
      { targetGeneration: 6 },
      { priceMicrousd: 1 },
      { payload: { title: 'y' } },
      { principal: 'codex/b' },
    ])
      expect(ledger.consume(id, { ...binding, ...change })).toBe(false)
    expect(ledger.stateOf(id)).toBe('cancelled')
    const second = ledger.open(binding, {
      client: 'c',
      connectionId: 'codex',
      workspace: 'repo',
      tool: 'muse_prompt_save',
      toolClass: 'write',
      generation: 5,
      priceMicrousd: 0,
      fields: [],
    })
    const [again] = ledger.pending()
    ledger.decide(second, again?.digest ?? '', true)
    expect(ledger.consume(second, binding)).toBe(true)
    expect(ledger.consume(second, binding)).toBe(false)
    now += CONNECTOR_LIMITS.approvalLeaseMs * 2
    expect(settled).toEqual(['approved', 'approved'])
  })

  it('keeps no fixed cap on pending approvals (Codex on PR #227 P1)', () => {
    const ledger = new ApprovalLedger(
      () => 0,
      () => undefined,
    )
    const open = () =>
      ledger.open(
        {
          principal: 'p',
          grantGeneration: 1,
          workspaceId: undefined,
          tool: 't',
          toolClass: 'write',
          payload: {},
          targetGeneration: 0,
          priceMicrousd: 0,
        },
        {
          client: '',
          connectionId: 'c',
          workspace: 'w',
          tool: 't',
          toolClass: 'write',
          generation: 0,
          priceMicrousd: 0,
          fields: [],
        },
      )
    const ids = [open(), open(), open()]
    expect(new Set(ids).size).toBe(ids.length)
    expect(ledger.pending()).toHaveLength(ids.length)
    expect(ledger.cancelAll()).toHaveLength(ids.length)
    expect(ledger.pending()).toHaveLength(0)
  })
})

describe('M124 settled intents (RVM124 P2-6)', () => {
  it('drops payloads at settlement and keeps a bounded history', () => {
    let now = 0
    const ledger = new ApprovalLedger(
      () => now,
      () => undefined,
    )
    const ids: string[] = []
    for (let cycle = 0; cycle < 600; cycle += 1) {
      const id = ledger.open(
        {
          principal: 'p',
          grantGeneration: 1,
          workspaceId: undefined,
          tool: 't',
          toolClass: 'write',
          payload: { body: `raw prompt ${String(cycle)}` },
          targetGeneration: 0,
          priceMicrousd: 0,
        },
        {
          client: '',
          connectionId: 'c',
          workspace: 'w',
          tool: 't',
          toolClass: 'write',
          generation: 0,
          priceMicrousd: 0,
          fields: [],
        },
      )
      ids.push(id)
      const [view] = ledger.pending()
      if (cycle % 2 === 0) ledger.decide(id, view?.digest ?? '', false)
      else now += CONNECTOR_LIMITS.approvalLeaseMs + 1
    }
    ledger.expireDue()
    expect(ledger.size).toBe(0)
    expect(ledger.stateOf(ids[0] ?? '')).toBeUndefined()
    expect(ledger.stateOf(ids.at(-2) ?? '')).toBe('denied')
    expect(ledger.stateOf(ids.at(-1) ?? '')).toBe('expired')
  })
})

function operationOf(tool: string, state: { cause?: ConnectorCancelCause }) {
  const journal: string[] = []
  const operation = new Operation('op', connectorTool(tool), {
    now: () => 0,
    stopCause: () => state.cause,
    journal: (_operation, from, to) => {
      journal.push(`${from}>${to}`)
      return Promise.resolve(true)
    },
    refusalOf: () => ({ reason: 'unavailable', message: 'stopped' }),
  })
  return { operation, journal }
}

describe('M124 operation state machine', () => {
  it('takes only the table’s edges, ends once, and never cancels a started write', async () => {
    for (const [from, edges] of Object.entries(TRANSITIONS))
      if (['settled', 'refused', 'cancelled', 'failed'].includes(from)) expect(edges).toEqual([])
    const { operation: write, journal } = operationOf('muse_prompt_save', {})
    expect(write.move('settled', true)).toBe(false)
    for (const to of ['admitted', 'dispatching'] as const) {
      expect(await write.writeAhead(to)).toBe(true)
      expect(write.move(to, true)).toBe(true)
    }
    expect(write.cancel('stop')).toBe(false)
    expect(write.stop()).toBe('stopRequested')
    expect(await write.writeAhead('settled')).toBe(true)
    expect(write.move('settled', true)).toBe(true)
    expect(write.move('failed')).toBe(false)
    expect(write.cancel('stop')).toBe(false)
    expect(write.stop()).toBe('alreadyStopped')
    expect(journal).toEqual(['received>admitted', 'admitted>dispatching', 'dispatching>settled'])
    const { operation: read } = operationOf('muse_prompt_list', {})
    read.move('admitted', true)
    read.move('dispatching', true)
    expect(read.cancel('client')).toBe(true)
    expect(read.state).toBe('cancelled')
  })

  it('moves to a receipted state only written ahead, and writes ahead only an edge of the table (round 4)', async () => {
    const { operation, journal } = operationOf('muse_prompt_list', {})
    // No receipt, no transition: admitted, approved, dispatching and settled are written ahead.
    expect(operation.move('admitted')).toBe(false)
    expect(operation.state).toBe('received')
    expect(operation.cancel('client')).toBe(true)
    // A terminal operation journals no further edge (RVM124R3 finding 5).
    expect(await operation.writeAhead('admitted')).toBe(false)
    expect(journal).toEqual(['received>cancelled'])
    // Stop's receipts are best effort: it never waits for the journal.
    expect(operationOf('muse_stop', {}).operation.move('admitted')).toBe(true)
  })

  it('runs a hold when the operation leaves its states, or at once when it already has', () => {
    const { operation } = operationOf('muse_prompt_list', {})
    const released: string[] = []
    operation.holdWhile(['received', 'admitted'], () => {
      released.push('lease')
    })
    operation.move('admitted', true)
    expect(released).toEqual([])
    operation.move('dispatching', true)
    expect(released).toEqual(['lease'])
    operation.holdWhile(['admitted'], () => {
      released.push('late')
    })
    expect(released).toEqual(['lease', 'late'])
  })

  it('stops at its gate when the authority stops it, even for a signal that aborted before attaching', () => {
    const state: { cause?: ConnectorCancelCause } = {}
    const { operation } = operationOf('muse_prompt_list', state)
    expect(operation.gate(['received'])).toBe(true)
    state.cause = 'revoked'
    expect(operation.gate(['received'])).toBe(false)
    expect(operation.state).toBe('cancelled')
    const aborted = operationOf('muse_prompt_list', { cause: 'client' }).operation
    aborted.attach(AbortSignal.abort())
    expect(aborted.state).toBe('cancelled')
  })
})

describe('M124 audit journal under failure', () => {
  it('counts a hung journal as failed until it answers, and starts no more appends meanwhile', async () => {
    let appends = 0
    const hung = Promise.withResolvers<undefined>()
    const audit = new ConnectorAudit(
      {
        append: async () => {
          appends += 1
          if (appends === 1) await hung.promise
        },
        key: () => Promise.resolve(new Uint8Array(32)),
      },
      'codex',
      Date.now,
      (text) => text,
      20,
    )
    expect(await audit.record({ event: 'list' })).toBe(false)
    expect(await audit.record({ event: 'list' })).toBe(false)
    expect(appends).toBe(1)
    hung.resolve(undefined)
    await flush()
    expect(await audit.record({ event: 'list' })).toBe(true)
  })
})
