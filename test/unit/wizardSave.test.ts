// The wizard save's failure reads (src/host/providers/wizardSave.ts): an
// address the policy passes but the URL parse refuses is refused with the
// address named and the parse failure as its cause; a credential save that
// fails still reports every completed, failed and skipped step.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { ProviderCredentialStore } from '../../src/host/providers/credentialRecords'
import type { ProviderEntry, ProvidersStore } from '../../src/host/providers/providerPorts'
import {
  saveWizardDraft,
  type WizardDraft,
  type WizardSaveDeps,
} from '../../src/host/providers/wizardSave'

function entry(): ProviderEntry {
  return {
    id: 'p',
    preset: 'custom',
    address: 'http://127.0.0.1:1/',
    auth: 'apiKey',
    models: ['m'],
  }
}

function stores(options: { failCredential?: Error } = {}) {
  const added: ProviderEntry[] = []
  let defaultModel: string | undefined
  const store: ProvidersStore = {
    validate: () => undefined,
    list: () => Promise.resolve([...added]),
    add: (candidate) => {
      added.push(candidate)
      return Promise.resolve()
    },
    remove: () => Promise.resolve(undefined),
    restore: () => Promise.resolve(),
    replaceAll: () => Promise.resolve([]),
    defaultModel: () => Promise.resolve(defaultModel),
    setDefaultModel: (ref) => {
      defaultModel = ref ?? undefined
      return Promise.resolve()
    },
  }
  const credentials = {
    getProviderCredential: () => Promise.resolve(undefined),
    setProviderCredential: () =>
      options.failCredential === undefined
        ? Promise.resolve()
        : Promise.reject(options.failCredential),
  } as unknown as ProviderCredentialStore
  const deps: WizardSaveDeps = {
    store,
    credentials,
    policy: { check: () => ({ kind: 'ok' }) },
    setComposerModel: () => Promise.resolve(),
  }
  return { deps }
}

function draft(address: string): WizardDraft {
  return {
    provider: { ...entry(), address },
    credential: 'key-1',
    credentialAuth: 'apiKey',
    defaultModel: 'p/m',
    useNow: false,
  }
}

describe('saveWizardDraft', () => {
  it('refuses an address the URL parse rejects, carrying the TypeError', async () => {
    const { deps } = stores()
    let failure: unknown
    try {
      await saveWizardDraft(deps, draft('http://exa mple.com/'))
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('http://exa mple.com/')
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
  })

  it('reports a failed credential save step by step', async () => {
    const { deps } = stores({ failCredential: new Error('secret store is down') })
    const outcome = await saveWizardDraft(deps, draft('http://127.0.0.1:1/'))
    expect(outcome.failedStep).toBe('credential')
    expect(outcome.notice).toContain(UI_TEXT.providerSaved)
    expect(outcome.notice).toContain('secret store is down')
  })
})
