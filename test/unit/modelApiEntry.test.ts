// C-M95-4 R3: the entry feeds the host's `contextModel` seam from the
// configured registry's synchronous peek, so compaction sizes every M95
// model to its live window. A model the registry never listed keeps the
// previous fallback (including the legacy Meta window).

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { writeProvidersFileAtomic } from '../../src/core/providers/providersFile'
import { watchSessionTurns } from './helpers/sessionTurns'
import { memorySecrets } from './helpers/fakes'
import { createModelApiHost } from '../../src/host/backend/modelApiEntry'
import type { ModelApiBundleDeps } from '../../src/host/backend/modelApiBundle'
import type { ProviderClient } from '../../src/core/backends/modelapi/client'
import type { ContextModel } from '../../src/core/context/overflow'
import { EN } from '../../src/shared/l10n/en'
import { MODEL_API_CONTEXT_WINDOW } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  fakeModelApi,
  fakeModelApiClient,
  fakeModelApiClientSettings,
} from './helpers/fakeModelApi'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { memoryToolIo } from './helpers/fakeToolIo'

function entryDeps(
  peek: (model: string) => ContextModel | undefined,
  api = fakeModelApi(),
  modelId = 'muse-spark-1.3',
): ModelApiBundleDeps {
  const log = new FakeLogOutputChannel()
  const meta = fakeModelApiClient(api, log)
  const client: ProviderClient = Object.assign(meta, {
    listModels: () => Promise.resolve([modelId]),
    peekContextModel: peek,
  })
  const full = fakeModelApiHostDeps({
    client,
    workspaceRoot: '/ws',
    io: memoryToolIo({}, '/ws'),
    log,
  })
  const { client: _client, loadHooks: _hooks, mcpServers: _servers, ...host } = full
  return {
    uiText: EN,
    uiLocale: 'en',
    client: { ...fakeModelApiClientSettings(log), fetch: api.fetch },
    createProviderClient: () => Promise.resolve(client),
    host,
    hookSettingsPath: undefined,
    createMcpServers: undefined,
  }
}

describe('createModelApiHost registry windows', () => {
  it('sizes a listed model from the registry peek', async () => {
    const host = await createModelApiHost(
      entryDeps(() => ({ format: 'responses', contextTokens: 4096 })),
    )
    const rows = await host.listModels()
    expect(rows.find((row) => row.modelId === 'muse-spark-1.3')?.contextLimit).toBe(4096)
  })

  it('keeps the legacy window for a model the registry never listed', async () => {
    const host = await createModelApiHost(entryDeps(() => undefined))
    const rows = await host.listModels()
    expect(rows.find((row) => row.modelId === 'muse-spark-1.3')?.contextLimit).toBe(
      MODEL_API_CONTEXT_WINDOW,
    )
  })
})

describe('production entry local compaction', () => {
  it.each([
    ['llamacpp', 4096, 'manual'],
    ['lmstudio', 8192, 'manual'],
    ['llamacpp', 32_768, 'automatic'],
  ] as const)(
    'sizes %s compaction to its persisted %i window (%s)',
    async (preset, contextTokens, mode) => {
      const root = await mkdtemp(path.join(tmpdir(), 'm95-entry-'))
      const ref = `${preset}/local-model`
      const configFile = path.join(root, 'providers.json')
      const api = fakeModelApi()
      let host
      try {
        const saved = await writeProvidersFileAtomic(configFile, {
          v: 1,
          providers: [
            {
              id: preset,
              preset,
              auth: 'none',
              address: 'http://127.0.0.1:8080',
              models: ['local-model'],
              modelLimits: { 'local-model': { contextTokens, outputTokens: contextTokens } },
              modelCapabilities: {
                'local-model': { tools: { calling: { state: 'yes', value: true } } },
              },
            },
          ],
        })
        expect(saved.ok).toBe(true)
        const services = createConfiguredProviderServices(undefined, {
          configFile,
          catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
          secrets: memorySecrets(),
          resolve: () => Promise.resolve(['127.0.0.1']),
          send: () => Promise.reject(new Error('No network expected')),
        })
        await services.registry.resolve(ref)
        let isSeedComplete = false
        const deps = entryDeps(
          (model) =>
            mode === 'automatic' && !isSeedComplete
              ? undefined
              : services.client.peekContextModel?.(model),
          api,
          ref,
        )
        const fakeClient = fakeModelApiClient(api, new FakeLogOutputChannel())
        let admissions = 0
        host = await createModelApiHost({
          ...deps,
          host: {
            ...deps.host,
            autoCompaction: () => mode === 'automatic',
            autoCompactionEvaluated: () => true,
            admitAutoCompaction: () => {
              admissions += 1
              return Promise.resolve({ guard: () => undefined, settle: () => undefined })
            },
            models: {
              resolve: async (model) => ({
                ...(await services.registry.resolve(model)),
                client: fakeClient,
              }),
            },
          },
        })
        const session = await host.startSession({
          workspaceRoot: '/ws',
          modelId: ref,
          approvalMode: 'onRequest',
        })
        const watched = watchSessionTurns(session)
        const done = watched.turnDone()
        api.script({ text: 'earlier history' })
        await session.sendTurn([
          {
            type: 'text',
            text: mode === 'automatic' ? 'earlier history '.repeat(8000) : 'remember this task',
          },
        ])
        await done
        expect(watched.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
          terminal: 'completed',
        })
        if (mode === 'manual') {
          isSeedComplete = true
          api.script({ text: 'summary' })
          expect(await session.compact()).toMatchObject({ status: 'accepted' })
        } else {
          api.script(
            {
              onRequest: () => {
                isSeedComplete = true
              },
              calls: [
                {
                  name: 'todo_write',
                  arguments: JSON.stringify({ items: [{ text: 'task', status: 'inProgress' }] }),
                },
              ],
            },
            { text: 'summary' },
            { text: 'finished' },
          )
          const next = watched.turnDone()
          await session.sendTurn([{ type: 'text', text: 'continue' }])
          await next
          expect(admissions).toBe(1)
          expect(watched.events.findLast((event) => event.type === 'turnCompleted')).toMatchObject({
            terminal: 'completed',
          })
        }
        expect(api.responseBodies()[mode === 'manual' ? 1 : 2]?.['max_output_tokens']).toBe(
          Math.floor(contextTokens * 0.05),
        )
      } finally {
        await host?.close()
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('follows an edited window after the listing is warm, growing and shrinking', async () => {
    // C-M95-4 R5 (RVCM954C findings 1-2): the listing is warm at 4096 and
    // a turn has sent. The window is edited to 8192, then shrunk to 6144.
    // The manual summary and every later send carry the edited window's
    // cap, never the warmed snapshot's or a cached cap.
    const root = await mkdtemp(path.join(tmpdir(), 'm95-entry-edit-'))
    const ref = 'llamacpp/local-model'
    const configFile = path.join(root, 'providers.json')
    const api = fakeModelApi()
    let host
    try {
      const save = async (contextTokens: number) => {
        const saved = await writeProvidersFileAtomic(configFile, {
          v: 1,
          providers: [
            {
              id: 'llamacpp',
              preset: 'llamacpp',
              auth: 'none',
              address: 'http://127.0.0.1:8080',
              models: ['local-model'],
              modelLimits: {
                'local-model': { contextTokens, outputTokens: contextTokens },
              },
              modelCapabilities: {
                'local-model': { tools: { calling: { state: 'yes', value: true } } },
              },
            },
          ],
        })
        expect(saved.ok).toBe(true)
      }
      await save(4096)
      const services = createConfiguredProviderServices(undefined, {
        configFile,
        catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
        secrets: memorySecrets(),
        resolve: () => Promise.resolve(['127.0.0.1']),
        send: () => Promise.reject(new Error('No network expected')),
      })
      await services.registry.resolve(ref)
      const deps = entryDeps((model) => services.client.peekContextModel?.(model), api, ref)
      const fakeClient = fakeModelApiClient(api, new FakeLogOutputChannel())
      host = await createModelApiHost({
        ...deps,
        host: {
          ...deps.host,
          models: {
            resolve: async (model) => ({
              ...(await services.registry.resolve(model)),
              client: fakeClient,
            }),
          },
        },
      })
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: ref,
        approvalMode: 'onRequest',
      })
      const watched = watchSessionTurns(session)
      api.script({ text: 'earlier history' })
      let done = watched.turnDone()
      await session.sendTurn([{ type: 'text', text: 'remember this task' }])
      await done
      expect(api.responseBodies()[0]?.['max_output_tokens']).toBe(4096)
      await save(8192)
      api.script({ text: 'summary' })
      expect(await session.compact()).toMatchObject({ status: 'accepted' })
      expect(api.responseBodies()[1]?.['max_output_tokens']).toBe(Math.floor(8192 * 0.05))
      api.script({ text: 'more history' })
      done = watched.turnDone()
      await session.sendTurn([{ type: 'text', text: 'go on' }])
      await done
      expect(api.responseBodies()[2]?.['max_output_tokens']).toBe(8192)
      // Shrink below the grown window (staying above the prompt
      // scaffolding, so the send goes out): the cap shrinks with it.
      await save(6144)
      api.script({ text: 'still more history' })
      done = watched.turnDone()
      await session.sendTurn([{ type: 'text', text: 'go on again' }])
      await done
      expect(api.responseBodies()[3]?.['max_output_tokens']).toBe(6144)
    } finally {
      await host?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
