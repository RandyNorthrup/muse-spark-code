import { Usd } from '../../src/shared/usd'
import { EN } from '../../src/shared/l10n/en'
import { formatUsd } from '../../src/shared/l10n/exactUsd'
import { fill } from '../../src/shared/l10n/text'
// Fixtures for the Models panel's unit tests: a host-owned state with a
// local provider, a scanned model and the wizard at every step. Kept in
// one file so the suites share builders instead of duplicating them.

import type { ModelsPanelState, PanelDraft, PresetCard } from '../../src/shared/modelsPanel'

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
    sessionBudget: {
      effectiveUsd: Usd.from(0).toAmount(),
      nowLine: fill(EN.wizardSessionBudgetNow, {
        amount: formatUsd('0'),
        scope: EN.sessionBudgetScopeGlobal,
      }),
    },
    lastChoices: {},
    drafts: { edits: {} },
    pendingRemovals: [],
    ...overrides,
  }
}
