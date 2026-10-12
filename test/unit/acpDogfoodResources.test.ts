import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import * as acp from '@agentclientprotocol/sdk'
import { buildSync } from 'esbuild'
import { describe, expect, it, vi } from 'vitest'
import { createAcpAgent, type AcpAgentDeps } from '../../src/acp/agent'
import {
  isResourceReadingError,
  readResource,
  resourceFailureReporter,
  ResourceReadingError,
} from '../../src/runtime/resources/text'
import { createRuntimeResourceHost } from '../../src/runtime/resources/host'
import type { ResourceHistoryPort } from '../../src/runtime/resources/port'
import { resourceHistorySchema } from '../../src/shared/resourceHistory'
import { ACP_ERROR_CODES, RESOURCE_GIB_BYTES, UI_TEXT } from '../../src/shared/constants'
import { FakeAgentHost, FakeAgentSession } from './helpers/fakeAgent'
import { dogfoodAgentDeps, dogfoodSession, dogfoodPrompt } from './helpers/acpDogfood'
import { FakeResourceMachine, runtimeResources } from './helpers/resources/runtime'
import { FakeResourceClock } from './helpers/resources/fakes'

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

// The resources bundle and the agent bundle each carry their own class
// object, so `instanceof` cannot recognise the other's failures. This
// compiles the real resources text module a second time and loads it as its
// own file — two class objects from one source, as the reviewer did.
function otherBundleReadingError(reading: 'resources.resume'): Error {
  const textPath = new URL('../../src/runtime/resources/text.ts', import.meta.url).pathname
  const bundled = buildSync({
    stdin: {
      contents: `export * from ${JSON.stringify(textPath)}`,
      resolveDir: path.dirname(textPath),
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
  })
  const code = bundled.outputFiles[0]?.text ?? ''
  expect(code).toContain('resource_reading')
  const dir = mkdtempSync(path.join(tmpdir(), 'acp-brand-'))
  try {
    const file = path.join(dir, 'resources-text.cjs')
    writeFileSync(file, code)
    const loaded = createRequire(import.meta.url)(file) as {
      ResourceReadingError: new (reading: string) => Error
    }
    return new loaded.ResourceReadingError(reading)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('ACPDOG cross-bundle reading brand (R2)', () => {
  it('recognises a branded failure from a separately compiled bundle by brand, not identity', async () => {
    const foreign = otherBundleReadingError('resources.resume')
    expect(foreign).not.toBeInstanceOf(ResourceReadingError)
    expect(isResourceReadingError(foreign)).toBe(true)
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
      resources: {
        command: () => Promise.reject(foreign),
        subscribe: stubSubscribe,
      } as unknown as NonNullable<AcpAgentDeps['resources']>,
    }
    const agent = createAcpAgent(deps)
    const client = acp.client({ name: 'resources-brand' })
    await client.connectWith(agent, async (context) => {
      const { sessionId } = await dogfoodSession(context, cwd)
      await expect(
        context.request('session/prompt', {
          sessionId,
          prompt: [{ type: 'text', text: '/resources status' }],
        }),
      ).rejects.toMatchObject({
        code: ACP_ERROR_CODES.unavailable,
        message: `resources.resume: ${UI_TEXT.resourceUnavailable}`,
        data: { kind: 'resource_reading', reading: 'resources.resume' },
      })
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(`resources.resume: ${UI_TEXT.resourceUnavailable}`)
    expect(log.error).not.toHaveBeenCalled()
  })
})

/** An idle resource subscription for stubs that only fail commands. */
function stubSubscribe(): () => void {
  return vi.fn()
}

async function resourceAgent(history: ResourceHistoryPort, machine: FakeResourceMachine) {
  const clock = new FakeResourceClock()
  const resources = await createRuntimeResourceHost({
    clock,
    sampler: {
      sample: () =>
        Promise.resolve({
          atMs: clock.now(),
          cpuPercent: 20,
          memoryUsedPercent: 40,
          memoryAvailableBytes: 8 * RESOURCE_GIB_BYTES,
          memoryTotalBytes: 16 * RESOURCE_GIB_BYTES,
          gpuPercent: null,
          diskBusyPercent: null,
          pressure: null,
        }),
    },
    machine,
    running: { backgroundCount: () => 0 },
    history,
    onError: vi.fn(),
  })
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
  const client = acp.client({ name: 'resources-store' })
  return { client, log, agent }
}

describe('ACPDOG resource store failures (R3)', () => {
  // Every /resources command — status, history, resume, and /usage resources —
  // reports a store failure through the typed named reporter: the history
  // read and the resume persistence write reject here, and none of them
  // reaches the client as a generic internal failure.
  it.each([
    { command: '/resources history', reading: 'resources.history' },
    { command: '/resources resume', reading: 'resources.resume' },
    { command: '/usage resources', reading: 'resources.history' },
  ] as const)('reports a %s store failure as the named reading', async ({ command, reading }) => {
    const machine = new FakeResourceMachine()
    if (command === '/resources resume') {
      machine.writeResumeUntil.mockRejectedValueOnce(new Error('disk full: native path'))
    }
    const emptyHistory = resourceHistorySchema.parse({
      minutes: [],
      events: [],
      counts: [],
      work: [],
    })
    const history: ResourceHistoryPort = {
      read:
        command === '/resources resume'
          ? () => Promise.resolve(emptyHistory)
          : () => Promise.reject(new Error('journal locked: native path')),
    }
    const { client, agent, log } = await resourceAgent(history, machine)
    const cwd = path.resolve('/work/app')
    await client.connectWith(agent, async (context) => {
      const { sessionId } = await dogfoodSession(context, cwd)
      await expect(dogfoodPrompt(context, sessionId, command)).rejects.toMatchObject({
        code: ACP_ERROR_CODES.unavailable,
        message: `${reading}: ${UI_TEXT.resourceUnavailable}`,
        data: { kind: 'resource_reading', reading },
      })
    })
    // Named once under its own reading; no native detail and no log.error.
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(`${reading}: ${UI_TEXT.resourceUnavailable}`)
    expect(log.error).not.toHaveBeenCalled()
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('native')
  })
})
