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
        bodySummary: z.optional(
          z.object({ topLevelKeys: z.array(z.string()), sample: z.array(z.json()) }),
        ),
      }),
    })
    .parse(value).response
  if (response.body !== undefined)
    return typeof response.body === 'string'
      ? z.json().parse(JSON.parse(response.body))
      : response.body
  const summary = response.bodySummary
  if (summary === undefined) throw new Error('Missing captured body')
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
  panel.webview.messages.fire(value)
  await vi.waitFor(done)
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
  const calls: { path: string; headers: Readonly<Record<string, string>> }[] = []
  const services = createConfiguredProviderServices(undefined, {
    configFile,
    catalogFile: path.resolve('vendor/models-dev/snapshot.json'),
    secrets: { get: (key) => host.secrets.get(key) },
    resolve: () => Promise.resolve(['8.8.8.8']),
    send: (target, _body, headers) => {
      calls.push({ path: target.url.pathname, headers })
      return Promise.resolve(pinnedResponse(body))
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
  }
}

describe('PROVWIRE production provider wiring', () => {
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
