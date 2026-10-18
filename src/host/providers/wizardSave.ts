import { type UsdAmount } from '../../shared/usd'
// Saving the wizard (M95 lane K, PLAN.md D74, M95 acceptance 19 and the
// Tests' first-run items): the draft lives in memory only while the wizard
// runs. **Save** validates first, then writes the provider, entered key,
// chosen default, edited spending limit and requested composer model in order;
// **Cancel** discards the draft, so nothing is written.

import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { modelLimitsSchema, pruneModelLimits } from '../../shared/providerRouting'
import { redactSecrets } from '../../shared/redact'
import {
  applyWizardSessionBudget,
  validateWizardSessionBudget,
  type SessionBudgetConfig,
  type SessionBudgetApplyOutcome,
} from '../models/sessionBudget'
import type {
  CredentialRecord,
  ProviderCredentialStore as CredentialStore,
} from './credentialRecords'
import type {
  AddressPolicy,
  ProviderEntry,
  ProviderModelRow,
  ProvidersStore,
} from './providerPorts'

/** The wizard's in-memory draft: never written until Save. */
export interface WizardDraft {
  readonly provider: ProviderEntry
  /** The entered key; absent for no-auth servers or an untouched edit key. */
  readonly credential?: string | undefined
  /** How the credential was obtained (a pasted key or an OAuth connect). */
  readonly credentialAuth: 'apiKey' | 'oauth' | 'subscription'
  /** The model's qualified reference (`<providerId>/<modelId>`). */
  readonly defaultModel: string
  /** False for an edit whose stored default was not explicitly changed. */
  readonly setDefault?: boolean
  /** A session budget the suggestion accepted, for M82's seam when it lands. */
  readonly sessionBudgetUsd?: UsdAmount | undefined
  /** Save and use now: the conversation's model is set too. */
  readonly useNow: boolean
  readonly editing?: boolean
  /** Host-only completed writes carried by a confirmed budget retry. */
  readonly receipts?: readonly string[]
  /** Host-only opening values; a cached credential is not an entered replacement. */
  readonly editSnapshot?: {
    readonly provider: ProviderEntry
    readonly credential: CredentialRecord | undefined
    readonly defaultModel: string | undefined
  }
}

export interface WizardSaveDeps {
  readonly store: ProvidersStore
  readonly credentials: CredentialStore
  readonly policy: AddressPolicy
  /** Asks the conversation to set the composer's model (its own refusal stands). */
  readonly setComposerModel: (modelRef: string) => Promise<void>
  readonly sessionBudget?: {
    readonly config: SessionBudgetConfig
    readonly expectedUsd: UsdAmount | undefined
  }
  readonly isPrivateConfirmed?: (address: string) => boolean
}

export interface WizardSaveOutcome {
  /** Completed writes only, excluding failed/skipped steps; reusable on a budget retry. */
  readonly receipts?: readonly string[]
  /** Completed, failed and skipped steps; absent only on full success. */
  readonly notice?: string
  readonly failedStep?: 'credential' | 'default' | 'budget' | 'composer'
  readonly budget?: SessionBudgetApplyOutcome
  readonly providerId: string
  readonly modelRef: string
  /** Whether the conversation took the composer's model. */
  readonly composerSet: boolean
  readonly sessionBudgetUsd: UsdAmount | undefined
}

function editedValue<T>(initial: T, desired: T, current: T): T {
  if (JSON.stringify(initial) === JSON.stringify(desired)) return current
  if (JSON.stringify(initial) !== JSON.stringify(current)) {
    throw new Error(UI_TEXT.providerEditConflict)
  }
  return desired
}

/** Compare each edited leaf, retaining the latest value for untouched leaves. */
function editedProvider(
  initial: ProviderEntry,
  desired: ProviderEntry,
  current: ProviderEntry,
): ProviderEntry {
  const limits = { ...current.modelLimits }
  const desiredLimits = Object.entries(desired.modelLimits ?? {})
  for (const [model, wanted] of desiredLimits) {
    const before = initial.modelLimits?.[model]
    if (JSON.stringify(before) === JSON.stringify(wanted)) continue
    const now = current.modelLimits?.[model]
    limits[model] = {
      contextTokens:
        editedValue(before?.contextTokens, wanted.contextTokens, now?.contextTokens) ??
        wanted.contextTokens,
      outputTokens:
        editedValue(before?.outputTokens, wanted.outputTokens, now?.outputTokens) ??
        wanted.outputTokens,
    }
  }
  if (
    initial.routing !== undefined &&
    current.routing === undefined &&
    JSON.stringify(desired.routing) !== JSON.stringify(initial.routing)
  ) {
    throw new Error(UI_TEXT.providerEditConflict)
  }
  return {
    ...current,
    address: editedValue(initial.address, desired.address, current.address),
    auth: editedValue(initial.auth, desired.auth, current.auth),
    models: editedValue(initial.models, desired.models, current.models),
    ...(desired.format !== initial.format && {
      format: editedValue(initial.format, desired.format, current.format),
    }),
    ...(desired.privateNetwork !== initial.privateNetwork && {
      privateNetwork: editedValue(
        initial.privateNetwork,
        desired.privateNetwork,
        current.privateNetwork,
      ),
    }),
    ...(JSON.stringify(desired.modelLimits) !== JSON.stringify(initial.modelLimits) && {
      modelLimits: limits,
    }),
    ...(JSON.stringify(desired.routing) !== JSON.stringify(initial.routing) && {
      routing: {
        ...current.routing,
        privacy:
          editedValue(
            initial.routing?.privacy,
            desired.routing?.privacy,
            current.routing?.privacy,
          ) ??
          desired.routing?.privacy ??
          'zdr',
        ...(desired.routing?.order !== initial.routing?.order && {
          order: editedValue(
            initial.routing?.order,
            desired.routing?.order,
            current.routing?.order,
          ),
        }),
        ...(desired.routing?.allowFallbacks !== initial.routing?.allowFallbacks && {
          allowFallbacks: editedValue(
            initial.routing?.allowFallbacks,
            desired.routing?.allowFallbacks,
            current.routing?.allowFallbacks,
          ),
        }),
      },
    }),
  }
}

/**
 * Validates before writing; later failures return an honest partial outcome.
 * Completed writes stay saved. No compensating writes or inverse recovery.
 *
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
  if (
    provider.auth !== 'none' &&
    (draft.credential ?? '').trim() === '' &&
    (draft.editSnapshot === undefined || draft.credential !== undefined)
  ) {
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
  if (
    (draft.setDefault !== false || draft.useNow) &&
    provider.models.every((model) => draft.defaultModel !== `${provider.id}/${model}`)
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  deps.store.validate(
    provider,
    draft.setDefault !== false || draft.useNow ? draft.defaultModel : undefined,
  )
  const budgetInvalid = validateWizardSessionBudget(
    draft.sessionBudgetUsd,
    deps.sessionBudget?.expectedUsd,
  )
  if (
    budgetInvalid !== undefined ||
    (draft.sessionBudgetUsd !== undefined && deps.sessionBudget === undefined)
  ) {
    throw new Error(UI_TEXT.wizardSessionBudgetInvalid)
  }
  const previousDefault = await deps.store.defaultModel()
  const previousSecret = await deps.credentials.getProviderCredential(provider.id)
  const snapshot = draft.editSnapshot
  if (snapshot !== undefined) {
    if (secret !== '' && JSON.stringify(previousSecret) !== JSON.stringify(snapshot.credential)) {
      throw new Error(UI_TEXT.providerEditConflict)
    }
    if (draft.setDefault !== false) {
      editedValue(snapshot.defaultModel, draft.defaultModel, previousDefault)
    }
  }

  const previousEntries = await deps.store.list()
  if (draft.editing === true) {
    if (previousEntries.every((entry) => entry.id !== provider.id)) {
      throw new Error(UI_TEXT.actionFailed)
    }
    const previous = previousEntries.find((entry) => entry.id === provider.id)
    if (JSON.stringify(snapshot?.provider ?? previous) !== JSON.stringify(provider)) {
      await deps.store.replaceAll((entries) => {
        if (entries.every((entry) => entry.id !== provider.id)) {
          throw new Error(UI_TEXT.providerEditConflict)
        }
        return entries.map((entry) => {
          if (entry.id !== provider.id) return entry
          return snapshot === undefined
            ? provider
            : editedProvider(snapshot.provider, provider, entry)
        })
      })
    }
  } else {
    await deps.store.add(provider)
  }
  let isComposerSet = false
  let budget: SessionBudgetApplyOutcome | undefined
  let step: 'credential' | 'default' | 'budget' | 'composer' = 'credential'
  const receipts = [...new Set([...(draft.receipts ?? []), UI_TEXT.providerSaved])]
  let notice: string | undefined
  try {
    if (
      secret !== '' &&
      (previousSecret?.secret !== secret ||
        previousSecret.origin !== origin ||
        previousSecret.auth !==
          (draft.credentialAuth === 'oauth' ? 'apiKey' : draft.credentialAuth))
    ) {
      if (
        snapshot !== undefined &&
        JSON.stringify(await deps.credentials.getProviderCredential(provider.id)) !==
          JSON.stringify(previousSecret)
      )
        throw new Error(UI_TEXT.providerEditConflict)
      await deps.credentials.setProviderCredential(provider.id, {
        v: 1,
        auth: draft.credentialAuth === 'oauth' ? 'apiKey' : draft.credentialAuth,
        origin,
        secret,
      })
      receipts.push(UI_TEXT.providerKeySaved)
    }
    step = 'default'
    if (draft.setDefault !== false && draft.defaultModel !== previousDefault) {
      await deps.store.setDefaultModel(
        draft.defaultModel,
        snapshot === undefined ? undefined : { value: snapshot.defaultModel },
      )
      receipts.push(UI_TEXT.providerDefaultSaved)
    }
    step = 'budget'
    if (deps.sessionBudget !== undefined) {
      budget = await applyWizardSessionBudget(
        draft.sessionBudgetUsd,
        deps.sessionBudget.config,
        deps.sessionBudget.expectedUsd,
      )
      if (budget.status === 'failed' || budget.status === 'conflict') throw new Error(budget.error)
      if (budget.status === 'written') receipts.push(UI_TEXT.providerBudgetSaved)
    }
    step = 'composer'
    if (draft.useNow) {
      await deps.setComposerModel(draft.defaultModel)
      isComposerSet = true
    }
  } catch (error) {
    const detail = redactSecrets(
      error instanceof Error && error.message !== '' ? error.message : UI_TEXT.actionFailed,
      [secret, previousSecret?.secret ?? ''].filter((value) => value !== ''),
    )
    if (budget?.status === 'conflict' || budget?.status === 'failed')
      budget = { ...budget, error: detail }
    const failureText = {
      credential: UI_TEXT.providerKeySaveFailed,
      default: UI_TEXT.providerDefaultSaveFailed,
      budget: UI_TEXT.sessionBudgetPartialSave,
      composer: UI_TEXT.providerComposerSaveFailed,
    }[step]
    const messages = [...receipts, fill(failureText, { detail })]
    if (
      step === 'credential' &&
      draft.setDefault !== false &&
      draft.defaultModel !== previousDefault
    )
      messages.push(UI_TEXT.providerDefaultSkipped)
    if ((step === 'credential' || step === 'default') && draft.sessionBudgetUsd !== undefined)
      messages.push(UI_TEXT.providerBudgetSkipped)
    if (step !== 'composer' && draft.useNow) messages.push(UI_TEXT.providerComposerSkipped)
    notice = messages.join(' ')
  }
  return {
    receipts,
    providerId: provider.id,
    modelRef: draft.defaultModel,
    composerSet: isComposerSet,
    sessionBudgetUsd: draft.sessionBudgetUsd,
    ...(notice !== undefined && { notice, failedStep: step }),
    ...(budget !== undefined && { budget }),
  }
}
