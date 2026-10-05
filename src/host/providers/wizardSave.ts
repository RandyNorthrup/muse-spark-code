// Saving the wizard (M95 lane K, PLAN.md D74, M95 acceptance 19 and the
// Tests' first-run items): the draft lives in memory only while the wizard
// runs. **Save** writes `providers.json` and the secret together, sets the
// default model and asks the conversation to set the composer's model;
// **Cancel** discards the draft, so nothing is written.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { CredentialStore } from '../auth/credentialStore'
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
  readonly sessionBudgetUsd?: number | undefined
  /** Save and use now: the conversation's model is set too. */
  readonly useNow: boolean
}

export interface WizardSaveDeps {
  readonly store: ProvidersStore
  readonly credentials: CredentialStore
  readonly policy: AddressPolicy
  /** Asks the conversation to set the composer's model (its own refusal stands). */
  readonly setComposerModel: (modelRef: string) => Promise<void>
}

export interface WizardSaveOutcome {
  readonly providerId: string
  readonly modelRef: string
  /** Whether the conversation took the composer's model. */
  readonly composerSet: boolean
  readonly sessionBudgetUsd: number | undefined
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
    draft.provider.presetId.trim() === '' ||
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
  let origin: string
  try {
    origin = new URL(draft.provider.address).origin
  } catch {
    throw new Error(fill(UI_TEXT.providerAddressInvalid, { detail: draft.provider.address }))
  }
  const secret = (draft.credential ?? '').trim()
  await deps.store.add(draft.provider)
  if (secret !== '') {
    await deps.credentials.setProviderCredential(draft.provider.id, {
      v: 1,
      auth: draft.credentialAuth,
      origin,
      secret,
    })
  }
  await deps.store.setDefaultModel(draft.defaultModel)
  let isComposerSet = false
  if (draft.useNow) {
    try {
      await deps.setComposerModel(draft.defaultModel)
      isComposerSet = true
    } catch {
      isComposerSet = false
    }
  }
  return {
    providerId: draft.provider.id,
    modelRef: draft.defaultModel,
    composerSet: isComposerSet,
    sessionBudgetUsd: draft.sessionBudgetUsd,
  }
}
