// Lane M95-0 (PLAN.md D74, M95): the bring-your-own-provider strings. Every
// key the Models & Agents panel, the wizard, the picker, Account & usage and
// the manifest wire reads must exist in English with its slots, and the new
// manifest entries must resolve through package.nls.json. Lanes K, M, U and
// X build against this inventory.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import { EN } from '../../src/shared/l10n/en'
import { isPluralForms } from '../../src/shared/l10n/forms'
import { fill, plural } from '../../src/shared/l10n/text'

const here = path.dirname(fileURLToPath(import.meta.url))
const nls = JSON.parse(
  readFileSync(path.join(here, '..', '..', 'package.nls.json'), 'utf8'),
) as Record<string, string>

/** The value at a dotted key path (`providerFilters.cloud`) in the English table. */
function at(root: unknown, dotted: string): unknown {
  let node: unknown = root
  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null) {
      return undefined
    }
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

// Every UI string M95 acceptance items 17–19 need, by dotted key. Groups
// (providerFilters, wireFormats, modelBadges, modelColumns, providerFields)
// list their leaves so a renamed leaf breaks here, not in the panel.
const M95_UI_KEYS = [
  'startWithOwnModel',
  'startWithOwnModelDetail',
  'setupComplete',
  'manageProviders',
  'modelsPanelTitle',
  'modelsPanelUnavailable',
  'providersSectionTitle',
  'modelsSectionTitle',
  'providerSearchPlaceholder',
  'modelsSearchPlaceholder',
  'providerFilters.cloud',
  'providerFilters.local',
  'providerFilters.subscription',
  'providerFilters.aggregator',
  'scanComputer',
  'providersScanning',
  'providerUntested',
  'keyBoundState',
  'providerKeyWorks',
  'providerTestPaid',
  'providerTestFailed',
  'scanFailed',
  'wizardPickProvider',
  'providerFields.provider',
  'providerFields.address',
  'providerFields.models',
  'providerFields.privacy',
  'wireFormats.responses',
  'wireFormats.chat',
  'wireFormats.anthropic',
  'getKey',
  'enterKey',
  'providerConnect',
  'providerConnectWaiting',
  'providerKeyPrompt',
  'keyStoredNote',
  'changeKey',
  'reconnectAccount',
  'providerEdit',
  'providerRemove',
  'testConnection',
  'saveProvider',
  'saveAndUseNow',
  'wizardBack',
  'wizardCancel',
  'wizardContinue',
  'suggestionAccept',
  'suggestionChange',
  'providerRemoved',
  'undoAction',
  'providerExport',
  'providerImport',
  'providerImportPreviewTitle',
  'importNeedsKey',
  'refreshModels',
  'scanNewModels',
  'scanRemovedModels',
  'scanRepricedModels',
  'modelBadges.recommended',
  'modelBadges.cheapestCapable',
  'modelBadges.largestContext',
  'modelBadges.newBadge',
  'modelUnpriced',
  'modelLocal',
  'modelPlan',
  'modelFree',
  'modelColumns.name',
  'modelColumns.context',
  'modelColumns.inputPrice',
  'modelColumns.outputPrice',
  'modelColumns.price',
  'privacyNoRetention',
  'privacyNoRetentionDetail',
  'privacyNoTraining',
  'privacyNoTrainingDetail',
  'privacyAnyProvider',
  'privacyAnyDetail',
  'spendLimitLink',
  'suggestDefaultModel',
  'suggestSessionBudget',
  'suggestReasonCheapest',
  'suggestReasonRecommended',
  'suggestReasonBudgetMedian',
  'providerAddressInvalid',
  'providerPrivateNetwork',
  'providerPrivateConfirm',
  'originBindingMismatch',
  'providerRedirectRefused',
  'addModelProviderRow',
  'manageModelsRow',
  'pickerModelDetail',
  'usageKeyUsage',
  'usageLimit',
  'usageRemaining',
  'usageToday',
  'usageThisMonth',
  'usageUnpricedDetail',
  'signOutRemoveProviders',
  'acpProvidersNone',
  'acpProviderAdded',
  'acpProviderRemoved',
  'execProviderNotConfigured',
]

describe('M95 strings', () => {
  it('defines every key the providers UI reads, with text', () => {
    expect(M95_UI_KEYS.length).toBeGreaterThan(0)
    for (const key of M95_UI_KEYS) {
      const value = at(EN, key)
      if (isPluralForms(value)) {
        expect(value.other, key).toMatch(/\S/)
      } else {
        expect(typeof value, key).toBe('string')
        expect(value as string, key).toMatch(/\S/)
      }
    }
  })

  it('confirms the finished wizard with the provider and model (acceptance 19)', () => {
    expect(fill(EN.setupComplete, { provider: 'OpenRouter', model: 'openai/gpt-oss-20b' })).toBe(
      'You’re set up with OpenRouter · openai/gpt-oss-20b',
    )
  })

  it('counts the key check and scan diffs in words', () => {
    expect(plural(EN.providerKeyWorks, 1)).toBe('Key works · 1 model')
    expect(plural(EN.providerKeyWorks, 5)).toBe('Key works · 5 models')
    expect(plural(EN.scanNewModels, 1)).toBe('1 new model since the last scan')
    expect(plural(EN.scanRemovedModels, 2)).toBe('2 models removed since the last scan')
    expect(plural(EN.scanRepricedModels, 2)).toBe('2 models with a new price since the last scan')
  })

  it('binds the stored key to its origin in words', () => {
    expect(fill(EN.keyBoundState, { origin: 'https://openrouter.ai' })).toBe(
      'stored, bound to https://openrouter.ai',
    )
  })

  it('names both origins when the file moved behind the credential', () => {
    expect(
      fill(EN.originBindingMismatch, {
        actual: 'https://example.com/v1',
        expected: 'https://openrouter.ai',
      }),
    ).toContain('https://example.com/v1')
  })
})

describe('M95 manifest strings', () => {
  const commands = new Map(
    (manifest.contributes.commands as { command: string; title: string; category: string }[]).map(
      (entry) => [entry.command, entry],
    ),
  )

  it('contributes the three provider commands with titles from package.nls.json', () => {
    for (const id of [
      'museSpark.startWithOwnModel',
      'museSpark.modelsAndAgents',
      'museSpark.addModelProvider',
    ]) {
      const entry = commands.get(id)
      expect(entry, id).toBeDefined()
      const key = entry?.title.replace(/^%(.+)%$/, '$1') ?? ''
      expect(nls[key], id).toMatch(/\S/)
      expect(entry?.category).toBe('%command.category%')
    }
  })

  it('lets a workspace suggest one provider preset, and nothing else', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default?: unknown; description?: string; scope?: string }
    >
    const suggested = properties['museSpark.suggestedProvider']
    expect(suggested?.default).toBe('')
    expect(suggested?.scope).toBeUndefined()
    const key = suggested?.description?.replace(/^%(.+)%$/, '$1') ?? ''
    expect(nls[key]).toContain('preset')
  })

  it('adds the walkthrough step that opens the wizard', () => {
    const [walkthrough] = manifest.contributes.walkthroughs as {
      steps: { id: string; title: string; description: string }[]
    }[]
    const step = walkthrough?.steps.find((entry) => entry.id === 'ownModel')
    expect(step).toBeDefined()
    for (const field of [step?.title, step?.description]) {
      const key = field?.replace(/^%(.+)%$/, '$1') ?? ''
      expect(nls[key], field).toMatch(/\S/)
    }
  })
})
