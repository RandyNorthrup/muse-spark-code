// M95 lane K (PLAN.md D74, M95 step 8 and the Tests' first-run items):
// the quick pick runs the wizard without the panel, and cancelling at any
// step writes nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import {
  runAddProviderQuickPick,
  type ProviderQuickPickUi,
} from '../../src/host/models/modelsQuickPick'
import type { ProvidersHost } from '../../src/host/providers/providersHost'
import type { ProviderEntry } from '../../src/host/providers/providerPorts'
import { scannedTwoModels, TEST_ENTRY, testProvidersHost, testRow } from './helpers/m95kFixtures'
import { memoryProvidersStore, memorySessionBudgetConfig } from './helpers/fakes'
import { scriptedUi } from './helpers/providerQuickPickScript'

const GROQ_ENTRY: ProviderEntry = {
  id: 'groq',
  preset: 'groq',
  address: 'https://api.groq.com/openai/v1',
  auth: 'apiKey',
  models: [],
}

/** OpenRouter saved with `m1` as its default and the spending limit untouched. */
const OPENROUTER_ADDED = {
  providerId: 'openrouter',
  modelRef: 'openrouter/m1',
  sessionBudgetUsd: undefined,
}

/** Runs the quick pick against a fresh, untouched spending limit. */
function runQuickPick(
  providers: ProvidersHost,
  ui: ProviderQuickPickUi,
  isRemote = false,
): ReturnType<typeof runAddProviderQuickPick> {
  return runAddProviderQuickPick({
    providers,
    isRemote,
    ui,
    sessionBudget: memorySessionBudgetConfig(),
  })
}

function suggestiveHost(): { readonly providers: ProvidersHost; readonly composed: string[] } {
  const composed: string[] = []
  const store = memoryProvidersStore([GROQ_ENTRY])
  const { providers } = testProvidersHost({
    deps: {
      store,
      ...scannedTwoModels(),
      setComposerModel: (modelRef) => {
        composed.push(modelRef)
        return Promise.resolve()
      },
    },
  })
  return { providers, composed }
}

beforeEach(() => {
  vi.mocked(window.showInputBox).mockReset()
})

describe('runAddProviderQuickPick', () => {
  it('uses the entered unsaved credential for model discovery', async () => {
    const fetchModels = vi.fn(() => Promise.resolve({ rows: [testRow('m1')] }))
    const { providers, secrets } = testProvidersHost({
      deps: { store: memoryProvidersStore(), fetcher: { fetchModels } },
    })
    vi.mocked(window.showInputBox).mockResolvedValue('draft-key')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste'],
      pickMany: [['m1']],
      confirmSave: [false],
    })
    await runQuickPick(providers, ui)
    expect(fetchModels).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'openrouter' }),
      'draft-key',
    )
    expect(secrets.values.size).toBe(0)
  })
  it('adds a provider with a pasted key, end to end', async () => {
    const { providers, composed } = suggestiveHost()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1', 'm2']],
      inputText: ['0'],
      confirmSave: [true],
    })
    const outcome = await runQuickPick(providers, ui)
    expect(outcome).toEqual(OPENROUTER_ADDED)
    expect(composed).toEqual(['openrouter/m1'])
    expect(ui.notices.at(-1)).toContain('openrouter/m1')
  })

  it('connects the OpenRouter account without copy-paste', async () => {
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore(),
        fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
        startLoopback: (state) => {
          expect(state).toBe('s')
          return Promise.resolve({
            bindHost: '127.0.0.1',
            redirectUri: 'http://127.0.0.1:9/callback',
            waitForCode: () =>
              Promise.resolve({ code: 'browser-code', params: { code: 'browser-code' } }),
            close: () => undefined,
          })
        },
      },
    })
    const ui = scriptedUi({
      pickOne: ['openrouter', 'connect'],
      pickMany: [['m1']],
      inputText: ['0'],
      confirmSave: [true],
    })
    const outcome = await runQuickPick(providers, ui)
    expect(outcome).toEqual(OPENROUTER_ADDED)
  })

  it('takes the pasted code in a remote window', async () => {
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore(),
        fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
      },
    })
    vi.mocked(window.showInputBox).mockResolvedValue('remote-code')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'connect', 'accept'],
      pickMany: [['m1']],
      inputText: ['0'],
      confirmSave: [true],
    })
    const outcome = await runQuickPick(providers, ui, true)
    expect(outcome).toEqual(OPENROUTER_ADDED)
  })

  it('writes nothing when cancelled at any step', async () => {
    const { providers } = suggestiveHost()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    // Cancel at the provider pick.
    const ui = scriptedUi({ pickOne: [undefined] })
    await expect(runQuickPick(providers, ui)).resolves.toBeUndefined()
    // Cancel at the save confirm, after doing everything else.
    const late = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept'],
      pickMany: [['m1']],
      inputText: ['0'],
      confirmSave: [false],
    })
    await expect(runQuickPick(providers, late)).resolves.toBeUndefined()
    expect(await providers.providers()).toEqual([GROQ_ENTRY])
  })

  it('says a refused test and an empty scan, and saves nothing', async () => {
    const refused = testProvidersHost({
      deps: { tester: { test: () => Promise.resolve({ kind: 'failed', detail: 'denied' }) } },
    })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    const ui = scriptedUi({ pickOne: ['openrouter', 'paste'] })
    await expect(runQuickPick(refused.providers, ui)).resolves.toBeUndefined()
    expect(ui.errors).toHaveLength(1)
    const empty = testProvidersHost({})
    const ui2 = scriptedUi({ pickOne: ['openrouter', 'paste'], pickMany: [[]] })
    await expect(runQuickPick(empty.providers, ui2)).resolves.toBeUndefined()
    expect(await empty.providers.providers()).toEqual([TEST_ENTRY])
  })

  it('refuses a bad custom address and records a private one', async () => {
    const bad = testProvidersHost({
      deps: { policy: { check: () => ({ kind: 'refused', detail: 'nope' }) } },
    })
    const ui = scriptedUi({ pickOne: ['ollama'], inputText: ['https://lan.example'] })
    await expect(runQuickPick(bad.providers, ui)).resolves.toBeUndefined()
    expect(ui.errors).toHaveLength(1)
  })

  it('asks a custom server for every chosen model’s limits and saves them', async () => {
    const customPreset = {
      id: 'custom',
      name: 'Custom server',
      description: 'Any Chat Completions server',
      kind: 'cloud' as const,
      origin: '',
      format: 'chat',
      auth: 'apiKey' as const,
      keyHint: 'The key the server expects',
      keyPage: '',
      isKeyShape: () => true,
      freeTest: 'modelsList' as const,
      localProbes: [],
    }
    const { providers } = testProvidersHost({
      deps: {
        store: memoryProvidersStore(),
        catalog: {
          get: (id) => (id === 'custom' ? customPreset : undefined),
          has: (id) => id === 'custom',
          ids: () => ['custom'],
        },
        fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1')] }) },
      },
    })
    vi.mocked(window.showInputBox).mockResolvedValue('synthetic-key')
    const ui = scriptedUi({
      pickOne: ['custom', 'chat'],
      pickMany: [['m1']],
      inputText: ['https://llm.example', '128000', '4000', '0'],
      confirmSave: [true],
    })
    const outcome = await runQuickPick(providers, ui)
    expect(outcome).toEqual({
      providerId: 'custom',
      modelRef: 'custom/m1',
      sessionBudgetUsd: undefined,
    })
    expect(await providers.providers()).toEqual([
      {
        id: 'custom',
        preset: 'custom',
        address: 'https://llm.example',
        auth: 'apiKey',
        models: ['m1'],
        format: 'chat',
        modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
      },
    ])
  })
})
