import { MILLISECONDS_PER_SECOND } from '../../../shared/constants'
import type { UiText } from '../../../shared/l10n/en'
import { fill } from '../../../shared/l10n/text'
import type {
  ReportDocument,
  ReportLabelKey,
  ReportValue,
  ReportSection,
} from '../../../shared/reportSchema'
import { reportTimestamp } from './timestamp'

/** The host supplies its checked table; M102 can bind its separate report family here. */
export interface ReportLocalePort {
  textForLocale(
    locale: string,
  ): Pick<
    UiText,
    'reportLabels' | 'reportKinds' | 'reportUi' | 'reportRowsMore' | 'toggleOn' | 'toggleOff'
  >
}

/** Locale-specific Intl instances never install or consult the process-wide display state. */
export function reportDisplay(
  document: ReportDocument,
  locale: string,
  port: ReportLocalePort,
  scrub: (text: string) => string,
) {
  const UI_TEXT = port.textForLocale(locale)
  const number = new Intl.NumberFormat(locale)
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  const usd = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const seconds = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
  })
  const plurals = new Intl.PluralRules(locale)
  const timestamp = (value: string) => reportTimestamp(value, document.header.asOf)
  const label = (key: ReportLabelKey) => scrub(UI_TEXT.reportLabels[key])
  const value = (cell: ReportValue | undefined): string => {
    if (cell === undefined) throw new Error('Report cell missing from declared column')
    switch (cell.type) {
      case 'text': {
        return cell.value
      }
      case 'label': {
        return label(cell.value)
      }
      case 'count':
      case 'number': {
        return number.format(cell.value)
      }
      case 'percent': {
        return percent.format(cell.value / 100)
      }
      case 'usd': {
        return `${cell.value === null ? label('unknown') : usd.format(cell.value)} (${label(cell.certainty)})`
      }
      case 'durationMs': {
        return seconds.format(cell.value / MILLISECONDS_PER_SECOND)
      }
      case 'timestamp': {
        return timestamp(cell.value)
      }
      case 'boolean': {
        return scrub(cell.value ? UI_TEXT.toggleOn : UI_TEXT.toggleOff)
      }
      case 'textList': {
        return cell.value.join('\n')
      }
    }
  }
  const sourceLabels: readonly ReportLabelKey[] = [
    'name',
    'status',
    'reason',
    'observedAt',
    'freshness',
  ]
  return {
    label,
    value,
    sectionTable(section: ReportSection) {
      return {
        headers: [...section.columns.map((column) => label(column.label)), label('sources')],
        rows: section.rows.map((row) => [
          ...section.columns.map((column) => value(row.cells[column.key])),
          row.sourceIds.join(', '),
        ]),
      }
    },
    title: scrub(UI_TEXT.reportKinds[document.header.kind]),
    asOf: scrub(fill(UI_TEXT.reportUi.generatedAsOf, { asOf: document.header.asOf })),
    footer: scrub(
      fill(UI_TEXT.reportUi.footer, {
        version: document.footer.rendererVersion,
        icu: document.footer.icuVersion,
        locale,
      }),
    ),
    more(count: number) {
      return scrub(
        fill(UI_TEXT.reportRowsMore[plurals.select(count)] ?? UI_TEXT.reportRowsMore.other, {
          count: number.format(count),
        }),
      )
    },
    sources: {
      headers: sourceLabels.map((key) => label(key)),
      rows: document.sources.map((source) => [
        source.id,
        label(source.status),
        source.reason ?? '',
        source.observedAt === null ? label('unknown') : timestamp(source.observedAt),
        source.freshness.state === 'unknown'
          ? label('unknown')
          : `${label(source.freshness.state)} (${value({ type: 'durationMs', value: source.freshness.ageMs })})`,
      ]),
    },
  }
}

export type ReportDisplay = ReturnType<typeof reportDisplay>

/** LF and no terminal control sequences from source prose (escape/OSC/bidi controls included). */
export function printable(text: string): string {
  return text
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll('\t', ' ')
    .replaceAll(/\p{Cc}|[\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu, (char) =>
      char === '\n' ? char : '\u{FFFD}',
    )
}
