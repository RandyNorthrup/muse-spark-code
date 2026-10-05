// The Models & Agents panel's bundle (M95 lane K, PLAN.md D6): esbuild
// builds this file into dist/modelsPanel.js, which the activation bundle
// requires on the first Models & Agents action, so the panel's host side
// and the quick pick stay out of the bundle VS Code loads at activation.
// The lane-P/T seam (the providers file, presets, tests, scans, PKCE,
// suggestions) arrives as parameters, read from `dist/providers.js`.

import * as vscode from 'vscode'
import { GLOBAL_STATE_KEYS, PROVIDER_IMPORT_MAX_BYTES, UI_TEXT } from '../../shared/constants'
import { providerSetupSchema } from '../../shared/providerSetup'
import type { ChatSurface } from '../views/chatSurface'
import { fill, setUiText } from '../../shared/l10n/text'
import type { SecretStore } from '../auth/credentialStore'
import { ProviderCredentialStore as CredentialStore } from '../providers/credentialRecords'
import type { UiTable } from '../l10n'
import type { Logger } from '../logger'
import { showPickOne } from '../quickPick'
import { startOAuthLoopback } from '../providers/oauthLoopback'
import { createModelsPanel, type ModelsPanel, type ModelsPanelNavigate } from './modelsPanel'
import { runAddProviderQuickPick, type ProviderQuickPickOutcome } from './modelsQuickPick'
import { createProvidersHost, type ProvidersHost } from '../providers/providersHost'
import type { ModelScan, ScanStore } from '../providers/modelScans'
import type { PendingRemoval, RemovalStore } from '../providers/providerRemoval'
import type {
  AddressPolicy,
  CodeExchanger,
  KeyTester,
  KeyUsageReader,
  ModelFetcher,
  PkceSource,
  PresetCatalog,
  ProviderEntry,
  ProviderModelRow,
  ProvidersStore,
  SuggestionEngine,
} from '../providers/providerPorts'
import type { WizardSaveOutcome } from '../providers/wizardSave'

/** VS Code's global state, taken by shape (as `MementoLike` in paidHost). */
export interface ModelsPanelMemento {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void>
}

/** The lane-P/T seam the factory is composed with (PLAN.md M95 lanes). */
export interface ModelsPanelSeam {
  readonly store: ProvidersStore
  readonly catalog: PresetCatalog
  readonly policy: AddressPolicy
  readonly tester: KeyTester
  readonly fetcher: ModelFetcher
  readonly exchanger: CodeExchanger
  readonly usage: KeyUsageReader
  readonly pkce: PkceSource
  readonly suggest: SuggestionEngine
}

export interface ModelsPanelHostDeps {
  readonly secrets: SecretStore
  readonly credentials?: CredentialStore
  readonly extensionUri: vscode.Uri
  readonly l10n: UiTable
  readonly log: Logger
  readonly globalState: ModelsPanelMemento
  /**
   * `museSpark.suggestedProvider` as written (a preset id at most): read
   * fresh on every call, so a workspace edit applies without a reload.
   */
  readonly suggestedProviderSetting: () => string
  /** True in a remote window: connects paste a code instead of a callback. */
  readonly isRemote: boolean
  /** Asks the conversation to set the composer's model. */
  readonly setComposerModel: (modelRef: string) => Promise<void>
  /** Picks an export file and writes the text; undefined work stays unwritten. */
  readonly writeExportFile?: (text: string) => Promise<void>
  /** Picks an import file and reads its text; undefined when dismissed. */
  readonly readImportFile?: () => Promise<string | undefined>
  readonly onWizardSaved?: (outcome: WizardSaveOutcome) => void | Promise<void>
}

export interface ModelsPanelFeatures {
  /** Opens (or reveals) the Models & Agents panel. */
  readonly openPanel: (navigate?: ModelsPanelNavigate) => void
  /** The quick-pick fast path (`museSpark.addModelProvider`). */
  readonly runQuickPick: () => Promise<ProviderQuickPickOutcome | undefined>
  /** Finishes removals a closed window left behind. */
  readonly completePendingRemovals: () => Promise<void>
  /** The workspace's suggested preset id, if it names a known preset. */
  readonly suggestedPreset: () => string | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStoredRow(value: unknown): value is ProviderModelRow {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['label'] === 'string' &&
    typeof value['toolCapable'] === 'boolean' &&
    typeof value['priceFingerprint'] === 'string'
  )
}

function isStoredScan(value: unknown): value is ModelScan {
  return (
    isRecord(value) &&
    typeof value['providerId'] === 'string' &&
    typeof value['fetchedAt'] === 'number' &&
    (typeof value['catalogue'] === 'string' || value['catalogue'] === undefined) &&
    Array.isArray(value['rows']) &&
    value['rows'].every(isStoredRow)
  )
}

function storedScans(value: unknown): ModelScan[] {
  return Array.isArray(value) ? value.filter(isStoredScan).map((scan) => ({ ...scan })) : []
}

const AUTH_KINDS: ReadonlySet<string> = new Set(['apiKey', 'none', 'oauth', 'subscription'])

function isStoredEntry(value: unknown): value is ProviderEntry {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['preset'] === 'string' &&
    typeof value['address'] === 'string' &&
    typeof value['auth'] === 'string' &&
    AUTH_KINDS.has(value['auth']) &&
    Array.isArray(value['models']) &&
    value['models'].every((model): model is string => typeof model === 'string')
  )
}

function storedRemovals(value: unknown): PendingRemoval[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((removal) => {
    return !isRecord(removal) ||
      !isStoredEntry(removal['entry']) ||
      typeof removal['removedAt'] !== 'number'
      ? []
      : [{ entry: removal['entry'], removedAt: removal['removedAt'] }]
  })
}

function scanStoreOver(globalState: ModelsPanelMemento): ScanStore {
  return {
    load: () => Promise.resolve(storedScans(globalState.get(GLOBAL_STATE_KEYS.providerScanCache))),
    save: async (scans) => {
      await globalState.update(
        GLOBAL_STATE_KEYS.providerScanCache,
        scans.map((scan) => ({ ...scan })),
      )
    },
  }
}

function removalStoreOver(globalState: ModelsPanelMemento): RemovalStore {
  return {
    load: () =>
      Promise.resolve(storedRemovals(globalState.get(GLOBAL_STATE_KEYS.providerPendingRemovals))),
    save: async (pending) => {
      await globalState.update(
        GLOBAL_STATE_KEYS.providerPendingRemovals,
        pending.map((removal) => ({ ...removal })),
      )
    },
  }
}

/** Require the controller's observable model receipt; a void refusal is failure. */
export async function setComposerModelConfirmed(
  surface: ChatSurface,
  modelRef: string,
  run: () => Promise<void>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/unbound-method -- preserve the exact method for restoration; invoke it with its original surface via call. PLAN section 8.
  const previousPost = surface.post
  const receipt: { modelRef: string | undefined } = { modelRef: undefined }
  surface.post = (message) => {
    if (message.type === 'sessionInfo') {
      receipt.modelRef = message.modelId
    }
    previousPost.call(surface, message)
  }
  try {
    await run()
    if (receipt.modelRef !== modelRef) {
      throw new Error(UI_TEXT.actionFailed)
    }
  } finally {
    surface.post = previousPost
  }
}

/** The publisher uses the same setup-message schema as the chat boundary. */
export function publishProviderSetup(
  outcome: WizardSaveOutcome,
  surface: Pick<ChatSurface, 'post'>,
): void {
  if (!outcome.composerSet) {
    return
  }
  const parsed = providerSetupSchema.safeParse({
    type: 'setupComplete',
    provider: outcome.providerId,
    model: outcome.modelRef,
  })
  if (parsed.success) {
    surface.post(parsed.data)
  }
}

async function writeExportFile(text: string): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    filters: { JSON: ['json'] },
    saveLabel: UI_TEXT.providerExport,
  })
  if (target?.scheme === 'file') {
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text))
  }
}
async function readImportFile(): Promise<string | undefined> {
  const [target] =
    (await vscode.window.showOpenDialog({ filters: { JSON: ['json'] }, canSelectMany: false })) ??
    []
  if (target?.scheme !== 'file') {
    return undefined
  }
  const bytes = await vscode.workspace.fs.readFile(target)
  if (bytes.length > PROVIDER_IMPORT_MAX_BYTES) {
    throw new Error(UI_TEXT.textFileTooLarge)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(UI_TEXT.textFileInvalid)
  }
}

/**
 * The panel's features, composed from the VS Code host and the lane-P/T
 * seam. One instance serves the window; the panel it opens is one tab.
 */
export function createModelsPanelFeatures(
  host: ModelsPanelHostDeps,
  seam: ModelsPanelSeam,
): ModelsPanelFeatures {
  // Each bundle keeps its own installed-language state (PLAN.md D6): the
  // factory installs the caller's table before use.
  setUiText(host.l10n.table, host.l10n.locale)
  const credentials =
    host.credentials ??
    new CredentialStore(
      host.secrets,
      (message) => {
        host.log.warn(message)
      },
      undefined,
      async () => {
        const entries = await seam.store.list()
        return entries
      },
    )
  const providers: ProvidersHost = createProvidersHost({
    credentials,
    secrets: host.secrets,
    store: seam.store,
    catalog: seam.catalog,
    policy: seam.policy,
    tester: seam.tester,
    fetcher: seam.fetcher,
    exchanger: seam.exchanger,
    usage: seam.usage,
    pkce: seam.pkce,
    suggest: seam.suggest,
    scanStore: scanStoreOver(host.globalState),
    removalStore: removalStoreOver(host.globalState),
    startLoopback: (state) => startOAuthLoopback(state),
    clock: {
      now: () => Date.now(),
      schedule: (ms, run) => {
        const timer = setTimeout(run, ms)
        return {
          cancel: () => {
            clearTimeout(timer)
          },
        }
      },
    },
    loopbackFetch: globalThis.fetch,
    now: () => Date.now(),
    setComposerModel: host.setComposerModel,
    ui: {
      showInputBox: vscode.window.showInputBox,
      confirmPaidTest: async (message) =>
        (await vscode.window.showWarningMessage(
          message,
          { modal: true },
          UI_TEXT.wizardContinue,
          UI_TEXT.wizardCancel,
        )) === UI_TEXT.wizardContinue,
      confirmPrivateNetwork: async (message) =>
        (await vscode.window.showWarningMessage(
          message,
          { modal: true },
          UI_TEXT.providerPrivateConfirm,
          UI_TEXT.wizardCancel,
        )) === UI_TEXT.providerPrivateConfirm,
      openBrowser: (url) => {
        void vscode.env.openExternal(vscode.Uri.parse(url))
        return Promise.resolve()
      },
    },
  })

  let panel: ModelsPanel | undefined
  const openPanel = (navigate?: ModelsPanelNavigate): void => {
    if (panel === undefined) {
      const created = createModelsPanel({
        extensionUri: host.extensionUri,
        l10n: host.l10n,
        log: host.log,
        providers,
        isRemote: host.isRemote,
        writeExportFile: host.writeExportFile ?? writeExportFile,
        readImportFile: host.readImportFile ?? readImportFile,
        confirmImport: async (preview) => {
          const lines = preview.rows.map(
            (row) =>
              `${row.change}: ${row.entry.id} (${row.entry.address})${row.needsKey ? ` · ${UI_TEXT.importNeedsKey}` : ''}`,
          )
          return (
            (await vscode.window.showWarningMessage(
              UI_TEXT.providerImportPreviewTitle,
              { modal: true, detail: lines.join('\n') },
              UI_TEXT.providerImport,
              UI_TEXT.wizardCancel,
            )) === UI_TEXT.providerImport
          )
        },
        onWizardSaved: (outcome: WizardSaveOutcome) => {
          if (!outcome.composerSet) {
            return
          }
          void Promise.resolve(host.onWizardSaved?.(outcome)).catch(() => {
            host.log.warn('Provider setup notification failed')
          })
          void vscode.window
            .showInformationMessage(
              fill(UI_TEXT.setupComplete, {
                provider: outcome.providerId,
                model: outcome.modelRef,
              }),
              UI_TEXT.manageProviders,
            )
            .then((choice) => {
              if (choice === UI_TEXT.manageProviders) {
                openPanel()
              }
            })
        },
      })
      panel = created
      created.onDidDispose(() => {
        if (panel === created) {
          panel = undefined
        }
      })
    }
    panel.reveal(navigate)
  }

  return {
    openPanel,
    runQuickPick: async () => {
      const outcome = await runAddProviderQuickPick({
        providers,
        isRemote: host.isRemote,
        ui: {
          pickOne: (items, title, placeholder) => showPickOne(items, title, placeholder),
          pickMany: async (items, title, placeholder) => {
            const rows: (vscode.QuickPickItem & { readonly quickPickId: string })[] = items.map(
              (item) => ({
                label: item.label,
                ...(item.description !== undefined && { description: item.description }),
                ...(item.detail !== undefined && { detail: item.detail }),
                picked: item.picked,
                quickPickId: item.id,
              }),
            )
            const picked = await vscode.window.showQuickPick(rows, {
              title,
              placeHolder: placeholder,
              matchOnDescription: true,
              canPickMany: true,
            })
            return picked === undefined ? undefined : picked.map((item) => item.quickPickId)
          },
          inputText: (options) =>
            Promise.resolve(
              vscode.window.showInputBox({
                title: options.title,
                placeHolder: options.placeholder,
                ...(options.value !== undefined && { value: options.value }),
                ...(options.validate !== undefined && { validateInput: options.validate }),
                ignoreFocusOut: true,
              }),
            ),
          confirmSave: async (title, detail) =>
            (await vscode.window.showWarningMessage(
              title,
              { modal: true, detail },
              UI_TEXT.saveProvider,
              UI_TEXT.wizardCancel,
            )) === UI_TEXT.saveProvider,
          showError: (message) => {
            void vscode.window.showErrorMessage(message)
          },
          showNotice: (message) => {
            void vscode.window.showInformationMessage(message)
          },
        },
      })
      if (outcome !== undefined) {
        await host.onWizardSaved?.({ ...outcome, composerSet: true, sessionBudgetUsd: undefined })
      }
      return outcome
    },
    completePendingRemovals: () => providers.completePendingRemovals(),
    suggestedPreset: () => providers.suggestedPreset(host.suggestedProviderSetting()),
  }
}
