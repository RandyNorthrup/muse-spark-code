// The providers' host verbs (M95 lane K, PLAN.md D74): everything the
// Models & Agents panel bridge, the quick pick and the wizard drive — the
// password box, the key test with its paid question, the scans, removal
// with undo, import and export, OpenRouter's connect and usage, the local
// probe, the suggestions and the wizard save — composed from the
// SecretStorage records and the injected lane-P/T seams.

import { createHash, randomUUID } from 'node:crypto'
import type * as vscode from 'vscode'
import { PROVIDER_SECRET_PREFIX, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import type { SecretStore } from '../../auth/credentialStore'
import type { Logger } from '../../logger'
import type {
  CredentialRecord,
  ProviderCredentialStore as CredentialStore,
} from '../../providers/credentialRecords'
import { isOriginBound } from '../../providers/credentialRecords'
import {
  connectOpenRouterAccount,
  createOpenRouterUsageReader,
  promptOpenRouterCode,
  readOpenRouterKeyUsage,
} from '../../providers/openRouter'
import { huggingface } from '../../backend/providersEntry'
import type { ProviderSpendReport } from '../../../core/providers/providerSpend'
import type { OAuthLoopback } from '../../providers/oauthLoopback'
import { inspectProviderKey, providerKeyNoticeText } from '../../../core/providers/keyInspection'
import { promptForProviderKey } from './keyPrompt'
import { probeLocalServers, type LocalProbeResult } from '../../providers/localProbe'
import {
  createModelScanner,
  type ModelScan,
  type ScanOutcome,
  type ScanRequest,
  type ScanStore,
} from '../../providers/modelScans'
import {
  createProviderRemoval,
  type RemovalClock,
  type RemovalStore,
} from '../../providers/providerRemoval'
import {
  exportProviders,
  importProviders,
  previewProvidersImport,
  type ImportPreview,
} from '../../providers/importExport'
import {
  saveWizardDraft,
  type WizardDraft,
  type WizardSaveOutcome,
} from '../../providers/wizardSave'
import { workspaceSuggestedPreset } from '../../providers/workspaceSuggestion'
import type {
  AddressCheck,
  AddressPolicy,
  CodeExchanger,
  KeyTestResult,
  KeyTester,
  KeyUsageReader,
  KeyUsageSnapshot,
  ModelFetcher,
  ModelsPanelSeam,
  ProviderHeadersPorts,
  ModelSuggestion,
  PkceSource,
  PresetCatalog,
  PresetInfo,
  ProviderEntry,
  ProviderModelRow,
  ProvidersStore,
  SuggestionEngine,
} from '../../providers/providerPorts'

export interface ProvidersHostUi {
  readonly showInputBox: typeof vscode.window.showInputBox
  /** One pick from `items` (M95c part 6's header list); undefined when dismissed. */
  readonly pickOne: ProviderHeadersPorts['pickOne']
  /** States the one-token cost and asks before sending it (D74). */
  readonly confirmPaidTest: (message: string) => Promise<boolean>
  /** Asks once about a private-network address (D74). */
  readonly confirmPrivateNetwork: (message: string) => Promise<boolean>
  /**
  Asks whether a pasted key with a wrong-thing notice is used anyway.
  A "no" re-opens the box; the provider judges the sent key.
  */
  readonly confirmKeyUse: (message: string) => Promise<boolean>
  /** Opens a URL in the system browser. */
  readonly openBrowser: (url: string) => Promise<void>
  readonly onDiscardedKey?: () => void
}

export interface ProvidersHostDeps {
  readonly log: Logger
  readonly credentials: CredentialStore
  readonly secrets: SecretStore
  readonly store: ProvidersStore
  readonly catalog: PresetCatalog
  readonly policy: AddressPolicy
  readonly tester: KeyTester
  readonly fetcher: ModelFetcher
  readonly exchanger: CodeExchanger | undefined
  readonly huggingfaceExchanger?: CodeExchanger | undefined
  readonly usage: KeyUsageReader | undefined
  readonly onKeyUsage?: (
    snapshot: KeyUsageSnapshot & {
      readonly providerId: string
      readonly credentialId: string
      readonly observationId: string
    },
  ) => void
  /**
  The spend report consumer (PROVSPEND): the existing OpenRouter read as
  the first shared-shape report. Present beats `onKeyUsage`; the journal
  adaptation moves to the report and the snapshot callback stays as the
  fallback.
  */
  readonly onSpend?: (report: ProviderSpendReport) => void
  readonly pkce: PkceSource
  readonly suggest: SuggestionEngine
  readonly scanStore: ScanStore
  readonly removalStore: RemovalStore
  readonly clock: RemovalClock
  /** The one-shot loopback server behind an OAuth connect. */
  readonly startLoopback: (state: string) => Promise<OAuthLoopback>
  /** The loopback fetch (M95 step 1 decides which one never proxies). */
  readonly loopbackFetch: typeof fetch
  readonly now: () => number
  readonly setComposerModel: (modelRef: string) => Promise<void>
  /** M95c part 6: the seam's header manager (loaded with the seam). */
  readonly manageHeaders?: ModelsPanelSeam['manageHeaders']
  readonly ui: ProvidersHostUi
}

/** A provider with its credential state (never any of the key). */
export interface ProviderState {
  readonly entry: ProviderEntry
  readonly hasKey: boolean
  /** The origin the stored credential was entered for. */
  readonly origin: string | undefined
}

export interface ProvidersHost {
  readonly providers: () => Promise<readonly ProviderEntry[]>
  readonly defaultModel: () => Promise<string | undefined>
  readonly updateProvider: (entry: ProviderEntry) => Promise<void>
  readonly storedCredential: (entry: ProviderEntry) => Promise<string | undefined>
  /** Host-only edit baseline, including credentials refused at the entry's origin. */
  readonly credentialSnapshot: (id: string) => Promise<CredentialRecord | undefined>
  readonly preset: (id: string) => PresetInfo | undefined
  readonly presetIds: () => readonly string[]
  readonly suggestedPreset: (settingValue: string | undefined) => string | undefined
  /** The address verdict: refused stops, private asks once, else ok. */
  readonly confirmAddress: (address: string) => Promise<AddressCheck>
  readonly promptForKey: (preset: PresetInfo) => Promise<string | undefined>
  /**
  M95c part 6: add or remove the saved provider's custom request headers
  in the editor's own pickers; values go straight to the credential store.
  */
  readonly manageHeaders: (entry: ProviderEntry) => Promise<void>
  readonly testCredential: (entry: ProviderEntry, credential: string) => Promise<KeyTestResult>
  /** Tests the stored credential; "needs a key" when none was entered. */
  readonly testStoredCredential: (entry: ProviderEntry) => Promise<KeyTestResult>
  /** Every provider with its credential state, for the panel's list. */
  readonly providerStates: () => Promise<readonly ProviderState[]>
  readonly scan: (entry: ProviderEntry, request?: ScanRequest) => Promise<ScanOutcome>
  readonly scanDraft: (entry: ProviderEntry, credential: string | undefined) => Promise<ScanOutcome>
  readonly cancelScan: (providerId: string) => boolean
  readonly cachedScans: () => Promise<readonly ModelScan[]>
  readonly remove: (id: string) => Promise<ProviderEntry | undefined>
  readonly undoRemove: (id: string) => Promise<boolean>
  readonly completePendingRemovals: () => Promise<void>
  readonly exportConfig: () => Promise<string>
  readonly previewImport: (text: string) => Promise<ImportPreview>
  readonly importConfig: (
    text: string,
    shouldImport: (preview: ImportPreview) => Promise<boolean>,
  ) => Promise<number>
  readonly discardOpenRouterKey: () => void
  readonly connectOpenRouter: (
    isRemote: boolean,
    signal?: AbortSignal,
  ) => Promise<{ key: string } | undefined>
  /**
  Hugging Face OAuth connect. Refuses closed until the owner registers
  the OAuth app, naming that step; undefined when the user cancelled.
  */
  readonly connectHuggingFace: (
    isRemote: boolean,
    signal?: AbortSignal,
  ) => Promise<{ key: string } | undefined>
  readonly openRouterUsage: (
    credential: string,
    signal?: AbortSignal,
    entry?: ProviderEntry,
  ) => Promise<KeyUsageSnapshot | undefined>
  readonly probe: (preset: PresetInfo) => Promise<readonly LocalProbeResult[]>
  readonly suggestDefaultModel: (
    candidates: readonly ProviderModelRow[],
  ) => ModelSuggestion | undefined
  readonly suggestSessionBudget: (modelPrices: readonly string[]) => ModelSuggestion | undefined
  readonly saveDraft: (
    draft: WizardDraft,
    sessionBudget?: Parameters<typeof saveWizardDraft>[0]['sessionBudget'],
  ) => Promise<WizardSaveOutcome>
}

/**
The stored secret for a scan or test; undefined for a local server
without auth, or when no credential was entered. The secret is held only
for the call below, never logged or stored elsewhere.
*/
async function credentialFor(
  credentials: CredentialStore,
  entry: ProviderEntry,
): Promise<string | undefined> {
  if (entry.auth === 'none' || entry.auth === 'subscription') {
    return undefined
  }
  const record = await credentials.getProviderCredential(entry.id)
  if (record !== undefined && !isOriginBound(record, entry.address)) {
    throw new Error(UI_TEXT.importNeedsKey)
  }
  return record === undefined ? undefined : record.secret
}

export function createProvidersHost(deps: ProvidersHostDeps): ProvidersHost {
  let mutations = Promise.resolve()
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const previous = mutations
    const next = (async () => {
      await previous
      return await run()
    })()
    // A failure already reached the caller through `next`: the chain only
    // sequences later mutations, so observing its settlement (never its
    // rejection) keeps every later one running.
    mutations = (async () => {
      await Promise.allSettled([next])
    })()
    return next
  }
  const scanner = createModelScanner({
    fetch: deps.fetcher,
    credentialFor: (entry) => credentialFor(deps.credentials, entry),
    store: deps.scanStore,
    now: deps.now,
  })
  const removal = createProviderRemoval({
    providers: deps.store,
    secrets: deps.secrets,
    pending: deps.removalStore,
    clock: deps.clock,
    serialize,
  })
  const confirmedAddresses = new Set<string>()

  // The attributed key-usage read (journal attribution for the snapshot
  // path): shared by the plain read and the spend report's failure fallback.
  const attributedOpenRouterUsage = createOpenRouterUsageReader({
    reader: deps.usage,
    current: (id) => deps.credentials.getProviderCredential(id),
    ...(deps.onKeyUsage !== undefined && { onKeyUsage: deps.onKeyUsage }),
  })
  // Runs the key test, asking before a one-token check: declined answers
  // the paid state, so the panel can offer the test again.
  const runTest = async (entry: ProviderEntry, credential: string): Promise<KeyTestResult> => {
    const first = await deps.tester.test(entry, credential, false)
    // A tested OpenRouter key carries its credit balance: Account & usage
    // shows it at once instead of waiting for the next stream cost.
    if (first.kind === 'ok' && first.keyUsage !== undefined)
      deps.onKeyUsage?.({
        ...first.keyUsage,
        providerId: entry.id,
        credentialId: createHash('sha256').update(credential).digest('hex'),
        observationId: randomUUID(),
      })
    if (first.kind !== 'paid') {
      return first
    }
    const isConfirmed = await deps.ui.confirmPaidTest(
      fill(UI_TEXT.providerTestPaid, { cost: first.cost }),
    )
    return isConfirmed ? await deps.tester.test(entry, credential, true) : first
  }

  return {
    providers: () => deps.store.list(),
    defaultModel: () => deps.store.defaultModel(),
    storedCredential: (entry) => credentialFor(deps.credentials, entry),
    credentialSnapshot: (id) => deps.credentials.getProviderCredential(id),
    updateProvider: (entry) =>
      serialize(async () => {
        const entries = await deps.store.list()
        if (entries.every((candidate) => candidate.id !== entry.id)) {
          throw new Error(UI_TEXT.actionFailed)
        }
        await deps.store.replaceAll(
          entries.map((candidate) => (candidate.id === entry.id ? entry : candidate)),
        )
      }),
    preset: (id) => deps.catalog.get(id),
    presetIds: () => deps.catalog.ids(),
    suggestedPreset: (settingValue) =>
      workspaceSuggestedPreset(settingValue, (id) => deps.catalog.has(id)),
    confirmAddress: async (address) => {
      const verdict = await deps.policy.check(address)
      if (verdict.kind !== 'private') {
        return verdict
      }
      const isConfirmed = await deps.ui.confirmPrivateNetwork(
        fill(UI_TEXT.providerPrivateNetwork, { address: verdict.address }),
      )
      if (isConfirmed) {
        confirmedAddresses.add(address)
      }
      return isConfirmed ? verdict : { kind: 'refused', detail: UI_TEXT.providerPrivateConfirm }
    },
    promptForKey: async (preset) => {
      // Any non-blank key is accepted for the free key test; a value that
      // looks like the wrong thing (a URL, a path, placeholder text, inner
      // whitespace) asks once whether to use it anyway, and a "no"
      // re-opens the box. The provider judges the sent key.
      for (;;) {
        const key = await promptForProviderKey(deps.ui.showInputBox, {
          providerName: preset.name,
          origin: preset.origin,
          keyHint: preset.keyHint,
        })
        if (key === undefined) {
          return key
        }
        const inspection = inspectProviderKey(key)
        if (inspection === 'ok' || inspection === 'empty') {
          return key
        }
        const shouldUse = await deps.ui.confirmKeyUse(providerKeyNoticeText(inspection))
        if (shouldUse) {
          return key
        }
      }
    },
    manageHeaders: async (entry) => {
      if (deps.manageHeaders === undefined) throw new Error(UI_TEXT.actionFailed)
      await deps.manageHeaders(entry, {
        pickOne: deps.ui.pickOne,
        showInputBox: deps.ui.showInputBox,
        secrets: deps.secrets,
      })
    },
    testCredential: (entry, credential) => runTest(entry, credential),
    testStoredCredential: async (entry) => {
      const credential = await credentialFor(deps.credentials, entry)
      return credential === undefined
        ? { kind: 'failed', detail: UI_TEXT.importNeedsKey }
        : await runTest(entry, credential)
    },
    providerStates: async () => {
      const states: ProviderState[] = []
      const entries = await deps.store.list()
      for (const entry of entries) {
        if (entry.auth === 'subscription') {
          const present = await deps.secrets.get(`${PROVIDER_SECRET_PREFIX}${entry.id}`)
          states.push({ entry, hasKey: present !== undefined, origin: entry.address })
          continue
        }
        const record = await deps.credentials.getProviderCredential(entry.id)
        states.push({
          entry,
          hasKey: record !== undefined && isOriginBound(record, entry.address),
          origin: record?.origin,
        })
      }
      return states
    },
    scan: (entry, request) => scanner.scan(entry, request),
    scanDraft: async (entry, credential) => {
      if (credential === undefined && entry.auth !== 'none') {
        throw new Error(UI_TEXT.importNeedsKey)
      }
      const answer = await deps.fetcher.fetchModels(entry, credential)
      return { rows: answer.rows, diff: undefined, fromCache: false }
    },
    cancelScan: (providerId) => scanner.cancelScan(providerId),
    cachedScans: () => deps.scanStore.load(),
    remove: (id) => removal.remove(id),
    undoRemove: (id) => removal.undo(id),
    completePendingRemovals: () => removal.completePending(),
    exportConfig: () => exportProviders(deps.store),
    previewImport: async (text) =>
      await previewProvidersImport(
        await deps.store.list(),
        text,
        deps.policy,
        (preset) => deps.catalog.get(preset)?.origin,
      ),
    importConfig: (text, shouldImport) =>
      serialize(() =>
        importProviders(
          {
            store: deps.store,
            credentials: deps.credentials,
            policy: deps.policy,
            confirm: shouldImport,
            presetAddress: (preset) => deps.catalog.get(preset)?.origin,
          },
          text,
        ),
      ),
    discardOpenRouterKey: () => {
      deps.ui.onDiscardedKey?.()
    },
    connectHuggingFace: async (isRemote, signal) => {
      // Closed until the owner registers the OAuth app: the refusal names
      // that step and is thrown before the flow, never wrapped.
      const refusal = huggingface.huggingfaceConnectRefusal(
        huggingface.HF_OAUTH_CLIENT_ID,
        isRemote,
      )
      if (refusal !== undefined) throw new Error(refusal)
      const clientId = huggingface.HF_OAUTH_CLIENT_ID
      const exchanger = deps.huggingfaceExchanger
      if (clientId === undefined || exchanger === undefined)
        throw new Error(UI_TEXT.huggingfaceConnectFailed)
      try {
        const connection = await huggingface.connectHuggingFaceAccount({
          clientId,
          log: deps.log,
          pkce: deps.pkce,
          exchange: exchanger,
          openBrowser: deps.ui.openBrowser,
          startServer: deps.startLoopback,
          isRemote,
          ...(deps.ui.onDiscardedKey !== undefined && { onDiscardedKey: deps.ui.onDiscardedKey }),
          ...(signal !== undefined && { signal }),
        })
        return { key: connection.key }
      } catch (error) {
        if (signal?.aborted) return
        throw new Error(UI_TEXT.huggingfaceConnectFailed, { cause: error })
      }
    },
    connectOpenRouter: async (isRemote, signal) => {
      const exchanger = deps.exchanger
      if (exchanger === undefined) throw new Error(UI_TEXT.providerConnectFailed)
      try {
        const connection = await connectOpenRouterAccount({
          pkce: deps.pkce,
          exchange: exchanger,
          openBrowser: deps.ui.openBrowser,
          startServer: deps.startLoopback,
          promptForPastedCode: () => promptOpenRouterCode(deps.ui.showInputBox, signal),
          isRemote,
          ...(deps.ui.onDiscardedKey !== undefined && { onDiscardedKey: deps.ui.onDiscardedKey }),
          ...(signal !== undefined && { signal }),
        })
        return connection === undefined ? undefined : { key: connection.key }
      } catch {
        if (signal?.aborted) return
        throw new Error(UI_TEXT.providerConnectFailed)
      }
    },
    openRouterUsage: async (credential, signal, entry) => {
      if (deps.onSpend === undefined)
        return await attributedOpenRouterUsage(credential, signal, entry)
      if (deps.usage === undefined) return
      const snapshot = await readOpenRouterKeyUsage(deps.usage, credential, signal)
      // The report converts numbers only: a string amount falls back to
      // the attributed snapshot path like any other unreadable report.
      const { usedToday, usedThisWeek, usedThisMonth, limit, remaining } = snapshot
      if (
        typeof usedToday !== 'number' ||
        typeof usedThisWeek !== 'number' ||
        typeof usedThisMonth !== 'number' ||
        (limit !== undefined && typeof limit !== 'number') ||
        (remaining !== undefined && typeof remaining !== 'number')
      )
        return await attributedOpenRouterUsage(credential, signal, entry)
      // The provider core loads with its bundle: the entry require runs
      // here, on the key-usage read.
      const { providerSpendKeyUsage } = await import('../../backend/providersEntry')
      const report = providerSpendKeyUsage.openRouterSpendReport(
        { usedToday, usedThisWeek, usedThisMonth, limit, remaining },
        new Date(deps.now()).toISOString(),
      )
      if (providerSpendKeyUsage.isSpendFailure(report)) {
        // A failed report falls back to the attributed snapshot path, which
        // re-reads under the rotation guard instead of trusting this one.
        return await attributedOpenRouterUsage(credential, signal, entry)
      }
      deps.onSpend(report)
      return snapshot
    },
    probe: (preset) => probeLocalServers(preset.localProbes, deps.loopbackFetch),
    suggestDefaultModel: (candidates) => deps.suggest.defaultModel(candidates),
    suggestSessionBudget: (modelPrices) => deps.suggest.sessionBudget(modelPrices),
    saveDraft: (draft, sessionBudget) =>
      serialize(() =>
        saveWizardDraft(
          {
            store: deps.store,
            credentials: deps.credentials,
            policy: deps.policy,
            ...(sessionBudget !== undefined && { sessionBudget }),
            setComposerModel: deps.setComposerModel,
            isPrivateConfirmed: (address) => confirmedAddresses.has(address),
          },
          draft,
        ),
      ),
  }
}
