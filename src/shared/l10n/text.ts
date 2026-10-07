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
  dateTimes: Intl.DateTimeFormat
  // M87 (PLAN.md D66): a message's time on its card, and a step summary's list.
  times: Intl.DateTimeFormat
  fullDateTimes: Intl.DateTimeFormat
  lists: Intl.ListFormat
  readonly formatters: Map<string, Intl.NumberFormat>
}

function stateFor(locale: string, formatters: Map<string, Intl.NumberFormat>): LocaleState {
  return {
    locale,
    pluralRules: new Intl.PluralRules(locale),
    relativeTimes: new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' }),
    dates: new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    dateTimes: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    times: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }),
    fullDateTimes: new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }),
    // A conjunction list, not a `unit` one (D66 named `unit`, short): Turkish,
    // Japanese, Korean, Russian and Chinese join units with bare spaces,
    // which no list of actions reads as (measured, docs/certification/m87-c.md).
    lists: new Intl.ListFormat(locale, { type: 'conjunction', style: 'long' }),
    formatters,
  }
}

// The installed language's rules and formatters, replaced by `setUiText`.
const current: LocaleState = stateFor(BASE_LOCALE, new Map())

/** What the user reads, in the display language once `setUiText` has run. */
// A descriptor clone has exactly EN's keys and value types; TypeScript cannot
// infer that from defineProperties (ACTDIET, PLAN.md §8). Getters stay lazy.
export const UI_TEXT = Object.defineProperties({}, Object.getOwnPropertyDescriptors(EN)) as UiText

/** Installs a checked table and the language whose plural and number rules apply. */
export function setUiText(table: UiText, tableLocale: string): void {
  Object.defineProperties(UI_TEXT, Object.getOwnPropertyDescriptors(table))
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

// Decimal sizes, as Intl's byte units are named (kB, MB).
const BYTES_PER_KILOBYTE = 1000
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * BYTES_PER_KILOBYTE
const SIZE_FRACTION_DIGITS = 1

/** A size as the language writes one, in the largest unit below it: 512 byte / 48.2 kB / 5.2 MB. */
export function formatBytes(bytes: number): string {
  let unit = 'byte'
  let value = bytes
  if (bytes >= BYTES_PER_MEGABYTE) {
    unit = 'megabyte'
    value = bytes / BYTES_PER_MEGABYTE
  } else if (bytes >= BYTES_PER_KILOBYTE) {
    unit = 'kilobyte'
    value = bytes / BYTES_PER_KILOBYTE
  }
  return numberFormat(`bytes:${unit}`, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: SIZE_FRACTION_DIGITS,
  }).format(value)
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

/** A local calendar date and time in the installed language. */
export function formatDateTime(epochMs: number): string {
  return current.dateTimes.format(epochMs)
}

/** The local time of day alone, as the language writes it: 14:05 / 2:05 PM (M87). */
export function formatTime(epochMs: number): string {
  return current.times.format(epochMs)
}

/** The full local date and the time: "Saturday, 3 October 2026 at 14:05" (M87). */
export function formatFullDateTime(epochMs: number): string {
  return current.fullDateTimes.format(epochMs)
}

/** Whether two moments fall on the same calendar day in the local time zone (M87). */
export function isSameLocalDay(aMs: number, bMs: number): boolean {
  const a = new Date(aMs)
  const b = new Date(bMs)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Parts joined as the language lists them: "a, b, and c" / "a, b und c" / "a、b、c" (M87). */
export function formatList(parts: readonly string[]): string {
  return current.lists.format(parts)
}

/** The first letter raised by the language's own case rules, the rest as it is (M87). */
export function capitalizeFirst(text: string): string {
  const first = text.codePointAt(0)
  if (first === undefined) {
    return text
  }
  const head = String.fromCodePoint(first)
  return `${head.toLocaleUpperCase(current.locale)}${text.slice(head.length)}`
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

const TOKENS_PER_MILLION = 1_000_000
const TOKENS_PER_THOUSAND = 1000
// Thousands are shown to one decimal: 12.3K.
const TOKENS_PER_TENTH_THOUSAND = 100
const TENTHS_PER_UNIT = 10

/** "1M" / "200K" / "12.3K" / "512" for a token count, in the display language's digits. */
export function formatTokenWindow(tokens: number): string {
  if (tokens < TOKENS_PER_THOUSAND) {
    return formatNumber(tokens)
  }
  const thousands = Math.round(tokens / TOKENS_PER_TENTH_THOUSAND) / TENTHS_PER_UNIT
  // 999,950 and up round to a thousand thousands: that is "1M", not "1,000K".
  return thousands < TOKENS_PER_THOUSAND
    ? `${formatNumber(thousands)}K`
    : `${formatNumber(Math.round(tokens / TOKENS_PER_MILLION))}M`
}
