import { afterEach, describe, expect, it } from 'vitest'
import { tableProblems } from '../../src/shared/l10n/check'
import { EN } from '../../src/shared/l10n/en'
import { forms, isPluralForms } from '../../src/shared/l10n/forms'
import { tableFileName, tableLocaleFor } from '../../src/shared/l10n/locales'
import {
  BASE_LOCALE,
  fill,
  formatDate,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatUnit,
  plural,
  setUiText,
  templateParts,
  UI_TEXT,
  uiLocale,
} from '../../src/shared/l10n/text'

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

describe('fill', () => {
  it('fills each slot, formats numbers in the display language, and keeps unknown slots', () => {
    expect(fill('{count} files in {path}', { count: 1234, path: 'src' })).toBe('1,234 files in src')
    expect(fill('{missing} stays', {})).toBe('{missing} stays')
    setUiText(EN, 'de')
    expect(fill('{count}', { count: 1234 })).toBe('1.234')
  })
})

describe('plural', () => {
  const agents = forms({ one: '{count} agent', other: '{count} agents' })

  it('picks the English form by count and fills the other slots', () => {
    expect(plural(agents, 1)).toBe('1 agent')
    expect(plural(agents, 0)).toBe('0 agents')
    expect(
      plural(forms({ one: '{count} in {path}', other: '{count} in {path}' }), 2, { path: 'a' }),
    ).toBe('2 in a')
  })

  it('uses the language’s own categories, and falls back to other for a missing form', () => {
    setUiText(EN, 'ru')
    const russian = forms({
      one: '{count} агент',
      few: '{count} агента',
      many: '{count} агентов',
      other: '{count} агента',
    })
    expect(plural(russian, 1)).toBe('1 агент')
    expect(plural(russian, 3)).toBe('3 агента')
    expect(plural(russian, 5)).toBe('5 агентов')
    // English forms under Russian rules: `few` is missing, so `other` is used.
    expect(plural(agents, 3)).toBe('3 agents')
  })
})

describe('templateParts', () => {
  it('splits a template around its slots for a view that renders a slot as markup', () => {
    expect(templateParts('{percent} of model attempts came from subagents')).toEqual([
      { slot: 'percent' },
      ' of model attempts came from subagents',
    ])
    expect(templateParts('a {x} b {y}')).toEqual(['a ', { slot: 'x' }, ' b ', { slot: 'y' }])
    expect(templateParts('no slots')).toEqual(['no slots'])
  })
})

describe('Intl formatting in the display language', () => {
  it('writes percentages, units, relative times and dates as the language does', () => {
    expect(formatPercent(42)).toBe('42%')
    expect(formatNumber(1234)).toBe('1,234')
    expect(formatUnit(3, 'second')).toBe(
      new Intl.NumberFormat('en', { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(
        3,
      ),
    )
    expect(formatRelativeTime(-5, 'minute')).toBe(
      new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }).format(-5, 'minute'),
    )
    const epoch = Date.UTC(2026, 8, 25)
    expect(formatDate(epoch)).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(epoch),
    )
    setUiText(EN, 'de')
    expect(formatPercent(42)).toBe(new Intl.NumberFormat('de', { style: 'percent' }).format(0.42))
    expect(formatPercent(42)).not.toBe('42%')
  })
})

describe('setUiText', () => {
  it('installs a table and its locale, and English comes back', () => {
    setUiText({ ...EN, stopTitle: 'Stopp' }, 'de')
    expect(UI_TEXT.stopTitle).toBe('Stopp')
    expect(uiLocale()).toBe('de')
    setUiText(EN, BASE_LOCALE)
    expect(UI_TEXT.stopTitle).toBe('Stop')
    expect(uiLocale()).toBe('en')
  })
})

describe('isPluralForms', () => {
  it('tells plural forms from a group of labels', () => {
    expect(isPluralForms(EN.agentsCount)).toBe(true)
    expect(isPluralForms(EN.permissionModes)).toBe(false)
    expect(isPluralForms({ one: 'x' })).toBe(false)
    expect(isPluralForms('text')).toBe(false)
  })
})

describe('tableLocaleFor', () => {
  const locales = ['de', 'pt-br', 'zh-tw']

  it('takes the exact id, else the primary language, else English', () => {
    expect(tableLocaleFor('pt-BR', locales)).toBe('pt-br')
    expect(tableLocaleFor('de-ch', locales)).toBe('de')
    expect(tableLocaleFor('zh-cn', locales)).toBeUndefined()
    expect(tableLocaleFor('pt', locales)).toBeUndefined()
    expect(tableLocaleFor('en')).toBeUndefined()
    expect(tableFileName('pt-br')).toBe('ui.pt-br.json')
  })
})

describe('tableProblems', () => {
  const english = {
    title: 'Hello {name}',
    code: 'Run `muse login` **now**',
    agents: forms({ one: '{count} agent', other: '{count} agents' }),
    modes: { manual: 'Manual', plan: 'Plan' },
    brand: 'Muse',
  }
  const german = {
    title: 'Hallo {name}',
    code: 'Führe `muse login` **jetzt** aus',
    agents: { one: '{count} Agent', other: '{count} Agenten' },
    modes: { manual: 'Manuell', plan: 'Planen' },
    brand: 'Muse',
  }
  const strict = { locale: 'de', isStrict: true, untranslated: new Set(['brand']) }

  it('passes a complete translation', () => {
    expect(tableProblems(english, german, strict)).toEqual([])
  })

  it('finds missing, extra and misshapen entries in any mode', () => {
    const broken = {
      title: 'Hallo {nme}',
      agents: 'Agenten',
      modes: { manual: 'Manuell', plan: 'Planen', auto: 'Auto' },
      brand: 'Muse',
      extra: 'x',
    }
    expect(tableProblems(english, broken, { locale: 'de', isStrict: false })).toEqual([
      'extra: not in the English table',
      'title: slots {name} expected, found {nme}',
      'code: missing',
      'agents: plural forms expected (an object with "other")',
      'modes.auto: not in the English table',
    ])
    expect(tableProblems(english, [], strict)).toEqual(['the table is not a JSON object'])
  })

  it('strictly checks plural categories, code spans, bold markers and English left behind', () => {
    const lazy = {
      ...german,
      code: 'Führe muse login jetzt aus',
      agents: { one: '{count} агент', other: '{count} агента' },
      modes: { manual: 'Manual', plan: 'Planen' },
    }
    expect(tableProblems(english, lazy, { ...strict, locale: 'ru' })).toEqual([
      'code: the code spans (`) differ from the English',
      'code: the bold markers (**) differ from the English',
      'agents: ru uses the forms few, many, one, other; found one, other',
      'modes.manual: left in English',
    ])
    expect(tableProblems(english, lazy, { locale: 'ru', isStrict: false })).toEqual([])
  })

  it('checks every plural form’s slots, in any mode (the review of PR #23)', () => {
    const extra = { ...german, agents: { one: '{count} Agent {x}', other: '{count} Agenten' } }
    expect(tableProblems(english, extra, strict)).toEqual([
      'agents.one: slots {count} expected, found {count}, {x}',
    ])
    // Russian's `one` also covers 21 and 31, so a form cannot drop the number.
    const dropped = {
      ...german,
      agents: {
        one: 'агент',
        few: '{count} агента',
        many: '{count} агентов',
        other: '{count} агента',
      },
    }
    const problem = 'agents.one: slots {count} expected, found {}'
    expect(tableProblems(english, dropped, { ...strict, locale: 'ru' })).toEqual([problem])
    expect(tableProblems(english, dropped, { locale: 'ru', isStrict: false })).toEqual([problem])
  })

  it('strictly checks each plural form for code spans, bold markers and English left behind', () => {
    const english2 = {
      ...english,
      hint: forms({ one: '`{count}` **step**', other: '`{count}` **steps**' }),
    }
    const table = {
      ...german,
      hint: { one: '{count} Schritt', other: '`{count}` **steps**' },
    }
    expect(tableProblems(english2, table, strict)).toEqual([
      'hint.one: the code spans (`) differ from the English',
      'hint.one: the bold markers (**) differ from the English',
      'hint.other: left in English',
    ])
    expect(
      tableProblems(english2, table, { ...strict, untranslated: new Set(['brand', 'hint']) }),
    ).toEqual([
      'hint.one: the code spans (`) differ from the English',
      'hint.one: the bold markers (**) differ from the English',
    ])
  })

  it('accepts the English table against itself in shape', () => {
    expect(tableProblems(EN, EN, { locale: 'en', isStrict: false })).toEqual([])
  })
})
