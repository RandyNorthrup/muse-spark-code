#!/usr/bin/env node
// The localization gate (M40, PLAN.md D33), part of `quality:gates`.
//
// - Tables: l10n/ holds `ui.<language>.json` for each language
//   TABLE_LOCALES lists (src/shared/l10n/locales.ts) and for no other.
//   Each one is checked against the English table (src/shared/l10n/en.ts)
//   with the extension's own `tableProblems`, strictly: every key and no
//   extra one, the same {slots}, code spans and bold markers, exactly the
//   plural forms Intl.PluralRules gives the language, and no value left in
//   English unless l10n/untranslated.json allows it (names, commands, …).
// - The manifest: every user-visible string in package.json is a `%key%` of
//   package.nls.json, every key there is used, and each
//   package.nls.<language>.json passes the same checks against it.
// - Load order: nothing in src/ reads UI_TEXT while its module loads (at
//   module level, in a class field or static block, or in a callback run
//   there: a function called at once, or one passed to map, filter, …),
//   because the display language's table is installed after that. Imports,
//   exports and types (`typeof UI_TEXT`) are not reads.
//
// Every problem is printed; any problem fails the gate.
//
//   node scripts/check-l10n.mjs

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { loadL10n } from './lib/l10nSource.mjs'

const MANIFEST = 'package.json'
const MANIFEST_STRINGS = 'package.nls.json'
const MANIFEST_TRANSLATION = /^package\.nls\.(.+)\.json$/
const UNTRANSLATED = 'untranslated.json'
const UNTRANSLATED_SECTIONS = ['ui', 'manifest']
const EVERY_LOCALE = '*'
const TABLE_FILE = /^ui\.(.+)\.json$/
const SOURCE_DIR = 'src'
const SOURCE_FILE = /\.tsx?$/
const TEXT_TABLE = 'UI_TEXT'
// A manifest string VS Code replaces from package.nls*.json; vsce accepts
// only these characters in the key.
const NLS_REFERENCE = /^%([\w.]+)%$/
const NLS_LIKE = /^%.*%$/
// The manifest fields VS Code shows the user, wherever they sit under
// `contributes` or `capabilities` (a string, or a list of strings).
const TEXT_FIELDS = new Set([
  'altText',
  'category',
  'contextualTitle',
  'deprecationMessage',
  'description',
  'displayName',
  'enumDescriptions',
  'enumItemLabels',
  'errorMessage',
  'label',
  'markdownDeprecationMessage',
  'markdownDescription',
  'markdownEnumDescriptions',
  'name',
  'patternErrorMessage',
  'shortTitle',
  'title',
])
const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
])
// Array methods that call their callback before they return, so a callback
// passed to one at module level runs at module load.
const EAGER_METHODS = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'from',
  'map',
  'reduce',
  'reduceRight',
  'some',
  'sort',
  'toSorted',
])
const repoRoot = process.cwd()

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The parsed JSON file, or undefined with the reason added to `problems`. */
function readJson(file, problems) {
  let value
  try {
    value = JSON.parse(readFileSync(path.join(repoRoot, file), 'utf8'))
  } catch (error) {
    problems.push(`${file}: ${error.message}`)
  }
  return value
}

/** The dotted keys of a table's plain strings (plural forms are not listed). */
function stringKeys(table, isPluralForms, prefix = '') {
  return Object.entries(table).flatMap(([name, value]) => {
    const key = `${prefix}${name}`
    if (typeof value === 'string') {
      return [key]
    }
    return isRecord(value) && !isPluralForms(value)
      ? stringKeys(value, isPluralForms, `${key}.`)
      : []
  })
}

/**
 * l10n/untranslated.json: per section (`ui`, `manifest`), the keys whose
 * value may stay English, for every language (`*`) or for one.
 * Returns `(section, locale) => Set`.
 */
function readUntranslated(file, known, locales, problems) {
  const lists = readJson(file, problems) ?? {}
  if (!isRecord(lists)) {
    problems.push(`${file}: an object of sections expected`)
  }
  problems.push(
    ...Object.keys(lists)
      .filter((name) => !UNTRANSLATED_SECTIONS.includes(name))
      .map((name) => `${file}: ${name}: not a section (${UNTRANSLATED_SECTIONS.join(', ')})`),
  )
  for (const section of UNTRANSLATED_SECTIONS) {
    const byLocale = lists[section] ?? {}
    if (!isRecord(byLocale)) {
      problems.push(`${file}: ${section}: an object of key lists by language expected`)
      continue
    }
    const everywhere = byLocale[EVERY_LOCALE] ?? []
    for (const [locale, keys] of Object.entries(byLocale)) {
      const where = `${file}: ${section}.${locale}`
      if (locale !== EVERY_LOCALE && !locales.includes(locale)) {
        problems.push(`${where}: not a language TABLE_LOCALES lists`)
      }
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
        problems.push(`${where}: a list of keys expected`)
        continue
      }
      // Twice in one list, or under a language as well as under "*".
      const repeated = keys.filter(
        (key, index) =>
          keys.indexOf(key) !== index || (locale !== EVERY_LOCALE && everywhere.includes(key)),
      )
      problems.push(
        ...repeated.map((key) => `${where}: ${key}: listed twice`),
        ...keys
          .filter((key) => !known[section].has(key))
          .map((key) => `${where}: ${key}: not a string of the ${section} table`),
      )
    }
  }
  return (section, locale) =>
    new Set([
      ...(lists[section]?.[EVERY_LOCALE] ?? []),
      ...(locale === EVERY_LOCALE ? [] : (lists[section]?.[locale] ?? [])),
    ])
}

/** The translated tables in l10n/: one per language TABLE_LOCALES lists, no other. */
function checkTables(l10n, untranslatedFor, problems) {
  const { EN, TABLE_DIRECTORY, TABLE_LOCALES, tableFileName, tableProblems } = l10n
  const directory = path.join(repoRoot, TABLE_DIRECTORY)
  const files = existsSync(directory) ? readdirSync(directory) : []
  for (const name of files) {
    const locale = TABLE_FILE.exec(name)?.[1]
    if (locale === undefined && name !== UNTRANSLATED) {
      problems.push(
        `${TABLE_DIRECTORY}/${name}: not a table (ui.<language>.json) or ${UNTRANSLATED}`,
      )
    } else if (locale !== undefined && !TABLE_LOCALES.includes(locale)) {
      problems.push(`${TABLE_DIRECTORY}/${name}: ${locale} is not in TABLE_LOCALES`)
    }
  }
  for (const locale of TABLE_LOCALES) {
    const file = `${TABLE_DIRECTORY}/${tableFileName(locale)}`
    if (!files.includes(tableFileName(locale))) {
      problems.push(`${file}: missing (TABLE_LOCALES lists ${locale})`)
      continue
    }
    const table = readJson(file, problems)
    if (table === undefined) {
      continue
    }
    const untranslated = untranslatedFor('ui', locale)
    const found = tableProblems(EN, table, { locale, isStrict: true, untranslated })
    problems.push(...found.map((problem) => `${file}: ${problem}`))
  }
  return TABLE_LOCALES.length
}

/** Every string in `value` with its path, for a walk over the manifest. */
function stringsIn(value, where) {
  if (typeof value === 'string') {
    return [[where, value]]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => stringsIn(item, `${where}[${String(index)}]`))
  }
  return isRecord(value)
    ? Object.entries(value).flatMap(([key, child]) => stringsIn(child, `${where}.${key}`))
    : []
}

/** The manifest's user-visible strings that are not a `%key%`. */
function unmovedText(value, where) {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unmovedText(item, `${where}[${String(index)}]`))
  }
  if (!isRecord(value)) {
    return []
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const at = `${where}.${key}`
    const isText =
      typeof child === 'string' ||
      (Array.isArray(child) && child.every((item) => typeof item === 'string'))
    return isText && TEXT_FIELDS.has(key)
      ? stringsIn(child, at).filter(([, text]) => !NLS_LIKE.test(text))
      : unmovedText(child, at)
  })
}

/** package.json against package.nls.json, and each package.nls.<language>.json against both. */
function checkManifest(l10n, untranslatedFor, strings, problems) {
  const { TABLE_LOCALES, tableProblems } = l10n
  const manifest = readJson(MANIFEST, problems)
  if (!isRecord(strings)) {
    problems.push(`${MANIFEST_STRINGS}: an object of strings by key expected`)
  }
  if (!isRecord(manifest) || !isRecord(strings)) {
    return 0
  }
  const shown = [
    ...['displayName', 'description'].map((key) => [`${MANIFEST}.${key}`, manifest[key]]),
    ...unmovedText(
      { contributes: manifest.contributes, capabilities: manifest.capabilities },
      MANIFEST,
    ),
  ].filter(([, text]) => typeof text === 'string' && !NLS_LIKE.test(text))
  for (const [where, text] of shown) {
    problems.push(
      `${where}: "${text}" is shown to the user; make it a %key% of ${MANIFEST_STRINGS}`,
    )
  }
  const used = new Set()
  for (const [where, text] of stringsIn(manifest, MANIFEST)) {
    const key = NLS_REFERENCE.exec(text)?.[1]
    if (key === undefined && NLS_LIKE.test(text)) {
      problems.push(`${where}: ${text}: vsce accepts only letters, digits, _ and . in a key`)
    } else if (key !== undefined && typeof strings[key] !== 'string') {
      problems.push(`${where}: %${key}% is not in ${MANIFEST_STRINGS}`)
    } else if (key !== undefined) {
      used.add(key)
    }
  }
  for (const [key, text] of Object.entries(strings)) {
    if (typeof text !== 'string') {
      problems.push(`${MANIFEST_STRINGS}: ${key}: text expected`)
    } else if (!used.has(key)) {
      problems.push(`${MANIFEST_STRINGS}: ${key}: not used by ${MANIFEST}`)
    }
  }
  const translations = readdirSync(repoRoot).flatMap((name) => {
    const locale = MANIFEST_TRANSLATION.exec(name)?.[1]
    return locale === undefined ? [] : [locale]
  })
  problems.push(
    ...translations
      .filter((locale) => !TABLE_LOCALES.includes(locale))
      .map((locale) => `package.nls.${locale}.json: ${locale} is not in TABLE_LOCALES`),
  )
  for (const locale of TABLE_LOCALES) {
    const file = `package.nls.${locale}.json`
    if (!translations.includes(locale)) {
      problems.push(`${file}: missing (TABLE_LOCALES lists ${locale})`)
      continue
    }
    const table = readJson(file, problems)
    if (table === undefined) {
      continue
    }
    const untranslated = untranslatedFor('manifest', locale)
    const found = tableProblems(strings, table, { locale, isStrict: true, untranslated })
    problems.push(...found.map((problem) => `${file}: ${problem}`))
  }
  return Object.keys(strings).length
}

/** Whether a function runs where it is written: called at once, or by an eager array method. */
function isCalledAtOnce(fn) {
  let callee = fn
  while (ts.isParenthesizedExpression(callee.parent)) {
    callee = callee.parent
  }
  const call = callee.parent
  return (
    ts.isCallExpression(call) &&
    (call.expression === callee ||
      (call.arguments.includes(callee) &&
        ts.isPropertyAccessExpression(call.expression) &&
        EAGER_METHODS.has(call.expression.name.text)))
  )
}

/** Where a read of the table runs at module load, or '' when it runs later. */
function loadTimeContext(node) {
  let child = node
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (FUNCTION_KINDS.has(current.kind) && !isCalledAtOnce(current)) {
      return ''
    }
    if (ts.isClassStaticBlockDeclaration(current)) {
      return 'a class static block'
    }
    if (ts.isPropertyDeclaration(current) && current.initializer === child) {
      return 'a class field initializer'
    }
    if (ts.isSourceFile(current)) {
      return 'module level'
    }
    child = current
  }
  return 'module level'
}

/** Whether an identifier named like the table reads it (not an import, a declared name or a type). */
function isRead(node) {
  const { parent } = node
  if (ts.isShorthandPropertyAssignment(parent)) {
    return true
  }
  // A declaration's own name is no read; `constants.UI_TEXT` (a property
  // access's name) is one.
  const isDeclaredName = !ts.isPropertyAccessExpression(parent) && parent.name === node
  if (
    isDeclaredName ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent)
  ) {
    return false
  }
  for (let current = parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current)) {
      return false
    }
    if (ts.isStatement(current)) {
      return true
    }
  }
  return true
}

/** `file:line:col: …` for each read of UI_TEXT (or a local alias of it) at module load. */
function moduleLoadReads(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const names = new Set([TEXT_TABLE])
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === TEXT_TABLE) {
          names.add(element.name.text)
        }
      }
    }
  }
  const found = []
  const visit = (node) => {
    if (ts.isIdentifier(node) && names.has(node.text) && isRead(node)) {
      const context = loadTimeContext(node)
      if (context !== '') {
        const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source))
        found.push(
          `${file}:${String(line + 1)}:${String(character + 1)}: ${node.text} read at module load (${context}); read it inside the function that shows it`,
        )
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function checkLoadOrder(problems) {
  const files = readdirSync(path.join(repoRoot, SOURCE_DIR), { recursive: true })
    .map((name) => path.join(SOURCE_DIR, String(name)).replaceAll('\\', '/'))
    .filter((file) => SOURCE_FILE.test(file) && statSync(path.join(repoRoot, file)).isFile())
  for (const file of files) {
    problems.push(...moduleLoadReads(file, readFileSync(path.join(repoRoot, file), 'utf8')))
  }
  return files.length
}

async function main() {
  const problems = []
  let l10n
  try {
    l10n = await loadL10n(repoRoot)
  } catch (error) {
    console.log(`src/shared/l10n could not be bundled: ${String(error.message ?? error)}`)
    process.exitCode = 1
    return
  }
  const strings = readJson(MANIFEST_STRINGS, problems)
  const known = {
    ui: new Set(stringKeys(l10n.EN, l10n.isPluralForms)),
    manifest: new Set(isRecord(strings) ? Object.keys(strings) : []),
  }
  const untranslatedFor = readUntranslated(
    `${l10n.TABLE_DIRECTORY}/${UNTRANSLATED}`,
    known,
    l10n.TABLE_LOCALES,
    problems,
  )
  const tables = checkTables(l10n, untranslatedFor, problems)
  const manifestKeys = checkManifest(l10n, untranslatedFor, strings, problems)
  const sources = checkLoadOrder(problems)
  for (const problem of problems) {
    console.log(problem)
  }
  console.log(
    `l10n: ${String(tables)} tables, ${String(manifestKeys)} manifest strings, ${String(sources)} source files; ${String(problems.length)} problems`,
  )
  if (problems.length > 0) {
    process.exitCode = 1
  }
}

await main()
