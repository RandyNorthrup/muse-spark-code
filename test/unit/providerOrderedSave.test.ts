import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModelsPanelSeam } from '../../src/core/providers/panelSeam'
import { ProviderCredentialStore, isOriginBound } from '../../src/host/providers/credentialRecords'
import { saveWizardDraft, type WizardDraft } from '../../src/host/providers/wizardSave'
import { REDACTED_MARK, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { Usd } from '../../src/shared/usd'
import { memorySecrets, memorySessionBudgetConfig, unexpectedWarning } from './helpers/fakes'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function fixture() {
  const folder = await mkdtemp(path.join(tmpdir(), 'ordered-provider-'))
  folders.push(folder)
  const configFile = path.join(folder, 'providers.json')
  const seam = createModelsPanelSeam({ configFile, subscriptionModels: () => Promise.resolve([]) })
  const credentials = new ProviderCredentialStore(memorySecrets(), unexpectedWarning)
  const provider = {
    id: 'custom',
    preset: 'custom',
    address: 'https://old.example/v1',
    auth: 'apiKey' as const,
    format: 'chat' as const,
    models: ['m1'],
    modelLimits: { m1: { contextTokens: 128_000, outputTokens: 80_000 } },
  }
  await seam.store.add(provider)
  await seam.store.setDefaultModel('other/model')
  await credentials.setProviderCredential(provider.id, {
    v: 1,
    auth: 'apiKey',
    origin: 'https://old.example',
    secret: 'synthetic-old-key',
  })
  const draft: WizardDraft = {
    provider: {
      ...provider,
      modelLimits: { m1: { contextTokens: 128_000, outputTokens: 40_000 } },
    },
    credential: 'synthetic-new-key',
    credentialAuth: 'apiKey',
    defaultModel: 'custom/m1',
    editing: true,
    useNow: true,
    editSnapshot: {
      provider,
      credential: await credentials.getProviderCredential(provider.id),
      defaultModel: 'other/model',
    },
  }
  const setComposerModel = vi.fn(() => Promise.resolve())
  const deps = {
    store: seam.store,
    credentials,
    policy: { check: () => ({ kind: 'ok' as const }) },
    setComposerModel,
  }
  return { configFile, provider, draft, deps, setComposerModel }
}

describe('ordered provider saves', () => {
  it.each(['entry', 'credential', 'default', 'composer'] as const)(
    'keeps only completed writes after the %s failure',
    async (step) => {
      const f = await fixture()
      const before = await readFile(f.configFile, 'utf8')
      switch (step) {
        case 'entry': {
          vi.spyOn(f.deps.store, 'replaceAll').mockRejectedValueOnce(new Error('entry refused'))
          break
        }
        case 'credential': {
          vi.spyOn(f.deps.credentials, 'setProviderCredential').mockRejectedValueOnce(
            new Error('key refused'),
          )
          break
        }
        case 'default': {
          vi.spyOn(f.deps.store, 'setDefaultModel').mockRejectedValueOnce(
            new Error('default refused'),
          )
          break
        }
        case 'composer': {
          f.setComposerModel.mockRejectedValueOnce(new Error('composer refused'))
          break
        }
      }
      if (step === 'entry') {
        await expect(saveWizardDraft(f.deps, f.draft)).rejects.toThrow('entry refused')
        expect(await readFile(f.configFile, 'utf8')).toBe(before)
      } else {
        const outcome = await saveWizardDraft(f.deps, f.draft)
        const failed = fill(
          {
            credential: UI_TEXT.providerKeySaveFailed,
            default: UI_TEXT.providerDefaultSaveFailed,
            composer: UI_TEXT.providerComposerSaveFailed,
          }[step],
          {
            detail: {
              credential: 'key refused',
              default: 'default refused',
              composer: 'composer refused',
            }[step],
          },
        )
        const expected = [UI_TEXT.providerSaved]
        if (step !== 'credential') expected.push(UI_TEXT.providerKeySaved)
        if (step === 'composer') expected.push(UI_TEXT.providerDefaultSaved)
        expected.push(failed)
        if (step === 'credential') expected.push(UI_TEXT.providerDefaultSkipped)
        if (step !== 'composer') expected.push(UI_TEXT.providerComposerSkipped)
        expect(outcome.notice).toBe(expected.join(' '))
        expect(await f.deps.store.list()).toEqual([f.draft.provider])
      }
      const record = await f.deps.credentials.getProviderCredential('custom')
      expect(record?.secret).toBe(
        step === 'entry' || step === 'credential' ? 'synthetic-old-key' : 'synthetic-new-key',
      )
      expect(await f.deps.store.defaultModel()).toBe(
        step === 'composer' ? 'custom/m1' : 'other/model',
      )
      if (step !== 'composer') expect(f.setComposerModel).not.toHaveBeenCalled()
    },
  )

  it('cannot create an invalid inverse after a later context edit (RVPROVWIZ8C P2-1)', async () => {
    const f = await fixture()
    f.setComposerModel.mockImplementationOnce(async () => {
      await f.deps.store.replaceAll((entries) =>
        entries.map((entry) => ({
          ...entry,
          modelLimits: { m1: { contextTokens: 60_000, outputTokens: 40_000 } },
        })),
      )
      throw new Error('composer refused')
    })
    const outcome = await saveWizardDraft(f.deps, f.draft)
    expect(outcome.notice).toContain(
      fill(UI_TEXT.providerComposerSaveFailed, { detail: 'composer refused' }),
    )
    expect(await f.deps.store.list()).toMatchObject([
      { modelLimits: { m1: { contextTokens: 60_000, outputTokens: 40_000 } } },
    ])
    await expect(f.deps.credentials.getProviderCredential('custom')).resolves.toMatchObject({
      secret: 'synthetic-new-key',
    })
    expect(await f.deps.store.defaultModel()).toBe('custom/m1')
  })

  it('keeps absent-routing edits and newer routing order after key refusal (RVPROVWIZ8C P2-2)', async () => {
    const f = await fixture()
    const provider = { ...f.provider, id: 'openrouter', preset: 'openrouter' }
    await f.deps.store.replaceAll([provider])
    vi.spyOn(f.deps.credentials, 'setProviderCredential').mockImplementationOnce(async () => {
      await f.deps.store.replaceAll((entries) =>
        entries.map((entry) => ({ ...entry, routing: { privacy: 'any', order: ['openai'] } })),
      )
      throw new Error('key refused')
    })
    const outcome = await saveWizardDraft(f.deps, {
      ...f.draft,
      provider: { ...provider, routing: { privacy: 'any' } },
      defaultModel: 'openrouter/m1',
      editSnapshot: { provider, credential: undefined, defaultModel: 'other/model' },
    })
    expect(outcome.notice).toContain(fill(UI_TEXT.providerKeySaveFailed, { detail: 'key refused' }))
    expect(await f.deps.store.list()).toMatchObject([
      { routing: { privacy: 'any', order: ['openai'] } },
    ])
  })

  it('leaves the old key unusable at the saved new origin when its replacement fails', async () => {
    const f = await fixture()
    vi.spyOn(f.deps.credentials, 'setProviderCredential').mockRejectedValueOnce(
      new Error('key refused'),
    )
    const outcome = await saveWizardDraft(f.deps, {
      ...f.draft,
      provider: { ...f.draft.provider, address: 'https://new.example/v1' },
    })
    expect(outcome.notice).toContain(fill(UI_TEXT.providerKeySaveFailed, { detail: 'key refused' }))
    const [entry] = await f.deps.store.list()
    const record = await f.deps.credentials.getProviderCredential('custom')
    if (entry === undefined || record === undefined) throw new Error('Missing fixture record')
    expect(entry.address).toBe('https://new.example/v1')
    expect(record.secret).toBe('synthetic-old-key')
    expect(isOriginBound(record, entry.address)).toBe(false)
  })

  it('validates schema and spending limit before writing', async () => {
    const f = await fixture()
    const before = await readFile(f.configFile, 'utf8')
    const write = vi.spyOn(f.deps.store, 'replaceAll')
    await expect(
      saveWizardDraft(f.deps, {
        ...f.draft,
        provider: {
          ...f.draft.provider,
          modelLimits: { m1: { contextTokens: 100, outputTokens: 200 } },
        },
      }),
    ).rejects.toThrow()
    await expect(
      saveWizardDraft(f.deps, {
        ...f.draft,
        provider: { ...f.provider, models: [''], modelLimits: { '': f.provider.modelLimits.m1 } },
        defaultModel: 'custom/',
      }),
    ).rejects.toThrow(UI_TEXT.providerText.schema.modelRef)
    const config = memorySessionBudgetConfig()
    await expect(
      saveWizardDraft(
        { ...f.deps, sessionBudget: { config, expectedUsd: undefined } },
        { ...f.draft, sessionBudgetUsd: Usd.from(2).toAmount() },
      ),
    ).rejects.toThrow(UI_TEXT.wizardSessionBudgetInvalid)
    expect(write).not.toHaveBeenCalled()
    expect(await readFile(f.configFile, 'utf8')).toBe(before)
    await expect(f.deps.credentials.getProviderCredential('custom')).resolves.toMatchObject({
      secret: 'synthetic-old-key',
    })
  })

  it('writes entry, key, default, limit, then composer; a limit failure preserves earlier writes', async () => {
    const f = await fixture()
    const calls: string[] = []
    const entryWrite = f.deps.store.replaceAll
    vi.spyOn(f.deps.store, 'replaceAll').mockImplementation(async (...args) => {
      calls.push('entry')
      return await entryWrite(...args)
    })
    const keyWrite = f.deps.credentials.setProviderCredential.bind(f.deps.credentials)
    vi.spyOn(f.deps.credentials, 'setProviderCredential').mockImplementation(async (...args) => {
      calls.push('key')
      await keyWrite(...args)
    })
    const defaultWrite = f.deps.store.setDefaultModel
    vi.spyOn(f.deps.store, 'setDefaultModel').mockImplementation(async (...args) => {
      calls.push('default')
      await defaultWrite(...args)
    })
    const config = memorySessionBudgetConfig()
    vi.spyOn(config, 'write').mockImplementation(() => {
      calls.push('limit')
      return Promise.reject(new Error('limit refused: synthetic-new-key'))
    })
    f.setComposerModel.mockImplementation(() => {
      calls.push('composer')
      return Promise.resolve()
    })
    const outcome = await saveWizardDraft(
      { ...f.deps, sessionBudget: { config, expectedUsd: config.read().effectiveUsd } },
      { ...f.draft, sessionBudgetUsd: Usd.from(2).toAmount() },
    )
    expect(calls).toEqual(['entry', 'key', 'default', 'limit'])
    expect(outcome.notice).toBe(
      [
        UI_TEXT.providerSaved,
        UI_TEXT.providerKeySaved,
        UI_TEXT.providerDefaultSaved,
        fill(UI_TEXT.sessionBudgetPartialSave, { detail: `limit refused: ${REDACTED_MARK}` }),
        UI_TEXT.providerComposerSkipped,
      ].join(' '),
    )
    expect(outcome.budget).toEqual({ status: 'failed', error: `limit refused: ${REDACTED_MARK}` })
    expect(JSON.stringify(outcome)).not.toContain('synthetic-new-key')
    expect(await f.deps.store.list()).toEqual([f.draft.provider])
    expect(await f.deps.store.defaultModel()).toBe('custom/m1')
    expect(config.read().effectiveUsd).toBe(Usd.from(0).toAmount())
  })
})
