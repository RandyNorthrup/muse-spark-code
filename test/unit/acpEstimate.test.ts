import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpEstimate, type AcpEstimatePort } from '../../src/acp/estimate'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { AcpPaidUse } from '../../src/acp/paid'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { fakeEstimate } from './helpers/estimator/fixtures'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memoryPaidGrants } from './helpers/paidGrants'
import { until } from './helpers/acpWaits'

const CWD = process.platform === 'win32' ? String.raw`C:\work\estimator` : '/work/estimator'
function harness(estimate?: AcpEstimatePort) {
  const host = new FakeAgentHost()
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const updates: acp.SessionUpdate[] = []
  const deps: AcpAgentDeps = {
    backend: {
      kind: 'museCode',
      readiness: () => Promise.resolve({ state: 'ready' }),
      hostFor: () => Promise.resolve(host),
    },
    version: 'test',
    options: { canBypass: false, allowsContributorModels: false, initialMode: 'manual' },
    signIn: { id: 'test', name: 'Test', description: '', args: [], command: 'test' },
    defaultCwd: CWD,
    paid: new AcpPaidUse({
      flagged: [],
      canRemember: () => false,
      grants: memoryPaidGrants(),
      log,
    }),
    log,
    ...(estimate && { estimate }),
  }
  const agent = createAcpAgent(deps)
  const client = acp
    .client({ name: 'estimate-test' })
    .onNotification('session/update', (context) => {
      updates.push(context.params.update)
    })
  return {
    host,
    updates,
    run: <T>(operation: (client: acp.ClientContext, sessionId: string) => Promise<T>) =>
      client.connectWith(agent, async (connected) => {
        await connected.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })
        const { sessionId } = await connected.request('session/new', { cwd: CWD, mcpServers: [] })
        return await operation(connected, sessionId)
      }),
  }
}
function prompt(client: acp.ClientContext, sessionId: string, text: string) {
  return client.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
}
function messages(updates: acp.SessionUpdate[]): string {
  let text = ''
  for (const update of updates)
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
      text += update.content.text
  return text
}

describe('M117 ACP estimate', () => {
  it('handles a goal locally, announces the command and never starts a model turn', async () => {
    const section = fakeEstimate()
    const port = createAcpEstimate({
      context: () => ({ asOf: section.asOf, optimize: 'cost' }),
      runner: () => ({ estimate: () => Promise.resolve(section) }),
      money: { price: () => 'exact' },
    })
    const h = harness(port)
    await h.run(async (client, sessionId) => {
      expect(await prompt(client, sessionId, '/estimate M117')).toMatchObject({
        stopReason: 'end_turn',
      })
    })
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
    expect(messages(h.updates)).toContain(UI_TEXT.estimatePrior)
    const announced = h.updates.find(
      (update) => update.sessionUpdate === 'available_commands_update',
    )
    expect(announced).toMatchObject({
      availableCommands: expect.arrayContaining([expect.objectContaining({ name: 'estimate' })]),
    })
  })

  it('reports the unbound loader honestly instead of forwarding to a model', async () => {
    const h = harness()
    await h.run(async (client, sessionId) => {
      expect(await prompt(client, sessionId, '/estimate M117')).toMatchObject({
        stopReason: 'end_turn',
      })
    })
    expect(messages(h.updates)).toContain('M117-W-estimator-binding')
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })

  it('does not dispatch invalid syntax or help and respects the selected workspace', async () => {
    const context = vi.fn(() => ({ asOf: fakeEstimate().asOf, optimize: 'cost' as const }))
    const estimate = vi.fn(() => Promise.resolve(fakeEstimate()))
    const port = createAcpEstimate({
      context,
      runner: () => ({ estimate }),
      money: { price: () => 'exact' },
    })
    const signal = new AbortController().signal
    expect(await port.run('/estimate "broken', CWD, signal)).toBe(UI_TEXT.estimateUsage)
    expect(await port.run('/estimate --help', CWD, signal)).toContain(UI_TEXT.estimateCliHelp)
    expect(context).not.toHaveBeenCalled()
    await port.run('/estimate M117', CWD, signal)
    expect(context).toHaveBeenCalledWith(CWD)
    expect(estimate).toHaveBeenCalledTimes(1)
  })

  it('cancels the local estimate, denies overlapping prompts and suppresses a late result', async () => {
    const pending = Promise.withResolvers<string>()
    const run = vi.fn((_text: string, _cwd: string, _signal: AbortSignal) => pending.promise)
    const h = harness({ run })
    await h.run(async (client, sessionId) => {
      const response = prompt(client, sessionId, '/estimate M117')
      await until(() => run.mock.calls.length === 1)
      await expect(prompt(client, sessionId, '/estimate M117')).rejects.toThrow()
      await client.notify('session/cancel', { sessionId })
      await until(() => run.mock.calls[0]?.[2].aborted === true)
      pending.resolve('late private result')
      expect(await response).toMatchObject({ stopReason: 'cancelled' })
    })
    expect(messages(h.updates)).not.toContain('late private')
    expect(h.host.sessions[0]?.sendTurn).not.toHaveBeenCalled()
  })

  it('scrubs a throwing injected adapter from ACP output', async () => {
    const h = harness({ run: () => Promise.reject(new Error('/private/account/data')) })
    await h.run(async (client, sessionId) => {
      await prompt(client, sessionId, '/estimate M117')
    })
    expect(messages(h.updates)).toContain('estimate-unavailable')
    expect(messages(h.updates)).not.toContain('/private')
  })
})
