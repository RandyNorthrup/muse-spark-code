// The providers' host verbs (M95 lane K, PLAN.md D74): everything the
// Models & Agents panel bridge, the quick pick and the wizard drive — the
// password box, the key test with its paid question, the scans, removal
// with undo, import and export, OpenRouter's connect and usage, the local
// probe, the suggestions and the wizard save — composed from the
// SecretStorage records and the injected lane-P/T seams.

import type * as vscode from 'vscode'
import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { SecretStore } from '../auth/credentialStore'
import type { ProviderCredentialStore as CredentialStore } from './credentialRecords'
import { isOriginBound } from './credentialRecords'
import { readOpenRouterKeyUsage } from './openRouter'
import { connectOpenRouterAccount } from './openRouter'
import type { OAuthLoopback } from './oauthLoopback'
import { promptForProviderKey } from './keyPrompt'
import { probeLocalServers, type LocalProbeResult } from './localProbe'
import {
  createModelScanner,
  type ModelScan,
  type ScanOutcome,
  type ScanRequest,
  type ScanStore,
} from './modelScans'
import { createProviderRemoval, type RemovalClock, type RemovalStore } from './providerRemoval'
import {
  exportProviders,
  importProviders,
  previewProvidersImport,
  type ImportPreview,
} from './importExport'
import { saveWizardDraft, type WizardDraft, type WizardSaveOutcome } from './wizardSave'
import { workspaceSuggestedPreset } from './workspaceSuggestion'
import type {
  AddressCheck,
  AddressPolicy,
  CodeExchanger,
  KeyTestResult,
  KeyTester,
  KeyUsageReader,
  KeyUsageSnapshot,
  ModelFetcher,
  ModelSuggestion,
  PkceSource,
  PresetCatalog,
  PresetInfo,
  ProviderEntry,
  ProviderModelRow,
  ProvidersStore,
  SuggestionEngine,
} from './providerPorts'

export interface ProvidersHostUi {
  readonly showInputBox: typeof vscode.window.showInputBox
  /** States the one-token cost and asks before sending it (D74). */
  readonly confirmPaidTest: (message: string) => Promise<boolean>
  /** Asks once about a private-network address (D74). */
  readonly confirmPrivateNetwork: (message: string) => Promise<boolean>
  /** Opens a URL in the system browser. */
  readonly openBrowser: (url: string) => Promise<void>
}

export interface ProvidersHostDeps {
  readonly credentials: CredentialStore
  readonly secrets: SecretStore
  readonly store: ProvidersStore
  readonly catalog: PresetCatalog
  readonly policy: AddressPolicy
  readonly tester: KeyTester
  readonly fetcher: ModelFetcher
  readonly exchanger: CodeExchanger
  readonly usage: KeyUsageReader
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
  readonly updateProvider: (entry: ProviderEntry) => Promise<void>
  readonly storedCredential: (entry: ProviderEntry) => Promise<string | undefined>
  readonly preset: (id: string) => PresetInfo | undefined
  readonly presetIds: () => readonly string[]
  readonly suggestedPreset: (settingValue: string | undefined) => string | undefined
  /** The address verdict: refused stops, private asks once, else ok. */
  readonly confirmAddress: (address: string) => Promise<AddressCheck>
  readonly promptForKey: (preset: PresetInfo) => Promise<string | undefined>
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
  readonly connectOpenRouter: (isRemote: boolean) => Promise<{ key: string } | undefined>
  readonly openRouterUsage: (credential: string) => Promise<KeyUsageSnapshot>
  readonly probe: (preset: PresetInfo) => Promise<readonly LocalProbeResult[]>
  readonly suggestDefaultModel: (
    candidates: readonly ProviderModelRow[],
  ) => ModelSuggestion | undefined
  readonly suggestSessionBudget: (modelPrices: readonly string[]) => ModelSuggestion | undefined
  readonly saveDraft: (draft: WizardDraft) => Promise<WizardSaveOutcome>
}

/**
 * The stored secret for a scan or test; undefined for a local server
 * without auth, or when no credential was entered. The secret is held only
 * for the call below, never logged or stored elsewhere.
 */
async function credentialFor(
  credentials: CredentialStore,
  entry: ProviderEntry,
): Promise<string | undefined> {
  if (entry.auth === 'none') {
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
    mutations = (async () => {
      try {
        await next
      } catch {
        return
      }
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

  // Runs the key test, asking before a one-token check: declined answers
  // the paid state, so the panel can offer the test again.
  const runTest = async (entry: ProviderEntry, credential: string): Promise<KeyTestResult> => {
    const first = await deps.tester.test(entry, credential, false)
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
    storedCredential: (entry) => credentialFor(deps.credentials, entry),
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
      const verdict = deps.policy.check(address)
      if (verdict.kind !== 'private') {
        return verdict
      }
      const isConfirmed = await deps.ui.confirmPrivateNetwork(
        fill(UI_TEXT.providerPrivateNetwork, { address: verdict.address }),
      )
      if (isConfirmed) {
        confirmedAddresses.add(address)
      }
      return isConfirmed ? verdict : { kind: 'refused', detail: verdict.address }
    },
    promptForKey: (preset) =>
      promptForProviderKey(deps.ui.showInputBox, {
        providerName: preset.name,
        origin: preset.origin,
        keyHint: preset.keyHint,
        isKeyShape: (value) => preset.isKeyShape(value),
      }),
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
        const record = await deps.credentials.getProviderCredential(entry.id)
        states.push({ entry, hasKey: record !== undefined, origin: record?.origin })
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
      previewProvidersImport(
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
            policy: deps.policy,
            confirm: shouldImport,
            presetAddress: (preset) => deps.catalog.get(preset)?.origin,
          },
          text,
        ),
      ),
    connectOpenRouter: async (isRemote) => {
      const connection = await connectOpenRouterAccount({
        pkce: deps.pkce,
        exchange: deps.exchanger,
        openBrowser: deps.ui.openBrowser,
        startServer: deps.startLoopback,
        promptForPastedCode: () =>
          Promise.resolve(
            deps.ui.showInputBox({
              title: fill(UI_TEXT.providerConnect, { provider: 'OpenRouter' }),
              prompt: fill(UI_TEXT.providerConnectWaiting, { provider: 'OpenRouter' }),
              password: true,
              ignoreFocusOut: true,
            }),
          ),
        isRemote,
      })
      return connection === undefined ? undefined : { key: connection.key }
    },
    openRouterUsage: (credential) => readOpenRouterKeyUsage(deps.usage, credential),
    probe: (preset) => probeLocalServers(preset.localProbes, deps.loopbackFetch),
    suggestDefaultModel: (candidates) => deps.suggest.defaultModel(candidates),
    suggestSessionBudget: (modelPrices) => deps.suggest.sessionBudget(modelPrices),
    saveDraft: (draft) =>
      serialize(() =>
        saveWizardDraft(
          {
            store: deps.store,
            credentials: deps.credentials,
            policy: deps.policy,
            setComposerModel: deps.setComposerModel,
            isPrivateConfirmed: (address) => confirmedAddresses.has(address),
          },
          draft,
        ),
      ),
  }
}
