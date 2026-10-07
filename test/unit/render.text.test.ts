import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPORT_KINDS, REPORT_TEXT_COLUMNS } from '../../src/shared/constants'
import { finalizeReport } from '../../src/core/reporting/render/canonical'
import { createReportRenderers } from '../../src/core/reporting/render'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, uiLocale } from '../../src/shared/l10n/text'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import {
  GOLDEN_ROOT,
  RENDERERS,
  REPORT_THEME,
  localePort,
  renderFixture,
  valueFixture,
} from './reportRenderFixtures'

describe('report terminal text', () => {
  it.each(REPORT_KINDS)('matches the %s text golden', async (kind) => {
    expect(RENDERERS.text(renderFixture(kind), 'en', REPORT_THEME)).toBe(
      await readFile(path.join(GOLDEN_ROOT, `${kind}.text.golden`), 'utf8'),
    )
  })
  it('omits trailing whitespace from empty source details', () => {
    for (const kind of REPORT_KINDS) {
      const output = RENDERERS.text(renderFixture(kind), 'en', REPORT_THEME)
      expect(output).toContain('Reason:\n')
      expect(output).not.toMatch(/[^\S\n]+\n/)
    }
  })
  it('wraps long unbroken text, CJK and emoji at 80 cells and removes terminal controls', () => {
    const document = renderFixture()
    document.header.scope = `${'漢'.repeat(90)}\r\n${'😀'.repeat(90)}\n${'x'.repeat(180)}\u{1B}]8;;evil\u{7}\t\u{202E}`
    const output = RENDERERS.text(finalizeReport(document), 'en', REPORT_THEME)
    for (const line of output.split('\n')) {
      let columns = 0
      for (const char of line) columns += /[漢😀]/u.test(char) ? 2 : 1
      expect(columns).toBeLessThanOrEqual(REPORT_TEXT_COLUMNS)
    }
    expect(output).not.toContain('\r')
    expect(output.replaceAll('\n', '')).not.toMatch(/\p{Cc}|\u{202E}/u)
    expect(output).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u)
    expect(output.endsWith('\n\n')).toBe(false)
  })
  it('keeps family emoji and combining accents whole across wraps', () => {
    const document = renderFixture()
    const emoji = '👨‍👩‍👧‍👦'
    document.header.scope = `${'x'.repeat(72)}${emoji}e\u{301}${emoji}`
    const output = RENDERERS.text(finalizeReport(document), 'en', REPORT_THEME)
    expect(output).toContain(`${emoji}e\u{301}${emoji}`)
  })
  it.each(['\u{FFE5}', '\u{3000}', '😀'])(
    'wraps Unicode East Asian Width fullwidth/wide characters and emoji at 80 cells: %s',
    (char) => {
      const document = renderFixture()
      document.header.scope = char.repeat(90)
      const output = RENDERERS.text(finalizeReport(document), 'en', REPORT_THEME)
      for (const line of output.split('\n')) {
        let columns = 0
        for (const point of line) columns += point === char ? 2 : 1
        expect(columns).toBeLessThanOrEqual(REPORT_TEXT_COLUMNS)
      }
      expect(output.split(char).length - 1).toBe(90)
    },
  )
  it.each(TABLE_LOCALES)(
    'uses the explicit %s table, numbers, money, units and counts without installing locale state',
    async (locale) => {
      const renderers = createReportRenderers(await localePort(locale))
      setUiText(EN, 'en')
      const output = renderers.text(valueFixture(), locale, REPORT_THEME)
      expect(output).toContain(new Intl.NumberFormat(locale).format(1234.5))
      expect(output).toContain(
        new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(1.46),
      )
      expect(output).toContain(
        new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(0.42),
      )
      expect(output).toContain('2026-10-06T19:00:00.000+00:00')
      expect(output).toContain(locale)
      expect(uiLocale()).toBe('en')
    },
  )
})
