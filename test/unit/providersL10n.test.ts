// Provider text must follow the installed language after these modules load.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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
  formatUsd,
  plural,
  setUiText,
  UI_TEXT,
} from '../../src/shared/l10n/text'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('provider localization', () => {
  const tables = new URL('../../l10n/', import.meta.url)
  it.each(readdirSync(tables).filter((file) => /^ui\.[a-z-]+\.json$/u.test(file)))(
    'keeps provider and release commands in %s help',
    (file) => {
      const value: unknown = JSON.parse(readFileSync(fileURLToPath(new URL(file, tables)), 'utf8'))
      const help = z.object({ acpUsage: z.string() }).parse(value).acpUsage
      expect(help).toContain('auth set|status|clear --provider <id>')
      expect(help).toContain('providers list|add|test|remove')
      expect(help).toContain('report [options]')
      expect(help).toContain('setup [--maintenance]')
    },
  )

  it('reads preset descriptions, hints, labels and privacy at call time', () => {
    const openai = presetById('openai')
    expect(openai?.description).toBe(EN.providerText.descriptions.openai)
    setUiText(fr, 'fr')
    for (const preset of PRESETS) {
      expect(Object.values(fr.providerText.descriptions)).toContain(preset.description)
    }
    expect(openai?.description).toBe(fr.providerText.descriptions.openai)
    expect(openai?.keyHint).toBe(
      fill(fr.providerText.hints.prefix, { prefix: 'sk-', site: 'platform.openai.com' }),
    )
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
    expect(suggestSessionBudget(undefined, 1234.5)?.reason).toBe(
      fill(fr.providerText.suggest.history, { amount: formatUsd(1234.5, 2) }),
    )
    const model = {
      ref: 'groq/model',
      toolCalling: true,
      contextTokens: 32_768,
      inputUsd: 1e-6,
      outputUsd: 1e-6,
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
})
