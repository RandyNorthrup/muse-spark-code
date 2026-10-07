import { type UsdAmount } from '../../shared/usd'
// Saving the wizard (M95 lane K, PLAN.md D74, M95 acceptance 19 and the
// Tests' first-run items): the draft lives in memory only while the wizard
// runs. **Save** writes `providers.json` and the secret together, sets the
// default model and asks the conversation to set the composer's model;
// **Cancel** discards the draft, so nothing is written.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { ProviderCredentialStore as CredentialStore } from './credentialRecords'
import type { AddressPolicy, ProviderEntry, ProvidersStore } from './providerPorts'

/** The wizard's in-memory draft: never written until Save. */
export interface WizardDraft {
  readonly provider: ProviderEntry
  /** The entered key; absent for a local server without auth. */
  readonly credential?: string | undefined
  /** How the credential was obtained (a pasted key or an OAuth connect). */
  readonly credentialAuth: 'apiKey' | 'oauth' | 'subscription'
  /** The model's qualified reference (`<providerId>/<modelId>`). */
  readonly defaultModel: string
  /** A session budget the suggestion accepted, for M82's seam when it lands. */
  readonly sessionBudgetUsd?: UsdAmount | undefined
  /** Save and use now: the conversation's model is set too. */
  readonly useNow: boolean
  readonly editing?: boolean
}

export interface WizardSaveDeps {
  readonly store: ProvidersStore
  readonly credentials: CredentialStore
  readonly policy: AddressPolicy
  /** Asks the conversation to set the composer's model (its own refusal stands). */
  readonly setComposerModel: (modelRef: string) => Promise<void>
  readonly isPrivateConfirmed?: (address: string) => boolean
}

export interface WizardSaveOutcome {
  readonly providerId: string
  readonly modelRef: string
  /** Whether the conversation took the composer's model. */
  readonly composerSet: boolean
  readonly sessionBudgetUsd: UsdAmount | undefined
}

/**
 * Saves a finished draft: the file and the secret together, then the
 * default model, then (for Save and use now) the composer's model. Throws
 * on an invalid draft before writing anything.
 */
export async function saveWizardDraft(
  deps: WizardSaveDeps,
  draft: WizardDraft,
): Promise<WizardSaveOutcome> {
  if (
    draft.provider.id.trim() === '' ||
    draft.provider.preset.trim() === '' ||
    draft.provider.address.trim() === '' ||
    draft.defaultModel.trim() === ''
  ) {
    throw new Error('The provider draft is not complete')
  }
  if (draft.provider.auth !== 'none' && (draft.credential ?? '').trim() === '') {
    throw new Error(`Provider ${draft.provider.id} needs a key`)
  }
  const address = deps.policy.check(draft.provider.address)
  if (address.kind === 'refused') {
    throw new Error(fill(UI_TEXT.providerAddressInvalid, { detail: address.detail }))
  }
  if (address.kind === 'private' && deps.isPrivateConfirmed?.(draft.provider.address) !== true) {
    throw new Error(UI_TEXT.providerPrivateConfirm)
  }
  let origin: string
  try {
    origin = new URL(draft.provider.address).origin
  } catch {
    throw new Error(fill(UI_TEXT.providerAddressInvalid, { detail: draft.provider.address }))
  }
  const secret = (draft.credential ?? '').trim()
  if (
    draft.provider.models.every((model) => draft.defaultModel !== `${draft.provider.id}/${model}`)
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  const previousDefault = await deps.store.defaultModel()
  const previousSecret = await deps.credentials.getProviderCredential(draft.provider.id)
  const previousEntries = await deps.store.list()
  if (draft.editing === true) {
    if (previousEntries.every((entry) => entry.id !== draft.provider.id)) {
      throw new Error(UI_TEXT.actionFailed)
    }
    await deps.store.replaceAll(
      previousEntries.map((entry) => (entry.id === draft.provider.id ? draft.provider : entry)),
    )
  } else {
    await deps.store.add(draft.provider)
  }
  let isComposerSet = false
  try {
    if (secret !== '') {
      await deps.credentials.setProviderCredential(draft.provider.id, {
        v: 1,
        auth: draft.credentialAuth === 'oauth' ? 'apiKey' : draft.credentialAuth,
        origin,
        secret,
      })
    }
    await deps.store.setDefaultModel(draft.defaultModel)
    if (draft.useNow) {
      await deps.setComposerModel(draft.defaultModel)
      isComposerSet = true
    }
  } catch (error) {
    await deps.store.replaceAll(previousEntries)
    if (previousSecret === undefined) {
      await deps.credentials.clearProviderCredential(draft.provider.id)
    } else {
      await deps.credentials.setProviderCredential(draft.provider.id, previousSecret)
    }
    await deps.store.setDefaultModel(previousDefault)
    throw error
  }
  return {
    providerId: draft.provider.id,
    modelRef: draft.defaultModel,
    composerSet: isComposerSet,
    sessionBudgetUsd: draft.sessionBudgetUsd,
  }
}
