// HOTFIX0181, the fast signal on source. The build points every import of
// transport.ts, sse.ts and ndjson.ts outside dist/modelApi.js at that bundle
// (deferredCohort, scripts/lib/deferredBundles.mjs), which exports what
// src/host/backend/modelApiEntry.ts exports and nothing else. TypeScript
// checks those imports against the source modules, so a name the entry lacks
// compiles, passes every source test and is `undefined` in the built product:
// 0.18.0 shipped three. The built bundles are checked by the split gate and
// by deferredBundles.test.ts; this names the file and the import in seconds.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const ENTRY = 'src/host/backend/modelApiEntry.ts'
const REDIRECTED = new Set([
  'src/core/backends/modelapi/transport.ts',
  'src/core/backends/modelapi/sse.ts',
  'src/core/backends/modelapi/ndjson.ts',
])
// The split gate keeps these in dist/modelApi.js alone (its LAZY_ONLY list),
// where the import is the real module.
const MODEL_API_ONLY = new Set(['src/core/backends/modelapi/client.ts'])

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(path.join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function sourceFiles(): string[] {
  return readdirSync(path.join(ROOT, 'src'), { recursive: true, encoding: 'utf8' })
    .map((file) => `src/${file.replaceAll('\\', '/')}`)
    .filter((file) => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
}

/** The repository file a relative import names, or undefined for a package. */
function target(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return
  return path.posix.join(path.posix.dirname(from), `${specifier.replace(/\.[jt]s$/, '')}.ts`)
}

/** Every value name the entry exports; a type-only export is not at run time. */
function entryExports(): Set<string> {
  const names = new Set<string>()
  for (const statement of parse(ENTRY).statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue
      const clause = statement.exportClause
      if (clause === undefined || !ts.isNamedExports(clause))
        throw new Error(`${ENTRY}: name every export, so this check can read the list`)
      for (const element of clause.elements) if (!element.isTypeOnly) names.add(element.name.text)
    } else if (
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (
        (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
        statement.name !== undefined
      )
        names.add(statement.name.text)
      else if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations)
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
    }
  }
  return names
}

interface ValueImport {
  readonly file: string
  readonly from: string
  readonly name: string
}

/** The values `file` takes from the redirected modules, static and dynamic. */
function redirectedImports(file: string): ValueImport[] {
  const text = readFileSync(path.join(ROOT, file), 'utf8')
  if (!/transport|sse|ndjson/.test(text)) return []
  const found: ValueImport[] = []
  const add = (from: string, name: string) => {
    found.push({ file, from: path.posix.basename(from), name })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = target(file, node.moduleSpecifier.text)
      const clause = node.importClause
      if (
        from !== undefined &&
        REDIRECTED.has(from) &&
        clause?.phaseModifier !== ts.SyntaxKind.TypeKeyword
      ) {
        if (clause?.name !== undefined) add(from, 'default')
        const bindings = clause?.namedBindings
        if (bindings !== undefined && ts.isNamespaceImport(bindings))
          add(from, '* (name the members)')
        if (bindings !== undefined && ts.isNamedImports(bindings))
          for (const element of bindings.elements)
            if (!element.isTypeOnly) add(from, (element.propertyName ?? element.name).text)
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly
    ) {
      const from = target(file, node.moduleSpecifier.text)
      if (from !== undefined && REDIRECTED.has(from)) {
        const clause = node.exportClause
        if (clause === undefined || !ts.isNamedExports(clause)) add(from, '* (name the members)')
        else
          for (const element of clause.elements)
            if (!element.isTypeOnly) add(from, (element.propertyName ?? element.name).text)
      }
    }
    const [specifier] = ts.isCallExpression(node) ? node.arguments : []
    if (
      specifier !== undefined &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(specifier)
    ) {
      const from = target(file, specifier.text)
      if (from !== undefined && REDIRECTED.has(from)) {
        // `const { a, b } = await import(…)` names what it reads; anything
        // else keeps the whole module and cannot be compared with a list.
        const awaited = ts.isAwaitExpression(node.parent) ? node.parent.parent : undefined
        const pattern =
          awaited !== undefined &&
          ts.isVariableDeclaration(awaited) &&
          ts.isObjectBindingPattern(awaited.name)
            ? awaited.name
            : undefined
        if (pattern === undefined) add(from, '* (destructure the members)')
        else
          for (const element of pattern.elements) {
            const name = element.propertyName ?? element.name
            add(from, ts.isIdentifier(name) ? name.text : '* (name the members)')
          }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parse(file))
  return found
}

describe('the Model API bundle exports what other bundles import from its shared modules', () => {
  const exported = entryExports()
  const readers = sourceFiles().filter(
    (file) => file !== ENTRY && !REDIRECTED.has(file) && !MODEL_API_ONLY.has(file),
  )
  const imports = readers.flatMap((file) => redirectedImports(file))

  it('exports every value imported from transport, sse and ndjson outside the bundle', () => {
    expect(
      imports
        .filter(({ name }) => !exported.has(name))
        .map(
          ({ file, from, name }) =>
            `${file} imports ${name} from ${from}; ${ENTRY} does not export it`,
        ),
    ).toEqual([])
  })

  it('reads the imports it claims to check', () => {
    // An empty list would pass the comparison above.
    const names = new Set(imports.map(({ name }) => name))
    for (const name of [
      'RequestTransport',
      'ModelApiError',
      'parseSse',
      'parseNdjson',
      'assertConfirmedAllowed',
      'isStaleConfirmedError',
      'noteConfirmedRequestStarted',
    ])
      expect(names.has(name), name).toBe(true)
    // The three places 0.18.0 broke, and the one dynamic import.
    expect([...new Set(imports.map(({ file }) => file))]).toEqual(
      expect.arrayContaining([
        'src/core/backends/modelapi/providerClient.ts',
        'src/core/providers/configured.ts',
        'src/core/providers/subscriptions/registry.ts',
        'src/host/providers/copilotClient.ts',
        'src/runtime/exec/execFetch.ts',
      ]),
    )
  })

  it('leaves out only files the split gate keeps in the Model API bundle alone', () => {
    const gate = readFileSync(path.join(ROOT, 'scripts/check-bundle-split.mjs'), 'utf8')
    const list = /const LAZY_ONLY = \[([^\]]*)\]/.exec(gate)?.[1] ?? ''
    for (const file of MODEL_API_ONLY) expect(list).toContain(`'${path.posix.basename(file)}'`)
  })
})
