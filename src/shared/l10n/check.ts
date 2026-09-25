// How a translation is checked against English (PLAN.md D33). The host runs
// the shape checks on the table it loads, so a damaged file falls back to
// English instead of showing broken text; the l10n gate
// (`scripts/check-l10n.mjs`) runs them strictly on every table it ships.

import { isPluralForms, type PluralCategory, type PluralForms } from './forms'

const SLOT = /\{(\w+)\}/g
const CODE_SPAN = /`/g
const BOLD = /\*\*/g

export interface CheckOptions {
  /** The table's language: its plural categories come from `Intl.PluralRules`. */
  readonly locale: string
  /**
   * The gate's checks on top of the shape: exactly the language's plural
   * categories, the same code spans and bold markers, and no value left in
   * English unless its key is in `untranslated`.
   */
  readonly isStrict: boolean
  /** Dotted keys whose value may equal the English (names, commands, …). */
  readonly untranslated?: ReadonlySet<string>
}

function byText(left: string, right: string): number {
  return left.localeCompare(right)
}

function slotsOf(text: string): readonly string[] {
  const names = new Set(Array.from(text.matchAll(SLOT), (match) => match[1] ?? ''))
  return [...names].toSorted(byText)
}

function countOf(text: string, pattern: RegExp): number {
  return text.split(pattern).length - 1
}

function isSameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringProblems(
  key: string,
  english: string,
  value: string,
  options: CheckOptions,
): readonly string[] {
  const problems: string[] = []
  const expected = slotsOf(english)
  const found = slotsOf(value)
  if (!isSameList(expected, found)) {
    problems.push(
      `${key}: slots {${expected.join('}, {')}} expected, found {${found.join('}, {')}}`,
    )
  }
  if (!options.isStrict) {
    return problems
  }
  if (countOf(english, CODE_SPAN) !== countOf(value, CODE_SPAN)) {
    problems.push(`${key}: the code spans (\`) differ from the English`)
  }
  if (countOf(english, BOLD) !== countOf(value, BOLD)) {
    problems.push(`${key}: the bold markers (**) differ from the English`)
  }
  if (value === english && english.trim() !== '' && options.untranslated?.has(key) !== true) {
    problems.push(`${key}: left in English`)
  }
  return problems
}

function formsProblems(
  key: string,
  english: PluralForms,
  value: unknown,
  options: CheckOptions,
): readonly string[] {
  if (!isPluralForms(value)) {
    return [`${key}: plural forms expected (an object with "other")`]
  }
  const problems: string[] = []
  const englishSlots = slotsOf(english.other)
  // Parsed JSON: the category keys are checked, their values are not yet.
  const forms: Readonly<Record<string, unknown>> = value
  for (const [category, text] of Object.entries(forms)) {
    if (typeof text !== 'string') {
      problems.push(`${key}.${category}: text expected`)
      continue
    }
    const extra = slotsOf(text).filter((slot) => !englishSlots.includes(slot))
    if (extra.length > 0) {
      problems.push(`${key}.${category}: unknown slots {${extra.join('}, {')}}`)
    }
  }
  const other = forms['other']
  if (!isSameList(slotsOf(typeof other === 'string' ? other : ''), englishSlots)) {
    problems.push(`${key}.other: slots {${englishSlots.join('}, {')}} expected`)
  }
  if (options.isStrict) {
    const categories: readonly PluralCategory[] = new Intl.PluralRules(options.locale)
      .resolvedOptions()
      .pluralCategories.toSorted(byText)
    const found = Object.keys(forms).toSorted(byText)
    if (!isSameList(categories, found)) {
      problems.push(
        `${key}: ${options.locale} uses the forms ${categories.join(', ')}; found ${found.join(', ')}`,
      )
    }
  }
  return problems
}

function groupProblems(
  prefix: string,
  english: Readonly<Record<string, unknown>>,
  table: Readonly<Record<string, unknown>>,
  options: CheckOptions,
): readonly string[] {
  const problems: string[] = []
  for (const name of Object.keys(table)) {
    if (!Object.hasOwn(english, name)) {
      problems.push(`${prefix}${name}: not in the English table`)
    }
  }
  for (const [name, englishValue] of Object.entries(english)) {
    const key = `${prefix}${name}`
    const value = table[name]
    if (value === undefined) {
      problems.push(`${key}: missing`)
    } else if (typeof englishValue === 'string') {
      problems.push(
        ...(typeof value === 'string'
          ? stringProblems(key, englishValue, value, options)
          : [`${key}: text expected`]),
      )
    } else if (isPluralForms(englishValue)) {
      problems.push(...formsProblems(key, englishValue, value, options))
    } else if (isRecord(englishValue)) {
      problems.push(
        ...(isRecord(value)
          ? groupProblems(`${key}.`, englishValue, value, options)
          : [`${key}: a group of labels expected`]),
      )
    }
  }
  return problems
}

/** Every way `table` differs from `english` in shape (and, strictly, in content). */
export function tableProblems(
  english: Readonly<Record<string, unknown>>,
  table: unknown,
  options: CheckOptions,
): readonly string[] {
  return isRecord(table)
    ? groupProblems('', english, table, options)
    : ['the table is not a JSON object']
}
