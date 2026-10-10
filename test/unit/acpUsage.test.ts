import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { createAcpAgent } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { fakeUsageAccess, usageState } from './helpers/usageAdapters'

function harness(
  options: {
    url?: boolean
    broken?: boolean
    elicitation?: () => Promise<acp.CreateElicitationResponse>
  } = {},
) {
  const host = new FakeAgentHost()
  const fake = fakeUsageAccess()
  const updates: acp.SessionUpdate[] = []
  const elicitations: acp.CreateElicitationRequest[] = []
  const elicitationSignals: AbortSignal[] = []
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const openPage = vi.fn().mockResolvedValue(`http://127.0.0.1:1234/#${'a'.repeat(64)}`)
  const app = createAcpAgent({
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    questions: 'decline',
    defaultCwd: '/workspace',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'test', name: 'test', description: 'test', args: [], command: 'test' },
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    usage: { access: () => fake.usage, openPage },
    log,
  })
  const client = acp
    .client({ name: 'usage-test' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
    .onRequest('elicitation/create', (context) => {
      elicitations.push(context.params)
      elicitationSignals.push(context.signal)
      if (options.broken) throw new Error('client failed')
      return options.elicitation?.() ?? { action: 'accept' }
    })
  const run = (op: (context: acp.ClientContext, sessionId: string) => Promise<void>) =>
    client.connectWith(app, async (context) => {
      await context.request('initialize', {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: options.url ? { elicitation: { url: {} } } : {},
      })
      const { sessionId } = await context.request('session/new', {
        cwd: '/workspace',
        mcpServers: [],
      })
      host.sessions[0]?.sendTurn.mockRejectedValue(new Error('a usage command reached the model'))
      await op(context, sessionId)
    })
  return { ...fake, host, updates, elicitations, elicitationSignals, openPage, run, log }
}

describe('ACP local usage command', () => {
  it('recognizes only an exact local command and leaves ordinary prompts for the backend', async () => {
    const h = harness()
    await h.run(async (client, sessionId) => {
      await expect(
        client.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'Explain /usage in this sentence' }],
        }),
      ).rejects.toThrow('Internal error')
    })
    expect(h.usage.read).not.toHaveBeenCalled()
    expect(h.host.sessions[0]?.sendTurn).toHaveBeenCalledOnce()
  })
  it('announces /usage and replies through the shared renderer with a companion link, without a model turn', async () => {
    const h = harness()
    await h.run(async (client, sessionId) => {
      const response = await client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/usage' }],
      })
      expect(response.stopReason).toBe('end_turn')
      expect(h.usage.read).toHaveBeenCalledExactlyOnceWith({
        range: '30d',
        groupBy: 'provider',
        metric: 'cost',
      })
      expect(h.usage.usageText).toHaveBeenCalledExactlyOnceWith(usageState(), 'markdown', 'summary')
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    })
    expect(h.updates).toContainEqual({
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        {
          name: 'help',
          description: 'Commands, settings and features, with descriptions and documentation.',
          input: null,
        },
        { name: 'compact', description: 'Summarise older context to free the window', input: null },
        {
          name: 'report',
          description: UI_TEXT.reportSlashDescription,
          input: { hint: '<kind> [args] | history' },
        },
        {
          name: 'usage',
          description: 'Show usage and cost across models, or open the usage page.',
          input: null,
        },
        {
          name: 'agents',
          description: UI_TEXT.referenceAgentOutcomes,
          input: { hint: '[receipt|continue|retry] [ID]' },
        },
      ],
    })
    expect(h.updates).toContainEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Unpriced: unknown; reported: $0.42' },
    })
    expect(h.updates).toContainEqual({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `\n[Open usage page](http://127.0.0.1:1234/#${'a'.repeat(64)})`,
      },
    })
    expect(h.elicitations).toEqual([])
  })

  it('elicits a URL only when supported, falling back to a link if the client fails', async () => {
    for (const isBroken of [false, true]) {
      const h = harness({ url: true, broken: isBroken })
      await h.run(async (client, sessionId) => {
        expect(
          await client.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: '/usage page' }],
          }),
        ).toEqual({ stopReason: 'end_turn' })
      })
      expect(h.elicitations).toHaveLength(1)
      expect(h.elicitations[0]).toMatchObject({
        mode: 'url',
        message: 'Open usage page',
        url: `http://127.0.0.1:1234/#${'a'.repeat(64)}`,
      })
      const links = h.updates.filter(
        (update) =>
          update.sessionUpdate === 'agent_message_chunk' &&
          update.content.type === 'text' &&
          update.content.text.includes('[Open usage page]'),
      )
      expect(links).toHaveLength(isBroken ? 1 : 0)
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    }
  })

  it('keeps /usage reachable when skills fail and reserves its name against a skill collision', async () => {
    const h = harness()
    await h.run(async (client, sessionId) => {
      h.host.sessions[0]?.listSkills.mockRejectedValueOnce(new Error('skills failed'))
      await client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/usage' }],
      })
      const session = h.host.sessions[0]
      if (session !== undefined)
        session.skills = [
          {
            selector: 'usage',
            displayName: 'Skill usage',
            description: 'collision',
            argumentHint: undefined,
          },
        ]
      session?.emit({ type: 'skillsChanged' })
      await vi.waitFor(() => {
        expect(
          h.updates.filter((update) => update.sessionUpdate === 'available_commands_update'),
        ).toHaveLength(2)
      })
    })
    for (const update of h.updates)
      if (update.sessionUpdate === 'available_commands_update')
        expect(update.availableCommands.map((item) => item.name)).toEqual([
          'help',
          'compact',
          'report',
          'usage',
          'agents',
        ])
  })

  it('honors cancellation during a journal read and refuses a second prompt while it is running', async () => {
    const h = harness()
    const pending = Promise.withResolvers<ReturnType<typeof usageState>>()
    h.usage.read.mockReturnValue(pending.promise)
    await h.run(async (client, sessionId) => {
      const reply = client.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '/usage' }],
      })
      await vi.waitFor(() => {
        expect(h.usage.read).toHaveBeenCalledOnce()
      })
      await expect(
        client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/usage' }] }),
      ).rejects.toThrow()
      await client.notify('session/cancel', { sessionId })
      await vi.waitFor(() => {
        expect(
          h.log.info.mock.calls.some(
            ([text]) => typeof text === 'string' && text.includes('cancelled before its turn'),
          ),
        ).toBe(true)
      })
      pending.resolve(usageState())
      expect(await reply).toEqual({ stopReason: 'cancelled' })
    })
    expect(h.openPage).not.toHaveBeenCalled()
    expect(h.updates.some((update) => update.sessionUpdate === 'agent_message_chunk')).toBe(false)
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })

  it('abandons a pending URL elicitation on cancellation and accepts another prompt before a late client answer', async () => {
    for (const isLateFailure of [false, true]) {
      const pending = Promise.withResolvers<acp.CreateElicitationResponse>()
      const elicitation = vi
        .fn<() => Promise<acp.CreateElicitationResponse>>()
        .mockResolvedValue({ action: 'accept' })
        .mockReturnValueOnce(pending.promise)
      const h = harness({ url: true, elicitation })
      await h.run(async (client, sessionId) => {
        const reply = client.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: '/usage' }],
        })
        let response: acp.PromptResponse | undefined
        void reply.then((value) => {
          response = value
        })
        try {
          await vi.waitFor(() => {
            expect(h.elicitations).toHaveLength(1)
          })
          await expect(
            client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: '/usage' }],
            }),
          ).rejects.toThrow()
          await client.notify('session/cancel', { sessionId })
          await vi.waitFor(() => {
            expect(response).toEqual({ stopReason: 'cancelled' })
          })
          await vi.waitFor(() => {
            expect(h.elicitationSignals[0]?.aborted).toBe(true)
          })
          expect(
            await client.request('session/prompt', {
              sessionId,
              prompt: [{ type: 'text', text: '/usage page' }],
            }),
          ).toEqual({ stopReason: 'end_turn' })
          expect(h.elicitations).toHaveLength(2)
          expect(h.elicitationSignals[1]?.aborted).toBe(false)
          const updateCount = h.updates.length
          if (isLateFailure) pending.reject(new Error('late client failure'))
          else pending.resolve({ action: 'accept' })
          // A round trip orders the late answer before checking for stale updates.
          await client.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: '/usage open' }],
          })
          expect(h.updates).toHaveLength(updateCount + 1)
          expect(h.log.warn).not.toHaveBeenCalled()
        } finally {
          pending.resolve({ action: 'cancel' })
          await reply
        }
      })
      expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    }
  })

  it('refuses a foreign companion URL and propagates read errors without making a model call', async () => {
    const h = harness({ url: true })
    h.openPage.mockResolvedValue('https://foreign.example/')
    await h.run(async (client, sessionId) => {
      await expect(
        client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/usage' }] }),
      ).rejects.toThrow()
      h.usage.read.mockRejectedValueOnce(new Error('journal failed'))
      await expect(
        client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: '/usage' }] }),
      ).rejects.toThrow()
    })
    expect(h.elicitations).toEqual([])
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })
})
