// C-M95-4 R3: the entry feeds the host's `contextModel` seam from the
// configured registry's synchronous peek, so compaction sizes every M95
// model to its live window. A model the registry never listed keeps the
// previous fallback (including the legacy Meta window).

import { describe, expect, it } from 'vitest'
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

function entryDeps(peek: (model: string) => ContextModel | undefined): ModelApiBundleDeps {
  const log = new FakeLogOutputChannel()
  const api = fakeModelApi()
  const meta = fakeModelApiClient(api, log)
  const client: ProviderClient = Object.assign(meta, {
    listModels: () => Promise.resolve(['muse-spark-1.3']),
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
