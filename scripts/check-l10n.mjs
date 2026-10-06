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
//   A `one` form also needs {count} if the locale selects it for an integer
//   other than 1 in 0..200, even when English's `one` omits the number.
// - The manifest: every user-visible string in package.json is a `%key%` of
//   package.nls.json, every key there is used, and each
//   package.nls.<language>.json passes the same checks against it.
// - Usage: usage.<language>.json is checked against usageEn.ts with the same
//   strict rules, in source and the packaged stage. It is a separate family.
// - Load order: nothing in src/ reads UI_TEXT or USAGE_TEXT while its module loads (at
//   module level, in a class field or static block, or in a callback run
//   there: a function called at once, or one passed to map, filter, …),
//   because the display language's table is installed after that. Imports,
//   exports and types (`typeof UI_TEXT`) are not reads.
// - No JSON file it reads names a key twice in one object (M91): JSON.parse
//   would keep the last one silently.
//
// Every problem is printed; any problem fails the gate.
//
//   node scripts/check-l10n.mjs

import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { brotliDecompressSync } from 'node:zlib'
import process from 'node:process'
import ts from 'typescript'
import { loadL10n } from './lib/l10nSource.mjs'

const MANIFEST = 'package.json'
const MANIFEST_STRINGS = 'package.nls.json'
const MANIFEST_TRANSLATION = /^package\.nls\.(.+)\.json$/
const UNTRANSLATED = 'untranslated.json'
const UNTRANSLATED_SECTIONS = ['ui', 'usage', 'manifest']
const EVERY_LOCALE = '*'
const TABLE_FILE = /^(ui|usage)\.(.+)\.json$/
const SOURCE_DIR = 'src'
const SOURCE_FILE = /\.tsx?$/
const TEXT_TABLES = ['UI_TEXT', 'USAGE_TEXT']
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

/** Opens a container for `{` or `[` and closes one for `}` or `]`. */
function trackContainer(open, char) {
  switch (char) {
    case '{': {
      open.push(new Set())
      return
    }
    case '[': {
      open.push(null)
      return
    }
    case '}':
    case ']': {
      open.pop()
      return
    }
    // No default
  }
}

/**
 * The keys an object in valid JSON text names twice, at any depth. JSON.parse
 * keeps the last one without a word, so a stale string could win unseen (M91:
 * a merge left two `config.modelApiHooks.description` lines in three tables).
 */
function duplicateKeys(text) {
  const found = []
  // One entry per open container: the keys seen for an object, null for an array.
  const open = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    if (char === '"') {
      let end = index + 1
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
      const literal = text.slice(index, end + 1)
      index = end + 1
      let next = index
      while (/\s/u.test(text[next] ?? '')) next += 1
      const keys = open.at(-1)
      if (text[next] === ':' && keys instanceof Set) {
        const key = JSON.parse(literal)
        if (keys.has(key)) found.push(key)
        keys.add(key)
      }
      continue
    }
    trackContainer(open, char)
    index += 1
  }
  return found
}

/** The parsed JSON file, or undefined with the reason added to `problems`. */
function readJson(file, problems, root = repoRoot, maxOutputLength) {
  let value
  try {
    const target = path.join(root, file)
    const text =
      maxOutputLength === undefined
        ? readFileSync(target, 'utf8')
        : brotliDecompressSync(readFileSync(`${target}.br`), { maxOutputLength }).toString('utf8')
    value = JSON.parse(text)
    for (const key of duplicateKeys(text))
      problems.push(`${file}: "${key}" is named twice in one object; JSON keeps only the last`)
  } catch (error) {
    problems.push(`${file}: ${error.message}`)
  }
  return value
}

// A language's plural forms may be any of these, whichever English uses.
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other']

/**
 * The dotted keys `untranslated.json` may name: each plain string, and each
 * plural entry both whole (`agentsCount`) and by form (`agentsCount.one`),
 * since one form can read as the English does ("1 agent" in Czech and
 * Polish) while the others do not.
 */
function stringKeys(table, isPluralForms, prefix = '') {
  return Object.entries(table).flatMap(([name, value]) => {
    const key = `${prefix}${name}`
    if (typeof value === 'string') {
      return [key]
    }
    if (isPluralForms(value)) {
      return [key, ...PLURAL_CATEGORIES.map((category) => `${key}.${category}`)]
    }
    return isRecord(value) ? stringKeys(value, isPluralForms, `${key}.`) : []
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
function checkTables(l10n, untranslatedFor, problems, family) {
  const { TABLE_DIRECTORY, TABLE_LOCALES, tableProblems } = l10n
  const english = family === 'usage' ? l10n.USAGE_EN : l10n.EN
  const fileName = family === 'usage' ? l10n.usageTableFileName : l10n.tableFileName
  const directory = path.join(repoRoot, TABLE_DIRECTORY)
  const files = existsSync(directory) ? readdirSync(directory) : []
  // Check directory membership once; both families must have every locale.
  if (family === 'ui') {
    for (const name of files) {
      const locale = TABLE_FILE.exec(name)?.[2]
      if (locale === undefined && name !== UNTRANSLATED) {
        problems.push(`${TABLE_DIRECTORY}/${name}: not a ui/usage table or ${UNTRANSLATED}`)
      } else if (locale !== undefined && !TABLE_LOCALES.includes(locale)) {
        problems.push(`${TABLE_DIRECTORY}/${name}: ${locale} is not in TABLE_LOCALES`)
      }
    }
  }
  for (const locale of TABLE_LOCALES) {
    const file = `${TABLE_DIRECTORY}/${fileName(locale)}`
    if (!files.includes(fileName(locale))) {
      problems.push(`${file}: missing (TABLE_LOCALES lists ${locale})`)
      continue
    }
    const table = readJson(file, problems)
    if (table === undefined) continue
    const untranslated = untranslatedFor(family, locale)
    const found = tableProblems(english, table, { locale, isStrict: true, untranslated })
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
  const names = new Set(TEXT_TABLES)
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined
    if (bindings !== undefined && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (TEXT_TABLES.includes((element.propertyName ?? element.name).text)) {
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

// Package-time compaction must keep every translated value byte-for-byte
// after JSON parsing. Validate staged data with the same strict source schema.
function checkPackaged(root, l10n, untranslatedFor, strings, problems, isAcp = false) {
  const files = [
    MANIFEST,
    MANIFEST_STRINGS,
    ...l10n.TABLE_LOCALES.flatMap((locale) => [
      `${l10n.TABLE_DIRECTORY}/${l10n.tableFileName(locale)}`,
      `${l10n.TABLE_DIRECTORY}/${l10n.usageTableFileName(locale)}`,
      `package.nls.${locale}.json`,
    ]),
  ]
  for (const file of files) {
    if (isAcp && !file.startsWith(`${l10n.TABLE_DIRECTORY}/`)) continue
    let shipped
    if (TABLE_FILE.exec(path.basename(file))?.[1] === 'ui') {
      try {
        const text = brotliDecompressSync(
          readFileSync(path.join(root, l10n.TABLE_DIRECTORY, l10n.L10N_TABLE_ARCHIVE_FILE)),
          {
            maxOutputLength: l10n.L10N_TABLE_MAX_BYTES * l10n.TABLE_LOCALES.length,
          },
        ).toString('utf8')
        shipped = JSON.parse(
          l10n.readArchivedUiTable(text, TABLE_FILE.exec(path.basename(file))?.[2]),
        )
      } catch (error) {
        problems.push(`${file}: ${error.message}`)
      }
    } else if (TABLE_FILE.exec(path.basename(file))?.[1] === 'usage') {
      const text = brotliDecompressSync(
        readFileSync(path.join(root, l10n.TABLE_DIRECTORY, l10n.USAGE_TABLE_ARCHIVE_FILE)),
        { maxOutputLength: l10n.L10N_TABLE_MAX_BYTES * l10n.TABLE_LOCALES.length },
      ).toString('utf8')
      shipped = JSON.parse(text)[TABLE_FILE.exec(path.basename(file))?.[2]]
    } else shipped = readJson(file, problems, root)
    const source = readJson(file, problems)
    if (JSON.stringify(shipped) !== JSON.stringify(source))
      problems.push(`packaged ${file}: differs from source`)
    if (file === MANIFEST || file === MANIFEST_STRINGS) continue
    const locale =
      TABLE_FILE.exec(path.basename(file))?.[2] ??
      MANIFEST_TRANSLATION.exec(path.basename(file))?.[1]
    const family = TABLE_FILE.exec(path.basename(file))?.[1] ?? 'manifest'
    const english = { ui: l10n.EN, usage: l10n.USAGE_EN, manifest: strings }[family]
    problems.push(
      ...l10n
        .tableProblems(english, shipped, {
          ...(locale !== undefined && { locale }),
          isStrict: true,
          untranslated: untranslatedFor(family, locale ?? 'en'),
        })
        .map((problem) => `packaged ${file}: ${problem}`),
    )
  }
}

// Keep the page's English fallback out of the main UI family and its bundles.
async function loadUsageFamily() {
  const { outputFiles } = await build({
    stdin: {
      contents:
        "export { USAGE_EN } from './usageEn'; export { usageTableFileName } from './usageTable'",
      resolveDir: path.join(repoRoot, 'src/shared/l10n'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
  )
}

async function main() {
  const problems = []
  let l10n
  try {
    l10n = { ...(await loadL10n(repoRoot)), ...(await loadUsageFamily()) }
  } catch (error) {
    console.log(`src/shared/l10n could not be bundled: ${String(error.message ?? error)}`)
    process.exitCode = 1
    return
  }
  const strings = readJson(MANIFEST_STRINGS, problems)
  const known = {
    ui: new Set(stringKeys(l10n.EN, l10n.isPluralForms)),
    usage: new Set(stringKeys(l10n.USAGE_EN, l10n.isPluralForms)),
    manifest: new Set(isRecord(strings) ? Object.keys(strings) : []),
  }
  const untranslatedFor = readUntranslated(
    `${l10n.TABLE_DIRECTORY}/${UNTRANSLATED}`,
    known,
    l10n.TABLE_LOCALES,
    problems,
  )
  const tables = checkTables(l10n, untranslatedFor, problems, 'ui')
  const usageTables = checkTables(l10n, untranslatedFor, problems, 'usage')
  const manifestKeys = checkManifest(l10n, untranslatedFor, strings, problems)
  const sources = checkLoadOrder(problems)
  if (['--packaged', '--packaged-acp'].includes(process.argv[2])) {
    if (process.argv.length !== 4)
      throw new Error('--packaged requires exactly one stage directory')
    checkPackaged(
      path.resolve(process.argv[3]),
      l10n,
      untranslatedFor,
      strings,
      problems,
      process.argv[2] === '--packaged-acp',
    )
  } else if (process.argv.length !== 2) {
    throw new Error('Unknown localization gate arguments')
  }
  for (const problem of problems) {
    console.log(problem)
  }
  console.log(
    `l10n: ${String(tables)} UI tables, ${String(usageTables)} usage tables, ${String(manifestKeys)} manifest strings, ${String(sources)} source files; ${String(problems.length)} problems`,
  )
  if (problems.length > 0) {
    process.exitCode = 1
  }
}

await main()
