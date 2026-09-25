// Count-dependent strings (PLAN.md D33): one form per plural category the
// language uses, as `Intl.PluralRules` names them. English uses `one` and
// `other`; Russian, Polish and Czech add `few` and `many`.

export type PluralCategory = Intl.LDMLPluralRule

export type PluralForms = Readonly<Partial<Record<PluralCategory, string>>> & {
  readonly other: string
}

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set<PluralCategory>([
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
])

/** Marks an entry of the table as plural forms rather than a group of labels. */
export function forms(entry: PluralForms): PluralForms {
  return entry
}

/** Whether a table value is plural forms: only category keys, `other` among them. */
export function isPluralForms(value: unknown): value is PluralForms {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const keys = Object.keys(value)
  return keys.includes('other') && keys.every((key) => PLURAL_CATEGORIES.has(key))
}
