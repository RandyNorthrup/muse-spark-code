// The harness in any table (PLAN.md D33): `--lang=<id>` for the scripts that
// open test/harness/index.html, passed on as `?lang=<id>`. The page then
// reads l10n/ui.<id>.json, or for `pseudo` the pseudo-locale table this
// module writes from the English one: every letter accented, each string
// in ⟦ ⟧ and about 30 % longer, so English the table did not supply stands
// out and long languages are simulated. {slots}, code spans and ** are kept
// as they are, plural entries keep English's forms, and the keys
// l10n/untranslated.json lets every language keep stay as they are, as in a
// real translation.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadL10n } from './l10nSource.mjs'

export const PSEUDO_LANG = 'pseudo'
// The pseudo table is English underneath: its plural rules and formats.
const PSEUDO_LOCALE = 'en'
const PSEUDO_FILE = 'test/harness/l10n/ui.pseudo.json'
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

function pseudoTable(table, isPluralForms, kept, prefix = '') {
  return Object.fromEntries(
    Object.entries(table).map(([name, value]) => {
      const key = `${prefix}${name}`
      if (typeof value === 'string') {
        return [name, kept.has(key) ? value : pseudoString(value)]
      }
      return [
        name,
        isPluralForms(value)
          ? Object.fromEntries(
              Object.entries(value).map(([category, text]) => [category, pseudoString(text)]),
            )
          : pseudoTable(value, isPluralForms, kept, `${key}.`),
      ]
    }),
  )
}

/** Writes the pseudo-locale table from the English one; returns its path. */
export async function writePseudoTable(repoRoot) {
  const { EN, isPluralForms, tableProblems } = await loadL10n(repoRoot)
  const untranslated = JSON.parse(readFileSync(path.join(repoRoot, UNTRANSLATED_FILE), 'utf8'))
  const kept = new Set(untranslated.ui?.[EVERY_LOCALE])
  const table = pseudoTable(EN, isPluralForms, kept)
  const problems = tableProblems(EN, table, { locale: PSEUDO_LOCALE, isStrict: false })
  if (problems.length > 0) {
    throw new Error(`the pseudo table does not match the English one:\n${problems.join('\n')}`)
  }
  const file = path.join(repoRoot, PSEUDO_FILE)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(table, null, 2)}\n`)
  return file
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
  if (lang !== undefined && lang !== PSEUDO_LANG && !LANG_ID.test(lang)) {
    throw new Error(`--lang=${lang}: a VS Code language id (de, pt-br, …) or ${PSEUDO_LANG}`)
  }
  return { lang, scenarios }
}

/** Makes the table `lang` names ready: the pseudo table written afresh, a real one found. */
export async function prepareLang(repoRoot, lang) {
  if (lang === PSEUDO_LANG) {
    await writePseudoTable(repoRoot)
  } else if (lang !== undefined && !existsSync(path.join(repoRoot, 'l10n', `ui.${lang}.json`))) {
    throw new Error(`l10n/ui.${lang}.json is missing`)
  }
}

/** The harness URL's `&lang=<id>`, or nothing in English. */
export function langQuery(lang) {
  return lang === undefined ? '' : `&lang=${encodeURIComponent(lang)}`
}
