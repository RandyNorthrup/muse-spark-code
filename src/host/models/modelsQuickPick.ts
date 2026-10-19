import { Usd, usdInputSchema, type UsdAmount } from '../../shared/usd'
// The quick-pick fast path (M95 lane K, PLAN.md D74, M95 step 8): **Muse
// Spark: Add Model Provider…** runs the same flow as the panel wizard
// without the panel: pick a provider, enter or connect the credential,
// test, pick models, confirm. Cancelling at any step writes nothing: the
// draft lives in this runner's memory, and only the final confirm saves.

import { UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { modelLimitsSchema } from '../../shared/providerRouting'
import type { PickItem } from '../commands/pickItem'
import type { PresetInfo, ProviderEntry, ProviderModelRow } from '../providers/providerPorts'
import type { ProvidersHost } from '../providers/providersHost'
import { scannedLocalModelLimits, type WizardDraft } from '../providers/wizardSave'
import { type SessionBudgetConfig } from './sessionBudget'

export interface ProviderQuickPickUi {
  /** One choice from a list; undefined when dismissed. */
  readonly pickOne: (
    items: readonly PickItem[],
    title: string,
    placeholder: string,
  ) => Promise<string | undefined>
  /** Any number of choices; undefined when dismissed. */
  readonly pickMany: (
    items: readonly (PickItem & { readonly picked: boolean })[],
    title: string,
    placeholder: string,
  ) => Promise<readonly string[] | undefined>
  /** Free text; undefined when dismissed. */
  readonly inputText: (options: {
    readonly title: string
    readonly placeholder: string
    readonly value?: string | undefined
    readonly validate?: ((value: string) => string | undefined) | undefined
  }) => Promise<string | undefined>
  /** The save summary with who receives the code; false when dismissed. */
  readonly confirmSave: (title: string, detail: string) => Promise<boolean>
  readonly showError: (message: string) => void
  readonly showNotice: (message: string) => void
}

export interface ProviderQuickPickDeps {
  readonly providers: ProvidersHost
  readonly isRemote: boolean
  readonly ui: ProviderQuickPickUi
  /**
  The conversation spending limit setting: the budget answer below is
  prefilled with its effective value and, when changed, written back at
  its scope through the shared wizard function. Backed by VS Code's
  configuration in production, by memory in tests.
  */
  readonly sessionBudget: SessionBudgetConfig
}

export interface ProviderQuickPickOutcome {
  readonly providerId: string
  readonly modelRef: string
  /** The wizard's budget answer, as saved to the spending-limit setting. */
  readonly sessionBudgetUsd: UsdAmount | undefined
}

function providerItem(preset: PresetInfo): PickItem {
  return {
    id: preset.id,
    label: preset.name,
    description: preset.description,
    detail: preset.origin === '' ? UI_TEXT.providerFields.address : preset.origin,
  }
}

function parseBudgetUsd(value: string): UsdAmount | undefined {
  const parsed = usdInputSchema.safeParse(value.trim().replace(',', '.'))
  return parsed.success ? parsed.data : undefined
}

/** A positive whole token count, or undefined for anything else. */
function parseTokenCount(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return undefined
  }
  const count = Number(trimmed)
  return Number.isSafeInteger(count) && count > 0 ? count : undefined
}

/**
Asks one token count, re-asking after an invalid answer until the user
answers validly or dismisses. `max` caps the longest reply at the window.
*/
async function askTokenCount(
  ui: ProviderQuickPickUi,
  title: string,
  value: string | undefined,
  max: number | undefined,
): Promise<number | undefined> {
  for (;;) {
    const answer = await ui.inputText({
      title,
      placeholder: UI_TEXT.customLimitsTokensPlaceholder,
      ...(value !== undefined && { value }),
      validate: (candidate) =>
        parseTokenCount(candidate) === undefined ? UI_TEXT.customLimitsInvalid : undefined,
    })
    if (answer === undefined) {
      return undefined
    }
    const count = parseTokenCount(answer)
    if (count === undefined) {
      continue
    }
    if (max !== undefined && count > max) {
      ui.showError(UI_TEXT.customLimitsOutputCap)
      continue
    }
    return count
  }
}

/**
The address as the key-stored note shows it: the URL's origin, or the raw
address when the URL parser itself rejects it (`TypeError`). Anything
else still throws.
*/
export function originOf(address: string): string {
  try {
    return new URL(address).origin
  } catch (error: unknown) {
    if (error instanceof TypeError) return address
    throw error
  }
}

/**
Adds one provider through the quick pick. The outcome, or undefined when
cancelled at any step (nothing written).
*/
export async function runAddProviderQuickPick(
  deps: ProviderQuickPickDeps,
): Promise<ProviderQuickPickOutcome | undefined> {
  const { providers, ui } = deps
  const items: PickItem[] = []
  for (const id of providers.presetIds()) {
    const preset = providers.preset(id)
    if (preset !== undefined) {
      items.push(providerItem(preset))
    }
  }
  const picked = await ui.pickOne(
    items,
    UI_TEXT.wizardPickProvider,
    UI_TEXT.providerSearchPlaceholder,
  )
  if (picked === undefined) {
    return undefined
  }
  const preset = providers.preset(picked)
  if (preset === undefined) {
    return undefined
  }
  // The prefilled form: the preset's address, or the user's own where the
  // preset allows it (Azure's resource, a custom server, a local port).
  let address = preset.origin
  if (address === '') {
    const entered = await ui.inputText({
      title: UI_TEXT.providerFields.address,
      placeholder: 'https://…',
      validate: (value) =>
        value.trim() === '' ? fill(UI_TEXT.providerAddressInvalid, { detail: value }) : undefined,
    })
    if (entered === undefined || entered.trim() === '') {
      return undefined
    }
    address = entered.trim()
  }
  const addressVerdict = await providers.confirmAddress(address)
  if (addressVerdict.kind === 'refused') {
    ui.showError(fill(UI_TEXT.providerAddressInvalid, { detail: address }))
    return undefined
  }
  // The credential: connect, paste, or nothing for a local server.
  let credential: string | undefined
  let credentialAuth: WizardDraft['credentialAuth'] = 'apiKey'
  let wasKeyKept = false
  try {
    if (preset.auth !== 'none') {
      if (preset.id === 'openrouter' && preset.connectLabel !== undefined) {
        const method = await ui.pickOne(
          [
            { id: 'connect', label: preset.connectLabel },
            { id: 'paste', label: UI_TEXT.enterKey },
          ],
          fill(UI_TEXT.providerConnect, { provider: preset.name }),
          preset.keyHint,
        )
        if (method === undefined) {
          return undefined
        }
        if (method === 'connect') {
          const connection = await providers.connectOpenRouter(deps.isRemote)
          if (connection === undefined) {
            return undefined
          }
          credential = connection.key
          credentialAuth = 'oauth'
        }
      }
      if (credential === undefined) {
        const pasted = await providers.promptForKey({ ...preset, origin: new URL(address).origin })
        if (pasted === undefined) {
          return undefined
        }
        credential = pasted
      }
    }
    const providerId = preset.id
    let customFormat: ProviderEntry['format']
    if (preset.id === 'custom') {
      const choice = await ui.pickOne(
        [
          { id: 'chat', label: UI_TEXT.wireFormats.chat },
          { id: 'responses', label: UI_TEXT.wireFormats.responses },
          { id: 'anthropic', label: UI_TEXT.wireFormats.anthropic },
        ],
        UI_TEXT.providerFields.provider,
        UI_TEXT.providerSearchPlaceholder,
      )
      if (choice !== 'chat' && choice !== 'responses' && choice !== 'anthropic') {
        return undefined
      }
      customFormat = choice
    }
    const entry: ProviderEntry = {
      id: providerId,
      preset: preset.id,
      address,
      auth: preset.auth,
      models: [],
      ...(customFormat !== undefined && { format: customFormat }),
      ...(addressVerdict.kind === 'private' && { privateNetwork: true }),
    }
    // The free check, or the one-token cost stated and asked first.
    if (credential !== undefined) {
      const tested = await providers.testCredential(entry, credential)
      if (tested.kind === 'failed') {
        ui.showError(fill(UI_TEXT.providerTestFailed, { detail: tested.detail }))
        return undefined
      }
      if (tested.kind === 'paid') {
        ui.showNotice(fill(UI_TEXT.providerTestPaid, { cost: tested.cost }))
      } else {
        ui.showNotice(plural(UI_TEXT.providerKeyWorks, tested.models))
      }
    }
    // The models: the scan fills the table, the suggestion ticks the default.
    const scanned = await providers.scanDraft(entry, credential)
    if (scanned.rows.length === 0) {
      ui.showError(fill(UI_TEXT.scanFailed, { detail: providerId }))
      return undefined
    }
    const suggested = providers.suggestDefaultModel(scanned.rows)
    const ticked = await ui.pickMany(
      scanned.rows.map((row: ProviderModelRow) => ({
        id: row.id,
        label: row.label,
        picked: suggested?.value === row.id,
      })),
      UI_TEXT.providerFields.models,
      UI_TEXT.modelsSearchPlaceholder,
    )
    if (ticked === undefined || ticked.length === 0) {
      return undefined
    }
    // A custom server saves every chosen model's limits (the production file
    // rejects the entry without them): the scan fills what it reports, the
    // user answers the rest. Dismissing writes nothing.
    let modelLimits: ProviderEntry['modelLimits']
    if (preset.id === 'custom') {
      const limits: Record<string, { contextTokens: number; outputTokens: number }> = {}
      for (const id of ticked) {
        const row = scanned.rows.find((candidate) => candidate.id === id)
        const known = row?.context === undefined ? undefined : String(row.context)
        const contextTokens = await askTokenCount(
          ui,
          `${UI_TEXT.customLimitsContext} (${id})`,
          known,
          undefined,
        )
        if (contextTokens === undefined) {
          return undefined
        }
        const outputTokens = await askTokenCount(
          ui,
          `${UI_TEXT.customLimitsOutput} (${id})`,
          undefined,
          contextTokens,
        )
        if (outputTokens === undefined) {
          return undefined
        }
        limits[id] = { contextTokens, outputTokens }
      }
      modelLimits = limits
    }
    // A local server's report is its only window (C-M95-4 R3): the scan
    // fills what it reports, the user answers the rest. Custom servers are
    // covered above. Dismissing writes nothing.
    if (entry.auth === 'none' && preset.id !== 'custom') {
      const scannedWindows = scannedLocalModelLimits(entry.auth, ticked, scanned.rows) ?? {}
      const localLimits: Record<string, { contextTokens: number; outputTokens: number }> = {
        ...scannedWindows,
      }
      for (const id of ticked) {
        const entered = await ui.inputText({
          title: `${UI_TEXT.localContextWindow}: ${id}`,
          placeholder: UI_TEXT.localContextWindowHint,
          value: localLimits[id]?.contextTokens.toString(),
          validate: (value) =>
            modelLimitsSchema.shape.contextTokens.safeParse(Number(value)).success
              ? undefined
              : UI_TEXT.localContextWindowInvalid,
        })
        if (entered === undefined) return undefined
        const parsed = modelLimitsSchema.shape.contextTokens.safeParse(Number(entered))
        if (!parsed.success) {
          ui.showError(UI_TEXT.localContextWindowInvalid)
          return undefined
        }
        localLimits[id] = { contextTokens: parsed.data, outputTokens: parsed.data }
      }
      modelLimits = localLimits
    }
    // OpenRouter's privacy routing (D74: private by default) is the panel's
    // choice (lane M renders it from `privacyChoices`); the quick pick keeps
    // the default until lane P's file holds the routing. Noted in m95-k.md.
    // The suggestions, each with its reason: Accept or Change.
    let defaultModel = suggested?.value ?? ticked[0] ?? ''
    if (suggested !== undefined) {
      const choice = await ui.pickOne(
        [
          {
            id: 'accept',
            label: `${UI_TEXT.suggestionAccept}: ${suggested.value}`,
            description: suggested.reason,
          },
          { id: 'change', label: UI_TEXT.suggestionChange },
        ],
        UI_TEXT.suggestDefaultModel,
        suggested.reason,
      )
      if (choice === undefined) {
        return undefined
      }
      if (choice === 'change') {
        const changed = await ui.pickOne(
          ticked.map((id) => ({ id, label: id })),
          UI_TEXT.suggestDefaultModel,
          UI_TEXT.modelsSearchPlaceholder,
        )
        if (changed === undefined) {
          return undefined
        }
        defaultModel = changed
      }
    }
    // The spending limit IS the conversation spending limit setting: the
    // field is prefilled with its effective value, and the typed number
    // counts. Dismissing writes nothing, as at every earlier step.
    const budgetState = deps.sessionBudget.read()
    const budgetScope =
      budgetState.scope === 'workspace'
        ? UI_TEXT.sessionBudgetScopeWorkspace
        : UI_TEXT.sessionBudgetScopeGlobal
    let sessionBudgetUsd: UsdAmount | undefined
    for (;;) {
      const entered = await ui.inputText({
        title: UI_TEXT.wizardSessionBudget,
        placeholder: fill(UI_TEXT.wizardSessionBudgetNow, {
          amount: formatUsd(budgetState.effectiveUsd),
          scope: budgetScope,
        }),
        value: budgetState.effectiveUsd,
        validate: (candidate) =>
          parseBudgetUsd(candidate) === undefined ? UI_TEXT.wizardSessionBudgetInvalid : undefined,
      })
      if (entered === undefined) {
        return undefined
      }
      const parsed = parseBudgetUsd(entered)
      if (parsed === undefined) {
        ui.showError(UI_TEXT.wizardSessionBudgetInvalid)
        continue
      }
      sessionBudgetUsd =
        Usd.from(parsed).compare(Usd.from(budgetState.effectiveUsd)) === 0 ? undefined : parsed
      break
    }
    const modelRef = `${providerId}/${defaultModel}`
    const origin = originOf(address)
    const isConfirmed = await ui.confirmSave(
      UI_TEXT.saveProvider,
      [fill(UI_TEXT.keyStoredNote, { origin }), `${preset.name} · ${modelRef}`].join('\n'),
    )
    if (!isConfirmed) {
      return undefined
    }
    let outcome = await providers.saveDraft(
      {
        provider: {
          ...entry,
          models: [...ticked],
          ...(modelLimits !== undefined && { modelLimits }),
        },
        credential,
        credentialAuth,
        defaultModel: modelRef,
        sessionBudgetUsd,
        useNow: true,
      },
      { config: deps.sessionBudget, expectedUsd: budgetState.effectiveUsd },
    )
    wasKeyKept =
      outcome.failedStep === undefined ||
      outcome.receipts?.includes(UI_TEXT.providerKeySaved) === true
    while (outcome.budget?.status === 'conflict') {
      const isConfirmed = await ui.confirmSave(UI_TEXT.wizardSessionBudget, outcome.budget.error)
      if (!isConfirmed) break
      const currentProviders = await providers.providers()
      const current = currentProviders.find((provider) => provider.id === providerId)
      if (current === undefined) throw new Error(UI_TEXT.providerEditConflict)
      outcome = await providers.saveDraft(
        {
          provider: current,
          ...(outcome.receipts !== undefined && { receipts: outcome.receipts }),
          credentialAuth,
          editSnapshot: { provider: current, credential: undefined, defaultModel: undefined },
          defaultModel: modelRef,
          setDefault: false,
          sessionBudgetUsd,
          useNow: true,
          editing: true,
        },
        { config: deps.sessionBudget, expectedUsd: outcome.budget.effectiveUsd },
      )
    }
    if (outcome.notice !== undefined) {
      ui.showError(outcome.notice)
      return undefined
    }
    if (outcome.composerSet) {
      ui.showNotice(fill(UI_TEXT.setupComplete, { provider: preset.name, model: outcome.modelRef }))
    }
    return {
      providerId: outcome.providerId,
      modelRef: outcome.modelRef,
      sessionBudgetUsd: outcome.sessionBudgetUsd,
    }
  } finally {
    if (credentialAuth === 'oauth' && !wasKeyKept) providers.discardOpenRouterKey()
  }
}
