import { Usd } from '../../src/shared/usd'
// Provider text must follow the installed language after these modules load.
import { afterEach, describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import fr from '../../l10n/ui.fr.json'
import ru from '../../l10n/ui.ru.json'
import { OPENROUTER_PRIVACY_CHOICES, PRESETS, presetById } from '../../src/core/providers/presets'
import { providerEntrySchema } from '../../src/core/providers/providersFile'
import { diffModelScans } from '../../src/core/providers/scanDiff'
import { suggestDefaultModel, suggestSessionBudget } from '../../src/core/providers/suggest'
import {
  applyWizardEvent,
  startWizard,
  wizardBlockers,
  wizardSummary,
} from '../../src/core/providers/wizardFlow'
import { EN } from '../../src/shared/l10n/en'
import {
  BASE_LOCALE,
  fill,
  formatNumber,
  plural,
  setUiText,
  UI_TEXT,
} from '../../src/shared/l10n/text'
import { formatUsd } from '../../src/shared/l10n/exactUsd'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('provider localization', () => {
  it('reads preset descriptions, hints, labels and privacy at call time', () => {
    const openai = presetById('openai')
    expect(openai?.description).toBe(EN.providerText.descriptions.openai)
    setUiText(fr, 'fr')
    for (const preset of PRESETS) {
      expect(Object.values(fr.providerText.descriptions)).toContain(preset.description)
    }
    expect(openai?.description).toBe(fr.providerText.descriptions.openai)
    expect(openai?.keyHint).toBe(fill(fr.providerText.hints.site, { site: 'platform.openai.com' }))
    expect(presetById('azure')?.keyHint).toBe(fr.providerText.hints.azure)
    expect(presetById('custom')?.label).toBe(fr.providerText.labels.custom)
    for (const choice of OPENROUTER_PRIVACY_CHOICES) {
      expect(Object.values(fr.providerText.privacy)).toContain(choice.blurb)
    }
    setUiText(EN, BASE_LOCALE)
    expect(openai?.description).toBe(EN.providerText.descriptions.openai)
  })

  it('localizes wizard errors, summary and suggestion reasons with Intl money', () => {
    setUiText(fr, 'fr')
    expect(wizardBlockers(startWizard())).toContain(fr.providerText.wizard.pick)
    expect(applyWizardEvent(startWizard(), { type: 'cancel' }).cancelled).toBe(true)
    expect(wizardSummary(startWizard()).lines).toContain(
      fill(fr.providerText.summary.destination, { value: '—' }),
    )
    expect(suggestSessionBudget(undefined, Usd.from(1234.5).toAmount())?.reason).toBe(
      fill(fr.providerText.suggest.history, { amount: formatUsd(1234.5, 2) }),
    )
    const model = {
      ref: 'groq/model',
      toolCalling: true,
      contextTokens: 32_768,
      inputUsd: Usd.from(1e-6).toAmount(),
      outputUsd: Usd.from(1e-6).toAmount(),
    }
    expect(suggestDefaultModel({ models: [model] })?.reason).toBe(
      fill(fr.providerText.suggest.cheapest, { ref: model.ref }),
    )
    const reason = fill(fr.providerText.suggest.recommended, { ref: model.ref })
    expect(
      suggestDefaultModel({ models: [{ ...model, recommended: true }], lastDefaultRef: model.ref })
        ?.reason,
    ).toBe(fill(fr.providerText.suggest.last, { reason }))
  })

  it('uses the installed scan plurals and formatted counts', () => {
    setUiText(ru, 'ru')
    const scan = { providerId: 'openai', scannedAtMs: 0, models: [{ id: 'a' }, { id: 'b' }] }
    expect(diffModelScans(undefined, scan).summary).toBe('Первое сканирование: 2 модели.')
    const many = {
      ...scan,
      models: Array.from({ length: 1000 }, (_, index) => ({ id: String(index) })),
    }
    expect(diffModelScans(undefined, many).summary).toBe(
      plural(UI_TEXT.providerText.scan.first, 1000),
    )
    expect(diffModelScans(undefined, many).summary).toContain(formatNumber(1000))
    const empty = { ...scan, models: [] }
    expect(diffModelScans(undefined, empty).summary).toBe(ru.providerText.scan.empty)
    expect(diffModelScans(scan, scan).summary).toBe(ru.providerText.scan.unchanged)
    expect(diffModelScans(empty, scan).summary).toBe(
      fill(ru.providerText.scan.since, { changes: plural(UI_TEXT.providerText.scan.new, 2) }),
    )
  })

  it('localizes provider validation errors when validation runs', () => {
    setUiText(fr, 'fr')
    const invalid = z.safeParse(providerEntrySchema, {
      id: 'custom',
      preset: 'custom',
      auth: 'none',
      models: ['unknown'],
    })
    expect(invalid.success).toBe(false)
    if (!invalid.success) {
      expect(invalid.error.message).toContain(fr.providerText.schema.customLimits)
    }
  })

  it('uses the grammatical Russian token noun for the output-cap minimum', () => {
    // RVMINOUT2 P3: `не менее` governs the genitive, so `one`/`other` take
    // токена and `few`/`many` take токенов — the same pattern as the file's
    // existing checksStoppedNotice (раунда/раундов), not the standalone
    // estimateTokens nominative nouns.
    setUiText(ru, 'ru')
    expect(plural(UI_TEXT.outputCapBelowMinimum, 1)).toBe(
      'Лимит вывода должен составлять не менее 1 токена.',
    )
    expect(plural(UI_TEXT.outputCapBelowMinimum, 2)).toBe(
      'Лимит вывода должен составлять не менее 2 токенов.',
    )
    expect(plural(UI_TEXT.outputCapBelowMinimum, 5)).toBe(
      'Лимит вывода должен составлять не менее 5 токенов.',
    )
    expect(plural(UI_TEXT.outputCapBelowMinimum, 16)).toBe(
      'Лимит вывода должен составлять не менее 16 токенов.',
    )
    expect(plural(UI_TEXT.outputCapBelowMinimum, 21)).toBe(
      'Лимит вывода должен составлять не менее 21 токена.',
    )
    expect(plural(UI_TEXT.outputCapBelowMinimum, 22)).toBe(
      'Лимит вывода должен составлять не менее 22 токенов.',
    )
  })
})
