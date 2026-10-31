// The harness in any table (PLAN.md D33): `--lang=<id>` for the scripts that
// open test/harness/index.html, passed on as `?lang=<id>`. The page then
// reads l10n/ui.<id>.json, or for `pseudo` the pseudo-locale tables this
// module writes from the English ones (the UI table and, for the usage page,
// the usage table): every letter accented, each string in ⟦ ⟧ and about
// 30 % longer, so English the table did not supply stands out and long
// languages are simulated. {slots}, code spans and ** are kept as they are,
// plural entries keep English's forms, and the keys l10n/untranslated.json
// lets every language keep stay as they are, as in a real translation.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadL10n } from './l10nSource.mjs'

export const PSEUDO_LANG = 'pseudo'
// M111 (D91.20): the pseudo-RTL table, Android ar-XB style. Every UI string
// wrapped in a right-to-left override, so a mirrored layout renders in the
// harness under `?lang=pseudo-rtl` with the page direction flipped.
export const PSEUDO_RTL_LANG = 'pseudo-rtl'
// The pseudo tables are English underneath: their plural rules and formats.
const PSEUDO_LOCALE = 'en'
const PSEUDO_FILE = 'test/harness/l10n/ui.pseudo.json'
const USAGE_PSEUDO_FILE = 'test/harness/l10n/usage.pseudo.json'
const PSEUDO_RTL_FILE = 'test/harness/l10n/ui.pseudo-rtl.json'
const USAGE_PSEUDO_RTL_FILE = 'test/harness/l10n/usage.pseudo-rtl.json'
const UNTRANSLATED_FILE = 'l10n/untranslated.json'
const EVERY_LOCALE = '*'
const LANG_OPTION = '--lang='
// VS Code's display-language ids, lower case: de, pt-br, zh-cn.
const LANG_ID = /^[a-z]{2,3}(?:-[a-z\d]+)*$/
// Kept as they are: a {slot}, a code span, a bold marker.
const KEPT = /(\{\w+\}|`[^`]*`|\*\*)/
const ACCENTED = {
  a: 'á',
  c: 'ç',
  e: 'é',
  i: 'í',
  n: 'ñ',
  o: 'ó',
  s: 'š',
  u: 'ú',
  y: 'ý',
  z: 'ž',
  A: 'Á',
  C: 'Ç',
  E: 'É',
  I: 'Í',
  N: 'Ñ',
  O: 'Ó',
  S: 'Š',
  U: 'Ú',
  Y: 'Ý',
  Z: 'Ž',
}
const GROWTH = 0.3
const FILLER_WORD = 'ẋẋẋẋẋ '

function pseudoString(text) {
  if (text.trim() === '') {
    return text
  }
  const accented = text
    .split(KEPT)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replaceAll(/[a-z]/gi, (letter) => ACCENTED[letter] ?? letter),
    )
    .join('')
  const growth = Math.ceil(text.length * GROWTH)
  const filler = FILLER_WORD.repeat(Math.ceil(growth / FILLER_WORD.length))
    .slice(0, growth)
    .trimEnd()
  return `⟦${accented} ${filler}⟧`
}

function pseudoRtlString(text) {
  if (text.trim() === '') {
    return text
  }
  // A right-to-left override (U+202E) with its pop (U+202C), Android
  // ar-XB style; the bidi algorithm mirrors brackets itself.
  return `\u{202E}${text}\u{202C}`
}

function shapedTable(table, isPluralForms, kept, shape, prefix = '') {
  return Object.fromEntries(
    Object.entries(table).map(([name, value]) => {
      const key = `${prefix}${name}`
      if (typeof value === 'string') {
        return [name, kept.has(key) ? value : shape(value)]
      }
      return [
        name,
        isPluralForms(value)
          ? Object.fromEntries(
              Object.entries(value).map(([category, text]) => [category, shape(text)]),
            )
          : shapedTable(value, isPluralForms, kept, shape, `${key}.`),
      ]
    }),
  )
}

/**
Writes the pseudo-locale tables from the English ones: the accented table
and the pseudo-RTL table, each for the UI table and, for the usage page,
the usage table. Returns their paths.
*/
export async function writePseudoTable(repoRoot) {
  const { EN, USAGE_EN, isPluralForms, tableProblems } = await loadL10n(repoRoot)
  const untranslated = JSON.parse(readFileSync(path.join(repoRoot, UNTRANSLATED_FILE), 'utf8'))
  const files = []
  for (const [english, section, pseudoFile, shape] of [
    [EN, 'ui', PSEUDO_FILE, pseudoString],
    [USAGE_EN, 'usage', USAGE_PSEUDO_FILE, pseudoString],
    [EN, 'ui', PSEUDO_RTL_FILE, pseudoRtlString],
    [USAGE_EN, 'usage', USAGE_PSEUDO_RTL_FILE, pseudoRtlString],
  ]) {
    const kept = new Set(untranslated[section]?.[EVERY_LOCALE])
    const table = shapedTable(english, isPluralForms, kept, shape)
    const problems = tableProblems(english, table, { locale: PSEUDO_LOCALE, isStrict: false })
    if (problems.length > 0) {
      throw new Error(`the pseudo table does not match the English one:\n${problems.join('\n')}`)
    }
    const file = path.join(repoRoot, pseudoFile)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(table, null, 2)}\n`)
    files.push(file)
  }
  return files
}

/** A harness script's arguments: the scenarios, and the table from `--lang=<id>`. */
export function harnessArgs(argv) {
  let lang
  const scenarios = []
  for (const arg of argv) {
    if (arg.startsWith(LANG_OPTION)) {
      lang = arg.slice(LANG_OPTION.length)
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option ${arg}; the one option is --lang=<id>`)
    } else {
      scenarios.push(arg)
    }
  }
  if (
    lang !== undefined &&
    lang !== PSEUDO_LANG &&
    lang !== PSEUDO_RTL_LANG &&
    !LANG_ID.test(lang)
  ) {
    throw new Error(
      `--lang=${lang}: a VS Code language id (de, pt-br, …), ${PSEUDO_LANG} or ${PSEUDO_RTL_LANG}`,
    )
  }
  return { lang, scenarios }
}

/** Makes the table `lang` names ready: a pseudo table written afresh, a real one found. */
export async function prepareLang(repoRoot, lang) {
  if (lang === PSEUDO_LANG || lang === PSEUDO_RTL_LANG) {
    await writePseudoTable(repoRoot)
  } else if (lang !== undefined && !existsSync(path.join(repoRoot, 'l10n', `ui.${lang}.json`))) {
    throw new Error(`l10n/ui.${lang}.json is missing`)
  }
}

/** The harness URL's `&lang=<id>`, or nothing in English. */
export function langQuery(lang) {
  return lang === undefined ? '' : `&lang=${encodeURIComponent(lang)}`
}
