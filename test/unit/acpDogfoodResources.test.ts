import path from 'node:path'
import * as acp from '@agentclientprotocol/sdk'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import { readResource, resourceFailureReporter } from '../../src/runtime/resources/text'
import { ACP_ERROR_CODES, UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { dogfoodAgentDeps, dogfoodSession } from './helpers/acpDogfood'
import { runtimeResources } from './helpers/resources/runtime'

describe('ACPDOG named resource failures', () => {
  it('reports the failed reading once without its native diagnostic', async () => {
    const log = { warn: vi.fn() }
    const report = resourceFailureReporter(log)
    for (const reading of ['resources.settings', 'resources.resume', 'resources.sample'] as const) {
      for (let repeat = 0; repeat < 2; repeat++) {
        try {
          await readResource(reading, () => Promise.reject(new Error('private path/header/key')))
        } catch (error) {
          report(error)
        }
      }
    }
    expect(log.warn.mock.calls).toEqual(
      ['resources.settings', 'resources.resume', 'resources.sample'].map((reading) => [
        `${reading}: ${UI_TEXT.resourceUnavailable}`,
      ]),
    )
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private')
    const next = resourceFailureReporter(log)
    try {
      await readResource('resources.sample', () => Promise.reject(new Error('private')))
    } catch (error) {
      next(error)
    }
    expect(log.warn).toHaveBeenCalledTimes(4)
  })

  it('reaches the client as the named reading through the one reporter (finding 5)', async () => {
    // The real host: the settings read at creation succeeds, later reads fail.
    const { host: resources, machine } = await runtimeResources()
    machine.readSettings.mockRejectedValue(new Error('native store path/header/key'))
    const cwd = path.resolve('/work/app')
    const host = new FakeAgentHost()
    const session = new FakeAgentSession('session', host.models[0]?.modelId ?? '')
    host.startSession.mockResolvedValue(session)
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const deps: AcpAgentDeps = {
      ...dogfoodAgentDeps(host, log),
      backend: {
        kind: 'modelApi',
        readiness: () => Promise.resolve({ state: 'ready' }),
        hostFor: () => Promise.resolve(host),
      },
      defaultCwd: cwd,
      questions: 'decline',
      resources,
    }
    const agent = createAcpAgent(deps)
    const client = acp.client({ name: 'resources' })
    await client.connectWith(agent, async (context) => {
      const { sessionId } = await dogfoodSession(context, cwd)
      for (let repeat = 0; repeat < 2; repeat++) {
        await expect(
          context.request('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: '/resources status' }],
          }),
        ).rejects.toMatchObject({
          code: ACP_ERROR_CODES.unavailable,
          message: `resources.settings: ${UI_TEXT.resourceUnavailable}`,
        })
      }
    })
    // Named once, however often the command fails; nothing native leaks.
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(`resources.settings: ${UI_TEXT.resourceUnavailable}`)
    expect(log.error).not.toHaveBeenCalled()
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('native')
  })
})
