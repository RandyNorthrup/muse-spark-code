import type { ModelsPanelDeps } from './modelsPanel'
// The Models & Agents panel's bundle (M95 lane K, PLAN.md D6): esbuild
// builds this file into dist/modelsPanel.js, which the activation bundle
// requires on the first Models & Agents action, so the panel's host side
// and the quick pick stay out of the bundle VS Code loads at activation.
// The lane-P/T seam (the providers file, presets, tests, scans, PKCE,
// suggestions) arrives as parameters, read from `dist/providers.js`.

import * as vscode from 'vscode'
import {
  GLOBAL_STATE_KEYS,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_PRICED_MODELS,
  MODEL_API_PRICES_PER_MILLION,
  SETTINGS_SECTION,
  UI_TEXT,
} from '../../../shared/constants'
import type { TeamPanelBinding, TeamPanelHost } from '../../models/teamPanelBinding'
import { randomUUID } from 'node:crypto'
import { providerSetupSchema } from '../../../shared/providerSetup'
import type { ChatSurface } from '../../views/chatSurface'
import type { WebviewBundleResolution } from '../../views/webviewBundle'
import { fill, setUiText } from '../../../shared/l10n/text'
import type { SecretStore } from '../../auth/credentialStore'
import type { JudgeSetupSectionPort } from '../judgeSetup/judgeSetupPanel'
import type { MigrationShell } from '../../vault/migrationShell'
import { ProviderCredentialStore as CredentialStore } from '../../providers/credentialRecords'
import type { UiTable } from '../../l10n'
import type { Logger } from '../../logger'
import type { VaultBundle } from '../vault/vaultPanelBundle'
import { showPickOne } from '../quickPick'
import { openRouterDiscardedKeyNotice } from '../../backend/providersEntry'
import { startOAuthLoopback } from '../../providers/oauthLoopback'
import { fetchLoopback } from '../../providers/loopbackFetch'
import {
  createModelsPanel,
  type ModelsPanel,
  type ModelsPanelNavigate,
  type ModelsVaultFactory,
} from './modelsPanel'
import { decodeImportFile } from '../../models/providerImportText'
import {
  runAddProviderQuickPick,
  type ProviderQuickPickOutcome,
} from '../../models/modelsQuickPick'
import {
  createSessionBudgetConfig,
  type SessionBudgetConfigSource,
} from '../../models/sessionBudget'
import { createProvidersHost, type ProvidersHost } from '../providers/providersHost'
import type { ModelScan, ScanStore } from '../../providers/modelScans'
import type { PendingRemoval, RemovalStore } from '../../providers/providerRemoval'
import type {
  ModelsPanelSeam,
  ProviderEntry,
  ProviderModelRow,
} from '../../providers/providerPorts'
export type { ModelsPanelSeam } from '../../providers/providerPorts'
import type { WizardSaveOutcome } from '../../providers/wizardSave'
export { credentialLeaseSecrets } from '../../models/credentialLeaseSecrets'

/** VS Code's global state, taken by shape (as `MementoLike` in paidHost). */
export interface ModelsPanelMemento {
  get(key: string): unknown
  update(key: string, value: unknown): Thenable<void>
}

export interface ModelsPanelHostDeps {
  readonly editorChat?:
    | { available(): boolean; selected(ref: string): boolean; toggle(ref: string): Promise<void> }
    | undefined
  readonly accounts?: ModelsPanelDeps['accounts']
  /** `isNewAccount` registers a different ChatGPT account instead of the saved one. */
  readonly connectChatGpt?: (isNewAccount: boolean) => Promise<void>
  readonly team?: TeamPanelBinding | undefined
  readonly connectCopilot?: () => Promise<void>
  readonly connectGrok?: () => Promise<void>
  readonly removeSubscription?: (id: string) => Promise<void>
  readonly isConfidential?: () => boolean
  readonly secrets: SecretStore
  readonly credentials?: CredentialStore
  readonly extensionUri: vscode.Uri
  /** The verified webview copy (VSIXWEB A), resolved in the activation bundle. */
  readonly resolveWebviewBundle: () => WebviewBundleResolution
  readonly l10n: UiTable
  readonly log: Logger
  readonly globalState: ModelsPanelMemento
  /**
  `museSpark.suggestedProvider` as written (a preset id at most): read
  fresh on every call, so a workspace edit applies without a reload.
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
  readonly onKeyUsage?: Parameters<typeof createProvidersHost>[0]['onKeyUsage']
  readonly onSpend?: Parameters<typeof createProvidersHost>[0]['onSpend']
  /**
  The vault bundle loader and its dist/ directory (C-M109-1 P1): the entry
  builds the broker-backed binding factory around this panel's publisher
  here, in dist/modelsPanel.js, so activation carries no factory body.
  Without both the section stays hidden.
  */
  readonly vault?: (() => VaultBundle) | undefined
  readonly vaultDir?: string | undefined
  /**
  The key-store migration's shell and its raw legacy source (D89.14 lane
  M). Absent until the window enables the vault path; the binding below
  builds the controller from it on first mount.
  */
  readonly credentialMigration?:
    | {
        readonly shell: MigrationShell
        readonly rawSecrets: SecretStore
        readonly minorRelease: () => number
      }
    | undefined
  /** The local-judge setup the Judge section manages (M125 lane W). */
  readonly judgeSetup?: JudgeSetupSectionPort | undefined
}

export interface ModelsPanelFeatures {
  /** Opens (or reveals) the Models & Agents panel. */
  readonly accountsChanged: () => void
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
      : { entry: removal['entry'], removedAt: removal['removedAt'] }
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
  return decodeImportFile(bytes)
}

/**
The panel's features, composed from the VS Code host and the lane-P/T
seam. One instance serves the window; the panel it opens is one tab.
*/
/**
The vault binding factory around this panel's publisher, built here in
dist/modelsPanel.js so activation carries no factory body. A throwing
loader (a switched-off vault, a missing bundle) leaves the panel without
the section, refusing exactly as 0.17.0 does.
*/
function vaultBindingFactory(
  host: ModelsPanelHostDeps,
  seam: ModelsPanelSeam,
): ModelsVaultFactory | undefined {
  const bundle = host.vault
  const distDir = host.vaultDir
  if (bundle === undefined || distDir === undefined) return undefined
  const source = host.credentialMigration
  return (publish) =>
    bundle().createModelsVaultBinding(
      {
        distDir,
        now: Date.now,
        publish,
        log: host.log,
        ...(source !== undefined && {
          credentialMigration: {
            shell: source.shell,
            rawSecrets: source.rawSecrets,
            minorRelease: source.minorRelease,
            listProviderIds: async () => {
              const entries = await seam.store.list()
              return entries.map((entry) => entry.id)
            },
          },
        }),
      },
      host.l10n.table,
      host.l10n.locale,
    )
}

/**
The live settings behind the budget config port: the single adapter both
the panel and the wizard use, also shared with the integration suite so
the store behaviour is proved against this exact wiring.
*/
export function vscodeSessionBudgetSource(): SessionBudgetConfigSource {
  return {
    get: (section) => vscode.workspace.getConfiguration(SETTINGS_SECTION).get(section),
    inspect: (section) => {
      const inspected = vscode.workspace.getConfiguration(SETTINGS_SECTION).inspect(section)
      return inspected === undefined
        ? undefined
        : {
            workspaceValue: inspected.workspaceValue,
            workspaceFolderValue: inspected.workspaceFolderValue,
          }
    },
    update: async (section, value, scope): Promise<void> => {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(
          section,
          value,
          scope === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global,
        )
    },
  }
}

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
    log: host.log,
    credentials,
    secrets: host.secrets,
    store: seam.store,
    catalog: seam.catalog,
    policy: seam.policy,
    tester: seam.tester,
    fetcher: seam.fetcher,
    exchanger: seam.exchanger,
    huggingfaceExchanger: seam.huggingfaceExchanger,
    usage: seam.usage,
    ...(host.onKeyUsage !== undefined && { onKeyUsage: host.onKeyUsage }),
    ...(host.onSpend !== undefined && { onSpend: host.onSpend }),
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
    // M95 step 1: the probe never uses VS Code's patched fetch (it honors
    // the user's proxy, and loopback needs no proxy at all).
    loopbackFetch: fetchLoopback,
    now: () => Date.now(),
    setComposerModel: host.setComposerModel,
    manageHeaders: seam.manageHeaders,
    ui: {
      onDiscardedKey: () => {
        void vscode.window.showWarningMessage(openRouterDiscardedKeyNotice())
      },
      showInputBox: vscode.window.showInputBox,
      pickOne: async (items, placeholder) =>
        await vscode.window.showQuickPick(items, {
          placeHolder: placeholder,
          ignoreFocusOut: true,
        }),
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
          UI_TEXT.providerPrivateConfirmLabel,
          UI_TEXT.wizardCancel,
        )) === UI_TEXT.providerPrivateConfirmLabel,
      confirmKeyUse: async (message) =>
        (await vscode.window.showWarningMessage(
          message,
          { modal: true },
          UI_TEXT.wizardContinue,
          UI_TEXT.wizardCancel,
        )) === UI_TEXT.wizardContinue,
      openBrowser: async (url) => {
        if (!(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
          throw new Error(UI_TEXT.providerConnectFailed)
        }
      },
    },
  })

  const team = createTeamPanelHost(host)
  // The wizard's spending limit IS the conversation spending limit
  // setting: both the panel and the quick pick read and write it through
  // this one configuration, at the scope it is effective from.
  const sessionBudget = createSessionBudgetConfig(vscodeSessionBudgetSource(), host.log)

  let panel: ModelsPanel | undefined
  const openPanel = (navigate?: ModelsPanelNavigate): void => {
    if (panel === undefined) {
      const created = createModelsPanel({
        accounts: host.accounts,
        extensionUri: host.extensionUri,
        resolveWebviewBundle: host.resolveWebviewBundle,
        l10n: host.l10n,
        log: host.log,
        judgeSetup: host.judgeSetup,
        vault: vaultBindingFactory(host, seam),
        providers,
        team,
        sessionBudget,
        editorChat: host.editorChat,
        metaModels: async () =>
          (await credentials.getApiKey()) === undefined
            ? []
            : MODEL_API_PRICED_MODELS.standard.map((id) => ({
                id,
                label: id,
                toolCapable: true,
                vision: true,
                reasoning: true,
                context: MODEL_API_CONTEXT_WINDOW,
                inputPerMillion: Number(MODEL_API_PRICES_PER_MILLION.standard.input),
                outputPerMillion: Number(MODEL_API_PRICES_PER_MILLION.standard.output),
                cachedPerMillion: Number(MODEL_API_PRICES_PER_MILLION.standard.cachedInput),
                isFree: false,
                isLocal: false,
                priceFingerprint: JSON.stringify(MODEL_API_PRICES_PER_MILLION.standard),
              })),
        connectChatGpt: host.connectChatGpt,
        connectCopilot: host.connectCopilot,
        connectGrok: host.connectGrok,
        removeSubscription: host.removeSubscription,
        isConfidential: host.isConfidential,
        isRemote: host.isRemote,
        writeExportFile: host.writeExportFile ?? writeExportFile,
        readImportFile: host.readImportFile ?? readImportFile,
        confirmImport: async (preview) => {
          const lines = preview.rows.map(
            (row) =>
              `${row.change}: ${row.entry.id} (${row.entry.address})${row.needsKey ? ` · ${UI_TEXT.importNeedsKeyLabel}` : ''}`,
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
          // Every saved credential retires the ownership generation, whether
          // or not the composer adopts it now; only the notice needs the set.
          void Promise.resolve(host.onWizardSaved?.(outcome)).catch(() => {
            host.log.warn('Provider setup notification failed')
          })
          if (!outcome.composerSet) {
            return
          }
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
        sessionBudget,
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
      // The wizard's budget answer reaches the setting through the shared
      // function inside the quick pick; it is forwarded here, no longer
      // dropped.
      if (outcome !== undefined) {
        await host.onWizardSaved?.({
          providerId: outcome.providerId,
          modelRef: outcome.modelRef,
          composerSet: true,
          sessionBudgetUsd: outcome.sessionBudgetUsd,
        })
      }
      return outcome
    },
    accountsChanged: () => panel?.accountsChanged(),
    completePendingRemovals: () => providers.completePendingRemovals(),
    suggestedPreset: () => providers.suggestedPreset(host.suggestedProviderSetting()),
  }
}

/** The production adapter used by Models & Agents and native-host composition tests. */
export function createTeamPanelHost(
  host: Pick<ModelsPanelHostDeps, 'team' | 'l10n' | 'writeExportFile' | 'readImportFile'>,
): TeamPanelHost | undefined {
  return host.team === undefined
    ? undefined
    : {
        tree: host.team.tree,
        onTreeChange: host.team.onTreeChange,
        handle: host.team.handle,
        load: async () => {
          const binding = host.team
          const configuration = binding?.configuration
          const snapshots = binding?.snapshots
          if (configuration === undefined || snapshots === undefined || !binding?.isEnabled())
            return
          const { createTeamPanel } = await import('../../../core/team/teamPanelEntry')
          return createTeamPanel(host.l10n.table, host.l10n.locale, {
            ...configuration,
            ...((binding.dryRun ?? configuration.dryRun) !== undefined && {
              dryRun: binding.dryRun ?? configuration.dryRun,
            }),
            ...snapshots,
            isEnabled: () =>
              binding.isEnabled() &&
              binding.configuration === configuration &&
              binding.snapshots === snapshots,
            isTrusted: () => vscode.workspace.isTrusted,
            state: binding.state,
            reload: binding.reload,
            newId: randomUUID,
            confirmInPlace: async () =>
              (await vscode.window.showWarningMessage(
                UI_TEXT.teamInPlaceConfirm,
                { modal: true },
                UI_TEXT.wizardContinue,
                UI_TEXT.wizardCancel,
              )) === UI_TEXT.wizardContinue,
            writeExport: host.writeExportFile ?? writeExportFile,
            readImport: host.readImportFile ?? readImportFile,
          })
        },
      }
}
