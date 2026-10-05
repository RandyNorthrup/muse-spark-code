// M95 lane K (PLAN.md D74, M95 acceptance 19 and the Tests' first-run
// items): Save writes the file and the secret together, sets the default
// model and asks for the composer's model; Cancel writes nothing.

import { describe, expect, it, vi } from 'vitest'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { providerSecretKey } from '../../src/host/providers/credentialRecords'
import type { AddressPolicy } from '../../src/host/providers/providerPorts'
import { saveWizardDraft, type WizardDraft } from '../../src/host/providers/wizardSave'
import { memoryProvidersStore, memorySecrets, unexpectedWarning } from './helpers/fakes'

const POLICY: AddressPolicy = {
  check: (address) =>
    address === 'https://attacker.example'
      ? { kind: 'refused', detail: 'refused' }
      : { kind: 'ok' },
}

const DRAFT: WizardDraft = {
  provider: {
    id: 'openrouter',
    presetId: 'openrouter',
    address: 'https://openrouter.ai',
    auth: 'oauth',
    models: ['openai/gpt-oss-20b'],
  },
  credential: 'sk-or-connected',
  credentialAuth: 'oauth',
  defaultModel: 'openrouter/openai/gpt-oss-20b',
  sessionBudgetUsd: undefined,
  useNow: true,
}

function saving(parts: { readonly setComposerModel?: (modelRef: string) => Promise<void> } = {}): {
  readonly store: ReturnType<typeof memoryProvidersStore>
  readonly secrets: ReturnType<typeof memorySecrets>
  readonly credentials: CredentialStore
  readonly setComposerModel: (modelRef: string) => Promise<void>
} {
  const store = memoryProvidersStore()
  const secrets = memorySecrets()
  return {
    store,
    secrets,
    credentials: new CredentialStore(secrets, unexpectedWarning),
    setComposerModel: parts.setComposerModel ?? (() => Promise.resolve()),
  }
}

describe('saveWizardDraft', () => {
  it('writes the file and the secret together, then the default and composer models', async () => {
    const savingParts = saving()
    const composed: string[] = []
    const outcome = await saveWizardDraft(
      {
        store: savingParts.store,
        credentials: savingParts.credentials,
        policy: POLICY,
        setComposerModel: (modelRef) => {
          composed.push(modelRef)
          return Promise.resolve()
        },
      },
      DRAFT,
    )
    expect(outcome).toEqual({
      providerId: 'openrouter',
      modelRef: 'openrouter/openai/gpt-oss-20b',
      composerSet: true,
      sessionBudgetUsd: undefined,
    })
    expect(savingParts.store.current).toEqual([DRAFT.provider])
    expect(await savingParts.store.defaultModel()).toBe('openrouter/openai/gpt-oss-20b')
    expect(composed).toEqual(['openrouter/openai/gpt-oss-20b'])
    expect(await savingParts.credentials.getProviderCredential('openrouter')).toEqual({
      v: 1,
      auth: 'oauth',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-connected',
    })
  })

  it('leaves the composer alone without use now, and survives its refusal', async () => {
    const without = saving()
    const outcome = await saveWizardDraft(
      {
        store: without.store,
        credentials: without.credentials,
        policy: POLICY,
        setComposerModel: () => Promise.resolve(),
      },
      { ...DRAFT, useNow: false },
    )
    expect(outcome.composerSet).toBe(false)
    expect(without.store.current).toEqual([DRAFT.provider])
    const refusing = saving({
      setComposerModel: () => Promise.reject(new Error('unknown model')),
    })
    const refused = await saveWizardDraft(
      {
        store: refusing.store,
        credentials: refusing.credentials,
        policy: POLICY,
        setComposerModel: refusing.setComposerModel,
      },
      DRAFT,
    )
    // The save stands; only the composer ask failed.
    expect(refused.composerSet).toBe(false)
    expect(refusing.store.current).toEqual([DRAFT.provider])
  })

  it('writes nothing for an incomplete draft, a missing key or a refused address', async () => {
    const savingParts = saving()
    const setComposerModel = vi.fn(() => Promise.resolve())
    const deps = {
      store: savingParts.store,
      credentials: savingParts.credentials,
      policy: POLICY,
      setComposerModel,
    }
    await expect(
      saveWizardDraft(deps, { ...DRAFT, provider: { ...DRAFT.provider, id: '' } }),
    ).rejects.toThrow()
    await expect(saveWizardDraft(deps, { ...DRAFT, credential: '  ' })).rejects.toThrow()
    await expect(
      saveWizardDraft(deps, {
        ...DRAFT,
        provider: { ...DRAFT.provider, address: 'https://attacker.example' },
      }),
    ).rejects.toThrow()
    expect(savingParts.store.current).toEqual([])
    expect(savingParts.secrets.values.has(providerSecretKey('openrouter'))).toBe(false)
    expect(setComposerModel).not.toHaveBeenCalled()
  })

  it('saves a local server with no secret', async () => {
    const savingParts = saving()
    const outcome = await saveWizardDraft(
      {
        store: savingParts.store,
        credentials: savingParts.credentials,
        policy: POLICY,
        setComposerModel: () => Promise.resolve(),
      },
      {
        ...DRAFT,
        provider: {
          id: 'ollama',
          presetId: 'ollama',
          address: 'http://127.0.0.1:11434',
          auth: 'none',
          models: ['qwen3:8b'],
        },
        credential: undefined,
        defaultModel: 'ollama/qwen3:8b',
      },
    )
    expect(outcome.providerId).toBe('ollama')
    expect(savingParts.secrets.values.size).toBe(0)
  })
})
