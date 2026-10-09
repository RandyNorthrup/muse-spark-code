// M124 (D106): the connector's registry and policy through the real MCP
// protocol class, with fake owner ports. Approval can only come from the
// approval page's `decide`; Stop never asks; results are scrubbed.
import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_LIMITS,
  CONNECTOR_MODEL_TEXT,
  CONNECTOR_SCHEMA_VERSION,
} from '../../src/shared/constants'
import type { ConnectorGrant } from '../../src/shared/connector'
import { CONNECTOR_TOOLS } from '../../src/shared/connectorTools'
import type { SavedPrompt } from '../../src/shared/prompts'
import { ApprovalLedger, bindingDigest } from '../../src/core/connector/approval'
import { ConnectorAudit, type AuditPort } from '../../src/core/connector/audit'
import { ConnectorProtocol } from '../../src/core/connector/protocol'
import { createConnectorScrub } from '../../src/core/connector/redaction'
import { ConnectorRegistry, type RegistryDeps } from '../../src/core/connector/registry'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'

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
  }
  call(name: string, args?: unknown): Promise<Record<string, unknown>>
}

async function harness(): Promise<Harness> {
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
  }
  const port: AuditPort = {
    append: (line) => {
      if (state.auditFails) return Promise.reject(new Error('disk full'))
      state.audit.push(line)
      return Promise.resolve()
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
    grant: () => Promise.resolve(state.grant),
    killed: () => Promise.resolve(state.killed),
    confidential: () => state.confidential,
    audit: new ConnectorAudit(port, 'codex', now, scrub.text),
    scrub,
    surface: {
      show: () => {
        state.shown += 1
        return Promise.resolve(state.surface)
      },
      changed: () => undefined,
    },
    prompts: {
      list: (_root, scope) =>
        Promise.resolve(state.prompts.filter((candidate) => candidate.scope === scope)),
      write: (_root, saved) => {
        state.writes.push(saved)
        state.prompts.push(saved)
        return Promise.resolve()
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
      generate: (root, kind) => Promise.resolve(`# ${kind} report for ${root}`),
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
