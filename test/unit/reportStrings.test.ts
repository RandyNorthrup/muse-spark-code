import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { REPORT_KINDS, REPORT_LABEL_KEYS, UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { tableProblems } from '../../src/shared/l10n/check'
import { TABLE_LOCALES } from '../../src/shared/l10n/locales'
import { fill, plural } from '../../src/shared/l10n/text'
import type {
  ReportLabelKey,
  ReportRow,
  ReportValue,
  ReportSection,
} from '../../src/shared/reportSchema'
import { reportValueSchema } from '../../src/shared/reportSchema'
import { installGerman, restoreEnglish } from './helpers/germanTable'
import { FakeLogOutputChannel } from './helpers/fakes'
import { reportDocument } from './helpers/reporting/snapshot'

const reportEnglish = {
  reportShowCommand: EN.reportShowCommand,
  reportShowItem: EN.reportShowItem,
  reportSlashDescription: EN.reportSlashDescription,
  reportUsageAction: EN.reportUsageAction,
  reportLabels: EN.reportLabels,
  reportKinds: EN.reportKinds,
  reportUi: EN.reportUi,
  reportRowsMore: EN.reportRowsMore,
  reportCliUsage: EN.reportCliUsage,
}

afterEach(restoreEnglish)
describe('M113 regional reporting text', () => {
  it('gives every schema label and kind a translated table key', () => {
    expect(Object.keys(EN.reportLabels)).toEqual([...REPORT_LABEL_KEYS])
    expect(Object.keys(EN.reportKinds)).toEqual([...REPORT_KINDS])
    const section: ReportSection = reportDocument().sections[0]!
    const row: ReportRow = section.rows[0]!
    const value: ReportValue = row.cells['state']!
    const key: ReportLabelKey = section.label
    expect(EN.reportLabels[key]).toBe('Status')
    expect(value.type).toBe('label')
  })
  it('labels input/output/cache totals and current/lagging stores through the closed vocabulary', () => {
    const labels = {
      inputTokens: 'Input tokens',
      outputTokens: 'Output tokens',
      cachedTokens: 'Cached tokens',
      current: 'Current',
      lagging: 'Lagging',
    }
    for (const [key, text] of Object.entries(labels)) {
      const value = reportValueSchema.parse({ type: 'label', value: key })
      if (value.type !== 'label') throw new Error('Expected a schema label')
      expect(UI_TEXT.reportLabels[value.value]).toBe(text)
    }
  })
  it.each(TABLE_LOCALES)(
    'has real %s translations, preserved slots and correct count forms',
    async (locale) => {
      const raw: unknown = JSON.parse(
        await readFile(new URL(`../../l10n/ui.${locale}.json`, import.meta.url), 'utf8'),
      )
      const table = Object.fromEntries(
        Object.keys(reportEnglish).map((key) => [
          key,
          typeof raw === 'object' && raw !== null ? Reflect.get(raw, key) : undefined,
        ]),
      )
      expect(tableProblems(reportEnglish, table, { locale, isStrict: true })).toEqual([])
    },
  )
  it('reads the installed language at runtime, including templates and counts', async () => {
    await installGerman(new FakeLogOutputChannel())
    expect(UI_TEXT.reportShowItem).toBe('Bericht anzeigen…')
    expect(UI_TEXT.reportLabels.needsYou).toBe('Benötigt Ihre Entscheidung')
    expect(UI_TEXT.reportLabels.inputTokens).toBe('Eingabetokens')
    expect(UI_TEXT.reportLabels.current).toBe('Aktuell')
    expect(UI_TEXT.reportLabels.lagging).toBe('Im Rückstand')
    expect(fill(UI_TEXT.reportUi.noChange, { asOf: '2026-10-06' })).toBe(
      'Keine Änderung seit 2026-10-06',
    )
    expect(plural(UI_TEXT.reportRowsMore, 2)).toBe('2 weitere Zeilen')
    expect(fill(UI_TEXT.reportCliUsage, { command: 'muse-spark-code-acp' })).toContain(
      'muse-spark-code-acp report <kind>',
    )
  })
})
