// Lane M's strict bridge is shared by both sides. Credentials stay in this
// host-owned draft and never join state, exceptions, logs or postMessage.
import * as vscode from 'vscode'
import * as z from 'zod/mini'
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
  wizardStepSchema,
  prefillFieldsSchema,
  type ModelsPanelState,
  type PanelDraft,
  type PanelToHostMessage,
  type HostToPanelMessage,
  type ModelRow,
  type ProviderTest,
} from '../../shared/modelsPanel'
import { buildWebviewHtml, createNonce } from '../html'
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
import type { WizardSaveOutcome } from '../providers/wizardSave'
import { OPENROUTER_ORIGIN } from '../providers/openRouter'

// Edit operations extend M's initial contract; their strict shapes carry no
// credential. M's repair can adopt these variants in the shared schema.
const editSchema = z.strictObject({ type: z.literal('providers/edit'), providerId: z.string() })
const editPrefillSchema = z.strictObject({
  type: z.literal('providers/prefill'),
  providerId: z.string(),
  fields: prefillFieldsSchema,
})
type EditMessage = z.infer<typeof editSchema> | z.infer<typeof editPrefillSchema>

export interface ModelsPanelDeps {
  readonly extensionUri: vscode.Uri
  readonly l10n: UiTable
  readonly log: Logger
  readonly providers: ProvidersHost
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
function newDraft(preset?: PresetInfo): PanelDraft {
  return {
    step: preset === undefined ? 'pick-provider' : 'configure',
    presetId: preset?.id,
    address: preset?.origin,
    auth: preset?.auth ?? 'apiKey',
    keyPresent: false,
    keyShapeOk: false,
    connected: false,
    costAccepted: false,
    models: [],
    privacy: 'no-training',
    providerOrder: [],
    allowFallbacks: false,
    privateConfirmed: false,
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
    lastChoices: {},
    drafts: { edits: {} },
    pendingRemovals: [],
  }
  const credentials = new Map<string, { secret: string; origin: string }>()
  const rows = new Map<string, readonly ProviderModelRow[]>()
  const newModels = new Set<string>()
  let isDisposed = false
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
  const fail = (): void => {
    // Exception text can contain a bare key even before it is retained.
    log.warn('Models panel operation failed')
    state.notice = UI_TEXT.actionFailed
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
    return {
      id: id ?? preset.id,
      preset: preset.id,
      address: draft.address ?? preset.origin,
      auth: draft.auth,
      models: draft.models,
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
  const draftSecret = (entry: ProviderEntry, id?: string): string | undefined => {
    const record = credentials.get(id ?? 'wizard')
    if (record !== undefined && record.origin !== new URL(entry.address).origin) {
      throw new Error(UI_TEXT.importNeedsKey)
    }
    return record?.secret
  }
  const refresh = async (): Promise<void> => {
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
        throw new Error(UI_TEXT.actionFailed)
      }
      return [card.data]
    })
    const providerStates = await providers.providerStates()
    state.providers = providerStates.map(({ entry, hasKey, origin }) => {
      const preset = state.presets.find((candidate) => candidate.id === entry.preset)
      if (preset === undefined) {
        throw new Error(UI_TEXT.actionFailed)
      }
      const isBound = origin === undefined || origin === new URL(entry.address).origin
      return {
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
      }
    })
    const all: ModelRow[] = []
    const families = new Map<string, string>()
    for (const [providerId, models] of rows) {
      const saved = state.providers.find((entry) => entry.id === providerId)
      const draft = state.drafts.wizard?.presetId === providerId ? state.drafts.wizard : undefined
      for (const model of models) {
        const knownPrice: ModelRow['priceNote'] =
          model.inputPerMillion === undefined ? 'unpriced' : 'priced'
        const priceNote = model.isLocal ? 'local' : model.isFree ? 'free' : knownPrice
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
          priceNote,
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
    const outcome =
      draft === undefined
        ? await providers.scan(entry, { refresh: true })
        : await providers.scanDraft(entry, draftSecret(entry, id))
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
  const handle = async (message: PanelToHostMessage | EditMessage): Promise<void> => {
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
      case 'providers/select': {
        const preset = providers.preset(message.presetId)
        if (preset === undefined) {
          throw new Error(UI_TEXT.actionFailed)
        }
        credentials.delete('wizard')
        state.drafts.wizard = newDraft(preset)
        break
      }
      case 'providers/edit': {
        const entry = await entryOf(message.providerId)
        const draft = {
          ...newDraft(providers.preset(entry.preset)),
          address: entry.address,
          models: [...entry.models],
        }
        let secret: string | undefined
        try {
          secret = await providers.storedCredential(entry)
        } catch {
          draft.errors = [UI_TEXT.importNeedsKey]
        }
        if (secret !== undefined) {
          credentials.set(entry.id, { secret, origin: new URL(entry.address).origin })
          draft.keyPresent = true
          draft.keyShapeOk = true
        }
        state.drafts.edits[entry.id] = draft
        break
      }
      case 'providers/prefill': {
        const id = 'providerId' in message ? message.providerId : undefined
        const draft = draftOf(id)
        const oldAddress = draft.address
        // A webview grant cannot stand in for native private-network consent.
        const { privateConfirmed: _claimed, ...fields } = message.fields
        Object.assign(draft, fields)
        if (draft.loopbackPort !== undefined) {
          draft.address = `http://127.0.0.1:${String(draft.loopbackPort)}`
        }
        if (draft.azureResource !== undefined) {
          draft.address = `https://${draft.azureResource}.openai.azure.com/openai/v1`
        }
        if (oldAddress !== draft.address) {
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
          const entry = await entryOf(id)
          state.drafts.edits[id] = {
            ...newDraft(providers.preset(entry.preset)),
            address: entry.address,
            models: [...entry.models],
          }
        }
        const draft = draftOf(id)
        const entry = draftEntry(draft, id)
        const preset = providers.preset(entry.preset)
        if (
          preset === undefined ||
          (message.type === 'providers/connect' && preset.id !== 'openrouter')
        ) {
          throw new Error(UI_TEXT.actionFailed)
        }
        const connection =
          message.type === 'providers/connect'
            ? await providers.connectOpenRouter(deps.isRemote === true)
            : undefined
        const secret =
          message.type === 'providers/connect'
            ? connection?.key
            : await providers.promptForKey({ ...preset, origin: new URL(entry.address).origin })
        if (secret !== undefined && !isDisposed) {
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
          draft.test = undefined
        }
        break
      }
      case 'providers/test': {
        const id = message.providerId
        const draft = id === undefined ? draftOf() : state.drafts.edits[id]
        const entry = draft === undefined ? await entryOf(id ?? '') : draftEntry(draft, id)
        const verdict = await providers.confirmAddress(entry.address)
        if (verdict.kind === 'refused') {
          throw new Error(UI_TEXT.actionFailed)
        }
        if (draft !== undefined) {
          draft.privateConfirmed = verdict.kind === 'private'
          draft.privateAsked = true
        }
        const secret =
          draft === undefined ? await providers.storedCredential(entry) : draftSecret(entry, id)
        let tested: KeyTestResult
        if (secret === undefined) {
          tested =
            entry.auth === 'none'
              ? { kind: 'ok', models: 0 }
              : { kind: 'failed', detail: UI_TEXT.importNeedsKey }
        } else {
          tested = await providers.testCredential(entry, secret)
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
          await scan(entry, draft, id)
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
        const entry = {
          ...(message.providerId !== undefined && (await entryOf(message.providerId))),
          ...draftEntry(draft, message.providerId),
        }
        if (draft.test?.status !== 'ok') {
          throw new Error(UI_TEXT.actionFailed)
        }
        const verdict = await providers.confirmAddress(entry.address)
        if (verdict.kind === 'refused') {
          throw new Error(UI_TEXT.actionFailed)
        }
        const outcome = await providers.saveDraft({
          provider: { ...entry, privateNetwork: verdict.kind === 'private' },
          credential: draftSecret(entry, message.providerId),
          credentialAuth: 'apiKey',
          defaultModel: draft.defaultModel ?? `${entry.id}/${entry.models[0] ?? ''}`,
          sessionBudgetUsd: draft.sessionBudgetUsd,
          useNow: message.useNow,
          editing: message.providerId !== undefined,
        })
        credentials.delete(message.providerId ?? 'wizard')
        if (message.providerId === undefined) {
          state.drafts.wizard = undefined
        } else {
          state.drafts.edits = Object.fromEntries(
            Object.entries(state.drafts.edits).filter(([id]) => id !== message.providerId),
          )
        }
        if (outcome.composerSet) {
          deps.onWizardSaved(outcome)
        }
        break
      }
      case 'providers/remove': {
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
        for (const id of providers.presetIds()) {
          const preset = providers.preset(id)
          if (preset?.kind !== 'local') {
            continue
          }
          const probes = await providers.probe(preset)
          const probe = probes.find((candidate) => candidate.answered)
          if (probe !== undefined) {
            state.drafts.wizard = {
              ...newDraft(preset),
              address: `http://${probe.host}:${String(probe.port)}`,
            }
            break
          }
        }
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
        if (suggestion?.kind === 'defaultModel') {
          draft.defaultModel =
            message.type === 'suggestions/change' ? message.modelRef : suggestion.modelRef
        }
        if (suggestion?.kind === 'sessionBudget') {
          draft.sessionBudgetUsd =
            message.type === 'suggestions/change' ? message.usd : suggestion.usd
        }
        if (suggestion !== undefined) {
          suggestion.accepted = true
        }
        break
      }
    }
    await refresh()
    publish()
  }
  const enqueue = (message: PanelToHostMessage | EditMessage): void => {
    const previous = operations
    operations = (async () => {
      await previous
      if (isDisposed) {
        return
      }
      try {
        await handle(message)
      } catch {
        fail()
      }
    })()
  }
  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const edit = editSchema.safeParse(raw)
    if (edit.success) {
      enqueue(edit.data)
      return
    }
    const prefill = editPrefillSchema.safeParse(raw)
    if (prefill.success) {
      enqueue(prefill.data)
      return
    }
    const parsed = parsePanelToHostMessage(raw)
    if (!parsed.ok) {
      log.warn('Dropped malformed models panel message')
      return
    }
    if (parsed.message.type === 'models/cancelScan') {
      providers.cancelScan(parsed.message.providerId)
      return
    }
    enqueue(parsed.message)
  })
  const cleanup = (): void => {
    isDisposed = true
    credentials.clear()
    subscription.dispose()
  }
  panel.onDidDispose(cleanup)
  return {
    reveal: (navigate) => {
      panel.reveal(vscode.ViewColumn.One)
      navigation = navigate
      if (navigate?.wizard === true) {
        state.drafts.wizard = newDraft()
        credentials.clear()
      }
      if (navigate?.presetId !== undefined) {
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
