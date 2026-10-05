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
import { memoryProvidersStore } from './helpers/fakes'

const GROQ_ENTRY: ProviderEntry = {
  id: 'groq',
  presetId: 'groq',
  address: 'https://api.groq.com/openai/v1',
  auth: 'apiKey',
  models: [],
}

interface Script {
  readonly pickOne?: (string | undefined)[]
  readonly pickMany?: (readonly string[] | undefined)[]
  readonly inputText?: (string | undefined)[]
  readonly confirmSave?: boolean[]
}

function scriptedUi(script: Script): ProviderQuickPickUi & {
  readonly errors: string[]
  readonly notices: string[]
} {
  const errors: string[] = []
  const notices: string[] = []
  const pickOne = [...(script.pickOne ?? [])]
  const pickMany = [...(script.pickMany ?? [])]
  const inputText = [...(script.inputText ?? [])]
  const confirmSave = [...(script.confirmSave ?? [])]
  return {
    errors,
    notices,
    pickOne: () => Promise.resolve(pickOne.shift()),
    pickMany: () => Promise.resolve(pickMany.shift()),
    inputText: () => Promise.resolve(inputText.shift()),
    confirmSave: () => Promise.resolve(confirmSave.shift() ?? false),
    showError: (message) => {
      errors.push(message)
    },
    showNotice: (message) => {
      notices.push(message)
    },
  }
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
  it('adds a provider with a pasted key, end to end', async () => {
    const { providers, composed } = suggestiveHost()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    const ui = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept', 'accept'],
      pickMany: [['m1', 'm2']],
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({ providers, isRemote: false, ui })
    expect(outcome).toEqual({ providerId: 'openrouter', modelRef: 'openrouter/m1' })
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
            waitForCode: () => Promise.resolve('browser-code'),
            close: () => undefined,
          })
        },
      },
    })
    const ui = scriptedUi({
      pickOne: ['openrouter', 'connect'],
      pickMany: [['m1']],
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({ providers, isRemote: false, ui })
    expect(outcome).toEqual({ providerId: 'openrouter', modelRef: 'openrouter/m1' })
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
      confirmSave: [true],
    })
    const outcome = await runAddProviderQuickPick({ providers, isRemote: true, ui })
    expect(outcome).toEqual({ providerId: 'openrouter', modelRef: 'openrouter/m1' })
  })

  it('writes nothing when cancelled at any step', async () => {
    const { providers } = suggestiveHost()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    // Cancel at the provider pick.
    const ui = scriptedUi({ pickOne: [undefined] })
    await expect(
      runAddProviderQuickPick({ providers, isRemote: false, ui }),
    ).resolves.toBeUndefined()
    // Cancel at the save confirm, after doing everything else.
    const late = scriptedUi({
      pickOne: ['openrouter', 'paste', 'accept', 'accept'],
      pickMany: [['m1']],
      confirmSave: [false],
    })
    await expect(
      runAddProviderQuickPick({ providers, isRemote: false, ui: late }),
    ).resolves.toBeUndefined()
    expect(await providers.providers()).toEqual([GROQ_ENTRY])
  })

  it('says a refused test and an empty scan, and saves nothing', async () => {
    const refused = testProvidersHost({
      deps: { tester: { test: () => Promise.resolve({ kind: 'failed', detail: 'denied' }) } },
    })
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-pasted')
    const ui = scriptedUi({ pickOne: ['openrouter', 'paste'] })
    await expect(
      runAddProviderQuickPick({ providers: refused.providers, isRemote: false, ui }),
    ).resolves.toBeUndefined()
    expect(ui.errors).toHaveLength(1)
    const empty = testProvidersHost({})
    const ui2 = scriptedUi({ pickOne: ['openrouter', 'paste'], pickMany: [[]] })
    await expect(
      runAddProviderQuickPick({ providers: empty.providers, isRemote: false, ui: ui2 }),
    ).resolves.toBeUndefined()
    expect(await empty.providers.providers()).toEqual([TEST_ENTRY])
  })

  it('refuses a bad custom address and records a private one', async () => {
    const bad = testProvidersHost({
      deps: { policy: { check: () => ({ kind: 'refused', detail: 'nope' }) } },
    })
    const ui = scriptedUi({ pickOne: ['ollama'], inputText: ['https://lan.example'] })
    await expect(
      runAddProviderQuickPick({ providers: bad.providers, isRemote: false, ui }),
    ).resolves.toBeUndefined()
    expect(ui.errors).toHaveLength(1)
  })
})
