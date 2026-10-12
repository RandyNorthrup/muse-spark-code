// ACPDOG round 4: battle findings B12/B13/B19-B21, spoken over the protocol to
// the real agent with a fake backend (the ACP SDK's own client, in process).
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent } from '../../src/acp/agent'
import { SessionNotFoundError } from '../../src/core/agent/agentBackend'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { FakeAgentHost, type FakeAgentSession } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { fakeAcpQuestions } from './helpers/questions/acpRegistry'
import { AcpPaidUse } from '../../src/acp/paid'
import { until } from './helpers/acpWaits'

const CWD = process.platform === 'win32' ? String.raw`C:\\work\\app` : '/work/app'

interface Round4Harness {
  readonly host: FakeAgentHost
  readonly updates: acp.SessionUpdate[]
  run<T>(op: (client: acp.ClientContext) => Promise<T>): Promise<T>
}

function harness(): Round4Harness {
  const host = new FakeAgentHost()
  host.info = { ...host.info, kind: 'museCode' }
  const updates: acp.SessionUpdate[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const agent = createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: '0.0.0-test',
    options: {
      canBypass: false,
      allowsContributorModels: false,
      initialMode: 'manual',
    },
    signIn: {
      id: 'muse-code-login',
      name: 'Sign In',
      description: 'Sign In to Muse Code',
      args: ['login'],
      command: 'muse-spark-code-acp login',
    },
    defaultCwd: CWD,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    questions: fakeAcpQuestions,
  })
  const client = acp
    .client({ name: 'round4-client' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('session/request_permission', () => ({ outcome: { outcome: 'cancelled' } }))
  return { host, updates, run: (op) => client.connectWith(agent, op) }
}

async function start(client: acp.ClientContext): Promise<acp.NewSessionResponse> {
  await client.request('initialize', {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientCapabilities: { session: { notices: {} } },
  })
  return await client.request('session/new', { cwd: CWD, mcpServers: [] })
}

function prompt(client: acp.ClientContext, sessionId: string, text: string) {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}

function chunkTexts(updates: readonly acp.SessionUpdate[]): string[] {
  return updates.flatMap((update) =>
    update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text'
      ? [update.content.text]
      : [],
  )
}

function completeModelTurn(session: FakeAgentSession, turnNumber: number): void {
  session.emit({
    type: 'itemCompleted',
    item: {
      itemId: 'answer',
      kind: 'agentMessage',
      status: 'completed',
      text: 'Model output',
    },
  })
  session.emit({
    type: 'turnCompleted',
    turnId: `turn-${String(turnNumber)}`,
    terminal: 'completed',
  })
}

describe('B12 unknown slash commands stay local', () => {
  it('answers /nosuchcommand locally with the nearest commands, never a model turn', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = await prompt(client, sessionId, '/nosuchcommand')
      expect(response).toEqual({ stopReason: 'end_turn' })
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      const texts = chunkTexts(h.updates)
      expect(texts.some((text) => text.includes('Unknown command /nosuchcommand'))).toBe(true)
      expect(texts.some((text) => text.includes('/help'))).toBe(true)
    })
  })

  it('treats /models as unknown: the Help reference promises only /help and /compact', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = await prompt(client, sessionId, '/models')
      expect(response).toEqual({ stopReason: 'end_turn' })
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(chunkTexts(h.updates).some((text) => text.includes('Unknown command /models'))).toBe(
        true,
      )
    })
  })

  it('leaves a lone / as prompt text for the model', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = prompt(client, sessionId, '/')
      const session = h.host.sessions[0]!
      await until(() => session.sendTurn.mock.calls.length === 1)
      expect(session.sendTurn.mock.calls[0]?.[1]).toBe('/')
      completeModelTurn(session, 1)
      expect(await response).toEqual({ stopReason: 'end_turn' })
    })
  })

  it('answers /help <topic> locally: a known command, then no such topic', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await prompt(client, sessionId, '/help compact')
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(
        chunkTexts(h.updates).some((text) => text.includes(`/compact: ${UI_TEXT.compactDetail}`)),
      ).toBe(true)
      await prompt(client, sessionId, '/help exec')
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(chunkTexts(h.updates)).toContainEqual(
        fill(UI_TEXT.acpHelpUnknownTopic, { topic: 'exec' }),
      )
    })
  })

  it(String.raw`sends \/ messages to the model with a literal leading slash`, async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = prompt(client, sessionId, String.raw`/\/nosuchcommand`)
      const session = h.host.sessions[0]!
      await until(() => session.sendTurn.mock.calls.length === 1)
      // The escape is stripped, and nothing local answered: no skill ran, no
      // unknown-command sentence was sent.
      expect(session.sendTurn.mock.calls[0]?.[1]).toBe('/nosuchcommand')
      expect(chunkTexts(h.updates).some((text) => text.includes('Unknown command'))).toBe(false)
      completeModelTurn(session, 1)
      expect(await response).toEqual({ stopReason: 'end_turn' })
    })
  })

  it(String.raw`sends \/help to the model instead of listing commands`, async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = prompt(client, sessionId, String.raw`/\/help`)
      const session = h.host.sessions[0]!
      await until(() => session.sendTurn.mock.calls.length === 1)
      expect(session.sendTurn.mock.calls[0]?.[1]).toBe('/help')
      completeModelTurn(session, 1)
      expect(await response).toEqual({ stopReason: 'end_turn' })
    })
  })

  it('ends /help with how unknown slashes and the escape behave', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await prompt(client, sessionId, '/help')
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(chunkTexts(h.updates)).toContainEqual(
        expect.stringContaining(UI_TEXT.acpCommandHelpNote),
      )
    })
  })
})

/** The protocol rejection a request met, or a throw when it wrongly resolved. */
async function fails(request: Promise<unknown>, what: string): Promise<acp.RequestError> {
  try {
    await request
  } catch (error: unknown) {
    if (error instanceof acp.RequestError) {
      return error
    }
    throw new Error(`${what} rejected without a protocol error`, { cause: error })
  }
  throw new Error(`${what} resolved for an unknown session id`)
}

describe('B13 loading an unknown session id', () => {
  it('answers session/load resource-not-found, the same shape as a prompt on an unknown session', async () => {
    const h = harness()
    await h.run(async (client) => {
      await start(client)
      // The real brand the host throws, carried across the fake boundary.
      h.host.resumeSession.mockRejectedValueOnce(new SessionNotFoundError('no-such'))
      const loadFailure = await fails(
        client.request('session/load', { sessionId: 'no-such', cwd: CWD, mcpServers: [] }),
        'a load',
      )
      const promptFailure = await fails(prompt(client, 'no-such', 'hello'), 'a prompt')
      expect(loadFailure.code).toBe(promptFailure.code)
      expect(loadFailure.message).not.toMatch(/window/i)
    })
  })
})

describe('B19 /compact always answers', () => {
  it.each([
    { status: 'completed', text: UI_TEXT.compactionDone },
    { status: 'noop', text: UI_TEXT.nothingToCompact },
    { status: 'cancelled', text: UI_TEXT.compactionStoppedNotice },
    { status: 'failed', text: UI_TEXT.compactionFailed },
  ])('says what a $status compact did, with no model turn', async ({ status, text }) => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      h.host.sessions[0]?.compact.mockResolvedValue({ status, reason: undefined })
      const response = await prompt(client, sessionId, '/compact')
      expect(response).toEqual({ stopReason: status === 'cancelled' ? 'cancelled' : 'end_turn' })
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
      expect(chunkTexts(h.updates)).toContainEqual(text)
    })
  })
})

describe('B20 no internal compaction status in the answer', () => {
  it('keeps the first model reply free of the inactive-compaction status', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const response = prompt(client, sessionId, 'hello')
      const session = h.host.sessions[0]!
      await until(() => session.sendTurn.mock.calls.length === 1)
      completeModelTurn(session, 1)
      expect(await response).toEqual({ stopReason: 'end_turn' })
      for (const text of chunkTexts(h.updates)) {
        expect(text).not.toMatch(/awaiting evaluation|Automatic compaction is/i)
      }
    })
  })
})

describe('B21 the command list arrives with the session', () => {
  it('sends available_commands_update with session/new, before any prompt', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      expect(sessionId).toBeTruthy()
      const announcement = h.updates.find(
        (update) => update.sessionUpdate === 'available_commands_update',
      )
      expect(announcement).toMatchObject({
        availableCommands: expect.arrayContaining([
          expect.objectContaining({ name: 'help' }),
          expect.objectContaining({ name: 'compact' }),
        ]),
      })
    })
  })

  it('sends available_commands_update with session/load', async () => {
    const h = harness()
    await h.run(async (client) => {
      await start(client)
      const loaded = await client.request('session/load', {
        sessionId: 'session-9',
        cwd: CWD,
        mcpServers: [],
      })
      expect(loaded).toMatchObject({ modes: expect.anything(), configOptions: expect.anything() })
      const announcements = h.updates.filter(
        (update) => update.sessionUpdate === 'available_commands_update',
      )
      // One with the new session, one with the load.
      expect(announcements).toHaveLength(2)
    })
  })
})

describe('B13 agent sentences name no VS Code window', () => {
  it('never says "window" outside the context window in local answers', async () => {
    const h = harness()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      h.host.sessions[0]?.compact.mockResolvedValue({ status: 'noop', reason: undefined })
      await prompt(client, sessionId, '/help')
      await prompt(client, sessionId, '/help compact')
      await prompt(client, sessionId, '/nosuchcommand')
      await prompt(client, sessionId, '/compact')
      for (const text of chunkTexts(h.updates)) {
        expect(text.replaceAll('context window', 'context')).not.toMatch(/window/i)
      }
    })
  })
})
