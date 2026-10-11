import * as acp from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { aggregateResources } from '../../src/core/usage/aggregate'
import { AcpPaidUse } from '../../src/acp/paid'
import { acpResourceCommand, acpResourceUpdates } from '../../src/acp/resources'
import { RESOURCE_EXIT_MS, RESOURCE_GIB_BYTES, UI_TEXT } from '../../src/shared/constants'
import { fill, formatBytes } from '../../src/shared/l10n/text'
import { resourceRecordSchema } from '../../src/shared/resources'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { FakeAgentHost, type FakeAgentSession } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { runtimeResources } from './helpers/resources/runtime'

const resources: RuntimeResources[] = []
afterEach(() => {
  for (const host of resources.splice(0)) host.dispose()
})

async function scene() {
  const fixture = await runtimeResources()
  resources.push(fixture.host)
  const stopped = vi.fn()
  const subscribe = fixture.host.subscribe.bind(fixture.host)
  vi.spyOn(fixture.host, 'subscribe').mockImplementation((sessionId, listener) => {
    const stop = subscribe(sessionId, listener)
    return () => {
      stop()
      stopped(sessionId)
    }
  })
  const backend = new FakeAgentHost()
  const updates: acp.SessionNotification[] = []
  const permissions = vi.fn((): acp.RequestPermissionResponse => ({
    outcome: { outcome: 'cancelled' },
  }))
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const agent = createAcpAgent({
    backend: {
      kind: 'museCode',
      hostFor: () => Promise.resolve(backend),
      readiness: () => Promise.resolve({ state: 'ready' }),
    },
    resources: fixture.host,
    questions: 'decline',
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    version: 'test',
    defaultCwd: process.cwd(),
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
  })
  const client = acp
    .client({ name: 'm107h' })
    .onNotification('session/update', ({ params }) => {
      updates.push(params)
    })
    .onRequest('session/request_permission', permissions)
  const run = (
    test: (
      client: acp.ClientContext,
      sessionId: string,
      session: FakeAgentSession,
    ) => Promise<void>,
  ) =>
    client.connectWith(agent, async (connection) => {
      await connection.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const { sessionId } = await connection.request('session/new', {
        cwd: process.cwd(),
        mcpServers: [],
      })
      const session = backend.sessions[0]
      if (session === undefined) throw new Error('missing fake session')
      await test(connection, sessionId, session)
    })
  return { ...fixture, backend, updates, permissions, stopped, run }
}

function ask(client: acp.ClientContext, sessionId: string, text: string) {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}

async function finishOrdinaryTurn(
  client: acp.ClientContext,
  sessionId: string,
  session: FakeAgentSession,
) {
  const pending = ask(client, sessionId, 'go')
  await vi.waitFor(() => {
    expect(session.sendTurn).toHaveBeenCalled()
  })
  session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
  await pending
}

describe('M107 H ACP resources', () => {
  it('handles status, resume and retained resource usage locally without any model turn or paid question', async () => {
    const s = await scene()
    const record = resourceRecordSchema.parse({
      type: 'resource',
      atMs: 0,
      minute: null,
      event: { type: 'override', atMs: 0, untilMs: 1 },
      work: [],
    })
    vi.spyOn(s.host, 'history').mockResolvedValue(aggregateResources([record]))
    await s.run(async (client, sessionId, session) => {
      // A local command accidentally submitted to the model completes, exposing the leak by assertion.
      session.sendTurn.mockImplementation(() => {
        session.emit({ type: 'turnCompleted', turnId: 'leaked-command', terminal: 'completed' })
        return Promise.resolve({ turnId: 'leaked-command', disposition: 'started' })
      })
      for (const text of [
        '/resources',
        '/resources status',
        '/resources resume',
        '/resources history',
        '/usage resources',
      ]) {
        expect(await ask(client, sessionId, text)).toMatchObject({ stopReason: 'end_turn' })
      }
      expect(session.sendTurn).not.toHaveBeenCalled()
      expect(session.listSkills).not.toHaveBeenCalled()
      expect(s.permissions).not.toHaveBeenCalled()
      const messages = s.updates
        .map(({ update }) => update)
        .filter((update) => update.sessionUpdate === 'agent_message_chunk')
      expect(messages).toHaveLength(5)
      // Both history routes show the retained journal's event, not an unavailable notice.
      expect(messages.slice(3).map((message) => JSON.stringify(message))).toEqual([
        expect.stringContaining(UI_TEXT.resourceHistoryOverrides),
        expect.stringContaining(UI_TEXT.resourceHistoryOverrides),
      ])
      expect(s.machine.writeResumeUntil).toHaveBeenCalledTimes(1)
    })
  })

  it('rejects malformed local commands and leaves ordinary skill/model input alone', async () => {
    const s = await scene()
    await s.run(async (client, sessionId, session) => {
      await expect(
        acpResourceCommand([{ type: 'text', text: '/resources wrong' }], s.host),
      ).rejects.toThrow()
      for (const text of ['/resources wrong', '/resources resume extra', '/usage resources extra'])
        await expect(ask(client, sessionId, text)).rejects.toThrow()
      expect(session.sendTurn).not.toHaveBeenCalled()
      expect(
        await acpResourceCommand([{ type: 'text', text: '/resourcesLikeAName' }], s.host),
      ).toBeUndefined()
      await expect(
        acpResourceCommand(
          [
            { type: 'text', text: '/resources resume' },
            { type: 'text', text: 'extra' },
          ],
          s.host,
        ),
      ).rejects.toThrow()
      const pending = ask(client, sessionId, 'ordinary work')
      await vi.waitFor(() => {
        expect(session.sendTurn).toHaveBeenCalledTimes(1)
      })
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'completed' })
      const answer = await pending
      expect(answer.stopReason).toBe('end_turn')
    })
  })

  it('announces built-in commands even when skills fail, preserving resource name ownership', async () => {
    const s = await scene()
    await s.run(async (client, sessionId, session) => {
      session.listSkills.mockRejectedValueOnce(new Error('not available'))
      await finishOrdinaryTurn(client, sessionId, session)
      const commands = s.updates.find(
        ({ update }) => update.sessionUpdate === 'available_commands_update',
      )?.update
      expect(commands).toMatchObject({
        availableCommands: [
          { name: 'help' },
          { name: 'compact' },
          // M93's /report (df3afec80, PLAN D72) is announced between compact
          // and the resource commands; resource name ownership is unchanged.
          { name: 'report' },
          { name: 'resources' },
          { name: 'usage' },
          { name: 'agents' },
        ],
      })
    })
  })

  it('reserves resource command names while retaining the other skill commands', async () => {
    const s = await scene()
    await s.run(async (client, sessionId, session) => {
      session.skills = ['help', 'report', 'resources', 'usage', 'agents', 'custom'].map(
        (selector) => ({
          selector,
          displayName: selector,
          description: `skill-${selector}`,
          argumentHint: undefined,
        }),
      )
      await finishOrdinaryTurn(client, sessionId, session)
      const commands = s.updates.find(
        ({ update }) => update.sessionUpdate === 'available_commands_update',
      )?.update
      if (commands?.sessionUpdate !== 'available_commands_update')
        throw new Error('missing commands')
      expect(commands.availableCommands.map((command) => command.name)).toEqual([
        'help',
        'compact',
        // M93's /report (df3afec80, PLAN D72); skill selectors for resources,
        // usage, agents and report stay reserved to the built-ins below.
        'report',
        'resources',
        'usage',
        'agents',
        'custom',
      ])
      expect(
        commands.availableCommands.find((command) => command.name === 'resources')?.description,
      ).toBe(UI_TEXT.resourceGovernorDescription)
    })
  })

  it('sends one affected-session notice per change and attaches bounded metadata to the deferred call', async () => {
    const s = await scene()
    await s.run(async (client, sessionId) => {
      const created = await client.request('session/new', { cwd: process.cwd(), mcpServers: [] })
      const running = await s.host.admit(
        { kind: 'check', class: 'background', priority: 0 },
        { sessionId, toolCallId: 'live-tool' },
      )
      const permit = await running.ready
      s.reading.memoryAvailableBytes = 1
      await s.host.status()
      const deferred = await s.host.admit(
        { kind: 'toolShell', class: 'foreground', priority: 0 },
        { sessionId, toolCallId: 'waiting-tool' },
      )
      await vi.waitFor(() => {
        expect(
          s.updates.some(
            ({ update }) =>
              update.sessionUpdate === 'tool_call_update' && update.toolCallId === 'waiting-tool',
          ),
        ).toBe(true)
      })
      expect(s.updates.filter((update) => update.sessionId === created.sessionId)).toHaveLength(0)
      const notices = s.updates.filter(
        ({ update }) => update.sessionUpdate === 'agent_message_chunk',
      )
      expect(notices).toHaveLength(1)
      const call = s.updates.find(
        ({ update }) => update.sessionUpdate === 'tool_call_update',
      )?.update
      expect(call).toMatchObject({
        title: UI_TEXT.resourceWaiting,
        status: 'pending',
        _meta: {
          'museSpark.resources': {
            event: { type: 'deferred', kind: 'toolShell', class: 'foreground' },
            status: { level: 'pause' },
          },
        },
      })
      expect(JSON.stringify(call)).not.toMatch(/pid|commandLine|CANARY|startTime/)
      deferred.runNow()
      const foreground = await deferred.ready
      foreground.release()
      permit.release()
      await client.request('session/close', { sessionId })
      expect(s.stopped).toHaveBeenCalledWith(sessionId)
      const count = s.updates.length
      await s.host.resume()
      expect(s.updates).toHaveLength(count)
    })
  })

  it('keeps Resume and Stop reachable during a paused turn', async () => {
    const s = await scene()
    await s.run(async (client, sessionId, session) => {
      const pending = ask(client, sessionId, 'work')
      await vi.waitFor(() => {
        expect(session.sendTurn).toHaveBeenCalled()
      })
      s.reading.memoryAvailableBytes = 1
      const paused = await s.host.status()
      expect(paused.level).toBe('pause')
      const resumed = await ask(client, sessionId, '/resources resume')
      expect(resumed.stopReason).toBe('end_turn')
      expect(session.sendTurn).toHaveBeenCalledTimes(1)
      await client.notify('session/cancel', { sessionId })
      await vi.waitFor(() => {
        expect(session.cancel).toHaveBeenCalledTimes(1)
      })
      session.emit({ type: 'turnCompleted', turnId: 'turn-1', terminal: 'cancelled' })
      const cancelled = await pending
      expect(cancelled.stopReason).toBe('cancelled')
    })
  })

  it('warns once per conversation across repeated pauses while preserving every level update', async () => {
    const s = await scene()
    await s.run(async (client, sessionId) => {
      const running = await s.host.admit(
        { kind: 'check', class: 'background', priority: 0 },
        { sessionId },
      )
      const permit = await running.ready
      s.reading.memoryAvailableBytes = 1
      expect(await s.host.status()).toMatchObject({ level: 'pause' })
      s.reading.memoryAvailableBytes = 8 * RESOURCE_GIB_BYTES
      await s.host.status()
      s.clock.advance(RESOURCE_EXIT_MS)
      expect(await s.host.status()).toMatchObject({ level: 'throttle' })
      s.clock.advance(RESOURCE_EXIT_MS)
      expect(await s.host.status()).toMatchObject({ level: 'normal' })

      const second = await client.request('session/new', { cwd: process.cwd(), mcpServers: [] })
      const otherRunning = await s.host.admit(
        { kind: 'check', class: 'background', priority: 0 },
        { sessionId: second.sessionId },
      )
      const otherPermit = await otherRunning.ready
      s.reading.memoryAvailableBytes = 1
      expect(await s.host.status()).toMatchObject({ level: 'pause' })
      const levelUpdates = (id: string) =>
        s.updates.filter(
          ({ sessionId: updatedId, update }) =>
            updatedId === id &&
            update.sessionUpdate === 'agent_message_chunk' &&
            update._meta?.['museSpark.resources'] !== undefined,
        )
      await vi.waitFor(() => {
        expect(levelUpdates(sessionId)).toHaveLength(4)
        expect(levelUpdates(second.sessionId)).toHaveLength(1)
      })
      expect(levelUpdates(sessionId)).toMatchObject(
        ['pause', 'throttle', 'normal', 'pause'].map((level) => ({
          update: {
            _meta: { 'museSpark.resources': { event: { to: level }, status: { level } } },
          },
        })),
      )
      const fullWarnings = (id: string) =>
        levelUpdates(id).filter(
          ({ update }) =>
            update.sessionUpdate === 'agent_message_chunk' &&
            update.content.type === 'text' &&
            update.content.text.includes(UI_TEXT.resourceResumeNow),
        )
      expect(fullWarnings(sessionId)).toHaveLength(1)
      expect(fullWarnings(second.sessionId)).toHaveLength(1)
      expect(JSON.stringify(fullWarnings(sessionId))).toContain(
        fill(UI_TEXT.resourcePauseNotice, {
          metric: UI_TEXT.resourceAvailableMemory,
          reading: formatBytes(1),
          threshold: formatBytes(RESOURCE_GIB_BYTES),
        }),
      )
      expect(s.permissions).not.toHaveBeenCalled()
      otherPermit.release()
      permit.release()
    })
  })

  it('refuses private metadata fields even when an injected notice port lies', async () => {
    const { host } = await runtimeResources()
    resources.push(host)
    const status = await host.status()
    Reflect.set(status.settings, 'CANARY', 'private')
    expect(() =>
      acpResourceUpdates({
        event: { type: 'deferred', atMs: 0, kind: 'check', class: 'background' },
        status,
        text: 'safe',
        toolCallId: 'call',
      }),
    ).toThrow()
    Reflect.deleteProperty(status.settings, 'CANARY')
    const event = {
      type: 'deferred' as const,
      atMs: 0,
      kind: 'check' as const,
      class: 'background' as const,
    }
    Reflect.set(event, 'pid', 10)
    expect(() => acpResourceUpdates({ event, status, text: 'safe', toolCallId: 'call' })).toThrow()
    expect(
      acpResourceUpdates({
        event: {
          type: 'relocated',
          atMs: 0,
          kind: 'check',
          level: 'relocate',
          reason: 'machineBusy',
        },
        status,
        text: 'device notice from the relocation port',
      }),
    ).toMatchObject([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { text: 'device notice from the relocation port' },
      },
    ])
  })
})
