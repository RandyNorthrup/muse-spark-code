// M124 (D106): the connector's registry and policy through the real MCP
// protocol class, with fake owner ports. Approval can only come from the
// approval page's `decide`; Stop never asks; results are scrubbed.
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_LIMITS,
  CONNECTOR_MODEL_TEXT,
  CONNECTOR_SCHEMA_VERSION,
} from '../../src/shared/constants'
import {
  CONNECTOR_REASONS,
  type ConnectorCancelCause,
  type ConnectorGrant,
} from '../../src/shared/connector'
import { CONNECTOR_TOOLS, connectorTool } from '../../src/shared/connectorTools'
import type { SavedPrompt } from '../../src/shared/prompts'
import { ApprovalLedger, bindingDigest } from '../../src/core/connector/approval'
import { ConnectorAudit, type AuditPort } from '../../src/core/connector/audit'
import { Operation, TRANSITIONS } from '../../src/core/connector/operations'
import type { LimitState, LimitsPort } from '../../src/core/connector/policy'
import { ConnectorProtocol } from '../../src/core/connector/protocol'
import { createConnectorScrub } from '../../src/core/connector/redaction'
import { ConnectorRegistry, type RegistryDeps } from '../../src/core/connector/registry'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { serveStdio } from '../../src/runtime/connector/stdio'

/** The awaited result's field (the lint rule forbids member access on an await). */
async function field<T extends object, K extends keyof T>(
  result: Promise<T>,
  key: K,
): Promise<T[K]> {
  const value = await result
  return value[key]
}

const CANARY = 'sk-canary-0123456789abcdef0123456789'
const HOME = '/home/owner'

function grantOf(overrides: Partial<ConnectorGrant> = {}): ConnectorGrant {
  return {
    schemaVersion: CONNECTOR_SCHEMA_VERSION,
    connectionId: 'codex',
    generation: 1,
    createdAt: '2026-10-09T00:00:00.000Z',
    revoked: false,
    scopes: [
      'operations:read',
      'prompts:read',
      'prompts:write',
      'content:read',
      'sharing:read',
      'schedules:read',
      'reports:read',
      'control:stop',
    ],
    userLibrary: true,
    paidCapMicrousd: 0,
    workspaces: [{ id: 'ws-1', root: '/work/repo', label: 'repo', content: true }],
    ...overrides,
  }
}

function prompt(overrides: Partial<SavedPrompt> = {}): SavedPrompt {
  return {
    schemaVersion: 1,
    id: 'p1',
    title: 'Review',
    tags: ['review'],
    variables: [{ name: 'audience', source: 'input' }],
    scope: 'user',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    untrusted: false,
    body: `Hello {{ audience }} at ${HOME}/secret/notes.txt with ${CANARY}`,
    ...overrides,
  }
}

interface MemoryLimits extends LimitsPort {
  /** Leases of `kind` held now. */
  readonly leases: (kind: 'read' | 'pending') => number
  /** Updates started so far; `hold`, when set, may hold update number `count`. */
  updates: number
  hold: ((count: number) => Promise<void> | undefined) | undefined
}

/** The limit file's behaviour in memory: one saved state, changed whole. */
function memoryLimits(): MemoryLimits {
  let saved: LimitState | undefined
  const port: MemoryLimits = {
    updates: 0,
    hold: undefined,
    leases: (kind) => (saved?.leases ?? []).filter((lease) => lease.kind === kind).length,
    update: async (change) => {
      port.updates += 1
      await port.hold?.(port.updates)
      const [next, value] = change(saved)
      saved = next
      return value
    },
  }
  return port
}

interface Harness {
  readonly registry: ConnectorRegistry
  readonly protocol: ConnectorProtocol
  readonly state: {
    grant: ConnectorGrant | undefined
    killed: boolean
    auditFails: boolean
    surface: boolean
    shown: number
    now: number
    prompts: SavedPrompt[]
    writes: SavedPrompt[]
    audit: string[]
    paused: string[]
    confidential: boolean | undefined
    /** Gates that hold a port until released: audit events by name, `list`, `write`, `grant`. */
    holds: Set<string>
    held: { readonly name: string; readonly resolve: () => void }[]
    listFails: boolean
    /** Audit events whose append fails. */
    failEvents: Set<string>
    /** Owner reads started (prompt library lists). */
    reads: number
  }
  readonly limits: MemoryLimits
  call(name: string, args?: unknown): Promise<Record<string, unknown>>
}

async function harness(limits: MemoryLimits = memoryLimits()): Promise<Harness> {
  const state: Harness['state'] = {
    grant: grantOf(),
    killed: false,
    auditFails: false,
    surface: true,
    shown: 0,
    now: Date.parse('2026-10-09T12:00:00.000Z'),
    prompts: [prompt()],
    writes: [],
    audit: [],
    paused: [],
    confidential: false,
    holds: new Set(),
    held: [],
    listFails: false,
    failEvents: new Set(),
    reads: 0,
  }
  const gate = (name: string) =>
    state.holds.has(name)
      ? new Promise<void>((resolve) => {
          state.held.push({ name, resolve })
        })
      : Promise.resolve()
  const port: AuditPort = {
    append: async (line) => {
      const event = (JSON.parse(line) as { event: string }).event
      if (state.auditFails || state.failEvents.has(event)) throw new Error('disk full')
      await gate(event)
      state.audit.push(line)
    },
    key: () => Promise.resolve(new Uint8Array(32).fill(7)),
  }
  const privacy = createChatSharePrivacy({
    workspaceRoots: [],
    home: HOME,
    userName: 'owner',
    redactRegisteredSecrets: (text) => text,
  })
  const scrub = createConnectorScrub(privacy, () => [CANARY])
  const now = () => state.now
  const deps: RegistryDeps = {
    connectionId: 'codex',
    version: '0.0.0-test',
    now,
    grant: async () => {
      await gate('grant')
      return state.grant
    },
    killed: () => Promise.resolve(state.killed),
    confidential: () => state.confidential,
    audit: new ConnectorAudit(port, 'codex', now, scrub.text),
    limits,
    scrub,
    surface: {
      show: () => {
        state.shown += 1
        return Promise.resolve(state.surface)
      },
      changed: () => undefined,
    },
    prompts: {
      list: async (_root, scope) => {
        state.reads += 1
        await gate('list')
        if (state.listFails) throw new Error(`EACCES ${HOME}/private`)
        return state.prompts.filter((candidate) => candidate.scope === scope)
      },
      write: async (_root, saved) => {
        await gate('write')
        state.writes.push(saved)
        state.prompts.push(saved)
      },
      preview: (_root, saved, format) => `${format}:${saved.body}`,
    },
    schedules: {
      list: () =>
        Promise.resolve({
          kind: 'list',
          schedules: [
            {
              id: 's1',
              name: `nightly ${CANARY}`,
              delivery: 'queue',
              paused: false,
              nextFireAtMs: Date.parse('2026-10-10T00:00:00.000Z'),
              prompt: 'never projected',
            },
          ],
        }),
      pause: (_root, id) => {
        state.paused.push(id)
        return Promise.resolve({ kind: 'accepted' })
      },
    },
    reports: {
      generate: (root, kind, subjectId) =>
        Promise.resolve(`# ${kind} report for ${root} ${subjectId ?? ''} private-narrative`),
    },
  }
  const registry = new ConnectorRegistry(deps, 'muse-spark-code')
  const protocol = new ConnectorProtocol(registry)
  let id = 0
  await protocol.handle(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'init',
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex' } },
    }),
  )
  return {
    registry,
    protocol,
    state,
    limits,
    call: async (name, args = {}) => {
      id += 1
      const reply = await protocol.handle(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      )
      const result = (reply as { result: { structuredContent: Record<string, unknown> } }).result
      return result.structuredContent
    },
  }
}

const SAVE = {
  requestId: 'r1',
  expectedGeneration: Date.parse('2026-10-01T00:00:00.000Z'),
  scope: 'user',
  title: 'New prompt',
  body: 'Summarize {{ topic }}',
}

describe('M124 connector registry', () => {
  it('lists only backed tools the grant allows, with honest hints', async () => {
    const h = await harness()
    const reply = await h.protocol.handle(
      JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    )
    const tools = (reply as { result: { tools: { name: string; annotations: unknown }[] } }).result
      .tools
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('muse_prompt_save')
    expect(names).not.toContain('muse_fleet_status')
    expect(names).not.toContain('muse_lane_start')
    const save = tools.find((tool) => tool.name === 'muse_prompt_save')
    expect(save?.annotations).toMatchObject({ readOnlyHint: false })
    h.state.grant = grantOf({ scopes: ['prompts:read'] })
    const narrowed = await h.protocol.handle(
      JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/list' }),
    )
    expect(
      (narrowed as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name),
    ).toEqual(['muse_prompt_list'])
  })

  it('answers every unbacked tool with unavailable, never an empty success', async () => {
    const h = await harness()
    for (const tool of CONNECTOR_TOOLS) {
      if (tool.availability.kind === 'backed') continue
      const result = await h.call(tool.name, {})
      expect(result['status']).toBe('refused')
      expect(result['reason']).toBe('unavailable')
    }
    expect(await field(h.call('muse_machine_stop'), 'reason')).toBe('unavailable')
  })

  it('refuses unknown fields, so a client confirm or approve flag never reaches policy', async () => {
    const h = await harness()
    for (const extra of [{ confirm: true }, { approve: true }, { approved: 'yes' }]) {
      const result = await h.call('muse_prompt_save', { ...SAVE, ...extra })
      expect(result['reason']).toBe('invalid_input')
      // The value is never echoed back.
      expect(JSON.stringify(result)).not.toContain('yes')
    }
    expect(h.state.writes).toEqual([])
  })

  it('keeps a write inert until our page approves the exact intent, once', async () => {
    const h = await harness()
    const pending = await h.call('muse_prompt_save', SAVE)
    expect(pending['status']).toBe('awaitingApproval')
    const { operationId } = pending['data'] as { operationId: string }
    expect(h.state.writes).toEqual([])
    expect(h.state.shown).toBe(1)
    // The digest and intent id never reach the client.
    const [intent] = h.registry.pending()
    expect(JSON.stringify(pending)).not.toContain(intent?.digest ?? 'missing')
    expect(JSON.stringify(pending)).not.toContain(intent?.intentId ?? 'missing')
    // A client response or elicitation answer frame is ignored.
    expect(
      await h.protocol.handle(
        JSON.stringify({ jsonrpc: '2.0', id: 'x', result: { action: 'accept', content: {} } }),
      ),
    ).toBeUndefined()
    expect(h.state.writes).toEqual([])
    expect(h.registry.decide(intent?.intentId ?? '', 'f'.repeat(64), true)).toBe(false)
    expect(h.registry.decide(intent?.intentId ?? '', intent?.digest ?? '', true)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(h.state.writes).toHaveLength(1)
    expect(h.state.writes[0]?.untrusted).toBe(true)
    expect(h.registry.decide(intent?.intentId ?? '', intent?.digest ?? '', true)).toBe(false)
    const done = await h.call('muse_operation_get', { operationId })
    expect((done['data'] as { state: string }).state).toBe('completed')
    // The same request id and bytes return the same receipt; nothing runs twice.
    const again = await h.call('muse_prompt_save', SAVE)
    expect((again['data'] as { operationId: string }).operationId).toBe(operationId)
    expect(h.state.writes).toHaveLength(1)
    const changed = await h.call('muse_prompt_save', { ...SAVE, title: 'Other' })
    expect(changed['reason']).toBe('invalid_input')
  })

  it('cancels on denial, expiry, a changed grant or the kill switch', async () => {
    const denied = await harness()
    await denied.call('muse_prompt_save', SAVE)
    const [first] = denied.registry.pending()
    denied.registry.decide(first?.intentId ?? '', first?.digest ?? '', false)
    expect(denied.state.writes).toEqual([])

    const expired = await harness()
    const receipt = await expired.call('muse_prompt_save', SAVE)
    expired.state.now += CONNECTOR_LIMITS.approvalLeaseMs + 1
    const [late] = expired.registry.pending()
    expect(late).toBeUndefined()
    const status = await expired.call('muse_operation_get', {
      operationId: (receipt['data'] as { operationId: string }).operationId,
    })
    expect((status['data'] as { state: string }).state).toBe('expired')

    const regranted = await harness()
    await regranted.call('muse_prompt_save', SAVE)
    const [stale] = regranted.registry.pending()
    regranted.state.grant = grantOf({ generation: 2 })
    regranted.registry.decide(stale?.intentId ?? '', stale?.digest ?? '', true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(regranted.state.writes).toEqual([])

    const killed = await harness()
    await killed.call('muse_prompt_save', SAVE)
    killed.state.killed = true
    expect(await field(killed.call('muse_prompt_list', { scope: 'user' }), 'message')).toBe(
      CONNECTOR_MODEL_TEXT.killSwitch,
    )
    expect(killed.registry.pending()).toEqual([])
  })

  it('refuses approval_unavailable when no approval page can be shown', async () => {
    const h = await harness()
    h.state.surface = false
    const result = await h.call('muse_prompt_save', SAVE)
    expect(result['reason']).toBe('approval_unavailable')
    expect(h.registry.pending()).toEqual([])
  })

  it('keeps Stop and schedule cancel outside limits, the kill switch and audit failure', async () => {
    const h = await harness()
    const pending = await h.call('muse_prompt_save', SAVE)
    const { operationId } = pending['data'] as { operationId: string }
    h.state.killed = true
    h.state.auditFails = true
    for (let index = 0; index < CONNECTOR_LIMITS.burst + 2; index += 1)
      await h.call('muse_prompt_list', { scope: 'user' })
    const stop = await h.call('muse_stop', {
      workspaceId: 'ws-1',
      target: { kind: 'operation', id: operationId },
    })
    expect(stop['status']).toBe('ok')
    const cancelled = await h.call('muse_schedule_cancel', {
      workspaceId: 'ws-1',
      scheduleId: 's1',
    })
    expect(cancelled['data']).toEqual({ outcome: 'stopped' })
    expect(h.state.paused).toEqual(['s1'])
    const lane = await h.call('muse_stop', {
      workspaceId: 'ws-1',
      target: { kind: 'lane', id: 'l1' },
    })
    expect(lane['reason']).toBe('unavailable')
  })

  it('fails reads closed when the audit cannot be written', async () => {
    const h = await harness()
    h.state.auditFails = true
    expect(await field(h.call('muse_prompt_list', { scope: 'user' }), 'reason')).toBe(
      'audit_unavailable',
    )
    expect(await field(h.call('muse_prompt_save', SAVE), 'reason')).toBe('audit_unavailable')
  })

  it('rate limits ordinary calls and operation polls', async () => {
    const h = await harness()
    const answers = []
    for (let index = 0; index < CONNECTOR_LIMITS.burst + 1; index += 1)
      answers.push(await h.call('muse_prompt_list', { scope: 'user' }))
    expect(answers.at(-1)?.['reason']).toBe('rate_limited')
    h.state.now += CONNECTOR_LIMITS.minuteMs
    const pending = await h.call('muse_prompt_save', SAVE)
    const operationId = (pending['data'] as { operationId: string }).operationId
    expect(await field(h.call('muse_operation_get', { operationId }), 'status')).toBe('ok')
    expect(await field(h.call('muse_operation_get', { operationId }), 'reason')).toBe(
      'rate_limited',
    )
  })

  it('scopes reads by grant: workspace, content, user library and confidential policy', async () => {
    const h = await harness()
    expect(await field(h.call('muse_schedule_list', { workspaceId: 'other' }), 'reason')).toBe(
      'forbidden',
    )
    h.state.grant = grantOf({ userLibrary: false })
    expect(await field(h.call('muse_prompt_get', { promptId: 'p1' }), 'reason')).toBe('forbidden')
    h.state.grant = grantOf({
      workspaces: [{ id: 'ws-1', root: '/work/repo', label: 'repo', content: false }],
    })
    h.state.prompts = [prompt({ scope: 'workspace' })]
    expect(
      await field(h.call('muse_prompt_get', { workspaceId: 'ws-1', promptId: 'p1' }), 'reason'),
    ).toBe('forbidden')
    h.state.grant = grantOf()
    h.state.confidential = true
    expect(await field(h.call('muse_schedule_list', { workspaceId: 'ws-1' }), 'reason')).toBe(
      'forbidden',
    )
    h.state.confidential = undefined
    expect(
      await field(
        h.call('muse_report', { workspaceId: 'ws-1', kind: 'project', format: 'markdown' }),
        'reason',
      ),
    ).toBe('forbidden')
  })

  it('scrubs planted secrets and private paths from every result', async () => {
    const h = await harness()
    const results = [
      await h.call('muse_prompt_get', { promptId: 'p1' }),
      await h.call('muse_prompt_prepare', {
        promptId: 'p1',
        expectedGeneration: Date.parse('2026-10-01T00:00:00.000Z'),
        variables: { audience: CANARY },
      }),
      await h.call('muse_share_preview', {
        source: { kind: 'prompt', promptId: 'p1' },
        format: 'markdown',
      }),
      await h.call('muse_schedule_list', { workspaceId: 'ws-1' }),
      await h.call('muse_report', { workspaceId: 'ws-1', kind: 'project', format: 'markdown' }),
    ]
    for (const result of results) {
      expect(result['status']).toBe('ok')
      const text = JSON.stringify(result)
      expect(text).not.toContain(CANARY)
      expect(text).not.toContain(`${HOME}/secret`)
      expect(text).not.toContain('/work/repo')
      expect(text).not.toContain('never projected')
    }
    const audit = h.state.audit.join('')
    expect(audit).not.toContain(CANARY)
    expect(audit).not.toContain('Hello')
  })

  it('pages with cursors bound to the filter and grant', async () => {
    const h = await harness()
    h.state.prompts = Array.from({ length: 3 }, (_, index) =>
      prompt({ id: `p${String(index)}`, title: `T${String(index)}` }),
    )
    const first = await h.call('muse_prompt_list', { scope: 'user', page: { limit: 2 } })
    expect((first['data'] as { items: unknown[] }).items).toHaveLength(2)
    const cursor = first['nextCursor'] as string
    const second = await h.call('muse_prompt_list', { scope: 'user', page: { cursor, limit: 2 } })
    expect((second['data'] as { items: unknown[] }).items).toHaveLength(1)
    const crossed = await h.call('muse_prompt_list', {
      scope: 'user',
      query: 'T1',
      page: { cursor, limit: 2 },
    })
    expect(crossed['reason']).toBe('invalid_input')
  })
})

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
    expect(ledger.decide(id ?? '', view?.digest ?? '', true)).toBe('approved')
    for (const change of [
      { targetGeneration: 6 },
      { priceMicrousd: 1 },
      { payload: { title: 'y' } },
      { principal: 'codex/b' },
    ])
      expect(ledger.consume(id ?? '', { ...binding, ...change })).toBe(false)
    expect(ledger.stateOf(id ?? '')).toBe('cancelled')
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
    ledger.decide(second ?? '', again?.digest ?? '', true)
    expect(ledger.consume(second ?? '', binding)).toBe(true)
    expect(ledger.consume(second ?? '', binding)).toBe(false)
    now += CONNECTOR_LIMITS.approvalLeaseMs * 2
    expect(settled).toEqual(['approved', 'approved'])
  })

  it('caps pending approvals per connection', () => {
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
    expect(open()).toBeDefined()
    expect(open()).toBeDefined()
    expect(open()).toBeUndefined()
    expect(ledger.cancelAll()).toHaveLength(CONNECTOR_LIMITS.pendingApprovals)
  })
})

/** Lets queued promise work run (real timers). */
async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Releases every hold, or only the holds named `name`. */
function release(h: Harness, name?: string): void {
  if (name === undefined) h.state.holds.clear()
  else h.state.holds.delete(name)
  const kept = h.state.held.filter((hold) => name !== undefined && hold.name !== name)
  for (const hold of h.state.held) if (!kept.includes(hold)) hold.resolve()
  h.state.held.splice(0, h.state.held.length, ...kept)
}

interface Receipt {
  readonly event: string
  readonly from?: string
  readonly callId?: string
  readonly operationId?: string
  readonly tool?: string
  readonly reason?: string
  readonly cause?: string
  readonly rpcCode?: number
}

function events(h: Harness): Receipt[] {
  return h.state.audit.map((line) => JSON.parse(line) as Receipt)
}

const TERMINAL = new Set(['settled', 'refused', 'cancelled', 'failed'])

const byName = (left: unknown, right: unknown) => String(left).localeCompare(String(right))

/** One call's terminal receipts (its end); a finished call has exactly one. */
function ends(h: Harness, callId: unknown): Receipt[] {
  return events(h).filter((record) => record.callId === callId && TERMINAL.has(record.event))
}

/** The client's real pipes into serveStdio; replies by id. */
function stdio(h: Harness) {
  const input = new PassThrough()
  const output = new PassThrough()
  const replies = new Map<unknown, Record<string, unknown>>()
  output.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line === '') continue
      const reply = JSON.parse(line) as Record<string, unknown>
      replies.set(reply['id'], reply)
    }
  })
  const served = serveStdio({ input, output }, h.protocol)
  const send = (message: unknown) => {
    input.write(`${JSON.stringify(message)}\n`)
  }
  return {
    input,
    output,
    served,
    send,
    call: (id: number, name: string, args: unknown) => {
      send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
    },
    cancel: (id: number) => {
      send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } })
    },
    reply: async (id: number) => {
      await vi.waitFor(() => {
        expect(replies.has(id)).toBe(true)
      })
      const reply = replies.get(id)?.['result'] as { structuredContent: Record<string, unknown> }
      return reply.structuredContent
    },
  }
}

async function approveFirst(h: Harness): Promise<void> {
  const [intent] = h.registry.pending()
  expect(h.registry.decide(intent?.intentId ?? '', intent?.digest ?? '', true)).toBe(true)
  await Promise.resolve()
}

/** The write's dispatch receipt, written ahead of it (and that receipt's name before the redesign). */
const DISPATCH_RECEIPTS = ['dispatching', 'dispatched']

/** Saves, approves, holds the dispatch at `holds`, then stops the operation. */
async function stopWhileHeld(h: Harness, holds: readonly string[]) {
  const { operationId } = (await field(h.call('muse_prompt_save', SAVE), 'data')) as {
    operationId: string
  }
  for (const hold of holds) h.state.holds.add(hold)
  await approveFirst(h)
  await vi.waitFor(() => {
    expect(h.state.held).toHaveLength(1)
  })
  const stop = await h.call('muse_stop', {
    workspaceId: 'ws-1',
    target: { kind: 'operation', id: operationId },
  })
  return { operationId, stop }
}

const REPORT = { workspaceId: 'ws-1', kind: 'project', format: 'markdown' }

describe('M124 review fixes (RVM124)', () => {
  it('returns report bodies only with the content grant; metadata otherwise (P1)', async () => {
    const h = await harness()
    h.state.grant = grantOf({
      scopes: ['reports:read'],
      workspaces: [{ id: 'ws-1', root: '/work/repo', label: 'repo', content: false }],
    })
    const metadata = await h.call('muse_report', REPORT)
    expect(metadata['status']).toBe('ok')
    expect(metadata['data']).toEqual({ kind: 'project', format: 'markdown', contentWithheld: true })
    expect(JSON.stringify(metadata)).not.toContain('private-narrative')
    // The workspace's content flag alone is not the content scope, and the reverse.
    h.state.grant = grantOf({ scopes: ['reports:read'] })
    expect(JSON.stringify(await h.call('muse_report', REPORT))).not.toContain('private-narrative')
    h.state.grant = grantOf({
      workspaces: [{ id: 'ws-1', root: '/work/repo', label: 'repo', content: false }],
    })
    expect(JSON.stringify(await h.call('muse_report', REPORT))).not.toContain('private-narrative')
    h.state.grant = grantOf()
    expect(JSON.stringify(await h.call('muse_report', REPORT))).toContain('private-narrative')
  })

  it('never writes after Stop cancels a consumed approval that is still dispatching (P2-2)', async () => {
    const h = await harness()
    const { operationId, stop } = await stopWhileHeld(h, DISPATCH_RECEIPTS)
    expect(stop['data']).toEqual({ outcome: 'stopped' })
    release(h)
    await flush()
    expect(h.state.writes).toEqual([])
    h.state.now += CONNECTOR_LIMITS.pollMinMs
    const status = await h.call('muse_operation_get', { operationId })
    expect((status['data'] as { state: string }).state).toBe('cancelled')
  })

  it('reports stopRequested, not stopped, once the effect has started (P2-2)', async () => {
    const h = await harness()
    const { stop } = await stopWhileHeld(h, ['write'])
    expect(stop['data']).toEqual({ outcome: 'stopRequested' })
    release(h)
    await flush()
    expect(h.state.writes).toHaveLength(1)
  })

  it('opens no approvable write for a cancelled call (P2-3)', async () => {
    const h = await harness()
    h.state.holds.add('list')
    const reply = h.protocol.handle(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 77,
        method: 'tools/call',
        params: { name: 'muse_prompt_save', arguments: SAVE },
      }),
    )
    await vi.waitFor(() => {
      expect(h.state.held).toHaveLength(1)
    })
    await h.protocol.handle(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 77 },
      }),
    )
    expect(await reply).toBeUndefined()
    release(h)
    await flush()
    expect(h.registry.pending()).toEqual([])
    expect(h.state.shown).toBe(0)
  })

  it('opens no approvable write after the client disconnects over stdio (P2-3)', async () => {
    const h = await harness()
    const input = new PassThrough()
    const output = new PassThrough()
    output.resume()
    const served = serveStdio({ input, output }, h.protocol)
    h.state.holds.add('list')
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'muse_prompt_save', arguments: SAVE } })}\n`,
    )
    await vi.waitFor(() => {
      expect(h.state.held).toHaveLength(1)
    })
    input.end()
    await served
    release(h)
    await flush()
    expect(h.registry.pending()).toEqual([])
    expect(h.state.shown).toBe(0)
    expect(await field(h.call('muse_prompt_list', { scope: 'user' }), 'status')).toBe('refused')
  })

  it('shares the rate limit between servers of one grant (P2-7)', async () => {
    const shared = memoryLimits()
    const first = await harness(shared)
    const second = await harness(shared)
    const answers = []
    for (let index = 0; index < 2 * CONNECTOR_LIMITS.burst; index += 1)
      answers.push(
        await (index % 2 === 0 ? first : second).call('muse_prompt_list', { scope: 'user' }),
      )
    expect(answers.filter((answer) => answer['status'] === 'ok')).toHaveLength(
      CONNECTOR_LIMITS.burst,
    )
  })

  it('settles every read at the deadline, frees its slot and drops the late answer (P2-8)', async () => {
    const h = await harness()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      h.state.holds.add('list')
      let answer: Record<string, unknown> | undefined
      void h.call('muse_prompt_get', { promptId: 'p1' }).then((value) => {
        answer = value
      })
      await vi.advanceTimersByTimeAsync(CONNECTOR_LIMITS.requestDeadlineMs + 1)
      expect(answer).toMatchObject({ status: 'refused', reason: 'unavailable' })
      // The stalled read no longer holds one of the four read slots.
      h.state.holds.clear()
      const reads = await Promise.all(
        Array.from({ length: CONNECTOR_LIMITS.activeReads }, () =>
          h.call('muse_prompt_list', { scope: 'user' }),
        ),
      )
      expect(reads.map((read) => read['status'])).toEqual(
        Array.from({ length: CONNECTOR_LIMITS.activeReads }, () => 'ok'),
      )
      release(h)
      await vi.advanceTimersByTimeAsync(0)
      expect(answer).toMatchObject({ status: 'refused', reason: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the complete MCP result, text and structured copy, to 64 KiB (P2-9)', async () => {
    const h = await harness()
    h.state.prompts = [prompt({ body: 'Plain words. '.repeat(3077) })]
    const reply = await h.protocol.handle(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muse_prompt_get', arguments: { promptId: 'p1' } },
      }),
    )
    const result = (reply as { result: { structuredContent: Record<string, unknown> } }).result
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      CONNECTOR_LIMITS.resultBytes,
    )
    expect(result.structuredContent['message']).toBe(CONNECTOR_MODEL_TEXT.tooLarge)
  })

  it('leaves an audit receipt for every refusal (P2-10)', async () => {
    const h = await harness()
    await h.call('muse_no_such_tool')
    await h.call('muse_fleet_status')
    h.state.killed = true
    await h.call('muse_prompt_list', { scope: 'user' })
    h.state.killed = false
    for (let index = 0; index < CONNECTOR_LIMITS.burst + 1; index += 1)
      await h.call('muse_prompt_list', { scope: 'user', page: { limit: 0 } })
    const refused = events(h).filter((record) => record.event === 'refused')
    expect(refused[0]).toEqual(expect.not.objectContaining({ tool: expect.anything() }))
    expect(refused.map((record) => record.reason)).toEqual([
      'unavailable',
      'unavailable',
      'forbidden',
      ...Array.from({ length: CONNECTOR_LIMITS.burst }, () => 'invalid_input'),
      'rate_limited',
    ])
  })

  it('lets a user-library-only grant stop its own operation (P2-12)', async () => {
    const h = await harness()
    h.state.grant = grantOf({
      scopes: ['prompts:write', 'operations:read', 'control:stop'],
      workspaces: [],
    })
    const { operationId } = (await field(h.call('muse_prompt_save', SAVE), 'data')) as {
      operationId: string
    }
    const stop = await h.call('muse_stop', { target: { kind: 'operation', id: operationId } })
    expect(stop).toMatchObject({ status: 'ok', data: { outcome: 'stopped' } })
    expect(h.registry.pending()).toEqual([])
  })

  it('settles the operation when an owner read fails, before or after approval (P2-13)', async () => {
    const h = await harness()
    h.state.listFails = true
    expect(await field(h.call('muse_prompt_save', SAVE), 'reason')).toBe('unavailable')
    h.state.listFails = false
    const retry = await h.call('muse_prompt_save', SAVE)
    expect(retry).toMatchObject({ status: 'ok', data: { state: 'failed' } })
    const pending = await h.call('muse_prompt_save', { ...SAVE, requestId: 'r2' })
    const { operationId } = pending['data'] as { operationId: string }
    h.state.listFails = true
    await approveFirst(h)
    await flush()
    h.state.now += CONNECTOR_LIMITS.pollMinMs
    const status = await h.call('muse_operation_get', { operationId })
    expect((status['data'] as { state: string }).state).toBe('failed')
    expect(h.state.writes).toEqual([])
  })

  it('answers a retry with the real state of the operation (P2-14)', async () => {
    const h = await harness()
    await h.call('muse_prompt_save', SAVE)
    await approveFirst(h)
    await flush()
    const again = await h.call('muse_prompt_save', SAVE)
    expect(again).toMatchObject({ status: 'ok', data: { state: 'completed' } })
    expect(h.state.writes).toHaveLength(1)
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
      ids.push(id ?? '')
      const [view] = ledger.pending()
      if (cycle % 2 === 0) ledger.decide(id ?? '', view?.digest ?? '', false)
      else now += CONNECTOR_LIMITS.approvalLeaseMs + 1
    }
    ledger.expireDue()
    expect(ledger.size).toBe(0)
    expect(ledger.stateOf(ids[0] ?? '')).toBeUndefined()
    expect(ledger.stateOf(ids.at(-2) ?? '')).toBe('denied')
    expect(ledger.stateOf(ids.at(-1) ?? '')).toBe('expired')
  })
})

const WORKSPACE_SAVE = { ...SAVE, scope: 'workspace', workspaceId: 'ws-1', expectedGeneration: 0 }

/** Over real stdio: a workspace save, approved, its dispatch receipt held. */
async function approvedAndHeld(h: Harness) {
  const pipe = stdio(h)
  pipe.call(1, 'muse_prompt_save', WORKSPACE_SAVE)
  expect(await pipe.reply(1)).toMatchObject({ status: 'awaitingApproval' })
  for (const name of DISPATCH_RECEIPTS) h.state.holds.add(name)
  await approveFirst(h)
  await vi.waitFor(() => {
    expect(h.state.held).toHaveLength(1)
  })
  return pipe
}

function cancelCauses(h: Harness): (string | undefined)[] {
  return events(h)
    .filter((record) => record.event === 'cancelled')
    .map((record) => record.cause)
}

const AUTHORITY_CHANGES: readonly (readonly [string, string, (h: Harness) => void])[] = [
  [
    'revocation',
    'revoked',
    (h) => {
      h.state.grant = grantOf({ revoked: true, generation: 2 })
    },
  ],
  [
    'the kill switch',
    'killSwitch',
    (h) => {
      h.state.killed = true
    },
  ],
  [
    'a confidential policy',
    'revoked',
    (h) => {
      h.state.confidential = true
    },
  ],
]

describe('M124 one state machine, one authority (RVM124B)', () => {
  for (const [label, cause, change] of AUTHORITY_CHANGES)
    it(`starts no approved write after ${label} during the dispatch receipt wait, over stdio (P1)`, async () => {
      const h = await harness()
      const pipe = await approvedAndHeld(h)
      change(h)
      release(h)
      await flush()
      expect(h.state.writes).toEqual([])
      expect(cancelCauses(h)).toEqual([cause])
      pipe.input.end()
      await pipe.served
    })

  it('starts no approved write after the client disconnects during the dispatch receipt wait, over stdio (P1)', async () => {
    const h = await harness()
    const pipe = await approvedAndHeld(h)
    // The client closes its read end: the transport disconnects.
    pipe.output.destroy()
    await pipe.served
    release(h)
    await flush()
    expect(h.state.writes).toEqual([])
    expect(cancelCauses(h)).toEqual(['disconnect'])
  })

  it('lets no cancelled call take a read lease or start an owner read, over stdio (P2-2)', async () => {
    const h = await harness()
    const pipe = stdio(h)
    h.state.holds.add('grant')
    const ids = Array.from({ length: CONNECTOR_LIMITS.activeReads }, (_, index) => index + 1)
    for (const id of ids) pipe.call(id, 'muse_prompt_list', { scope: 'user' })
    await vi.waitFor(() => {
      expect(h.state.held).toHaveLength(ids.length)
    })
    for (const id of ids) pipe.cancel(id)
    // The transport delivers the cancellations before the lookups answer.
    await flush()
    // A read that did start would stall here, holding its slot.
    h.state.holds.add('list')
    release(h, 'grant')
    await flush()
    expect(h.state.reads).toBe(0)
    expect(h.limits.leases('read')).toBe(0)
    release(h)
    pipe.call(9, 'muse_prompt_list', { scope: 'user' })
    expect(await pipe.reply(9)).toMatchObject({ status: 'ok' })
    expect(cancelCauses(h)).toEqual(ids.map(() => 'client'))
    pipe.input.end()
    await pipe.served
  })

  it('lets a call past its deadline take no lease and start no owner read (P2-2)', async () => {
    const h = await harness()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      h.state.holds.add('grant')
      let answer: Record<string, unknown> | undefined
      void h.call('muse_prompt_get', { promptId: 'p1' }).then((value) => {
        answer = value
      })
      await vi.advanceTimersByTimeAsync(CONNECTOR_LIMITS.requestDeadlineMs + 1)
      expect(answer).toMatchObject({ status: 'refused', reason: 'unavailable' })
      h.state.holds.add('list')
      release(h, 'grant')
      await vi.advanceTimersByTimeAsync(0)
      expect(h.state.reads).toBe(0)
      expect(h.limits.leases('read')).toBe(0)
    } finally {
      release(h)
      vi.useRealTimers()
    }
  })

  it('frees a lease recorded after its call was cancelled and starts no owner read (P2-2)', async () => {
    const h = await harness()
    const pipe = stdio(h)
    let recordLease: (() => void) | undefined
    // The call's second limits update is its read lease (the first is its rate token).
    const lease = h.limits.updates + 2
    h.limits.hold = (count) => {
      if (count !== lease) return undefined
      const held = Promise.withResolvers<undefined>()
      recordLease = () => {
        held.resolve(undefined)
      }
      return held.promise
    }
    pipe.call(1, 'muse_prompt_list', { scope: 'user' })
    await vi.waitFor(() => {
      expect(recordLease).toBeDefined()
    })
    pipe.cancel(1)
    await flush()
    recordLease?.()
    await flush()
    expect(h.state.reads).toBe(0)
    expect(h.limits.leases('read')).toBe(0)
    pipe.input.end()
    await pipe.served
  })

  it('withholds a read result when the grant is revoked while the owner read runs (P2-2)', async () => {
    const h = await harness()
    h.state.holds.add('list')
    const answer = h.call('muse_prompt_list', { scope: 'user' })
    await vi.waitFor(() => {
      expect(h.state.held).toHaveLength(1)
    })
    h.state.grant = grantOf({ revoked: true, generation: 2 })
    release(h)
    expect(await answer).toMatchObject({ status: 'refused', reason: 'forbidden' })
  })

  it('records a final result refused for its size as the call’s one terminal receipt (P2-4)', async () => {
    const h = await harness()
    h.state.prompts = [prompt({ body: 'Plain words. '.repeat(3077) })]
    const result = await h.call('muse_prompt_get', { promptId: 'p1' })
    expect(result['message']).toBe(CONNECTOR_MODEL_TEXT.tooLarge)
    await flush()
    expect(ends(h, result['callId'])).toEqual([
      expect.objectContaining({ event: 'refused', from: 'dispatching', reason: 'unavailable' }),
    ])
  })

  it('leaves one transport receipt for every frame refused before a call exists, over stdio (P2-4)', async () => {
    const h = await harness()
    const pipe = stdio(h)
    pipe.input.write('{not json\n')
    pipe.input.write(Buffer.from([0xff, 0xfe, 0x0a]))
    pipe.input.write(`${'x'.repeat(CONNECTOR_LIMITS.frameBytes + 1)}\n`)
    pipe.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 5 } })
    pipe.send({ jsonrpc: '2.0', id: 2, method: 'resources/list' })
    pipe.send([{ jsonrpc: '2.0', id: 3, method: 'ping' }])
    // A full transport answers busy.
    h.state.holds.add('grant')
    for (let id = 10; id <= 10 + CONNECTOR_LIMITS.transportTasks; id += 1)
      pipe.call(id, 'muse_prompt_list', { scope: 'user' })
    const codes = () =>
      events(h)
        .filter((record) => record.event === 'transport')
        .map((record) => record.rpcCode ?? 0)
        .toSorted((left, right) => left - right)
    await vi.waitFor(() => {
      expect(codes()).toHaveLength(7)
    })
    expect(codes()).toEqual([-32_700, -32_700, -32_602, -32_601, -32_600, -32_002, -32_001])
    release(h)
    pipe.input.end()
    await pipe.served
  })

  it('reads no further frame while the journal holds its backlog of receipts (P2-4)', async () => {
    const h = await harness()
    h.state.holds.add('transport')
    const pipe = stdio(h)
    const frames = CONNECTOR_LIMITS.auditBacklog * 3
    pipe.input.write('{\n'.repeat(frames))
    await flush()
    expect(h.state.held).toHaveLength(CONNECTOR_LIMITS.auditBacklog)
    release(h)
    await vi.waitFor(() => {
      expect(events(h).filter((record) => record.event === 'transport')).toHaveLength(frames)
    })
    pipe.input.end()
    await pipe.served
  })

  it('walks a read and an approved write through the table, one receipt per transition (P2-4)', async () => {
    const h = await harness()
    const read = await h.call('muse_prompt_list', { scope: 'user' })
    const pending = await h.call('muse_prompt_save', SAVE)
    const { operationId } = pending['data'] as { operationId: string }
    await approveFirst(h)
    await flush()
    const path = (callId: unknown) =>
      events(h)
        .filter((record) => record.callId === callId)
        .map((record) => `${record.from ?? ''}>${record.event}`)
    expect(path(read['callId'])).toEqual([
      'received>admitted',
      'admitted>dispatching',
      'dispatching>settled',
    ])
    expect(path(operationId)).toEqual([
      'received>admitted',
      'admitted>awaitingApproval',
      'awaitingApproval>approved',
      'approved>dispatching',
      'dispatching>settled',
    ])
    expect(h.state.writes).toHaveLength(1)
  })

  it('ends every call on every tool, for every refusal kind, in exactly one terminal receipt (P2-4)', async () => {
    const h = await harness()
    const answers: Record<string, unknown>[] = []
    const run = async (name: string, args: unknown) => {
      // A full bucket for every call that is not about the limit.
      h.state.now += CONNECTOR_LIMITS.minuteMs
      answers.push(await h.call(name, args))
    }
    const valid: Readonly<Record<string, unknown>> = {
      muse_operation_get: { operationId: 'none' },
      muse_stop: { target: { kind: 'operation', id: 'none' } },
      muse_report: REPORT,
      muse_schedule_list: { workspaceId: 'ws-1' },
      muse_schedule_cancel: { workspaceId: 'ws-1', scheduleId: 's1' },
      muse_prompt_list: { scope: 'user' },
      muse_prompt_get: { promptId: 'p1' },
      muse_prompt_save: SAVE,
      muse_prompt_prepare: { promptId: 'p1', expectedGeneration: 0, variables: {} },
      muse_share_preview: { source: { kind: 'prompt', promptId: 'p1' }, format: 'markdown' },
    }
    // Every tool of the table: unknown fields, then a grant without its scopes.
    await run('muse_no_such_tool', {})
    for (const tool of CONNECTOR_TOOLS) await run(tool.name, { bogus: true })
    h.state.grant = grantOf({ scopes: [] })
    for (const tool of CONNECTOR_TOOLS) await run(tool.name, valid[tool.name] ?? {})
    h.state.grant = grantOf()
    // The kill switch, the limiter, and a journal that cannot take the admission.
    h.state.killed = true
    await run('muse_prompt_list', { scope: 'user' })
    h.state.killed = false
    for (let index = 0; index <= CONNECTOR_LIMITS.burst; index += 1)
      answers.push(await h.call('muse_prompt_list', { scope: 'user' }))
    h.state.failEvents.add('admitted')
    await run('muse_prompt_list', { scope: 'user' })
    h.state.failEvents.clear()
    // Refusals after admission: not found, stale, size, poll, unavailable lanes, a wrong workspace.
    await run('muse_prompt_get', { promptId: 'missing' })
    await run('muse_prompt_prepare', { promptId: 'p1', expectedGeneration: 1, variables: {} })
    await run('muse_stop', { workspaceId: 'ws-1', target: { kind: 'lane', id: 'l1' } })
    // Writes: stale target, no approval surface, then denied and expired operations.
    await run('muse_prompt_save', { ...SAVE, requestId: 'stale', expectedGeneration: 1 })
    h.state.surface = false
    await run('muse_prompt_save', { ...SAVE, requestId: 'hidden' })
    h.state.surface = true
    await run('muse_prompt_save', { ...SAVE, requestId: 'denied' })
    const [denied] = h.registry.pending()
    h.registry.decide(denied?.intentId ?? '', denied?.digest ?? '', false)
    await run('muse_prompt_save', { ...SAVE, requestId: 'expired' })
    const expiring = answers.at(-1)?.['data'] as { operationId: string }
    h.state.now += CONNECTOR_LIMITS.approvalLeaseMs + 1
    await run('muse_operation_get', { operationId: expiring.operationId })
    await run('muse_operation_get', { operationId: expiring.operationId })
    await run('muse_stop', {
      workspaceId: 'ws-1',
      target: { kind: 'operation', id: expiring.operationId },
    })
    await flush()
    // Every answered call ends in exactly one terminal receipt that carries its reason.
    for (const answer of answers) {
      if (answer['status'] === 'awaitingApproval') continue
      const [end, ...more] = ends(h, answer['callId'])
      expect(end).toBeDefined()
      expect(more).toEqual([])
      if (answer['status'] === 'ok') expect(end?.event).toBe('settled')
      else expect(end?.reason).toBe(answer['reason'])
    }
    // Every receipt of every call is one edge of the transition table.
    for (const record of events(h))
      if (record.from !== undefined)
        expect(TRANSITIONS[record.from as keyof typeof TRANSITIONS]).toContain(record.event)
    // Every refusal kind this build can produce was produced (paid authority is zero).
    const kinds = new Set([
      ...answers.flatMap((answer) => (answer['reason'] === undefined ? [] : [answer['reason']])),
      ...events(h).flatMap((record) => (record.event === 'cancelled' ? [record.reason] : [])),
    ])
    expect([...kinds].toSorted(byName)).toEqual(
      CONNECTOR_REASONS.filter((reason) => reason !== 'budget_exceeded').toSorted(byName),
    )
  })

  it('lets the user-library grant stop a user-library save that named a workspace, over stdio (P2-5)', async () => {
    const h = await harness()
    h.state.grant = grantOf({
      scopes: ['prompts:write', 'operations:read', 'control:stop'],
      workspaces: [],
    })
    const pipe = stdio(h)
    for (const [id, stop] of [
      [1, {}],
      [3, { workspaceId: 'not-granted' }],
    ] as const) {
      pipe.call(id, 'muse_prompt_save', {
        ...SAVE,
        requestId: `r${String(id)}`,
        workspaceId: 'not-granted',
      })
      const pending = await pipe.reply(id)
      expect(pending).toMatchObject({ status: 'awaitingApproval' })
      const { operationId } = pending['data'] as { operationId: string }
      pipe.call(id + 1, 'muse_stop', { ...stop, target: { kind: 'operation', id: operationId } })
      expect(await pipe.reply(id + 1)).toMatchObject({ status: 'ok', data: { outcome: 'stopped' } })
      expect(h.registry.pending()).toEqual([])
    }
    pipe.input.end()
    await pipe.served
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
  it('takes only the table’s edges, ends once, and never cancels a started write', () => {
    for (const [from, edges] of Object.entries(TRANSITIONS))
      if (['settled', 'refused', 'cancelled', 'failed'].includes(from)) expect(edges).toEqual([])
    const { operation: write, journal } = operationOf('muse_prompt_save', {})
    expect(write.move('settled')).toBe(false)
    expect(write.move('admitted')).toBe(true)
    expect(write.move('dispatching')).toBe(true)
    expect(write.cancel('stop')).toBe(false)
    expect(write.stop()).toBe('stopRequested')
    expect(write.move('settled')).toBe(true)
    expect(write.move('failed')).toBe(false)
    expect(write.cancel('stop')).toBe(false)
    expect(write.stop()).toBe('alreadyStopped')
    expect(journal).toEqual(['received>admitted', 'admitted>dispatching', 'dispatching>settled'])
    const { operation: read } = operationOf('muse_prompt_list', {})
    read.move('admitted')
    read.move('dispatching')
    expect(read.cancel('client')).toBe(true)
    expect(read.state).toBe('cancelled')
  })

  it('runs a hold when the operation leaves its states, or at once when it already has', () => {
    const { operation } = operationOf('muse_prompt_list', {})
    const released: string[] = []
    operation.holdWhile(['received', 'admitted'], () => {
      released.push('lease')
    })
    operation.move('admitted')
    expect(released).toEqual([])
    operation.move('dispatching')
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
