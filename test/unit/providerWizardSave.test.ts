// M95 lane K (PLAN.md D74, M95 acceptance 19 and the Tests' first-run
// items): Save writes the file and the secret together, sets the default
// model and asks for the composer's model; Cancel writes nothing.

import { describe, expect, it, vi } from 'vitest'
import { ProviderCredentialStore as CredentialStore } from '../../src/host/providers/credentialRecords'
import { providerSecretKey } from '../../src/host/providers/credentialRecords'
import type { AddressPolicy, ProviderEntry } from '../../src/host/providers/providerPorts'
import { saveWizardDraft, type WizardDraft } from '../../src/host/providers/wizardSave'
import { memoryProvidersStore, memorySecrets, unexpectedWarning } from './helpers/fakes'
import { UI_TEXT } from '../../src/shared/constants'

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

  it('saves an unchanged editing draft without rewriting the provider, default or secret', async () => {
    const parts = saving()
    await saveWizardDraft({ ...parts, policy: POLICY }, { ...DRAFT, useNow: false })
    const providerWrite = vi.spyOn(parts.store, 'replaceAll')
    const defaultWrite = vi.spyOn(parts.store, 'setDefaultModel')
    const secretWrite = vi.spyOn(parts.credentials, 'setProviderCredential')
    await saveWizardDraft({ ...parts, policy: POLICY }, { ...DRAFT, editing: true, useNow: false })
    expect(providerWrite).not.toHaveBeenCalled()
    expect(defaultWrite).not.toHaveBeenCalled()
    expect(secretWrite).not.toHaveBeenCalled()
  })

  it('keeps untouched credential rotations even when composer refusal rolls back the save', async () => {
    const parts = saving()
    await saveWizardDraft({ ...parts, policy: POLICY }, { ...DRAFT, useNow: false })
    const initialSecret = await parts.credentials.getProviderCredential(DRAFT.provider.id)
    if (initialSecret === undefined) throw new Error('Missing fixture credential')
    await expect(
      saveWizardDraft(
        {
          ...parts,
          policy: POLICY,
          setComposerModel: async () => {
            await parts.credentials.setProviderCredential(DRAFT.provider.id, {
              ...initialSecret,
              secret: 'synthetic-rotated-key',
            })
            throw new Error('composer refused')
          },
        },
        {
          ...DRAFT,
          credential: undefined,
          editing: true,
          setDefault: false,
          editSnapshot: {
            provider: DRAFT.provider,
            credential: DRAFT.credential,
            defaultModel: DRAFT.defaultModel,
          },
        },
      ),
    ).rejects.toThrow('composer refused')
    expect(await parts.credentials.getProviderCredential(DRAFT.provider.id)).toEqual({
      ...initialSecret,
      secret: 'synthetic-rotated-key',
    })
  })

  it.each(['unchanged', 'edited', 'added'] as const)(
    'composer refusal reverses only the %s save and keeps later field/provider changes',
    async (kind) => {
      const parts = saving()
      const initial: ProviderEntry = {
        ...DRAFT.provider,
        modelLimits: { m1: { contextTokens: 128_000, outputTokens: 4000 } },
        routing: { privacy: 'zdr', order: ['anthropic'], allowFallbacks: true },
      }
      const other = { ...initial, id: 'other' }
      await parts.store.add(other)
      if (kind !== 'added') await parts.store.add(initial)
      const wanted: ProviderEntry =
        kind === 'edited'
          ? {
              ...initial,
              privateNetwork: true,
              modelLimits: { m1: { contextTokens: 192_000, outputTokens: 8000 } },
              routing: { ...initial.routing, privacy: 'any' },
            }
          : initial
      const providerWrite = vi.spyOn(parts.store, 'replaceAll')
      const added = { ...initial, id: 'concurrent' }
      await expect(
        saveWizardDraft(
          {
            ...parts,
            policy: POLICY,
            setComposerModel: async () => {
              await parts.store.replaceAll((entries) =>
                entries.map((entry) =>
                  kind === 'edited' && entry.id === initial.id
                    ? {
                        ...entry,
                        pinned: ['m1'],
                        modelLimits: { m1: { contextTokens: 256_000, outputTokens: 8000 } },
                        routing: { privacy: 'any', order: ['openai'], allowFallbacks: false },
                      }
                    : { ...entry, pinned: ['m1'] },
                ),
              )
              await parts.store.add(added)
              throw new Error('composer refused')
            },
          },
          {
            ...DRAFT,
            provider: wanted,
            editing: kind !== 'added',
            setDefault: false,
            ...(kind !== 'added' && {
              credential: undefined,
              editSnapshot: { provider: initial, credential: undefined, defaultModel: undefined },
            }),
          },
        ),
      ).rejects.toThrow('composer refused')
      const current = parts.store.current.find((entry) => entry.id === initial.id)
      expect(current).toEqual(
        kind === 'edited'
          ? {
              ...initial,
              pinned: ['m1'],
              modelLimits: { m1: { contextTokens: 256_000, outputTokens: 4000 } },
              routing: { privacy: 'zdr', order: ['openai'], allowFallbacks: false },
            }
          : { ...initial, pinned: ['m1'] },
      )
      expect(parts.store.current.filter((entry) => entry.id !== initial.id)).toEqual([
        { ...other, pinned: ['m1'] },
        added,
      ])
      if (kind === 'unchanged') expect(providerWrite).toHaveBeenCalledTimes(1)
    },
  )

  it('removes only its unchanged addition when the composer refuses after another provider is added', async () => {
    const parts = saving()
    const other = { ...DRAFT.provider, id: 'other' }
    await expect(
      saveWizardDraft(
        {
          ...parts,
          policy: POLICY,
          setComposerModel: async () => {
            await parts.store.add(other)
            throw new Error('composer refused')
          },
        },
        DRAFT,
      ),
    ).rejects.toThrow('composer refused')
    expect(parts.store.current).toEqual([other])
    expect(await parts.store.defaultModel()).toBeUndefined()
  })

  it('does not recreate a provider removed while the composer refuses', async () => {
    const parts = saving()
    await saveWizardDraft({ ...parts, policy: POLICY }, { ...DRAFT, useNow: false })
    await expect(
      saveWizardDraft(
        {
          ...parts,
          policy: POLICY,
          setComposerModel: async () => {
            await parts.store.remove(DRAFT.provider.id)
            throw new Error('composer refused')
          },
        },
        { ...DRAFT, provider: { ...DRAFT.provider, privateNetwork: true }, editing: true },
      ),
    ).rejects.toThrow('composer refused')
    expect(parts.store.current).toEqual([])
  })

  it.each([
    { modelId: '__proto__', change: 'removed' },
    { modelId: 'constructor', change: 'removed' },
    { modelId: '__proto__', change: 'added' },
    { modelId: 'constructor', change: 'added' },
  ])(
    'reverses a $change model-limit field named $modelId alongside a concurrent limit change',
    async ({ modelId, change }) => {
      const parts = saving()
      const limits = { m1: { contextTokens: 128_000, outputTokens: 4000 } }
      const withModel = { ...limits, [modelId]: limits.m1 }
      const initial = {
        ...DRAFT.provider,
        modelLimits: change === 'removed' ? withModel : limits,
      }
      await parts.store.add(initial)
      await expect(
        saveWizardDraft(
          {
            ...parts,
            policy: POLICY,
            setComposerModel: async () => {
              await parts.store.replaceAll((entries) =>
                entries.map((entry) => ({
                  ...entry,
                  pinned: ['m1'],
                  modelLimits: {
                    ...entry.modelLimits,
                    m1: { contextTokens: 256_000, outputTokens: 4000 },
                  },
                })),
              )
              throw new Error('composer refused')
            },
          },
          {
            ...DRAFT,
            provider: { ...initial, modelLimits: change === 'removed' ? limits : withModel },
            editing: true,
            setDefault: false,
          },
        ),
      ).rejects.toThrow('composer refused')
      expect(parts.store.current).toEqual([
        {
          ...initial,
          pinned: ['m1'],
          modelLimits: {
            ...initial.modelLimits,
            m1: { contextTokens: 256_000, outputTokens: 4000 },
          },
        },
      ])
      if (change === 'removed') {
        expect(Object.hasOwn(parts.store.current[0]?.modelLimits ?? {}, modelId)).toBe(true)
      }
    },
  )

  it('compares changed routing leaves and keeps untouched routing choices', async () => {
    const parts = saving()
    const initial = {
      ...DRAFT.provider,
      routing: { privacy: 'zdr' as const, order: ['anthropic'], allowFallbacks: true },
    }
    await saveWizardDraft(
      { ...parts, policy: POLICY },
      { ...DRAFT, provider: initial, useNow: false },
    )
    const current = {
      ...initial,
      routing: { ...initial.routing, order: ['openai'], allowFallbacks: false },
    }
    await parts.store.replaceAll([current])
    const edit = {
      ...DRAFT,
      credential: undefined,
      editing: true,
      setDefault: false,
      useNow: false,
      provider: { ...initial, routing: { ...initial.routing, privacy: 'any' as const } },
      editSnapshot: {
        provider: initial,
        credential: DRAFT.credential,
        defaultModel: DRAFT.defaultModel,
      },
    }
    await saveWizardDraft({ ...parts, policy: POLICY }, edit)
    expect(parts.store.current).toEqual([
      { ...current, routing: { ...current.routing, privacy: 'any' } },
    ])
    await expect(saveWizardDraft({ ...parts, policy: POLICY }, edit)).rejects.toThrow(
      UI_TEXT.providerEditConflict,
    )
    expect(parts.store.current).toEqual([
      { ...current, routing: { ...current.routing, privacy: 'any' } },
    ])
    await parts.store.replaceAll([DRAFT.provider])
    const withoutOrder = { ...initial, routing: { privacy: 'zdr' as const, allowFallbacks: true } }
    await expect(
      saveWizardDraft(
        { ...parts, policy: POLICY },
        {
          ...edit,
          provider: { ...withoutOrder, routing: { ...withoutOrder.routing, order: ['google'] } },
          editSnapshot: { ...edit.editSnapshot, provider: withoutOrder },
        },
      ),
    ).rejects.toThrow(UI_TEXT.providerEditConflict)
    expect(parts.store.current).toEqual([DRAFT.provider])
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
