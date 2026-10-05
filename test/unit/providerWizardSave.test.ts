// M95 lane K (PLAN.md D74, M95 acceptance 19 and the Tests' first-run
// items): Save writes the file and the secret together, sets the default
// model and asks for the composer's model; Cancel writes nothing.

import { describe, expect, it, vi } from 'vitest'
import { ProviderCredentialStore as CredentialStore } from '../../src/host/providers/credentialRecords'
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
    preset: 'openrouter',
    address: 'https://openrouter.ai',
    auth: 'apiKey',
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
      auth: 'apiKey',
      origin: 'https://openrouter.ai',
      secret: 'sk-or-connected',
    })
  })

  it('leaves the composer alone without use now, and rolls back its refusal', async () => {
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
    await expect(
      saveWizardDraft(
        {
          store: refusing.store,
          credentials: refusing.credentials,
          policy: POLICY,
          setComposerModel: refusing.setComposerModel,
        },
        DRAFT,
      ),
    ).rejects.toThrow('unknown model')
    expect(refusing.store.current).toEqual([])
    expect(await refusing.store.defaultModel()).toBeUndefined()
    expect(await refusing.credentials.getProviderCredential(DRAFT.provider.id)).toBeUndefined()
  })

  it('rolls back a secret-store failure and preserves the prior default', async () => {
    const parts = saving()
    await parts.store.setDefaultModel('previous/model')
    vi.spyOn(parts.credentials, 'setProviderCredential').mockRejectedValue(
      new Error('store unavailable'),
    )
    await expect(saveWizardDraft({ ...parts, policy: POLICY }, DRAFT)).rejects.toThrow(
      'store unavailable',
    )
    expect(parts.store.current).toEqual([])
    expect(await parts.store.defaultModel()).toBe('previous/model')
  })
  it('rolls back a default-model persistence failure', async () => {
    const parts = saving()
    vi.spyOn(parts.store, 'setDefaultModel').mockRejectedValueOnce(new Error('default unavailable'))
    await expect(saveWizardDraft({ ...parts, policy: POLICY }, DRAFT)).rejects.toThrow(
      'default unavailable',
    )
    expect(parts.store.current).toEqual([])
    expect(await parts.credentials.getProviderCredential(DRAFT.provider.id)).toBeUndefined()
  })
  it('requires native private-network consent despite a claimed file grant', async () => {
    const parts = saving()
    await expect(
      saveWizardDraft(
        {
          ...parts,
          policy: { check: () => ({ kind: 'private', address: 'https://lan.example' }) },
        },
        { ...DRAFT, provider: { ...DRAFT.provider, privateNetwork: true } },
      ),
    ).rejects.toThrow()
    expect(parts.store.current).toEqual([])
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
          preset: 'ollama',
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
