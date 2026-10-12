import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { DeadlineError } from '../../src/core/timeouts'
import { ModelApiError } from '../../src/core/backends/modelapi/transport'
import { ACP_CONFIG_IDS, ACP_ERROR_CODES, UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { dogfoodAgentDeps, dogfoodSession } from './helpers/acpDogfood'

const cwd = path.resolve('/work/app')
const prompt = 'private prompt sentinel'
function scene() {
  const host = new FakeAgentHost()
  const session = new FakeAgentSession('session', host.models[0]?.modelId ?? '')
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const readiness = vi
    .fn<AcpAgentDeps['backend']['readiness']>()
    .mockResolvedValue({ state: 'ready' })
  const hostFor = vi.fn<AcpAgentDeps['backend']['hostFor']>().mockResolvedValue(host)
  const onClientName = vi.fn()
  host.startSession.mockResolvedValue(session)
  const deps: AcpAgentDeps = {
    ...dogfoodAgentDeps(host, log),
    backend: { kind: 'modelApi', readiness, hostFor },
    defaultCwd: cwd,
    questions: 'decline',
    onClientName,
  }
  const agent = createAcpAgent(deps)
  const client = acp.client({ name: 'errors' })
  return {
    host,
    session,
    log,
    readiness,
    hostFor,
    onClientName,
    run: <T>(work: (client: acp.ClientContext) => Promise<T>) => client.connectWith(agent, work),
  }
}
async function start(client: acp.ClientContext) {
  return await dogfoodSession(client, cwd)
}
function expectCause(log: ReturnType<typeof scene>['log'], method: string) {
  // R1: the log line is built from the one outbound shape (code, kind and a
  // fixed sentence), never from the thrown failure, so neither the stage's
  // detail nor any submitted text appears in it.
  expect(log.error).toHaveBeenCalledOnce()
  const text = JSON.stringify(log.error.mock.calls)
  expect(text).toContain(`ACP ${method} failed`)
  expect(text).toContain(String(-32_603))
  expect(text).toContain(UI_TEXT.actionFailed)
  expect(text).not.toContain('synthetic-header')
  expect(text).not.toContain(prompt)
}

describe('ACPDOG ACP request failure boundaries', () => {
  it.each(['readiness', 'hostFor', 'listModels', 'startSession', 'setReasoningEffort'] as const)(
    'logs a session/new failure at %s once',
    async (stage) => {
      const h = scene()
      const error = new Error(`${stage} failed; Authorization: Bearer synthetic-header`)
      switch (stage) {
        case 'readiness': {
          h.readiness.mockRejectedValueOnce(error)
          break
        }
        case 'hostFor': {
          h.hostFor.mockRejectedValueOnce(error)
          break
        }
        case 'listModels': {
          h.host.listModels.mockRejectedValueOnce(error)
          break
        }
        case 'startSession': {
          h.host.startSession.mockRejectedValueOnce(error)
          break
        }
        case 'setReasoningEffort': {
          h.session.setReasoningEffort.mockRejectedValueOnce(error)
          break
        }
      }
      await expect(h.run(start)).rejects.toMatchObject({
        code: -32_603,
        message: UI_TEXT.actionFailed,
      })
      expectCause(h.log, 'session/new')
    },
  )
  it('withholds headers even when a short prompt overlaps a header name', async () => {
    const h = scene()
    h.session.sendTurn.mockRejectedValueOnce(
      new Error('send failed; Authorization: Bearer SYNTHETIC-TOKEN'),
    )
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      await expect(
        client.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: 'a' }],
        }),
      ).rejects.toMatchObject({ code: ACP_ERROR_CODES.internal })
    })
    expect(h.log.error).toHaveBeenCalledOnce()
    expect(JSON.stringify(h.log.error.mock.calls)).not.toContain('SYNTHETIC-TOKEN')
  })
  it('logs initialize callback failure once', async () => {
    const h = scene()
    h.onClientName.mockImplementation(() => {
      throw new Error('initialize failed')
    })
    await expect(
      h.run((client) => client.request('initialize', { protocolVersion: acp.PROTOCOL_VERSION })),
    ).rejects.toMatchObject({ code: -32_603 })
    expectCause(h.log, 'initialize')
  })
  it.each([
    'authenticate',
    'session/list',
    'session/load',
    'session/resume',
    'session/set_mode',
    'session/set_config_option',
    'session/prompt',
    'session/close',
  ] as const)('logs a %s await failure once without prompt/header content', async (method) => {
    const h = scene()
    await h.run(async (client) => {
      const { sessionId } = await start(client)
      const error = new Error(`${method} failed; ${prompt}; Authorization: Bearer synthetic-header`)
      let response: Promise<unknown>
      switch (method) {
        case 'authenticate': {
          h.readiness.mockRejectedValueOnce(error)
          response = client.request(method, { methodId: 'auth' })
          break
        }
        case 'session/list': {
          h.host.listSessions.mockRejectedValueOnce(error)
          response = client.request(method, {})
          break
        }
        case 'session/load':
        case 'session/resume': {
          h.host.resumeSession.mockRejectedValueOnce(error)
          response = client.request(method, { sessionId, cwd, mcpServers: [] })
          break
        }
        case 'session/set_mode': {
          h.session.setApprovalMode.mockRejectedValueOnce(error)
          response = client.request(method, { sessionId, modeId: 'plan' })
          break
        }
        case 'session/set_config_option': {
          h.session.setReasoningEffort.mockRejectedValueOnce(error)
          response = client.request(method, {
            sessionId,
            configId: ACP_CONFIG_IDS.effort,
            value: 'high',
          })
          break
        }
        case 'session/prompt': {
          h.session.sendTurn.mockRejectedValueOnce(error)
          response = client.request(method, { sessionId, prompt: [{ type: 'text', text: prompt }] })
          break
        }
        case 'session/close': {
          h.session.dispose.mockImplementationOnce(() => {
            throw error
          })
          response = client.request(method, { sessionId })
          break
        }
      }
      await expect(response).rejects.toMatchObject({ code: -32_603, message: UI_TEXT.actionFailed })
      // Only prompt requests carry prompt content; other failures use technical causes.
      expect(h.log.error).toHaveBeenCalledOnce()
      if (method === 'session/prompt') expectCause(h.log, method)
    })
  })
  it.each([
    new DeadlineError('session/new did not answer'),
    new ModelApiError('provider refused', 429, 'rate_limit_error', 'rate_limit'),
  ])('preserves the known cause of %s as a typed refusal', async (error) => {
    const h = scene()
    h.hostFor.mockRejectedValueOnce(error)
    await expect(h.run(start)).rejects.toMatchObject({
      code:
        error instanceof DeadlineError ? ACP_ERROR_CODES.unavailable : ACP_ERROR_CODES.turnFailed,
    })
    expect(h.log.error).not.toHaveBeenCalled()
  })
})
