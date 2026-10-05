// M95 lane K (PLAN.md D74): the host verbs compose the seams — the key
// test asks before a paid check, the private address asks once, scans and
// removals delegate, and the stored credential tests without the webview.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import type { ProviderEntry } from '../../src/host/providers/providerPorts'
import { OPENROUTER_PRESET, TEST_ENTRY, testProvidersHost } from './helpers/m95kFixtures'

beforeEach(() => {
  vi.mocked(window.showInputBox).mockReset()
})

describe('createProvidersHost', () => {
  it('lists providers and presets, and parses the workspace suggestion', async () => {
    const { providers } = testProvidersHost()
    expect(await providers.providers()).toEqual([TEST_ENTRY])
    expect(providers.preset('openrouter')?.name).toBe('OpenRouter')
    expect(providers.presetIds()).toEqual(['openrouter', 'ollama'])
    expect(providers.suggestedPreset('openrouter')).toBe('openrouter')
    expect(providers.suggestedPreset('https://attacker.example')).toBeUndefined()
  })

  it('asks the paid question before a one-token check', async () => {
    const paid: ProviderEntry = { ...TEST_ENTRY, id: 'paid-only' }
    const tester = {
      test: (_entry: ProviderEntry, _credential: string, isPaidAllowed: boolean) =>
        !isPaidAllowed && _entry.id === 'paid-only'
          ? Promise.resolve({ kind: 'paid' as const, cost: '$0.01' })
          : Promise.resolve({ kind: 'ok' as const, models: 3 }),
    }
    const accepted = testProvidersHost({ deps: { tester } })
    await expect(accepted.providers.testCredential(paid, 'key')).resolves.toEqual({
      kind: 'ok',
      models: 3,
    })
    const declined = testProvidersHost({
      deps: { tester },
      confirmPaidTest: () => Promise.resolve(false),
    })
    await expect(declined.providers.testCredential(paid, 'key')).resolves.toEqual({
      kind: 'paid',
      cost: '$0.01',
    })
    await expect(accepted.providers.testCredential(TEST_ENTRY, 'key')).resolves.toEqual({
      kind: 'ok',
      models: 3,
    })
  })

  it('asks once about a private-network address', async () => {
    const confirmPrivateNetwork = vi.fn((_message: string) => Promise.resolve(true))
    const { providers } = testProvidersHost({
      deps: { policy: { check: () => ({ kind: 'private', address: 'https://lan.example' }) } },
      confirmPrivateNetwork,
    })
    await expect(providers.confirmAddress('https://lan.example')).resolves.toEqual({
      kind: 'private',
      address: 'https://lan.example',
    })
    expect(confirmPrivateNetwork).toHaveBeenCalledOnce()
  })

  it('prompts for a key through the password box', async () => {
    const { providers } = testProvidersHost()
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-x')
    await expect(providers.promptForKey(OPENROUTER_PRESET)).resolves.toBe('sk-or-x')
  })

  it('tests the stored credential, and says when no key was entered', async () => {
    const { providers } = testProvidersHost()
    await expect(providers.testStoredCredential(TEST_ENTRY)).resolves.toMatchObject({
      kind: 'failed',
    })
  })

  it('removes with undo and exports without secrets', async () => {
    const { providers } = testProvidersHost()
    await expect(providers.remove('openrouter')).resolves.toEqual(TEST_ENTRY)
    expect(await providers.undoRemove('openrouter')).toBe(true)
    const text = await providers.exportConfig()
    expect(JSON.parse(text)).toMatchObject({ version: 1 })
    const states = await providers.providerStates()
    expect(states).toHaveLength(1)
    expect(states[0]).toMatchObject({ hasKey: false })
  })
})
