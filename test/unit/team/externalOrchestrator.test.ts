// D250: an external ACP agent leading a conversation. The host under test
// is the real one; across the wire is a real ACP agent process on the
// pinned SDK (`test/fixtures/external-orchestrator/agent.mjs`), and the
// team endpoint is the real loopback server behind the real window
// binding. The suite proves the wire claims: the endpoint travels in
// `session/new` (HTTP, or the bridge where the agent has no HTTP), the
// turn streams as panel items, a permission request is the person's card
// to answer, cancel reaches the agent, a named model is confirmed or the
// start refuses, and not-signed-in names the agent's own CLI.

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ExternalOrchestratorHost,
  type ExternalOrchestratorDeps,
} from '../../../src/host/team/externalOrchestrator'
import type { TeamHostBinding } from '../../../src/host/teamHostBinding'
import type { ExternalAgent } from '../../../src/core/team/externalAgents'
import type { AgentEvent } from '../../../src/shared/agentEvents'
import { TEAM_MCP_MODEL_TEXT } from '../../../src/shared/constants'
import { openExternalLeadBinding, silentLog } from '../helpers/teamMcpBinding'
import { assertCurrentProductionBuild } from '../productionBuild'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURE = path.join(ROOT, 'test', 'fixtures', 'external-orchestrator', 'agent.mjs')
const BRIDGE = path.join(ROOT, 'dist', 'teamHttpBridge.js')

const state: { workspace: string; binding: TeamHostBinding | undefined; sequence: number } = {
  workspace: '',
  binding: undefined,
  sequence: 0,
}

beforeAll(async () => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  state.workspace = await mkdtemp(path.join(tmpdir(), 'orchext-'))
  state.binding = await openExternalLeadBinding()
})

afterAll(async () => {
  await state.binding?.dispose()
  await rm(state.workspace, { recursive: true, force: true })
})

interface Run {
  readonly host: ExternalOrchestratorHost
  readonly recordPath: string
  readonly record: () => Promise<Record<string, unknown>[]>
}

function makeHost(mode: string, isHttp: boolean, model = 'fixture'): Run {
  state.sequence += 1
  const recordPath = path.join(state.workspace, `record-${String(state.sequence)}.jsonl`)
  const agent: ExternalAgent = {
    agentId: 'fixture',
    label: 'Fixture Agent',
    command: process.execPath,
    args: [FIXTURE],
    signInCommand: 'fixture-login',
    model,
    pays: 'subscription',
  }
  const deps: ExternalOrchestratorDeps = {
    agent,
    command: process.execPath,
    bridge: { command: process.execPath, args: [BRIDGE] },
    log: silentLog,
    platform: process.platform,
    baseEnv: {
      ...process.env,
      FIXTURE_MODE: mode,
      FIXTURE_HTTP: isHttp ? '1' : '0',
      FIXTURE_RECORD: recordPath,
    },
    newId: () => `id-${String(state.sequence)}-${Math.random().toString(36).slice(2)}`,
    now: () => Date.now(),
  }
  return {
    host: new ExternalOrchestratorHost(deps),
    recordPath,
    record: async () => {
      try {
        const text = await readFile(recordPath, 'utf8')
        return text
          .trim()
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>)
      } catch {
        return []
      }
    },
  }
}

/** A session on the fixture agent, in the suite's workspace, with the person's usual mode. */
function start(
  run: Run,
  modelId: string,
  mcpServers?: Parameters<ExternalOrchestratorHost['startSession']>[0]['mcpServers'],
) {
  return run.host.startSession({
    workspaceRoot: state.workspace,
    modelId,
    approvalMode: 'promptUnmatched',
    ...(mcpServers !== undefined && { mcpServers }),
  })
}

/** A session on the fixture agent that took one turn: the session, its events, how the turn ended. */
async function takeTurn(run: Run) {
  const session = await start(run, 'fixture')
  const events = collect(session)
  await session.sendTurn([{ type: 'text', text: 'go' }])
  const done = await waitFor(events, 'turnCompleted')
  return { session, events, done }
}

async function teamEndpoint() {
  if (state.binding === undefined) throw new Error('binding not open')
  const endpoint = await state.binding.teamMcp.endpointForConversation()
  if (endpoint === undefined) throw new Error('team endpoint missing')
  return endpoint
}

function collect(session: {
  onEvent: (listener: (event: AgentEvent) => void) => () => void
}): AgentEvent[] {
  const events: AgentEvent[] = []
  session.onEvent((event) => {
    events.push(event)
  })
  return events
}

async function waitFor(events: AgentEvent[], type: AgentEvent['type']): Promise<AgentEvent> {
  const timeoutMs = 10_000
  const start = Date.now()
  for (;;) {
    const found = events.find((event) => event.type === type)
    if (found !== undefined) return found
    if (Date.now() - start > timeoutMs) throw new Error(`no ${type} event arrived`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
}

describe('an external ACP agent as orchestrator', () => {
  it('gives the agent the team endpoint over the bridge and streams its turn', async () => {
    const run = makeHost('default', false)
    const endpoint = await teamEndpoint()
    try {
      expect(run.host.info.kind).toBe('external')
      const session = await start(run, 'fixture', { team: endpoint })
      const record = await run.record()
      const started = record.find((row) => row['kind'] === 'session/new')
      const servers = started?.['mcpServers'] as
        { name: string; command?: string; env?: { name: string; value: string }[] }[] | undefined
      expect(servers).toHaveLength(1)
      expect(servers?.[0]?.name).toBe('team')
      // No HTTP advertised: the bridge, pointed at the same endpoint.
      expect(servers?.[0]?.command).toBe(process.execPath)
      const env = new Map((servers?.[0]?.env ?? []).map((row) => [row.name, row.value]))
      expect(env.get('MUSE_TEAM_BRIDGE_URL')).toBe(endpoint.url)
      expect(env.get('MUSE_TEAM_BRIDGE_HEADERS')).toContain('Authorization')
      expect(session.modelId).toBe('m1')

      const events = collect(session)
      await session.sendTurn([{ type: 'text', text: 'do it' }])
      const done = await waitFor(events, 'turnCompleted')
      expect(done).toMatchObject({ terminal: 'completed' })
      const kinds = events.map((event) => event.type)
      expect(kinds).toContain('itemStarted')
      expect(kinds).toContain('textDelta')
      expect(kinds).toContain('todoChanged')
      expect(kinds).toContain('contextUsage')
      const message = events.find(
        (event) => event.type === 'itemCompleted' && event.item.kind === 'agentMessage',
      )
      expect(message).toMatchObject({ item: { text: 'Hello world' } })
      const tool = events.find(
        (event) => event.type === 'itemCompleted' && event.item.kind === 'toolCall',
      )
      expect(tool).toMatchObject({ item: { status: 'completed', visibleOutput: 'file body' } })
      session.dispose()
    } finally {
      await run.host.close()
    }
  })

  it('gives the endpoint over HTTP where the agent advertises it', async () => {
    const run = makeHost('default', true)
    const endpoint = await teamEndpoint()
    try {
      const session = await start(run, 'fixture', { team: endpoint })
      const record = await run.record()
      const servers = record.find((row) => row['kind'] === 'session/new')?.['mcpServers'] as
        { name: string; type?: string; url?: string }[] | undefined
      expect(servers?.[0]).toMatchObject({ name: 'team', type: 'http', url: endpoint.url })
      session.dispose()
    } finally {
      await run.host.close()
    }
  })

  it.each([
    { label: 'the shipped bridge', isHttp: false, transport: 'stdio' },
    { label: 'HTTP', isHttp: true, transport: 'http' },
  ])(
    'lets the agent use the team tools it was given, over $label',
    async ({ isHttp, transport }) => {
      const run = makeHost('mcp', isHttp)
      const endpoint = await teamEndpoint()
      if (state.binding === undefined) throw new Error('binding not open')
      await state.binding.teamMcp.rememberMode('orchext-session', 'team')
      try {
        const session = await start(run, 'fixture', { team: endpoint })
        const events = collect(session)
        await session.sendTurn([{ type: 'text', text: 'what can you use?' }])
        await waitFor(events, 'turnCompleted')
        const rows = await run.record()
        const read = rows.find((row) => row['kind'] === 'team-read')
        // What the agent saw came from the very endpoint, through its own
        // MCP client: the instructions we ship, the five tools, the roster.
        expect(read).toMatchObject({
          transport,
          instructions: TEAM_MCP_MODEL_TEXT.mcpInstructions,
          tools: ['roster', 'delegate', 'collect', 'cancel', 'merge'],
        })
        expect(String(read?.['roster'])).toContain('engineering')
        session.dispose()
      } finally {
        await run.host.close()
      }
    },
  )

  it('puts the agent’s permission request on the person’s card', async () => {
    const run = makeHost('permission', true)
    try {
      const session = await start(run, 'fixture')
      const events = collect(session)
      await session.sendTurn([{ type: 'text', text: 'write it' }])
      const asked = await waitFor(events, 'approvalRequested')
      if (asked.type !== 'approvalRequested') throw new Error('unreachable')
      expect(asked.availableChoices.map((choice) => choice.label)).toEqual([
        'Allow once',
        'Reject once',
      ])
      await session.decideApproval({
        approvalId: asked.approvalId,
        choiceId: 'allow-1',
        requirementId: asked.requirementId,
      })
      await waitFor(events, 'turnCompleted')
      const record = await run.record()
      expect(record.find((row) => row['kind'] === 'permission-answer')?.['outcome']).toEqual({
        outcome: 'selected',
        optionId: 'allow-1',
      })
      session.dispose()
    } finally {
      await run.host.close()
    }
  })

  it('reaches the agent with cancel', async () => {
    const run = makeHost('slow', true)
    try {
      const session = await start(run, 'fixture')
      const events = collect(session)
      await session.sendTurn([{ type: 'text', text: 'long task' }])
      await session.cancel()
      const done = await waitFor(events, 'turnCompleted')
      expect(done).toMatchObject({ terminal: 'cancelled' })
      const record = await run.record()
      expect(record.some((row) => row['kind'] === 'session/cancel')).toBe(true)
      session.dispose()
    } finally {
      await run.host.close()
    }
  })

  it('selects a named model, and refuses one the agent does not confirm', async () => {
    const named = makeHost('default', true, 'm2')
    try {
      const session = await start(named, 'm2')
      expect(session.modelId).toBe('m2')
      const record = await named.record()
      expect(record.find((row) => row['kind'] === 'session/set_config_option')).toMatchObject({
        configId: 'model',
        value: 'm2',
      })
      session.dispose()
    } finally {
      await named.host.close()
    }
    const unknown = makeHost('default', true, 'no-such-model')
    try {
      await expect(start(unknown, 'no-such-model')).rejects.toThrow(
        /did not confirm the model no-such-model/u,
      )
    } finally {
      await unknown.host.close()
    }
  })

  it('names the agent’s own sign-in command when it is not signed in', async () => {
    const run = makeHost('auth-terminal', true)
    try {
      await expect(start(run, 'fixture')).rejects.toThrow(
        /Fixture Agent is not signed in.*fixture-login/u,
      )
    } finally {
      await run.host.close()
    }
  })

  it('passes an agent-kind authenticate through as the agent’s own flow', async () => {
    const run = makeHost('auth-agent', true)
    try {
      const { session, done } = await takeTurn(run)
      expect(done).toMatchObject({ terminal: 'completed' })
      const record = await run.record()
      expect(record.find((row) => row['kind'] === 'authenticate')).toMatchObject({
        methodId: 'agent-sign-in',
      })
      session.dispose()
    } finally {
      await run.host.close()
    }
  })

  it('fails the open turn when the agent dies, then resumes through session/load with its history', async () => {
    const run = makeHost('die', true)
    try {
      const { session, done } = await takeTurn(run)
      expect(done).toMatchObject({ terminal: 'failed', errorKind: 'backend' })

      // The agent is gone; resuming starts it again and loads the session.
      const loaded = await run.host.resumeSession(session.sessionId, 'm1')
      expect(loaded.session).toBe(session)
      const history = loaded.history
      if (history.mode !== 'inline') throw new Error('the history is read inline')
      const texts = history.items.map((item) => item.text)
      expect(texts).toContain('earlier ask')
      expect(texts).toContain('earlier answer')
      const rows = await run.record()
      expect(rows.some((row) => row['kind'] === 'session/load')).toBe(true)
      session.dispose()
    } finally {
      await run.host.close()
    }
  })
})
