import { Usd } from '../../src/shared/usd'
// The Models & Agents panel's wire contract: every message and the full
// host-owned state parse, and no credential field crosses postMessage in
// either direction (M95 acceptance 5 and 17).

import { describe, expect, it } from 'vitest'
import german from '../../l10n/ui.de.json'
import french from '../../l10n/ui.fr.json'
import italian from '../../l10n/ui.it.json'
import { tableProblems } from '../../src/shared/l10n/check'
import { EN } from '../../src/shared/l10n/en'
import { makeDraft, makeState } from './modelsPanelFixtures.js'
import {
  type HostToPanelMessage,
  parseHostToPanelMessage,
  parseModelsPanelState,
  type ModelsPanelState,
  type PanelToHostMessage,
  parsePanelToHostMessage,
} from '../../src/shared/modelsPanel'

const emptyState: ModelsPanelState = makeState({
  presets: [],
  facets: { providers: [], families: [] },
})

const messages: readonly PanelToHostMessage[] = [
  { type: 'modelsPanel/ready' },
  { type: 'openExternal', url: 'https://platform.openai.com/api-keys' },
  { type: 'providers/select', presetId: 'openrouter' },
  { type: 'providers/connectSubscription', providerId: 'chatgpt' },
  { type: 'providers/connectSubscription', providerId: 'copilot' },
  { type: 'providers/edit', providerId: 'ollama' },
  { type: 'providers/prefill', fields: { address: 'https://openrouter.ai' } },
  {
    type: 'providers/prefill',
    fields: { address: 'http://127.0.0.1:11434' },
    providerId: 'ollama',
  },
  { type: 'providers/enterKey', mode: 'new' },
  { type: 'providers/enterKey', mode: 'change', providerId: 'openrouter' },
  { type: 'providers/connect' },
  { type: 'providers/connect', providerId: 'openrouter' },
  { type: 'providers/save', useNow: false, providerId: 'ollama' },
  { type: 'models/numCtx', providerId: 'ollama', ref: 'ollama/qwen3:8b', numCtx: 32_768 },
  { type: 'providers/test', acceptCost: false },
  { type: 'providers/test', acceptCost: true },
  { type: 'providers/wizard', event: 'next' },
  { type: 'providers/wizard', event: 'back' },
  { type: 'providers/wizard', event: 'cancel' },
  { type: 'providers/wizard', event: 'cancel', providerId: 'ollama' },
  { type: 'providers/save', useNow: false },
  { type: 'providers/save', useNow: true },
  { type: 'providers/remove', providerId: 'openrouter' },
  { type: 'providers/undoRemove', providerId: 'openrouter' },
  { type: 'providers/scanLocal' },
  { type: 'providers/export' },
  { type: 'providers/export', providerId: 'ollama' },
  { type: 'providers/import', json: '{"v":1,"providers":[]}', confirmed: false },
  { type: 'providers/import', json: '{"v":1,"providers":[]}', confirmed: true },
  { type: 'models/scan', providerId: 'ollama' },
  { type: 'models/cancelScan', providerId: 'ollama' },
  { type: 'models/tick', scope: { scope: 'wizard' }, ref: 'ollama/qwen3:8b', ticked: true },
  {
    type: 'models/tick',
    scope: { scope: 'provider', providerId: 'ollama' },
    ref: 'ollama/qwen3:8b',
    ticked: false,
  },
  { type: 'models/pin', providerId: 'ollama', ref: 'ollama/qwen3:8b', pinned: true },
  {
    type: 'models/filter',
    filter: { toolCalling: true, contextMin: 32_000, providerId: 'ollama' },
    sort: { key: 'input-price', direction: 'asc' },
  },
  { type: 'suggestions/accept', kind: 'defaultModel' },
  { type: 'suggestions/accept', kind: 'sessionBudget' },
  { type: 'suggestions/change', kind: 'defaultModel', modelRef: 'ollama/qwen3:8b' },
  { type: 'suggestions/change', kind: 'sessionBudget', usd: Usd.from(2.5).toAmount() },
]

const hostMessages: readonly HostToPanelMessage[] = [
  { type: 'modelsPanel/state', state: emptyState },
  { type: 'modelsPanel/navigate', section: 'providers' },
  { type: 'modelsPanel/navigate', section: 'models', itemId: 'ollama/qwen3:8b' },
]

describe('modelsPanel schemas', () => {
  it.each([
    [
      'de',
      { vision: EN.modelFilterLabels.vision, reasoning: EN.modelFilterLabels.reasoning },
      { vision: german.modelFilterLabels.vision, reasoning: german.modelFilterLabels.reasoning },
    ],
    [
      'fr',
      { vision: EN.modelFilterLabels.vision, docs: EN.providerDocs },
      { vision: french.modelFilterLabels.vision, docs: french.providerDocs },
    ],
    [
      'it',
      { provider: EN.modelFilterLabels.provider },
      { provider: italian.modelFilterLabels.provider },
    ],
  ] as const)(
    'strictly translates the reviewed model filters and provider documentation (%s)',
    (locale, english, table) => {
      expect(tableProblems(english, table, { locale, isStrict: true })).toEqual([])
    },
  )

  it('parses the empty first-run state', () => {
    const parsed = parseModelsPanelState(emptyState)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.message).toEqual(emptyState)
    }
  })

  it('parses every panel-to-host message', () => {
    for (const message of messages) {
      expect(parsePanelToHostMessage(message).ok).toBe(true)
    }
  })

  it('parses every host-to-panel message', () => {
    for (const message of hostMessages) {
      expect(parseHostToPanelMessage(message).ok).toBe(true)
    }
  })

  it('refuses an unknown message type in either direction', () => {
    expect(parsePanelToHostMessage({ type: 'providers/launch' }).ok).toBe(false)
    expect(parseHostToPanelMessage({ type: 'modelsPanel/launch' }).ok).toBe(false)
  })

  it('refuses a deep link to an unknown section', () => {
    expect(parseHostToPanelMessage({ type: 'modelsPanel/navigate', section: 'roles' }).ok).toBe(
      false,
    )
  })

  it('refuses a filter with an unknown sort key', () => {
    expect(
      parsePanelToHostMessage({
        type: 'models/filter',
        filter: {},
        sort: { key: 'price', direction: 'asc' },
      }).ok,
    ).toBe(false)
  })
})

// A key smuggled into any message fails validation instead of riding along
// (M95 acceptance 5: a key never reaches the webview, a log, a hook, a
// tool, a child process, an exported session or an error shown to the
// user). Break this by making a message non-strict or by adding a
// credential field, and this test names it.
const SMUGGLED_FIELDS = ['secret', 'apiKey', 'token', 'password', 'authorization', 'key'] as const

describe('modelsPanel carries no credential', () => {
  it('refuses a smuggled credential field on every panel-to-host message', () => {
    for (const message of messages) {
      for (const field of SMUGGLED_FIELDS) {
        const parsed = parsePanelToHostMessage({ ...message, [field]: 'sk-test-plant' })
        expect(parsed.ok, `${message.type} accepted .${field}`).toBe(false)
      }
    }
  })

  it('refuses a smuggled credential field on the state and its rows', () => {
    expect(parseModelsPanelState({ ...emptyState, secret: 'sk-test-plant' }).ok).toBe(false)
    expect(
      parseModelsPanelState({
        ...emptyState,
        providers: [
          {
            id: 'openrouter',
            presetId: 'openrouter',
            label: 'OpenRouter',
            format: 'chat',
            auth: 'apiKey',
            key: { state: 'stored', origin: 'https://openrouter.ai' },
            test: { status: 'untested' },
            models: [],
            pinned: [],
            apiKey: 'sk-test-plant',
          },
        ],
      }).ok,
    ).toBe(false)
    expect(
      parseModelsPanelState({
        ...emptyState,
        drafts: {
          edits: {},
          wizard: {
            ...makeDraft({
              step: 'credential',
              blockers: ['Enter the key or connect the account first.'],
            }),
            token: 'sk-test-plant',
          },
        },
      }).ok,
    ).toBe(false)
  })
})

it('pins subscription messages to their two supported providers and rejects credentials', () => {
  for (const message of [
    { type: 'providers/connectSubscription', providerId: 'meta' },
    { type: 'providers/connectSubscription', providerId: 'chatgpt', token: 'synthetic' },
    { type: 'providers/connectSubscription' },
  ])
    expect(parsePanelToHostMessage(message).ok).toBe(false)
})
