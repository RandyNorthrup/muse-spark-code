// Lane M's strict bridge is shared by both sides. Credentials stay in this
// host-owned draft and never join state, exceptions, logs or postMessage.
import * as vscode from 'vscode'
import {
  MODELS_PANEL_VIEW_TYPE,
  MODELS_WEBVIEW_SCRIPT_FILE,
  MODELS_WEBVIEW_STYLE_FILE,
  PROVIDER_HARNESS_MIN_CONTEXT_TOKENS,
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
} from '../../shared/constants'
import {
  parsePanelToHostMessage,
  parseHostToPanelMessage,
  presetCardSchema,
  customFormatSchema,
  providerStateSchema,
  providerKeyUsageSchema,
  wizardStepSchema,
  type ModelsPanelState,
  type PanelDraft,
  type PanelToHostMessage,
  type HostToPanelMessage,
  type ModelRow,
  type ProviderTest,
} from '../../shared/modelsPanel'
import { buildWebviewHtml, createNonce } from '../html'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { modelLimitsSchema } from '../../shared/providerRouting'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'
import type { ImportPreview } from '../providers/importExport'
import type {
  ProviderEntry,
  PresetInfo,
  ProviderModelRow,
  KeyTestResult,
} from '../providers/providerPorts'
import type { ProvidersHost } from '../providers/providersHost'
import { isOriginBound, type CredentialRecord } from '../providers/credentialRecords'
import type { WizardSaveOutcome } from '../providers/wizardSave'
import type { ScanOutcome } from '../providers/modelScans'
import { OPENROUTER_ORIGIN, readOpenRouterPanelUsage } from '../backend/providersEntry'
import { Usd } from '../../shared/usd'
import { redactSecrets } from '../../shared/redact'
import { type SessionBudgetConfig } from './sessionBudget'

export interface ModelsPanelDeps {
  readonly connectChatGpt?: (() => Promise<void>) | undefined
  readonly connectCopilot?: (() => Promise<void>) | undefined
  readonly removeSubscription?: ((id: string) => Promise<void>) | undefined
  readonly isConfidential?: (() => boolean) | undefined
  readonly extensionUri: vscode.Uri
  readonly l10n: UiTable
  readonly log: Logger
  readonly providers: ProvidersHost
  /**
   * The conversation spending limit setting: read for the suggestions
   * step's prefill and written when the wizard's number changed. Backed by
   * VS Code's configuration in production, by memory in tests.
   */
  readonly sessionBudget: SessionBudgetConfig
  readonly isRemote?: boolean
  readonly writeExportFile: (text: string) => Promise<void>
  readonly readImportFile: () => Promise<string | undefined>
  readonly confirmImport: (preview: ImportPreview) => Promise<boolean>
  readonly onWizardSaved: (outcome: WizardSaveOutcome) => void
}
export interface ModelsPanelNavigate {
  readonly section?: string | undefined
  readonly presetId?: string | undefined
  readonly wizard?: boolean | undefined
}
export interface ModelsPanel {
  readonly reveal: (navigate?: ModelsPanelNavigate) => void
  readonly onDidDispose: (run: () => void) => vscode.Disposable
  readonly dispose: () => void
}
function modelPriceNote(model: ProviderModelRow): ModelRow['priceNote'] {
  switch (true) {
    case model.isLocal: {
      return 'local'
    }
    case model.isFree: {
      return 'free'
    }
    case model.priceFingerprint === 'plan': {
      return 'plan'
    }
    default: {
      return model.inputPerMillion === undefined ? 'unpriced' : 'priced'
    }
  }
}

function newDraft(preset?: PresetInfo, entry?: ProviderEntry): PanelDraft {
  // A local preset starts on its usual port (its own probe data), so the
  // configure step's **Local port** field is filled from the start.
  const loopbackProbe = preset?.kind === 'local' ? preset.localProbes[0] : undefined
  const format = customFormatSchema.safeParse(entry?.format)
  return {
    step: preset === undefined ? 'pick-provider' : 'configure',
    presetId: preset?.id,
    address:
      entry?.address ??
      (loopbackProbe === undefined
        ? preset?.origin
        : `http://${loopbackProbe.host}:${String(loopbackProbe.port)}`),
    ...(loopbackProbe !== undefined && { loopbackPort: loopbackProbe.port }),
    auth: entry?.auth ?? preset?.auth ?? 'apiKey',
    keyPresent: false,
    keyShapeOk: false,
    connected: false,
    costAccepted: false,
    models: [...(entry?.models ?? [])],
    ...(entry?.modelLimits !== undefined && { modelLimits: entry.modelLimits }),
    ...(format.success && { customFormat: format.data }),
    privacy: entry?.routing?.privacy ?? 'zdr',
    providerOrder: [...(entry?.routing?.order ?? [])],
    allowFallbacks: entry?.routing?.allowFallbacks ?? false,
    privateConfirmed: entry?.privateNetwork ?? false,
    privateAsked: false,
    errors: [],
    blockers: [],
  }
}
/** One panel and ordered host edits; a disposed tab discards its draft. */
export function createModelsPanel(deps: ModelsPanelDeps): ModelsPanel {
  const { providers, log } = deps
  const panel = vscode.window.createWebviewPanel(
    MODELS_PANEL_VIEW_TYPE,
    UI_TEXT.modelsPanelTitle,
    vscode.ViewColumn.One,
    { retainContextWhenHidden: true },
  )
  const root = vscode.Uri.joinPath(deps.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
  panel.webview.options = { enableScripts: true, localResourceRoots: [root] }
  panel.webview.html = buildWebviewHtml({
    scriptUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, MODELS_WEBVIEW_SCRIPT_FILE))
      .toString(),
    styleUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(root, MODELS_WEBVIEW_STYLE_FILE))
      .toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    l10n: deps.l10n,
  })
  const state: ModelsPanelState = {
    presets: [],
    providers: [],
    models: [],
    totalModels: 0,
    filter: {},
    sort: { key: 'name', direction: 'asc' },
    facets: { providers: [], families: [] },
    scans: {},
    suggestions: [],
    sessionBudget: { effectiveUsd: Usd.from(0).toAmount(), nowLine: '' },
    lastChoices: {},
    drafts: { edits: {} },
    pendingRemovals: [],
  }
  const credentials = new Map<string, { secret: string; origin: string }>()
  const rows = new Map<string, readonly ProviderModelRow[]>()
  const newModels = new Set<string>()
  // A failed limit write can leave a saved provider. Retrying that draft
  // replaces its saved entry rather than attempting a duplicate add.
  const savedDrafts = new WeakSet<PanelDraft>()
  // Token limits do not change the saved connection; only connection edits
  // invalidate this exemption from a fresh credential test.
  const savedConnections = new WeakSet<PanelDraft>()
  // Keep the entire stored entry on the host, including fields the form
  // does not expose. Only differences from this draft snapshot are saved.
  const editSnapshots = new WeakMap<
    PanelDraft,
    {
      entry: ProviderEntry
      fields: PanelDraft
      credential: CredentialRecord | undefined
    }
  >()
  const enteredCredentials = new WeakSet<PanelDraft>()
  let isDisposed = false
  const lifetime = new AbortController()
  let connectionRequest: AbortController | undefined
  let usageRequest: AbortController | undefined
  let navigation: ModelsPanelNavigate | undefined
  let operations = Promise.resolve()
  const post = (message: HostToPanelMessage): void => {
    if (isDisposed) {
      return
    }
    const parsed = parseHostToPanelMessage(message)
    if (!parsed.ok) {
      log.error('Models panel refused invalid host state')
      return
    }
    void panel.webview.postMessage(parsed.message)
  }
  const publish = (): void => {
    post({ type: 'modelsPanel/state', state })
  }
  const fail = (draft?: PanelDraft, error?: unknown): void => {
    // Exception text can contain a bare key even before it is retained.
    log.warn('Models panel operation failed')
    if (draft === undefined) {
      state.notice = UI_TEXT.actionFailed
    } else {
      // Save failures name their cause with every retained key redacted.
      state.notice = undefined
      draft.saveConflict = error instanceof Error && error.message === UI_TEXT.providerEditConflict
      draft.errors = [
        redactSecrets(
          error instanceof Error && error.message !== '' && error.message !== UI_TEXT.actionFailed
            ? error.message
            : UI_TEXT.providerSaveWriteConflict,
          Array.from(credentials.values(), (record) => record.secret),
        ),
      ]
    }
    publish()
  }
  const entryOf = async (id: string): Promise<ProviderEntry> => {
    const entries = await providers.providers()
    const entry = entries.find((candidate) => candidate.id === id)
    if (entry === undefined) {
      throw new Error(UI_TEXT.actionFailed)
    }
    return entry
  }
  const createEditDraft = async (id: string): Promise<PanelDraft> => {
    const existing = state.drafts.edits[id]
    if (existing !== undefined) return existing
    const entry = structuredClone(await entryOf(id))
    const draft = newDraft(providers.preset(entry.preset), entry)
    draft.defaultModel = await providers.defaultModel()
    draft.sessionBudgetExpectedUsd = deps.sessionBudget.read().effectiveUsd
    let secret: string | undefined
    let credential: CredentialRecord | undefined
    try {
      credential = await providers.credentialSnapshot(entry.id)
      if (entry.auth !== 'none' && entry.auth !== 'subscription') {
        if (credential !== undefined && !isOriginBound(credential, entry.address)) {
          throw new Error(UI_TEXT.importNeedsKey)
        }
        secret = credential?.secret
      }
    } catch {
      draft.errors = [UI_TEXT.importNeedsKey]
    }
    editSnapshots.set(draft, { entry, fields: structuredClone(draft), credential })
    if (secret !== undefined) {
      credentials.set(entry.id, { secret, origin: new URL(entry.address).origin })
      draft.keyPresent = true
      draft.keyShapeOk = true
    }
    if (secret !== undefined || entry.auth === 'none') savedConnections.add(draft)
    state.drafts.edits[id] = draft
    return draft
  }
  const draftOf = (id?: string): PanelDraft => {
    const draft = id === undefined ? state.drafts.wizard : state.drafts.edits[id]
    if (draft === undefined) {
      throw new Error(UI_TEXT.actionFailed)
    }
    return draft
  }
  const draftEntry = (draft: PanelDraft, id?: string): ProviderEntry => {
    const preset = providers.preset(draft.presetId ?? '')
    if (preset === undefined) {
      throw new Error(UI_TEXT.actionFailed)
    }
    // A custom entry saves only complete limits per chosen model; the
    // blockers below keep Save disabled until each one is valid, and the
    // production store rejects the entry if one is still missing.
    const modelLimits =
      preset.id === 'custom'
        ? Object.fromEntries(
            draft.models.flatMap(
              (model): [string, { contextTokens: number; outputTokens: number }][] => {
                const parsed = modelLimitsSchema.safeParse(draft.modelLimits?.[model])
                return parsed.success ? [[model, parsed.data]] : []
              },
            ),
          )
        : undefined
    const snapshot = editSnapshots.get(draft)
    if (snapshot !== undefined) {
      const base = snapshot.entry
      const initial = snapshot.fields
      const editedLimits = Object.fromEntries(
        Object.entries(modelLimits ?? {})
          .filter(
            ([model, limits]) =>
              JSON.stringify(limits) !== JSON.stringify(initial.modelLimits?.[model]),
          )
          .map(([model, limits]) => [
            model,
            {
              contextTokens:
                limits.contextTokens === initial.modelLimits?.[model]?.contextTokens
                  ? (base.modelLimits?.[model]?.contextTokens ?? limits.contextTokens)
                  : limits.contextTokens,
              outputTokens:
                limits.outputTokens === initial.modelLimits?.[model]?.outputTokens
                  ? (base.modelLimits?.[model]?.outputTokens ?? limits.outputTokens)
                  : limits.outputTokens,
            },
          ]),
      )
      const isOrderChanged =
        JSON.stringify(draft.providerOrder) !== JSON.stringify(initial.providerOrder)
      const isPrivacyChanged = draft.privacy !== initial.privacy
      const isFallbacksChanged = draft.allowFallbacks !== initial.allowFallbacks
      return {
        ...base,
        ...(draft.address !== initial.address && { address: draft.address ?? preset.origin }),
        ...(draft.auth !== initial.auth && { auth: draft.auth }),
        ...(draft.customFormat !== initial.customFormat && { format: draft.customFormat }),
        ...(JSON.stringify(draft.models) !== JSON.stringify(initial.models) && {
          models: draft.models,
        }),
        ...(JSON.stringify(draft.modelLimits) !== JSON.stringify(initial.modelLimits) && {
          modelLimits: { ...base.modelLimits, ...editedLimits },
        }),
        ...(preset.id === 'openrouter' &&
          (isPrivacyChanged || isOrderChanged || isFallbacksChanged) && {
            routing: {
              privacy: base.routing?.privacy ?? draft.privacy,
              ...base.routing,
              ...(isPrivacyChanged && { privacy: draft.privacy }),
              ...(isOrderChanged && { order: draft.providerOrder }),
              ...(isFallbacksChanged && { allowFallbacks: draft.allowFallbacks }),
            },
          }),
        ...(draft.privateConfirmed !== initial.privateConfirmed && {
          privateNetwork: draft.privateConfirmed,
        }),
      }
    }
    return {
      id: id ?? preset.id,
      preset: preset.id,
      address: draft.address ?? preset.origin,
      auth: draft.auth,
      models: draft.models,
      ...(modelLimits !== undefined && { modelLimits }),
      ...(draft.customFormat !== undefined && { format: draft.customFormat }),
      ...(preset.id === 'openrouter' && {
        routing: {
          privacy: draft.privacy,
          order: draft.providerOrder,
          allowFallbacks: draft.allowFallbacks,
        },
      }),
      privateNetwork: draft.privateConfirmed,
    }
  }
  /** Limits block Models and later steps; earlier steps must allow returning to their fields. */
  const syncCustomBlockers = (draft: PanelDraft, isSaving = false): void => {
    const rest = draft.blockers.filter((blocker) => blocker !== UI_TEXT.customLimitsMissing)
    const hasIncompleteLimits =
      draft.presetId === 'custom' &&
      (isSaving || !['pick-provider', 'configure', 'credential', 'test'].includes(draft.step)) &&
      draft.models.some((model) => !modelLimitsSchema.safeParse(draft.modelLimits?.[model]).success)
    draft.blockers = hasIncompleteLimits ? [...rest, UI_TEXT.customLimitsMissing] : rest
  }
  const syncDraftBlockers = (): void => {
    if (state.drafts.wizard !== undefined) {
      syncCustomBlockers(state.drafts.wizard)
    }
    for (const draft of Object.values(state.drafts.edits)) {
      syncCustomBlockers(draft, true)
    }
  }
  /** Why a subscription sign-in cannot start, or undefined when it can. */
  const subscriptionRefusal = (id: string): string | undefined => {
    if (id === 'chatgpt' && deps.connectChatGpt === undefined) {
      return UI_TEXT.signInNotOffered
    }
    if (id === 'chatgpt' && deps.isRemote === true) {
      return UI_TEXT.signInRemoteWindow
    }
    if (id === 'copilot' && deps.isConfidential?.() === true) {
      return UI_TEXT.planUi.copilotConfidential
    }
    return id === 'copilot' && deps.connectCopilot === undefined
      ? UI_TEXT.signInNotOffered
      : undefined
  }
  const draftSecret = (entry: ProviderEntry, id?: string): string | undefined => {
    const record = credentials.get(id ?? 'wizard')
    if (record !== undefined && record.origin !== new URL(entry.address).origin) {
      throw new Error(UI_TEXT.importNeedsKey)
    }
    return record?.secret
  }
  const refresh = async (): Promise<void> => {
    usageRequest?.abort()
    usageRequest = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, usageRequest.signal])
    // A failed credential/configuration read must not retain old key amounts.
    for (const row of state.providers) {
      if (row.presetId !== 'openrouter') {
        continue
      }

      row.keyUsage = undefined
      row.keyUsageError = UI_TEXT.providerUsageFailed
    }
    state.presets = providers.presetIds().flatMap((id) => {
      const preset = providers.preset(id)
      if (preset === undefined) {
        return []
      }
      const card = presetCardSchema.safeParse({
        id,
        label: preset.name,
        description: preset.description,
        category: id === 'custom' ? 'custom' : preset.kind,
        format: preset.format,
        originKind:
          preset.origin === '' ? (preset.kind === 'local' ? 'loopback' : 'custom') : 'fixed',
        originDisplay: preset.origin,
        auth: preset.auth,
        connectOAuth: preset.connectLabel !== undefined,
        keyHint: preset.keyHint,
        keyPage: preset.keyPage,
      })
      if (!card.success) {
        // One stale preset must not empty the whole dropdown. Preset data is
        // fixed and holds no key, so the log names the preset and its fields.
        const fields = card.error.issues.map((issue) => issue.path.join('.')).join(', ')
        log.warn(`Provider preset ${id} left out of the panel: ${fields}`)
        return []
      }
      return [card.data]
    })
    state.subscriptionsAvailable = deps.connectChatGpt !== undefined
    state.copilotAvailable = deps.connectCopilot !== undefined && deps.isConfidential?.() !== true
    state.remoteWindow = deps.isRemote === true
    state.confidentialWorkspace = deps.isConfidential?.() === true
    // The spending limit the suggestions step shows and prefills: what
    // enforcement reads today, with the one line naming its value and the
    // scope a change would be written at. The line is worded here, like
    // any error, so the lazy webview bundle does not carry its template.
    {
      const budget = deps.sessionBudget.read()
      state.sessionBudget = {
        effectiveUsd: budget.effectiveUsd,
        nowLine: fill(UI_TEXT.wizardSessionBudgetNow, {
          amount: formatUsd(budget.effectiveUsd),
          scope:
            budget.scope === 'workspace'
              ? UI_TEXT.sessionBudgetScopeWorkspace
              : UI_TEXT.sessionBudgetScopeGlobal,
        }),
      }
    }
    const providerStates = await providers.providerStates()
    state.providers = providerStates.flatMap(({ entry, hasKey, origin }) => {
      const preset = state.presets.find((candidate) => candidate.id === entry.preset)
      const info = providers.preset(entry.preset)
      if (preset === undefined) {
        // One stale card never hides a valid saved provider: the affected
        // row stays, marked unavailable with its reason. Names ids only.
        const label = info?.name ?? entry.id
        // Only a known wire format rides along; anything else stays absent.
        let infoFormat: 'responses' | 'chat' | 'anthropic' | 'gemini' | 'ollama' | undefined
        switch (info?.format) {
          case 'responses':
          case 'chat':
          case 'anthropic':
          case 'gemini':
          case 'ollama': {
            infoFormat = info.format
            break
          }
          default: {
            infoFormat = undefined
            break
          }
        }
        const parsed = providerStateSchema.safeParse({
          id: entry.id,
          presetId: entry.preset,
          unavailable: fill(UI_TEXT.providerPresetUnsupported, {
            provider: label,
            preset: entry.preset,
          }),
          label,
          address: entry.address,
          format: entry.format ?? infoFormat,
          auth: entry.auth,
          key: {
            state: hasKey ? 'stored' : 'missing',
            origin,
          },
          test: { status: 'untested' },
          models: [...entry.models],
          pinned: [...(entry.pinned ?? [])],
        })
        log.warn(`Provider ${entry.id} left out of the panel: ${entry.preset}`)
        return parsed.success ? [parsed.data] : []
      }
      const isBound = origin === undefined || origin === new URL(entry.address).origin
      return [
        {
          id: entry.id,
          presetId: entry.preset,
          label: preset.label,
          address: entry.address,
          format: entry.format ?? preset.format,
          auth: entry.auth,
          key: {
            state: hasKey ? (isBound ? 'stored' : 'needs-again') : 'missing',
            origin,
            actualOrigin: isBound ? undefined : new URL(entry.address).origin,
          },
          test: { status: 'untested' },
          models: [...entry.models],
          pinned: [...(entry.pinned ?? [])],
        },
      ]
    })
    for (const row of state.providers) {
      if (row.presetId !== 'openrouter') continue
      if (row.key.state !== 'stored') {
        row.keyUsageError = UI_TEXT.providerUsageFailed
        continue
      }
      row.keyUsage = undefined
      row.keyUsageError = undefined
      try {
        const entry = providerStates.find((item) => item.entry.id === row.id)?.entry
        if (entry === undefined) throw new Error(UI_TEXT.providerUsageFailed)
        row.keyUsage = providerKeyUsageSchema.parse(
          await readOpenRouterPanelUsage(entry, providers, signal),
        )
      } catch {
        row.keyUsageError = UI_TEXT.providerUsageFailed
      }
    }
    const all: ModelRow[] = []
    const families = new Map<string, string>()
    for (const [providerId, models] of rows) {
      if (providerId === 'copilot' && deps.isConfidential?.() === true) continue
      const saved = state.providers.find((entry) => entry.id === providerId)
      const draft = state.drafts.wizard?.presetId === providerId ? state.drafts.wizard : undefined
      for (const model of models) {
        if (model.family !== undefined) {
          families.set(`${providerId}/${model.id}`, model.family)
        }
        all.push({
          ref: `${providerId}/${model.id}`,
          providerId,
          modelId: model.id,
          label: model.label,
          toolCalling: model.toolCapable,
          vision: model.vision,
          reasoning: model.reasoning,
          contextTokens: model.context,
          inputPerMillion: model.inputPerMillion,
          outputPerMillion: model.outputPerMillion,
          cachedPerMillion: model.cachedPerMillion,
          recommended: model.recommended,
          serverless: model.serverless,
          isNew: newModels.has(`${providerId}/${model.id}`),
          freeOrLocal: model.isFree || model.isLocal,
          ticked: (saved?.models ?? draft?.models ?? []).includes(model.id),
          pinned: saved?.pinned.includes(model.id) ?? false,
          priceNote: modelPriceNote(model),
          badges: {
            recommended: false,
            cheapestCapable: false,
            largestContext: false,
            isNew: false,
          },
        })
      }
    }
    const capable = all.filter(
      (row) =>
        row.toolCalling &&
        (row.contextTokens ?? 0) >= PROVIDER_HARNESS_MIN_CONTEXT_TOKENS &&
        row.inputPerMillion !== undefined &&
        row.serverless !== false,
    )
    const cheapest =
      capable.length === 0 ? undefined : Math.min(...capable.map((row) => row.inputPerMillion ?? 0))
    const widest = Math.max(0, ...all.map((row) => row.contextTokens ?? 0))
    for (const row of all) {
      row.badges = {
        recommended: row.recommended === true,
        cheapestCapable: capable.includes(row) && row.inputPerMillion === cheapest,
        largestContext: (row.contextTokens ?? 0) > 0 && row.contextTokens === widest,
        isNew: row.isNew === true,
      }
    }
    state.totalModels = all.length
    state.facets = {
      providers: [...new Set(all.map((row) => row.providerId))],
      families: [...new Set(families.values())],
    }
    const filter = state.filter
    state.models = all.filter(
      (row) =>
        (filter.search === undefined ||
          `${row.ref} ${row.label ?? ''}`.toLowerCase().includes(filter.search.toLowerCase())) &&
        (filter.providerId === undefined || row.providerId === filter.providerId) &&
        (filter.family === undefined || families.get(row.ref) === filter.family) &&
        (filter.maxInputPerMillion === undefined ||
          (row.inputPerMillion ?? Infinity) <= filter.maxInputPerMillion) &&
        (filter.maxOutputPerMillion === undefined ||
          (row.outputPerMillion ?? Infinity) <= filter.maxOutputPerMillion) &&
        (filter.maxCachedPerMillion === undefined ||
          (row.cachedPerMillion ?? Infinity) <= filter.maxCachedPerMillion) &&
        (filter.toolCalling !== true || row.toolCalling) &&
        (filter.vision !== true || row.vision) &&
        (filter.reasoning !== true || row.reasoning) &&
        (filter.freeOrLocal !== true || row.freeOrLocal) &&
        (filter.contextMin === undefined || (row.contextTokens ?? 0) >= filter.contextMin) &&
        (filter.contextMax === undefined || (row.contextTokens ?? Infinity) <= filter.contextMax),
    )
    state.models.sort((left, right) => {
      let order = left.ref.localeCompare(right.ref)
      switch (state.sort.key) {
        case 'context': {
          order = (left.contextTokens ?? 0) - (right.contextTokens ?? 0)
          break
        }
        case 'input-price': {
          order = (left.inputPerMillion ?? Infinity) - (right.inputPerMillion ?? Infinity)
          break
        }
        case 'output-price': {
          order = (left.outputPerMillion ?? Infinity) - (right.outputPerMillion ?? Infinity)
          break
        }
        case 'name': {
          break
        }
      }
      return state.sort.direction === 'asc' ? order : -order
    })
  }
  const scan = async (entry: ProviderEntry, draft?: PanelDraft, id?: string): Promise<void> => {
    state.scans[entry.id] = { providerId: entry.id, status: 'scanning' }
    publish()
    let outcome: ScanOutcome
    try {
      outcome =
        draft === undefined
          ? await providers.scan(entry, { refresh: true })
          : await providers.scanDraft(entry, draftSecret(entry, id))
    } catch (error: unknown) {
      state.scans[entry.id] = {
        providerId: entry.id,
        status: 'failed',
        detail: UI_TEXT.providerProbeUnparseable,
      }
      publish()
      throw error
    }
    rows.set(entry.id, outcome.rows)
    const added = outcome.diff?.added ?? []
    for (const model of added) {
      newModels.add(`${entry.id}/${model}`)
    }
    state.scans[entry.id] = {
      providerId: entry.id,
      status: 'done',
      newCount: outcome.diff?.added.length,
      removedCount: outcome.diff?.removed.length,
      repricedCount: outcome.diff?.repriced.length,
    }
    if (draft === undefined) {
      return
    }
    if (draft.presetId === 'custom') {
      // The server's model list fills what it reports; the wizard asks the
      // rest. Limits the user already entered always win.
      const reported: Record<string, { contextTokens: number }> = {}
      for (const row of outcome.rows) {
        if (row.context !== undefined) {
          reported[row.id] = { contextTokens: row.context }
        }
      }
      if (Object.keys(reported).length > 0) {
        draft.modelLimits = { ...reported, ...draft.modelLimits }
      }
    }
    {
      const suggested = providers.suggestDefaultModel(outcome.rows)
      state.suggestions =
        suggested === undefined
          ? []
          : [
              {
                kind: 'defaultModel',
                modelRef: `${entry.id}/${suggested.value}`,
                reason: suggested.reason,
                accepted: false,
              },
            ]
    }
  }
  const handle = async (message: PanelToHostMessage): Promise<void> => {
    switch (message.type) {
      case 'modelsPanel/ready': {
        const cachedScans = await providers.cachedScans()
        for (const cached of cachedScans) {
          rows.set(cached.providerId, cached.rows)
        }
        await refresh()
        publish()
        if (navigation !== undefined) {
          post({
            type: 'modelsPanel/navigate',
            section: navigation.section === 'models' ? 'models' : 'providers',
            itemId: navigation.presetId,
          })
        }
        return
      }
      case 'openExternal': {
        const url = new URL(message.url)
        if (
          (url.protocol !== 'https:' && url.protocol !== 'http:') ||
          url.username !== '' ||
          url.password !== ''
        ) {
          throw new Error(UI_TEXT.actionFailed)
        }
        await vscode.env.openExternal(vscode.Uri.parse(url.href))
        return
      }
      case 'providers/connectSubscription': {
        // An unavailable sign-in is refused with its reason before any
        // connector runs, never a generic failure after one does.
        const refusal = subscriptionRefusal(message.providerId)
        if (refusal !== undefined) {
          state.notice = refusal
          break
        }
        const connect = message.providerId === 'chatgpt' ? deps.connectChatGpt : deps.connectCopilot
        if (connect === undefined) throw new Error(UI_TEXT.actionFailed)
        await connect()
        await scan(await entryOf(message.providerId))
        break
      }
      case 'providers/select': {
        const preset = providers.preset(message.presetId)
        if (preset === undefined) {
          throw new Error(UI_TEXT.actionFailed)
        }
        // Leaving the pick step retires the last scan's rows.
        state.localScan = undefined
        if (preset.auth === 'subscription') {
          const refusal = subscriptionRefusal(preset.id)
          if (refusal !== undefined) {
            state.notice = refusal
            break
          }
          const connect = preset.id === 'chatgpt' ? deps.connectChatGpt : deps.connectCopilot
          if (connect === undefined) throw new Error(UI_TEXT.actionFailed)
          await connect()
          await scan(await entryOf(preset.id))
          break
        }
        credentials.delete('wizard')
        state.drafts.wizard = newDraft(preset)
        break
      }
      case 'providers/edit': {
        if (message.reload === true) {
          state.drafts.edits = Object.fromEntries(
            Object.entries(state.drafts.edits).filter(([id]) => id !== message.providerId),
          )
          credentials.delete(message.providerId)
        }
        await createEditDraft(message.providerId)
        break
      }
      case 'providers/prefill': {
        const id = 'providerId' in message ? message.providerId : undefined
        const draft = draftOf(id)
        const oldAddress = draft.address
        const oldFormat = draft.customFormat
        // A webview grant cannot stand in for native private-network consent.
        const { privateConfirmed: _claimed, ...fields } = message.fields
        Object.assign(draft, fields)
        if (draft.loopbackPort !== undefined) {
          // The loopback host comes from the preset's own probe data.
          const probeHost =
            providers.preset(draft.presetId ?? '')?.localProbes[0]?.host ?? '127.0.0.1'
          draft.address = `http://${probeHost}:${String(draft.loopbackPort)}`
        }
        if (draft.azureResource !== undefined) {
          draft.address = `https://${draft.azureResource}.openai.azure.com/openai/v1`
        }
        if (oldFormat !== draft.customFormat) {
          savedConnections.delete(draft)
          draft.test = undefined
        }
        if (oldAddress !== draft.address) {
          savedConnections.delete(draft)
          credentials.delete(id ?? 'wizard')
          draft.keyPresent = false
          draft.keyShapeOk = false
          draft.privateConfirmed = false
          draft.test = undefined
        }
        break
      }
      case 'providers/enterKey':
      case 'providers/connect': {
        const id = message.providerId
        if (id !== undefined && state.drafts.edits[id] === undefined) {
          await createEditDraft(id)
        }
        const draft = draftOf(id)
        const entry = draftEntry(draft, id)
        const preset = providers.preset(entry.preset)
        if (
          preset === undefined ||
          (message.type === 'providers/connect' &&
            (preset.id !== 'openrouter' || preset.connectLabel === undefined))
        ) {
          throw new Error(UI_TEXT.actionFailed)
        }
        let connection: { readonly key: string } | undefined
        if (message.type === 'providers/connect') {
          draft.connecting = true
          publish()
          try {
            connection = await providers.connectOpenRouter(
              deps.isRemote === true,
              AbortSignal.any([
                lifetime.signal,
                ...(connectionRequest === undefined ? [] : [connectionRequest.signal]),
              ]),
            )
          } finally {
            draft.connecting = false
            publish()
          }
        }
        const secret =
          message.type === 'providers/connect'
            ? connection?.key
            : await providers.promptForKey({ ...preset, origin: new URL(entry.address).origin })
        if (secret !== undefined && !isDisposed) {
          enteredCredentials.add(draft)
          credentials.set(id ?? 'wizard', {
            secret,
            origin:
              message.type === 'providers/connect'
                ? OPENROUTER_ORIGIN
                : new URL(entry.address).origin,
          })
          draft.keyPresent = true
          draft.keyShapeOk = true
          draft.connected = message.type === 'providers/connect'
          savedConnections.delete(draft)
          draft.test = undefined
        }
        break
      }
      case 'providers/readUsage': {
        break
      }
      case 'providers/test': {
        const id = message.providerId
        const draft = id === undefined ? draftOf() : state.drafts.edits[id]
        const entry = draft === undefined ? await entryOf(id ?? '') : draftEntry(draft, id)
        if (draft !== undefined) savedConnections.delete(draft)
        const verdict = await providers.confirmAddress(entry.address)
        if (verdict.kind === 'refused') {
          throw new Error(UI_TEXT.actionFailed)
        }
        if (draft !== undefined) {
          draft.privateConfirmed = verdict.kind === 'private'
          draft.privateAsked = true
        }
        // The consent just granted rides on the tested entry itself: the
        // transport refuses a private address without it, so testing the
        // entry built before the question would fail despite consent.
        const testedEntry = verdict.kind === 'private' ? { ...entry, privateNetwork: true } : entry
        const secret =
          draft === undefined
            ? await providers.storedCredential(testedEntry)
            : draftSecret(testedEntry, id)
        let tested: KeyTestResult
        if (secret === undefined) {
          tested =
            testedEntry.auth === 'none'
              ? { kind: 'ok', models: 0 }
              : { kind: 'failed', detail: UI_TEXT.importNeedsKey }
        } else {
          tested = await providers.testCredential(testedEntry, secret)
        }
        let status: ProviderTest['status'] = tested.kind === 'ok' ? 'ok' : 'failed'
        if (tested.kind === 'paid') {
          status = 'needs-cost'
        }
        const test = {
          status,
          ...(tested.kind === 'ok' && { modelCount: tested.models }),
          ...(tested.kind === 'failed' && { detail: UI_TEXT.actionFailed }),
        }
        if (draft !== undefined) {
          draft.test = test
        }
        const saved = state.providers.find((candidate) => candidate.id === entry.id)
        if (saved !== undefined) {
          saved.test = test
        }
        if (draft !== undefined && tested.kind === 'ok') {
          await scan(testedEntry, draft, id)
        }
        publish()
        return
      }
      case 'providers/wizard': {
        if (message.event === 'cancel') {
          state.drafts = { edits: {} }
          credentials.clear()
          break
        }
        const draft = draftOf()
        const steps = wizardStepSchema.options
        const next = steps[steps.indexOf(draft.step) + (message.event === 'next' ? 1 : -1)]
        if (next !== undefined) {
          draft.step = next
        }
        break
      }
      case 'providers/save': {
        const draft = draftOf(message.providerId)
        let hasRefreshFailed = false
        // Every outcome refreshes through this catch. Earlier outcome text survives.
        const finish = async (isSaved: boolean): Promise<void> => {
          try {
            await refresh()
          } catch {
            hasRefreshFailed = true
            log.warn('Models panel could not refresh after provider save')
            if (isSaved) {
              state.notice =
                state.notice === undefined
                  ? UI_TEXT.providerSavedRefreshFailed
                  : [state.notice, UI_TEXT.providerRefreshFailed].join(' ')
            } else {
              draft.errors.push(UI_TEXT.providerRefreshFailed)
            }
          }
          syncDraftBlockers()
          publish()
        }
        let outcome: WizardSaveOutcome
        let entry: ProviderEntry
        try {
          syncCustomBlockers(draft, true)
          if (draft.blockers.length > 0) throw new Error(UI_TEXT.actionFailed)
          entry = draftEntry(draft, message.providerId)
          const snapshot = editSnapshots.get(draft)
          draft.errors = []
          draft.saveConflict = false
          state.notice = undefined
          if (draft.test?.status !== 'ok' && !savedConnections.has(draft)) {
            draft.errors = [UI_TEXT.providerText.wizard.test]
            await finish(false)
            return
          }
          const verdict = await providers.confirmAddress(entry.address)
          if (verdict.kind === 'refused') {
            draft.errors = [
              verdict.detail === UI_TEXT.providerPrivateConfirm
                ? verdict.detail
                : fill(UI_TEXT.providerAddressInvalid, { detail: verdict.detail }),
            ]
            await finish(false)
            return
          }
          outcome = await providers.saveDraft(
            {
              provider: { ...entry, ...(verdict.kind === 'private' && { privateNetwork: true }) },
              credential:
                snapshot === undefined || enteredCredentials.has(draft)
                  ? draftSecret(entry, message.providerId)
                  : undefined,
              credentialAuth: 'apiKey',
              defaultModel: draft.defaultModel ?? `${entry.id}/${entry.models[0] ?? ''}`,
              setDefault:
                snapshot === undefined || draft.defaultModel !== snapshot.fields.defaultModel,
              ...(snapshot !== undefined && {
                editSnapshot: {
                  provider: snapshot.entry,
                  credential: snapshot.credential,
                  defaultModel: snapshot.fields.defaultModel,
                },
              }),
              sessionBudgetUsd: draft.sessionBudgetUsd,
              useNow: message.useNow,
              editing: message.providerId !== undefined || savedDrafts.has(draft),
            },
            { config: deps.sessionBudget, expectedUsd: draft.sessionBudgetExpectedUsd },
          )
        } catch (error) {
          fail(draft, error)
          await finish(false)
          return
        }
        savedDrafts.add(draft)
        const snapshot = editSnapshots.get(draft)
        if (
          snapshot !== undefined &&
          (outcome.failedStep === undefined || outcome.failedStep === 'budget')
        ) {
          try {
            snapshot.entry = structuredClone(await entryOf(entry.id))
            snapshot.credential = await providers.credentialSnapshot(snapshot.entry.id)
            snapshot.fields = structuredClone(draft)
            enteredCredentials.delete(draft)
          } catch {
            hasRefreshFailed = true
            log.warn('Models panel saved provider but could not refresh its snapshot')
          }
        }
        state.notice = outcome.notice
        if (hasRefreshFailed)
          state.notice =
            state.notice === undefined
              ? UI_TEXT.providerSavedRefreshFailed
              : [state.notice, UI_TEXT.providerRefreshFailed].join(' ')
        if (outcome.composerSet) {
          try {
            deps.onWizardSaved(outcome)
          } catch {
            hasRefreshFailed = true
            state.notice =
              state.notice === undefined
                ? UI_TEXT.providerSavedRefreshFailed
                : [state.notice, UI_TEXT.providerRefreshFailed].join(' ')
            log.warn('Models panel saved provider but could not notify its host')
          }
        }
        await finish(true)
        // A fresh budget-only partial draft may retry its completed writes.
        // Any stale baseline or other partial outcome must reopen from storage.
        if (!hasRefreshFailed && outcome.failedStep === 'budget') {
          draft.errors = [
            fill(UI_TEXT.sessionBudgetPartialSave, {
              detail:
                outcome.budget?.status === 'conflict' || outcome.budget?.status === 'failed'
                  ? outcome.budget.error
                  : UI_TEXT.actionFailed,
            }),
          ]
          if (outcome.budget?.status === 'conflict')
            draft.sessionBudgetExpectedUsd = outcome.budget.effectiveUsd
        } else {
          credentials.delete(message.providerId ?? 'wizard')
          enteredCredentials.delete(draft)
          if (message.providerId === undefined) state.drafts.wizard = undefined
          else
            state.drafts.edits = Object.fromEntries(
              Object.entries(state.drafts.edits).filter(([id]) => id !== message.providerId),
            )
        }
        state.notice ??= fill(UI_TEXT.setupComplete, {
          provider: providers.preset(entry.preset)?.name ?? entry.id,
          model: outcome.modelRef,
        })
        publish()
        return
      }
      case 'providers/remove': {
        credentials.delete(message.providerId)
        state.drafts.edits = Object.fromEntries(
          Object.entries(state.drafts.edits).filter(([id]) => id !== message.providerId),
        )
        const entry = await entryOf(message.providerId)
        if (entry.auth === 'subscription') {
          if (deps.removeSubscription === undefined) throw new Error(UI_TEXT.actionFailed)
          await deps.removeSubscription(entry.id)
          rows.delete(entry.id)
          break
        }
        const removed = await providers.remove(message.providerId)
        if (removed !== undefined) {
          state.pendingRemovals.push({ providerId: removed.id, label: removed.id })
          rows.delete(removed.id)
        }
        break
      }
      case 'providers/undoRemove': {
        await providers.undoRemove(message.providerId)
        state.pendingRemovals = state.pendingRemovals.filter(
          (removal) => removal.providerId !== message.providerId,
        )
        break
      }
      case 'providers/export': {
        await deps.writeExportFile(await providers.exportConfig())
        break
      }
      case 'providers/import': {
        const preview = await providers.previewImport(message.json)
        state.importPreview = {
          providers: preview.rows
            .filter((row) => row.change !== 'removed')
            .map((row) => ({ id: row.entry.id, address: row.entry.address })),
          errors: [],
        }
        if (message.confirmed) {
          await providers.importConfig(message.json, deps.confirmImport)
          state.importPreview = undefined
        }
        break
      }
      case 'providers/scanLocal': {
        // Every local preset is probed through its own loopback targets;
        // the pick step offers each server that answered, or says none did.
        const found: { presetId: string; label: string; port: number }[] = []
        const checked: { presetId: string; label: string; port: number }[] = []
        for (const id of providers.presetIds()) {
          const preset = providers.preset(id)
          if (preset?.kind !== 'local') {
            continue
          }
          const usual = preset.localProbes[0]
          if (usual !== undefined) {
            checked.push({ presetId: id, label: preset.name, port: usual.port })
          }
          const probes = await providers.probe(preset)
          const probe = probes.find((candidate) => candidate.answered)
          if (probe !== undefined) {
            found.push({ presetId: id, label: preset.name, port: probe.port })
          }
        }
        state.localScan = { found, checked }
        break
      }
      case 'models/scan': {
        await scan(await entryOf(message.providerId))
        break
      }
      case 'models/cancelScan': {
        providers.cancelScan(message.providerId)
        break
      }
      case 'models/filter': {
        state.filter = message.filter
        state.sort = message.sort
        break
      }
      case 'models/tick': {
        const id = message.scope.providerId ?? draftOf().presetId ?? ''
        const prefix = `${id}/`
        if (!message.ref.startsWith(prefix)) {
          throw new Error(UI_TEXT.actionFailed)
        }
        const model = message.ref.slice(prefix.length)
        if (message.scope.scope === 'wizard') {
          const draft = draftOf()
          draft.models = [
            ...draft.models.filter((value) => value !== model),
            ...(message.ticked ? [model] : []),
          ]
          // An unticked model drops its custom limits with it.
          if (!message.ticked && draft.modelLimits?.[model] !== undefined) {
            draft.modelLimits = Object.fromEntries(
              Object.entries(draft.modelLimits).filter(([id]) => id !== model),
            )
          }
        } else {
          const entry = await entryOf(id)
          await providers.updateProvider({
            ...entry,
            models: [
              ...entry.models.filter((value) => value !== model),
              ...(message.ticked ? [model] : []),
            ],
          })
        }
        break
      }
      case 'models/pin':
      case 'models/numCtx': {
        const entry = await entryOf(message.providerId)
        const prefix = `${entry.id}/`
        if (!message.ref.startsWith(prefix)) {
          throw new Error(UI_TEXT.actionFailed)
        }
        const model = message.ref.slice(prefix.length)
        await providers.updateProvider(
          message.type === 'models/pin'
            ? {
                ...entry,
                pinned: [
                  ...(entry.pinned ?? []).filter((value) => value !== model),
                  ...(message.pinned ? [model] : []),
                ],
              }
            : { ...entry, numCtx: { ...entry.numCtx, [model]: message.numCtx } },
        )
        break
      }
      case 'suggestions/accept':
      case 'suggestions/change': {
        const draft = draftOf()
        const suggestion = state.suggestions.find((candidate) => candidate.kind === message.kind)
        if (message.kind === 'sessionBudget') {
          // The suggestions step's spending-limit field commits its typed
          // number directly: no suggestion card has to be accepted first.
          if (message.type === 'suggestions/change' && message.usd !== undefined) {
            draft.sessionBudgetUsd = message.usd
            draft.sessionBudgetExpectedUsd = message.expectedUsd
          } else if (suggestion?.kind === 'sessionBudget') {
            draft.sessionBudgetUsd = suggestion.usd
            draft.sessionBudgetExpectedUsd = state.sessionBudget.effectiveUsd
          }
        } else if (suggestion?.kind === 'defaultModel') {
          draft.defaultModel =
            message.type === 'suggestions/change' ? message.modelRef : suggestion.modelRef
        }
        if (suggestion !== undefined) {
          suggestion.accepted = true
        }
        break
      }
    }
    syncDraftBlockers()
    if (
      (message.type !== 'providers/wizard' || message.event === 'next') &&
      !connectionRequest?.signal.aborted
    )
      await refresh()
    publish()
  }
  const enqueue = (message: PanelToHostMessage): void => {
    if (message.type === 'providers/connect') {
      if (connectionRequest !== undefined) return
      connectionRequest = new AbortController()
    }
    let savingDraft: PanelDraft | undefined
    if (message.type === 'providers/save') {
      savingDraft =
        message.providerId === undefined
          ? state.drafts.wizard
          : state.drafts.edits[message.providerId]
      // Admit synchronously, before the queue awaits earlier work. Duplicate
      // deliveries join the first outcome; a retired draft cannot save again.
      if (savingDraft === undefined || savingDraft.saving === true) return
      savingDraft.saving = true
      publish()
    }
    const previous = operations
    operations = (async () => {
      await previous
      if (isDisposed) {
        return
      }
      try {
        await handle(message)
      } catch (error) {
        fail(
          message.type === 'providers/save' && message.providerId !== undefined
            ? savingDraft
            : undefined,
          error,
        )
      } finally {
        if (message.type === 'providers/connect') connectionRequest = undefined
        if (savingDraft !== undefined) {
          savingDraft.saving = false
          publish()
        }
      }
    })()
  }
  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = parsePanelToHostMessage(raw)
    if (!parsed.ok) {
      log.warn('Dropped malformed models panel message')
      return
    }
    if (parsed.message.type === 'models/cancelScan') {
      providers.cancelScan(parsed.message.providerId)
      return
    }
    if (
      (parsed.message.type === 'providers/wizard' && parsed.message.event !== 'next') ||
      ['providers/remove', 'providers/select', 'providers/enterKey', 'providers/edit'].includes(
        parsed.message.type,
      )
    ) {
      connectionRequest?.abort()
      usageRequest?.abort()
    }
    enqueue(parsed.message)
  })
  const cleanup = (): void => {
    isDisposed = true
    lifetime.abort()
    credentials.clear()
    subscription.dispose()
  }
  panel.onDidDispose(cleanup)
  return {
    reveal: (navigate) => {
      panel.reveal(vscode.ViewColumn.One)
      navigation = navigate
      if (navigate?.wizard === true) {
        connectionRequest?.abort()
        state.drafts.wizard = newDraft()
        credentials.clear()
      }
      if (navigate?.presetId !== undefined) {
        connectionRequest?.abort()
        state.drafts.wizard = newDraft(providers.preset(navigate.presetId))
        credentials.clear()
      }
      publish()
      if (navigate !== undefined) {
        post({
          type: 'modelsPanel/navigate',
          section: navigate.section === 'models' ? 'models' : 'providers',
          itemId: navigate.presetId,
        })
      }
    },
    onDidDispose: (run) => panel.onDidDispose(run),
    dispose: () => {
      cleanup()
      panel.dispose()
    },
  }
}
