// Offline production catalogue -> host facade -> configured transport -> panel.
// Only DNS, pinned send, VS Code and backing stores are fake; M95 captures
// supply every provider response. No live request or model attempt is made.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfiguredProviderServices } from '../../src/core/providers/configured'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { providerEntrySchema } from '../../src/core/providers/providersFile'
import { presetById } from '../../src/core/providers/presets'
import { probeProvider } from '../../src/runtime/providersCommands'
import { resolveProvider } from '../../src/runtime/exec/providerExec'
import { createModelsPanel } from '../../src/host/models/modelsPanel'
import { parseHostToPanelMessage } from '../../src/shared/modelsPanel'
import { PROVIDER_SECRET_PREFIX } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { FakeWebviewPanel } from './helpers/fakes'
import { testProvidersHost } from './helpers/m95kFixtures'
import { window, FakeUri } from './mocks/vscode'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
beforeEach(() => {
  window.createWebviewPanel.mockReset()
  window.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
  window.showInputBox.mockReset()
})

async function capturedBody(provider: string, file: string) {
  const value: unknown = JSON.parse(
    await readFile(path.join('docs/certification/m95-captures', provider, file), 'utf8'),
  )
  const response = z
    .object({
      response: z.object({
        body: z.optional(z.json()),
        bodySummary: z.optional(z.json()),
      }),
    })
    .parse(value).response
  if (response.body !== undefined)
    return typeof response.body === 'string'
      ? z.json().parse(JSON.parse(response.body))
      : response.body
  if (response.bodySummary === undefined) throw new Error('Missing captured body')
  const listed = z
    .object({ topLevelKeys: z.array(z.string()), sample: z.array(z.json()) })
    .safeParse(response.bodySummary)
  // The HF identity receipt retains only a redacted structural summary;
  // its key test consumes the HTTP status and bounded JSON, not account data.
  if (!listed.success) return response.bodySummary
  const summary = listed.data
  if (summary.topLevelKeys.includes('<array>')) return summary.sample
  return summary.topLevelKeys.includes('models')
    ? { models: summary.sample }
    : { data: summary.sample }
}
const pinnedResponse = (body: unknown, status = 200) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: (async function* () {
    yield* await Promise.resolve([Buffer.from(JSON.stringify(body))])
  })(),
  close: vi.fn(),
})
function latestState(panel: FakeWebviewPanel) {
  for (const call of panel.webview.postMessage.mock.calls.toReversed()) {
    const parsed = parseHostToPanelMessage(call[0])
    if (parsed.ok && parsed.message.type === 'modelsPanel/state') return parsed.message.state
  }
  throw new Error('Missing panel state')
}
async function message(panel: FakeWebviewPanel, value: unknown, done: () => void) {
  const before = panel.webview.postMessage.mock.calls.length
  panel.webview.messages.fire(value)
  await vi.waitFor(() => {
    expect(panel.webview.postMessage.mock.calls.length).toBeGreaterThan(before)
    done()
  })
}
async function fixture(preset: string, capture: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'provwire-'))
  roots.push(root)
  const configFile = path.join(root, 'providers.json')
  const seam = createModelsPanelSeam({
    configFile,
    subscriptionModels: () => Promise.resolve([]),
    resolve: () => Promise.resolve(['8.8.8.8']),
  })
  const info = seam.catalog.get(preset)
  if (info === undefined) throw new Error('Missing production preset')
  const entry = providerEntrySchema.parse({
    id: preset,
    preset,
    address: info.origin || 'http://127.0.0.1:11434',
    auth: info.auth,
    models: [],
  })
  await seam.store.add({ ...entry, address: entry.address ?? '' })
  let body = await capturedBody(preset, capture)
  let keyBody = body
  if (preset === 'openrouter') keyBody = await capturedBody(preset, '02-key-usage.json')
  else if (preset === 'huggingface') keyBody = await capturedBody(preset, '02-whoami-key-test.json')
  let keyStatus = 200
  const calls: { path: string; headers: Readonly<Record<string, string>> }[] = []
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
    secrets: { get: (key) => host.secrets.get(key) },
    resolve: () => Promise.resolve(['8.8.8.8']),
    send: (target, _body, headers) => {
      calls.push({ path: target.url.pathname, headers })
      return Promise.resolve(
        ['/api/v1/key', '/api/whoami-v2'].includes(target.url.pathname)
          ? pinnedResponse(keyBody, keyStatus)
          : pinnedResponse(body),
      )
    },
  })
  const host = testProvidersHost({
    deps: {
      ...seam,
      tester: { test: (entry, key) => services.test(providerEntrySchema.parse(entry), key) },
      fetcher: {
        fetchModels: async (entry, key, signal) => ({
          rows: await services.scanRows(providerEntrySchema.parse(entry), key, signal),
        }),
      },
    },
  })
  await host.secrets.store(
    `${PROVIDER_SECRET_PREFIX}${preset}`,
    JSON.stringify({ v: 1, auth: 'apiKey', origin: entry.address, secret: 'synthetic-stored-key' }),
  )
  const warnings: string[] = []
  const controller = createModelsPanel({
    extensionUri: new FakeUri('/ext'),
    l10n: { locale: 'en', table: EN },
    providers: host.providers,
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: (line) => {
        warnings.push(line)
      },
      error: (line) => {
        warnings.push(line)
      },
    },
    writeExportFile: () => Promise.resolve(),
    readImportFile: () => Promise.resolve(undefined),
    confirmImport: () => Promise.resolve(true),
    onWizardSaved: () => undefined,
  })
  const panel = window.createWebviewPanel.mock.results[0]?.value
  if (!(panel instanceof FakeWebviewPanel)) throw new Error('Missing panel')
  await message(panel, { type: 'modelsPanel/ready' }, () => {
    expect(latestState(panel).presets).toHaveLength(seam.catalog.ids().length)
  })
  return {
    entry,
    seam,
    services,
    ...host,
    panel,
    controller,
    calls,
    warnings,
    replaceBody: (value: typeof body) => {
      body = value
    },
    rejectKey: () => {
      keyStatus = 401
    },
  }
}

describe('PROVWIRE production provider wiring', () => {
  it('F4: CLI probe uses the same key-first contract with captured OpenRouter responses', async () => {
    const f = await fixture('openrouter', '01-models-list.json')
    const resolved = await resolveProvider(
      { v: 1, providers: [f.entry] },
      'openrouter',
      presetById,
      () => Promise.resolve(['8.8.8.8']),
    )
    if (!resolved.ok) throw new Error('Production provider refused')
    const paths: string[] = []
    const keyBody = await capturedBody('openrouter', '02-key-usage.json')
    const models = await capturedBody('openrouter', '01-models-list.json')
    const outcome = await probeProvider(
      (url) => {
        const pathname = new URL(url instanceof Request ? url.url : url).pathname
        paths.push(pathname)
        return Promise.resolve(Response.json(pathname === '/api/v1/key' ? keyBody : models))
      },
      resolved.provider,
      'synthetic-test-key',
      () => Promise.resolve(['8.8.8.8']),
    )
    expect(outcome).toEqual({ ok: true, modelCount: 4 })
    expect(paths).toEqual(['/api/v1/key', '/api/v1/models'])
    f.controller.dispose()
  })
  it('F4: HF checks the captured identity origin without forwarding the key to its public list', async () => {
    const f = await fixture('huggingface', '01-models-list.json')
    await expect(
      f.providers.testCredential(
        { ...f.entry, address: f.entry.address ?? '' },
        'synthetic-test-key',
      ),
    ).resolves.toEqual({ kind: 'ok', models: 0 })
    expect(f.calls.map((call) => call.path)).toEqual(['/api/whoami-v2'])
    f.controller.dispose()
  })
  it('F4: OpenRouter tests its captured key endpoint before the public models list', async () => {
    const f = await fixture('openrouter', '01-models-list.json')
    await expect(
      f.providers.testCredential(
        { ...f.entry, address: f.entry.address ?? '' },
        'synthetic-test-key',
      ),
    ).resolves.toEqual({ kind: 'ok', models: 4 })
    expect(f.calls.map((call) => call.path)).toEqual(['/api/v1/key', '/api/v1/models'])
    f.controller.dispose()
  })
  it('F4: a refused key never becomes Key works from a successful public list', async () => {
    const f = await fixture('openrouter', '01-models-list.json')
    f.rejectKey()
    await message(
      f.panel,
      { type: 'providers/test', providerId: 'openrouter', acceptCost: false },
      () => {
        expect(latestState(f.panel).providers[0]?.test.status).toBe('failed')
      },
    )
    expect(f.calls.map((call) => call.path)).toEqual(['/api/v1/key'])
    expect(latestState(f.panel).models).toEqual([])
    f.controller.dispose()
  })
  it('F3: invalid captured-rate fields remain unpriced rather than becoming free', async () => {
    const f = await fixture('openrouter', '01-models-list.json')
    const body = z
      .object({ data: z.array(z.record(z.string(), z.json())) })
      .parse(await capturedBody('openrouter', '01-models-list.json'))
    const free = body.data[0]
    if (free === undefined) throw new Error('Missing captured free model')
    free['pricing'] = { prompt: '0', completion: '0', input_cache_read: '-1' }
    f.replaceBody(body)
    await message(f.panel, { type: 'models/scan', providerId: 'openrouter' }, () => {
      expect(latestState(f.panel).scans['openrouter']?.status).toBe('done')
    })
    expect(latestState(f.panel).models.find((row) => row.modelId === free['id'])).toMatchObject({
      priceNote: 'unpriced',
      freeOrLocal: false,
    })
    f.controller.dispose()
  })
  it.each([
    ['groq', 'openai/gpt-oss-120b', 0.15, 0.6, 0.075],
    ['together', 'deepseek-ai/DeepSeek-V4.1-Flash', 0.3, 1.2, 0.006],
    ['xai', 'grok-4.20-0309-non-reasoning', 1.25, 2.5, 0.2],
    ['huggingface', 'Qwen/Qwen3.8-27B', 0.47, 3.19, undefined],
  ])(
    'F3: %s rates keep the capture unit through the production projection',
    async (preset, model, input, output, cached) => {
      const f = await fixture(preset, '01-models-list.json')
      await message(f.panel, { type: 'models/scan', providerId: preset }, () => {
        expect(latestState(f.panel).scans[preset]?.status).toBe('done')
      })
      expect(latestState(f.panel).models.find((row) => row.modelId === model)).toMatchObject({
        inputPerMillion: input,
        outputPerMillion: output,
        cachedPerMillion: cached,
        priceNote: 'priced',
        freeOrLocal: false,
      })
      f.controller.dispose()
    },
  )
  it('F3: captured OpenRouter prices and free flags survive scans, filters and repricing', async () => {
    const f = await fixture('openrouter', '01-models-list.json')
    await message(f.panel, { type: 'models/scan', providerId: 'openrouter' }, () => {
      expect(latestState(f.panel).scans['openrouter']?.status).toBe('done')
    })
    const sonnet = latestState(f.panel).models.find(
      (row) => row.modelId === 'anthropic/claude-sonnet-5.5',
    )
    expect(sonnet).toMatchObject({
      inputPerMillion: 2,
      outputPerMillion: 10,
      cachedPerMillion: 0.2,
      priceNote: 'priced',
    })
    expect(latestState(f.panel).models.filter((row) => row.freeOrLocal)).toHaveLength(2)
    await message(
      f.panel,
      {
        type: 'models/filter',
        filter: { freeOrLocal: true },
        sort: { key: 'name', direction: 'asc' },
      },
      () => {
        expect(latestState(f.panel).models).toHaveLength(2)
      },
    )
    expect(latestState(f.panel).models.every((row) => row.priceNote === 'free')).toBe(true)
    await message(
      f.panel,
      {
        type: 'models/filter',
        filter: { maxInputPerMillion: 1 },
        sort: { key: 'name', direction: 'asc' },
      },
      () => {
        expect(latestState(f.panel).models).toHaveLength(3)
      },
    )
    expect(
      latestState(f.panel).models.some((row) => row.modelId === 'anthropic/claude-sonnet-5.5'),
    ).toBe(false)
    // Sensitivity drill over captured fields, not an assertion of live rates.
    const body = z
      .object({ data: z.array(z.record(z.string(), z.json())) })
      .parse(await capturedBody('openrouter', '01-models-list.json'))
    const priced = body.data.find((row) => row['id'] === 'anthropic/claude-sonnet-5.5')
    if (priced === undefined) throw new Error('Missing captured Sonnet')
    const pricing = z.record(z.string(), z.string()).parse(priced['pricing'])
    priced['pricing'] = { ...pricing, input_cache_write_1h: '0.000005' }
    f.replaceBody(body)
    await message(f.panel, { type: 'models/scan', providerId: 'openrouter' }, () => {
      expect(latestState(f.panel).scans['openrouter']?.repricedCount).toBe(1)
    })
    expect(f.warnings).toEqual([])
    f.controller.dispose()
  })
  it.each([
    ['gemini', '01-models-list.json', 3],
    ['ollama', '02-tags.json', 7],
    ['anthropic', '01-models-list-x-api-key.json', 3],
  ])(
    'F2: scans and key tests use %s preset format when setup omits it',
    async (preset, capture, count) => {
      const f = await fixture(preset, capture)
      expect(f.entry.format).toBeUndefined()
      await expect(
        f.providers.testCredential(
          { ...f.entry, address: f.entry.address ?? '' },
          'synthetic-test-key',
        ),
      ).resolves.toEqual({ kind: 'ok', models: count })
      await message(f.panel, { type: 'models/scan', providerId: preset }, () => {
        expect(latestState(f.panel).scans[preset]?.status).toBe('done')
      })
      expect(latestState(f.panel).models).toHaveLength(count)
      if (preset === 'anthropic')
        expect(f.calls.every((call) => call.headers['anthropic-version'] === '2023-06-01')).toBe(
          true,
        )
      else if (preset === 'gemini')
        expect(latestState(f.panel).models.every((row) => !row.modelId.startsWith('models/'))).toBe(
          true,
        )
      expect(f.warnings).toEqual([])
      f.controller.dispose()
    },
  )
})
