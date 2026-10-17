import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { forms } from '../../src/shared/l10n/forms'
import { fill, plural, setUiText, formatPercent } from '../../src/shared/l10n/text'
import { USAGE_EN } from '../../src/shared/l10n/usageEn'
import { tableProblems } from '../../src/shared/l10n/check'
import {
  isUsageText,
  loadUsageTable,
  setUsageText,
  usageTableFileName,
  USAGE_TEXT,
} from '../../src/shared/l10n/usageTable'

const deps = (language: string, value: unknown = USAGE_EN) => ({
  language,
  readTableFile: vi.fn(() => Promise.resolve(JSON.stringify(value))),
  warn: vi.fn(),
})
afterEach(() => {
  setUsageText(USAGE_EN)
  setUiText(EN, 'en')
})

describe('usage table family', () => {
  it('uses English without a file for English and unsupported languages', async () => {
    for (const language of ['en', 'en-US', 'unknown']) {
      const ports = deps(language)
      expect(await loadUsageTable(ports)).toEqual({ locale: 'en', table: USAGE_EN })
      expect(ports.readTableFile).not.toHaveBeenCalled()
    }
  })

  it('loads the exact or primary locale with a checked table and no Node/editor dependency', async () => {
    const table = { ...USAGE_EN, title: 'Nutzung und Kosten' }
    const ports = deps('de-CH', table)
    expect(await loadUsageTable(ports)).toEqual({ locale: 'de', table })
    expect(ports.readTableFile).toHaveBeenCalledWith(['l10n', 'usage.de.json'])
    expect(ports.warn).not.toHaveBeenCalled()
    expect(usageTableFileName('zh-tw')).toBe('usage.zh-tw.json')
    const portuguese = await loadUsageTable(deps('pt-BR'))
    expect(portuguese.locale).toBe('pt-br')
  })

  it('falls back on read/JSON errors, missing or extra keys, damaged slots and plural shapes', async () => {
    for (const value of [
      {},
      { ...USAGE_EN, extra: 'canary' },
      { ...USAGE_EN, journalHost: 'Host {path}' },
      { ...USAGE_EN, recordCount: 'records' },
    ]) {
      const ports = deps('de', value)
      const loaded = await loadUsageTable(ports)
      expect(loaded.locale).toBe('en')
      expect(ports.warn).toHaveBeenCalledWith('l10n/usage.de.json: invalid table')
    }
    for (const readTableFile of [
      vi.fn(() => Promise.resolve('{')),
      vi.fn(() => Promise.reject(new Error('private path canary'))),
    ]) {
      const ports = { language: 'de', readTableFile, warn: vi.fn() }
      const loaded = await loadUsageTable(ports)
      expect(loaded.locale).toBe('en')
      expect(ports.warn).toHaveBeenCalledWith('l10n/usage.de.json: unreadable')
    }
    expect(isUsageText(USAGE_EN, 'en')).toBe(true)
    expect(isUsageText({ apiKey: 'canary' }, 'en')).toBe(false)
  })

  it('installs at runtime, and restores English without changing the frozen source', () => {
    const table = { ...USAGE_EN, title: 'Nutzung und Kosten' }
    setUsageText(table)
    expect(USAGE_TEXT.title).toBe('Nutzung und Kosten')
    expect(USAGE_EN.title).toBe('Usage & cost')
    setUsageText(USAGE_EN)
    expect(USAGE_TEXT.title).toBe('Usage & cost')
  })

  it('formats range counts and threshold percentages in the installed display language', () => {
    expect(plural(USAGE_EN.rangeDays, 7)).toBe('7 days')
    setUiText(EN, 'de')
    setUsageText({ ...USAGE_EN, rangeDays: forms({ one: '{count} Tag', other: '{count} Tage' }) })
    expect(plural(USAGE_TEXT.rangeDays, 1234)).toBe('1.234 Tage')
    expect(fill(USAGE_TEXT.warning75, { percent: formatPercent(75) })).toBe(
      'At least 75\u{A0}% of the limit is used.',
    )
  })

  it('requires translations to keep templates and use their own plural categories', () => {
    const problems = tableProblems(
      USAGE_EN,
      { ...USAGE_EN, chartSummary: 'Zusammenfassung' },
      {
        locale: 'de',
        isStrict: false,
      },
    )
    expect(problems).toContain(
      'chartSummary: slots {from}, {group}, {metric}, {to} expected, found {}',
    )
    expect(tableProblems(USAGE_EN, USAGE_EN, { locale: 'en', isStrict: false })).toEqual([])
  })
})
