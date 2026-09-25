// The table the extension shows, and the helpers that fill it in the display
// language (PLAN.md D33). `UI_TEXT` starts as English; the host installs the
// user's table at activation and hands the same table to each webview, which
// installs it before its first render. Everything reads `UI_TEXT.key` when
// it runs, never at module load, so the installed table is the one shown.

import { EN, type UiText } from './en'
import type { PluralForms } from './forms'

export const BASE_LOCALE = 'en'
const PERCENT_DIVISOR = 100
// `{name}`: a slot a template leaves for `fill`.
const SLOT = /\{(\w+)\}/g

interface LocaleState {
  locale: string
  pluralRules: Intl.PluralRules
  relativeTimes: Intl.RelativeTimeFormat
  dates: Intl.DateTimeFormat
  readonly formatters: Map<string, Intl.NumberFormat>
}

function stateFor(locale: string, formatters: Map<string, Intl.NumberFormat>): LocaleState {
  return {
    locale,
    pluralRules: new Intl.PluralRules(locale),
    relativeTimes: new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }),
    dates: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    formatters,
  }
}

// The installed language's rules and formatters, replaced by `setUiText`.
const current: LocaleState = stateFor(BASE_LOCALE, new Map())

/** What the user reads, in the display language once `setUiText` has run. */
export const UI_TEXT: UiText = { ...EN }

/** Installs a checked table and the language whose plural and number rules apply. */
export function setUiText(table: UiText, tableLocale: string): void {
  Object.assign(UI_TEXT, table)
  current.formatters.clear()
  Object.assign(current, stateFor(tableLocale, current.formatters))
}

/** The BCP 47 tag of the installed table (`en`, `de`, `zh-cn`, …). */
export function uiLocale(): string {
  return current.locale
}

export type TemplateValues = Readonly<Record<string, string | number>>

function numberFormat(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const cached = current.formatters.get(key)
  if (cached !== undefined) {
    return cached
  }
  const created = new Intl.NumberFormat(current.locale, options)
  current.formatters.set(key, created)
  return created
}

/** A count in the display language's digits and grouping: 1,234 / 1.234 / 1 234. */
export function formatNumber(value: number): string {
  return numberFormat('number', {}).format(value)
}

/** A whole percentage, as the language writes one: 42% / 42 % / %42. */
export function formatPercent(percent: number): string {
  return numberFormat('percent', { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / PERCENT_DIVISOR,
  )
}

/** An amount of US dollars as the language writes money: $1.46 / 1,46 $ / US$1.46. */
export function formatUsd(amount: number, fractionDigits: number): string {
  return numberFormat(`usd:${String(fractionDigits)}`, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount)
}

export type DurationUnit = 'second' | 'minute' | 'hour' | 'day'

/** A short amount of time in one unit: 3s / 3 Sek. / 3秒. */
export function formatUnit(value: number, unit: DurationUnit): string {
  return numberFormat(`unit:${unit}`, {
    style: 'unit',
    unit,
    unitDisplay: 'narrow',
  }).format(value)
}

/** "5 min. ago", "yesterday": a signed amount of time relative to now. */
export function formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  return current.relativeTimes.format(value, unit)
}

/** A calendar date in the display language. */
export function formatDate(epochMs: number): string {
  return current.dates.format(epochMs)
}

/** The template with each `{slot}` replaced; numbers are formatted, unknown slots stay. */
export function fill(template: string, values: TemplateValues): string {
  return template.replaceAll(SLOT, (whole, name: string) => {
    const value = values[name]
    if (value === undefined) {
      return whole
    }
    return typeof value === 'number' ? formatNumber(value) : value
  })
}

/** The form the language uses for `count`, filled with `count` and any other slots. */
export function plural(entry: PluralForms, count: number, values: TemplateValues = {}): string {
  const form = entry[current.pluralRules.select(count)] ?? entry.other
  return fill(form, { count, ...values })
}

export type TemplatePart = string | { readonly slot: string }

/** A template split around its slots, for a view that renders a slot as markup. */
export function templateParts(template: string): readonly TemplatePart[] {
  const parts: TemplatePart[] = []
  let last = 0
  for (const match of template.matchAll(SLOT)) {
    if (match.index > last) {
      parts.push(template.slice(last, match.index))
    }
    parts.push({ slot: match[1] ?? '' })
    last = match.index + match[0].length
  }
  if (last < template.length) {
    parts.push(template.slice(last))
  }
  return parts
}
