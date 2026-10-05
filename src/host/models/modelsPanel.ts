// The Models & Agents panel's host side (M95 lane K, PLAN.md D74, M95
// acceptance 17): the `WebviewPanel`, its CSP, its zod-validated bridge.
// The panel's React app (`dist/webview/models.js`) and the shared message
// schemas (`src/shared/modelsPanel.ts`) are lane M's: until they merge,
// this shell validates the plan's message names here and routes the
// providers section to the host verbs. Other sections' messages are logged
// and dropped (D4) until their lanes land. The host validates, saves and
// owns every credential; the webview only renders and asks.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import {
  MODELS_PANEL_VIEW_TYPE,
  MODELS_WEBVIEW_SCRIPT_FILE,
  MODELS_WEBVIEW_STYLE_FILE,
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
} from '../../shared/constants'
import { buildWebviewHtml, createNonce } from '../html'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'
import { scanDiffLines } from '../providers/modelScans'
import { providerEntrySchema, type ImportPreview } from '../providers/importExport'
import type { ProviderEntry, PresetInfo } from '../providers/providerPorts'
import type { ProvidersHost } from '../providers/providersHost'
import type { WizardSaveOutcome } from '../providers/wizardSave'

const inboundSchema = z.object({
  type: z.string(),
  payload: z.optional(z.unknown()),
})

const outboundSchema = z.object({
  type: z.string(),
  state: z.optional(z.unknown()),
})

const idPayloadSchema = z.object({ id: z.string() })
const presetPayloadSchema = z.object({ presetId: z.string() })
const scanPayloadSchema = z.object({ id: z.string(), refresh: z.optional(z.boolean()) })
const draftPayloadSchema = z.object({
  provider: providerEntrySchema,
  credential: z.optional(z.string()),
  credentialAuth: z.enum(['apiKey', 'oauth', 'subscription']),
  defaultModel: z.string(),
  sessionBudgetUsd: z.optional(z.number()),
  useNow: z.boolean(),
})
const remotePayloadSchema = z.object({ isRemote: z.boolean() })
const importTextPayloadSchema = z.object({ text: z.string() })

export interface ModelsPanelDeps {
  readonly extensionUri: vscode.Uri
  /** The installed table and its language, for the panel's HTML (D33). */
  readonly l10n: UiTable
  readonly log: Logger
  readonly providers: ProvidersHost
  /** Picks an export file and writes the text; undefined when dismissed. */
  readonly writeExportFile: (text: string) => Promise<void>
  /** Picks an import file and reads its text; undefined when dismissed. */
  readonly readImportFile: () => Promise<string | undefined>
  /** Shows the import preview and asks to go on. */
  readonly confirmImport: (preview: ImportPreview) => Promise<boolean>
  /** A saved wizard: the caller confirms and leaves first run. */
  readonly onWizardSaved: (outcome: WizardSaveOutcome) => void
}

export interface ModelsPanelNavigate {
  readonly section?: string | undefined
  readonly presetId?: string | undefined
  /** Opens the wizard straight at "Pick a provider" (`museSpark.startWithOwnModel`). */
  readonly wizard?: boolean | undefined
}

export interface ModelsPanel {
  /** Reveals the panel, telling the webview where to go. */
  readonly reveal: (navigate?: ModelsPanelNavigate) => void
  /** Runs when the user closes the tab (the opener drops its instance). */
  readonly onDidDispose: (run: () => void) => vscode.Disposable
  readonly dispose: () => void
}

/** The prefill the panel renders: the preset's known fields, never a secret. */
function prefillState(preset: PresetInfo): Record<string, unknown> {
  return {
    presetId: preset.id,
    name: preset.name,
    description: preset.description,
    kind: preset.kind,
    origin: preset.origin,
    format: preset.format,
    auth: preset.auth,
    keyHint: preset.keyHint,
    keyPage: preset.keyPage,
    freeTest: preset.freeTest,
    ...(preset.connectLabel !== undefined && { connectLabel: preset.connectLabel }),
    ...(preset.privacyChoices !== undefined && { privacyChoices: [...preset.privacyChoices] }),
  }
}

function badPayload(type: string): Error {
  return new Error(`The panel sent ${type} without its fields`)
}

function payloadOf<T>(type: string, schema: z.ZodMiniType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw badPayload(type)
  }
  return parsed.data
}

/**
 * One Models & Agents panel. A second call opens nothing new: the caller
 * keeps the instance and reveals it.
 */
export function createModelsPanel(deps: ModelsPanelDeps): ModelsPanel {
  const { providers, log } = deps
  const panel = vscode.window.createWebviewPanel(
    MODELS_PANEL_VIEW_TYPE,
    UI_TEXT.modelsPanelTitle,
    vscode.ViewColumn.One,
    { retainContextWhenHidden: true },
  )
  const bundleRoot = vscode.Uri.joinPath(deps.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
  panel.webview.options = { enableScripts: true, localResourceRoots: [bundleRoot] }
  panel.webview.html = buildWebviewHtml({
    scriptUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(bundleRoot, MODELS_WEBVIEW_SCRIPT_FILE))
      .toString(),
    styleUri: panel.webview
      .asWebviewUri(vscode.Uri.joinPath(bundleRoot, MODELS_WEBVIEW_STYLE_FILE))
      .toString(),
    cspSource: panel.webview.cspSource,
    nonce: createNonce(),
    l10n: deps.l10n,
  })

  const post = (type: string, state?: unknown): void => {
    const message = state === undefined ? { type } : { type, state }
    if (!outboundSchema.safeParse(message).success) {
      log.error(`The models panel refused to post ${type}: outside its bridge`)
      return
    }
    void panel.webview.postMessage(message)
  }

  const fail = (type: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error)
    log.warn(`Models panel ${type} failed: ${detail}`)
    post(`${type.split('/', 1)[0] ?? 'providers'}/failed`, { detail })
  }

  const entryOf = async (id: string): Promise<ProviderEntry> => {
    const entries = await providers.providers()
    const entry = entries.find((candidate) => candidate.id === id)
    if (entry === undefined) {
      throw new Error(`Provider ${id} is not configured`)
    }
    return entry
  }

  const readImportText = async (): Promise<string> => {
    const text = await deps.readImportFile()
    if (text === undefined) {
      throw new Error('No import file was picked')
    }
    return text
  }

  const handle = async (type: string, payload: unknown): Promise<void> => {
    switch (type) {
      case 'providers/select': {
        const { presetId } = payloadOf(type, presetPayloadSchema, payload)
        const preset = providers.preset(presetId)
        if (preset === undefined) {
          throw new Error(`Unknown provider preset ${presetId}`)
        }
        post('providers/prefilled', prefillState(preset))
        break
      }
      case 'providers/enterKey': {
        const { presetId } = payloadOf(type, presetPayloadSchema, payload)
        const preset = providers.preset(presetId)
        if (preset === undefined) {
          throw new Error(`Unknown provider preset ${presetId}`)
        }
        const entered = await providers.promptForKey(preset)
        post('providers/keyState', { presetId, hasKey: entered !== undefined })
        break
      }
      case 'providers/connect': {
        const { isRemote } = payloadOf(type, remotePayloadSchema, payload)
        const connection = await providers.connectOpenRouter(isRemote)
        post('providers/keyState', { presetId: 'openrouter', hasKey: connection !== undefined })
        break
      }
      case 'providers/test': {
        const { id } = payloadOf(type, idPayloadSchema, payload)
        post('providers/tested', {
          id,
          result: await providers.testStoredCredential(await entryOf(id)),
        })
        break
      }
      case 'providers/save': {
        const draft = payloadOf(type, draftPayloadSchema, payload)
        const outcome = await providers.saveDraft(draft)
        post('providers/saved', {
          providerId: outcome.providerId,
          modelRef: outcome.modelRef,
          composerSet: outcome.composerSet,
        })
        deps.onWizardSaved(outcome)
        break
      }
      case 'providers/remove': {
        const { id } = payloadOf(type, idPayloadSchema, payload)
        const removed = await providers.remove(id)
        post('providers/removed', { id, removed: removed !== undefined })
        break
      }
      case 'providers/undo': {
        const { id } = payloadOf(type, idPayloadSchema, payload)
        post('providers/unremoved', { id, restored: await providers.undoRemove(id) })
        break
      }
      case 'providers/export': {
        await deps.writeExportFile(await providers.exportConfig())
        post('providers/exported', {})
        break
      }
      case 'providers/importPreview': {
        const preview = await providers.previewImport(await readImportText())
        post('providers/importPreviewed', preview)
        break
      }
      case 'providers/import': {
        const { text } = payloadOf(type, importTextPayloadSchema, payload)
        post('providers/imported', {
          count: await providers.importConfig(text, deps.confirmImport),
        })
        break
      }
      case 'models/scan': {
        const { id, refresh } = payloadOf(type, scanPayloadSchema, payload)
        const outcome = await providers.scan(await entryOf(id), { refresh })
        post('models/scanned', {
          providerId: id,
          rows: outcome.rows,
          lines: scanDiffLines(outcome.diff ?? { added: [], removed: [], repriced: [] }),
          fromCache: outcome.fromCache,
        })
        break
      }
      case 'models/cancelScan': {
        const { id } = payloadOf(type, idPayloadSchema, payload)
        post('models/scanCancelled', { id, cancelled: providers.cancelScan(id) })
        break
      }
      case 'providers/list': {
        post('providers/listed', { providers: await providers.providerStates() })
        break
      }
      default: {
        // Lane M's sections (models/tick, pin, filter, suggestions/*)
        // until they land: named in the log, never failing the panel.
        log.warn(`Dropped models panel message outside lane K: ${type}`)
        break
      }
    }
  }

  const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
    const parsed = inboundSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn(`Dropped malformed models panel message: ${z.prettifyError(parsed.error)}`)
      return
    }
    void handle(parsed.data.type, parsed.data.payload).catch((error: unknown) => {
      fail(parsed.data.type, error)
    })
  })

  return {
    reveal: (navigate) => {
      panel.reveal(vscode.ViewColumn.One)
      if (navigate !== undefined) {
        post('navigate', { ...navigate })
      }
    },
    onDidDispose: (run) => panel.onDidDispose(run),
    dispose: () => {
      subscription.dispose()
      panel.dispose()
    },
  }
}
