import { type UsdAmount } from '../../shared/usd'
// Saving the wizard (M95 lane K, PLAN.md D74, M95 acceptance 19 and the
// Tests' first-run items): the draft lives in memory only while the wizard
// runs. **Save** writes `providers.json` and the secret together, sets the
// default model and asks the conversation to set the composer's model;
// **Cancel** discards the draft, so nothing is written.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { modelLimitsSchema, pruneModelLimits } from '../../shared/providerRouting'
import type { ProviderCredentialStore as CredentialStore } from './credentialRecords'
import type {
  AddressPolicy,
  ProviderEntry,
  ProviderModelRow,
  ProvidersStore,
} from './providerPorts'

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
 * The scanned windows a save carries into `providers.json` (C-M95-4 R3):
 * every saved local model keeps its server's reported window in
 * `modelLimits`, so the request path never meets a missing window. The
 * server reports no separate output cap, so output is bounded by the
 * window. Undefined when nothing was carried (a keyed provider, whose
 * catalogue owns its windows, or no scanned window for a saved model).
 */
export function scannedLocalModelLimits(
  auth: ProviderEntry['auth'],
  ids: readonly string[],
  rows: readonly ProviderModelRow[],
): Record<string, { readonly contextTokens: number; readonly outputTokens: number }> | undefined {
  if (auth !== 'none') return undefined
  const byId = new Map(rows.map((row) => [row.id, row]))
  const limits: Record<string, { contextTokens: number; outputTokens: number }> = {}
  for (const id of ids) {
    const context = byId.get(id)?.context
    if (context !== undefined && Number.isSafeInteger(context) && context > 0)
      limits[id] = { contextTokens: context, outputTokens: context }
  }
  return Object.keys(limits).length > 0 ? limits : undefined
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
  // C-M95-4 R5: limits exist only for ticked models. The save keeps limits
  // for models in the list and drops the rest, so an unticked model's
  // manual window never reaches the file (a later re-tick scans afresh).
  const provider: ProviderEntry = {
    ...draft.provider,
    modelLimits: pruneModelLimits(draft.provider.models, draft.provider.modelLimits),
  }
  if (
    provider.auth === 'none' &&
    provider.models.some((id) => !modelLimitsSchema.safeParse(provider.modelLimits?.[id]).success)
  )
    throw new Error(fill(UI_TEXT.localModelWindowUnknown, { model: draft.defaultModel }))
  if (
    provider.id.trim() === '' ||
    provider.preset.trim() === '' ||
    provider.address.trim() === '' ||
    draft.defaultModel.trim() === ''
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  if (provider.auth !== 'none' && (draft.credential ?? '').trim() === '') {
    throw new Error(fill(UI_TEXT.providerNeedsKey, { id: provider.id }))
  }
  const address = await deps.policy.check(provider.address)
  if (address.kind === 'refused') {
    throw new Error(fill(UI_TEXT.providerAddressInvalid, { detail: address.detail }))
  }
  if (address.kind === 'private' && deps.isPrivateConfirmed?.(provider.address) !== true) {
    throw new Error(UI_TEXT.providerPrivateConfirm)
  }
  let origin: string
  try {
    origin = new URL(provider.address).origin
  } catch {
    throw new Error(fill(UI_TEXT.providerAddressInvalid, { detail: provider.address }))
  }
  const secret = (draft.credential ?? '').trim()
  if (provider.models.every((model) => draft.defaultModel !== `${provider.id}/${model}`)) {
    throw new Error(UI_TEXT.actionFailed)
  }
  const previousDefault = await deps.store.defaultModel()
  const previousSecret = await deps.credentials.getProviderCredential(provider.id)
  const previousEntries = await deps.store.list()
  if (draft.editing === true) {
    if (previousEntries.every((entry) => entry.id !== provider.id)) {
      throw new Error(UI_TEXT.actionFailed)
    }
    await deps.store.replaceAll(
      previousEntries.map((entry) => (entry.id === provider.id ? provider : entry)),
    )
  } else {
    await deps.store.add(provider)
  }
  let isComposerSet = false
  try {
    if (secret !== '') {
      await deps.credentials.setProviderCredential(provider.id, {
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
      await deps.credentials.clearProviderCredential(provider.id)
    } else {
      await deps.credentials.setProviderCredential(provider.id, previousSecret)
    }
    await deps.store.setDefaultModel(previousDefault)
    throw error
  }
  return {
    providerId: provider.id,
    modelRef: draft.defaultModel,
    composerSet: isComposerSet,
    sessionBudgetUsd: draft.sessionBudgetUsd,
  }
}
