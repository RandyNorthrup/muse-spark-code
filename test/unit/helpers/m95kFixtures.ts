// Shared fixtures for the M95 lane-K tests: presets, entries, rows and the
// seams behind `createProvidersHost`, so each test builds the same honest
// host with its own overrides.

import { window } from 'vscode'
import { CredentialStore } from '../../../src/host/auth/credentialStore'
import {
  createProvidersHost,
  type ProvidersHost,
  type ProvidersHostDeps,
} from '../../../src/host/providers/providersHost'
import type {
  AddressPolicy,
  CodeExchanger,
  KeyUsageReader,
  ModelFetcher,
  PkceSource,
  PresetCatalog,
  PresetInfo,
  ProviderEntry,
  ProviderModelRow,
  SuggestionEngine,
} from '../../../src/host/providers/providerPorts'
import type { ModelScan } from '../../../src/host/providers/modelScans'
import type { PendingRemoval } from '../../../src/host/providers/providerRemoval'
import { memoryProvidersStore, memorySecrets, unexpectedWarning } from './fakes'

export const OPENROUTER_PRESET: PresetInfo = {
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'One key for hundreds of models',
  kind: 'aggregator',
  origin: 'https://openrouter.ai',
  format: 'chat',
  auth: 'oauth',
  keyHint: 'sk-or-…',
  keyPage: 'https://openrouter.ai/keys',
  isKeyShape: (value) => value.startsWith('sk-or-'),
  freeTest: 'modelsList',
  localProbes: [],
  connectLabel: 'Connect OpenRouter account',
}

export const OLLAMA_PRESET: PresetInfo = {
  id: 'ollama',
  name: 'Ollama',
  description: 'Models on this computer',
  kind: 'local',
  origin: '',
  format: 'ollama',
  auth: 'none',
  keyHint: '',
  keyPage: '',
  isKeyShape: () => false,
  freeTest: 'none',
  localProbes: [{ host: '127.0.0.1', port: 11_434, path: '/' }],
}

export const TEST_CATALOG: PresetCatalog = {
  get: (id) => {
    if (id === 'openrouter') {
      return OPENROUTER_PRESET
    }
    return id === 'ollama' ? OLLAMA_PRESET : undefined
  },
  has: (id) => id === 'openrouter' || id === 'ollama',
  ids: () => ['openrouter', 'ollama'],
}

export const TEST_ENTRY: ProviderEntry = {
  id: 'openrouter',
  presetId: 'openrouter',
  address: 'https://openrouter.ai',
  auth: 'oauth',
  models: [],
}

/** A `ScanStore` (M95 lane K) backed by an array. */
export function memoryScanStore(scans: readonly ModelScan[] = []): {
  load(): Promise<readonly ModelScan[]>
  save(scans: readonly ModelScan[]): Promise<void>
} {
  let current = [...scans]
  return {
    load: () => Promise.resolve([...current]),
    save: (next) => {
      current = [...next]
      return Promise.resolve()
    },
  }
}

/** A `RemovalStore` (M95 lane K) backed by an array. */
export function memoryRemovalStore(pending: readonly PendingRemoval[] = []): {
  load(): Promise<readonly PendingRemoval[]>
  save(pending: readonly PendingRemoval[]): Promise<void>
} {
  let current = [...pending]
  return {
    load: () => Promise.resolve([...current]),
    save: (next) => {
      current = [...next]
      return Promise.resolve()
    },
  }
}

export function testRow(id: string, priceFingerprint = 'p1'): ProviderModelRow {
  return {
    id,
    label: id,
    toolCapable: true,
    vision: false,
    reasoning: false,
    context: 128_000,
    priceFingerprint,
    isFree: false,
    isLocal: false,
  }
}

export interface SeamBase {
  readonly catalog: PresetCatalog
  readonly policy: AddressPolicy
  readonly exchanger: CodeExchanger
  readonly usage: KeyUsageReader
  readonly pkce: PkceSource
}

/**
 * The seam members identical in every lane-K test: the catalogue, the
 * address policy, the OpenRouter exchange and usage readers, and PKCE.
 * Each test adds its own store, key tester, model rows and suggestions.
 */
export function seamBase(): SeamBase {
  return {
    catalog: TEST_CATALOG,
    policy: { check: () => ({ kind: 'ok' }) },
    exchanger: { exchange: () => Promise.resolve('sk-or-x') },
    usage: {
      read: () =>
        Promise.resolve({
          usedToday: 0,
          usedThisWeek: 0,
          usedThisMonth: 0,
          limit: 10,
          remaining: 10,
        }),
    },
    pkce: {
      create: () => ({ verifier: 'v', challenge: 'c' }),
      newState: () => 's',
    },
  }
}

/**
 * A scan that found two models, with the suggestion answers behind them:
 * the cheapest capable default and the session budget. Tests that drive a
 * model choice spread this into their seam.
 */
export function scannedTwoModels(): {
  readonly fetcher: ModelFetcher
  readonly suggest: SuggestionEngine
} {
  return {
    fetcher: { fetchModels: () => Promise.resolve({ rows: [testRow('m1'), testRow('m2')] }) },
    suggest: {
      defaultModel: () => ({ value: 'm1', reason: 'The cheapest capable model.' }),
      sessionBudget: () => ({ value: '5.00', reason: 'From your recent sessions.' }),
    },
  }
}

export interface TestHostParts {
  readonly deps?: Partial<ProvidersHostDeps>
  readonly confirmPaidTest?: (message: string) => Promise<boolean>
  readonly confirmPrivateNetwork?: (message: string) => Promise<boolean>
}

/** The host with memory backing and controllable confirms. */
export function testProvidersHost(parts: TestHostParts = {}): {
  readonly providers: ProvidersHost
  readonly secrets: ReturnType<typeof memorySecrets>
  readonly confirmPaidTest: (message: string) => Promise<boolean>
  readonly confirmPrivateNetwork: (message: string) => Promise<boolean>
} {
  const secrets = memorySecrets()
  const store = parts.deps?.store ?? memoryProvidersStore([TEST_ENTRY])
  const credentials = new CredentialStore(secrets, unexpectedWarning, 'test store', async () => {
    const entries = await store.list()
    return entries.map((entry) => entry.id)
  })
  const confirmPaidTest = parts.confirmPaidTest ?? (() => Promise.resolve(true))
  const confirmPrivateNetwork = parts.confirmPrivateNetwork ?? (() => Promise.resolve(true))
  const providers = createProvidersHost({
    credentials,
    secrets,
    store,
    ...seamBase(),
    tester: { test: () => Promise.resolve({ kind: 'ok', models: 3 }) },
    fetcher: { fetchModels: () => Promise.resolve({ rows: [] }) },
    suggest: {
      defaultModel: () => undefined,
      sessionBudget: () => undefined,
    },
    scanStore: memoryScanStore(),
    removalStore: memoryRemovalStore(),
    clock: { now: () => 0, schedule: () => ({ cancel: () => undefined }) },
    startLoopback: () =>
      Promise.resolve({
        bindHost: '127.0.0.1',
        redirectUri: 'http://127.0.0.1:9/callback',
        waitForCode: () => Promise.resolve('fixture-code'),
        close: () => undefined,
      }),
    loopbackFetch: () => Promise.reject(new Error('no network in this test')),
    now: () => 0,
    setComposerModel: () => Promise.resolve(),
    ui: {
      showInputBox: window.showInputBox,
      confirmPaidTest: (message) => confirmPaidTest(message),
      confirmPrivateNetwork: (message) => confirmPrivateNetwork(message),
      openBrowser: () => Promise.resolve(),
    },
    ...parts.deps,
  })
  return { providers, secrets, confirmPaidTest, confirmPrivateNetwork }
}
