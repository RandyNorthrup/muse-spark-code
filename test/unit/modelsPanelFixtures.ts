// Fixtures for the Models panel's unit tests: a host-owned state with a
// local provider, a scanned model and the wizard at every step. Kept in
// one file so the suites share builders instead of duplicating them.

import type {
  ModelRow,
  ModelsPanelState,
  PanelDraft,
  PanelSuggestion,
  PresetCard,
  ProviderKeyUsage,
  ProviderState,
  ProviderTest,
  SuggestionKind,
} from '../../src/shared/modelsPanel'

export const OLLAMA_PRESET: PresetCard = {
  id: 'ollama',
  label: 'Ollama',
  description: 'Models on this computer through Ollama',
  category: 'local',
  format: 'ollama',
  originKind: 'loopback',
  originDisplay: 'http://127.0.0.1:11434',
  auth: 'none',
  connectOAuth: false,
  keyHint: 'No key needed',
}

export const OPENROUTER_PRESET: PresetCard = {
  id: 'openrouter',
  label: 'OpenRouter',
  description: 'Hundreds of models behind one key',
  category: 'aggregator',
  format: 'chat',
  originKind: 'fixed',
  originDisplay: 'https://openrouter.ai',
  auth: 'apiKey',
  connectOAuth: true,
  keyHint: 'sk-or-…',
  keyPage: 'https://openrouter.ai/keys',
  docsUrl: 'https://openrouter.ai/docs',
  dataUseUrl: 'https://openrouter.ai/policy',
  privacyNote: 'Routing chooses who sees the prompt.',
}

export function makeProvider(overrides: Partial<ProviderState> = {}): ProviderState {
  return {
    id: 'ollama',
    presetId: 'ollama',
    label: 'Ollama',
    address: 'http://127.0.0.1:11434',
    format: 'ollama',
    auth: 'none',
    key: { state: 'missing' },
    test: makeTest(),
    models: ['ollama/qwen3:8b'],
    pinned: [],
    ...overrides,
  }
}

export function makeRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    ref: 'ollama/qwen3:8b',
    providerId: 'ollama',
    modelId: 'qwen3:8b',
    toolCalling: true,
    vision: false,
    reasoning: true,
    contextTokens: 131072,
    inputPerMillion: 0,
    outputPerMillion: 0,
    cachedPerMillion: 0,
    freeOrLocal: true,
    ticked: true,
    pinned: false,
    priceNote: 'local',
    badges: {
      recommended: true,
      cheapestCapable: false,
      largestContext: true,
      isNew: false,
    },
    ...overrides,
  }
}

export function makeTest(overrides: Partial<ProviderTest> = {}): ProviderTest {
  return { status: 'untested', ...overrides }
}

export function makeKeyUsage(overrides: Partial<ProviderKeyUsage> = {}): ProviderKeyUsage {
  return { dayUsd: 1.2, monthUsd: 3.4, limitUsd: 10, remainingUsd: 6.6, ...overrides }
}

export function makeSuggestion(kind: SuggestionKind): PanelSuggestion {
  return kind === 'defaultModel'
    ? {
        kind,
        modelRef: 'ollama/qwen3:8b',
        reason: 'The cheapest tool-calling model.',
        accepted: false,
      }
    : { kind, usd: 2.5, reason: 'From your recent sessions.', accepted: false }
}

export function makeDraft(overrides: Partial<PanelDraft> = {}): PanelDraft {
  return {
    step: 'pick-provider',
    auth: 'apiKey',
    keyPresent: false,
    keyShapeOk: false,
    connected: false,
    costAccepted: false,
    models: [],
    privacy: 'zdr',
    providerOrder: [],
    allowFallbacks: true,
    privateConfirmed: false,
    privateAsked: false,
    errors: [],
    blockers: ['Pick a provider first.'],
    ...overrides,
  }
}

export function makeState(overrides: Partial<ModelsPanelState> = {}): ModelsPanelState {
  return {
    presets: [OLLAMA_PRESET, OPENROUTER_PRESET],
    providers: [],
    models: [],
    totalModels: 0,
    filter: {},
    sort: { key: 'name', direction: 'asc' },
    facets: { providers: ['ollama'], families: ['qwen3'] },
    scans: {},
    suggestions: [],
    lastChoices: {},
    drafts: { edits: {} },
    pendingRemovals: [],
    ...overrides,
  }
}
