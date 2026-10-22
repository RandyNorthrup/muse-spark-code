// Derive the extension's runtime bundles from production build declarations
// and runtime call sites, then use the VSIX builder's real VSCE inventory.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { buildProductionPackage } from './helpers/productionPackage'
import { UI_TEXT_REGIONS } from '../../scripts/lib/uiTextRegions.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const normalize = (file) => file.replaceAll('\\', '/')
const read = (file) => readFileSync(path.join(root, file), 'utf8')
const parse = (file) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
function visit(node, inspect) {
  inspect(node)
  ts.forEachChild(node, (child) => visit(child, inspect))
}
function declarations(tree) {
  const values = new Map()
  visit(tree, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      values.set(node.name.text, node.initializer)
  })
  return values
}
function strings(expression, values, seen = new Set()) {
  let value = expression
  while (ts.isIdentifier(value) && !seen.has(value.text)) {
    seen.add(value.text)
    const next = values.get(value.text)
    if (!next) return []
    value = next
  }
  if (ts.isStringLiteralLike(value)) return [normalize(value.text)]
  return ts.isArrayLiteralExpression(value)
    ? value.elements.flatMap((element) => strings(element, values, new Set(seen)))
    : []
}
function buildBundles() {
  const tree = parse('scripts/build.mjs')
  const values = declarations(tree)
  const bundles = new Map()
  visit(tree, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return
    const properties = new Map(
      node.properties
        .filter((property) => ts.isPropertyAssignment(property))
        .map((property) => [property.name.getText(tree), property.initializer]),
    )
    const entry = properties.get('entryPoints')
    const output = properties.get('outfile')
    if (!entry || !output) return
    const files = strings(output, values)
    if (files.length !== 1) throw new Error(`Unresolved production output: ${output.getText(tree)}`)
    const entries = strings(entry, values)
    if (entries.length === 0)
      throw new Error(`Unresolved production entries: ${entry.getText(tree)}`)
    bundles.set(files[0], entries)
  })
  return bundles
}
function requiredBundles(bundles, folder) {
  const byName = new Map(bundles.keys().map((file) => [path.posix.basename(file), file]))
  const required = new Set(['dist/extension.js'])
  const pending = ['dist/extension.js']
  while (pending.length > 0) {
    const file = pending.pop()
    const tree = ts.createSourceFile(
      file,
      readFileSync(path.join(folder, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    // Minified locals reuse names. Resolve each identifier in its lexical
    // scope so a nested variable cannot hide an activation bundle path.
    const scopes = new WeakMap()
    function bind(node, functionScope, blockScope) {
      if (ts.isSourceFile(node) || ts.isFunctionLike(node)) {
        functionScope = node
        blockScope = node
        scopes.set(node, new Map())
        if (ts.isFunctionLike(node))
          for (const parameter of node.parameters)
            if (ts.isIdentifier(parameter.name))
              scopes.get(node).set(parameter.name.text, undefined)
      } else if (ts.isBlock(node)) {
        blockScope = node
        scopes.set(node, new Map())
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const lexical = node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)
        scopes.get(lexical ? blockScope : functionScope).set(node.name.text, node.initializer)
      }
      ts.forEachChild(node, (child) => bind(child, functionScope, blockScope))
    }
    bind(tree, tree, tree)
    // A module that the bundle also imports dynamically is emitted as a lazy
    // initializer (`var a, b; init = fn(() => { a = "x.js" })`), so a name
    // declared without a value takes the value its own scope's assignment
    // gives it (shared/constants is emitted this way once a team surface
    // imports a module of its own in-bundle).
    visit(tree, (node) => {
      if (
        !ts.isBinaryExpression(node) ||
        node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
        !ts.isIdentifier(node.left)
      )
        return
      for (let owner = node.parent; owner; owner = owner.parent) {
        const scope = scopes.get(owner)
        if (!scope?.has(node.left.text)) continue
        if (scope.get(node.left.text) === undefined) scope.set(node.left.text, node.right)
        return
      }
    })
    const resolved = new WeakMap()
    function valueOf(identifier) {
      for (let owner = identifier.parent; owner; owner = owner.parent) {
        const scope = scopes.get(owner)
        if (scope?.has(identifier.text)) return scope.get(identifier.text)
      }
    }
    function collect(expression, seen = new Set()) {
      if (resolved.has(expression)) return resolved.get(expression)
      if (seen.has(expression)) return []
      const next = new Set([...seen, expression])
      const found = new Set()
      function walk(node) {
        if (ts.isFunctionLike(node)) return
        if (ts.isStringLiteralLike(node)) {
          const name = normalize(node.text)
          if (byName.has(path.posix.basename(name))) found.add(name)
        }
        if (ts.isIdentifier(node)) {
          const value = valueOf(node)
          // Only filename aliases and path expressions can name modules.
          if (
            value &&
            (ts.isStringLiteralLike(value) ||
              ts.isIdentifier(value) ||
              ts.isPropertyAccessExpression(value) ||
              (ts.isCallExpression(value) &&
                ts.isPropertyAccessExpression(value.expression) &&
                ['join', 'joinPath'].includes(value.expression.name.text)))
          )
            for (const candidate of collect(value, next)) found.add(candidate)
        }
        ts.forEachChild(node, walk)
      }
      walk(expression)
      const result = [...found]
      resolved.set(expression, result)
      return result
    }
    function references(expression) {
      for (const candidate of collect(expression)) {
        const output = byName.get(path.posix.basename(candidate))
        if (!output || required.has(output)) continue
        required.add(output)
        pending.push(output)
      }
    }
    visit(tree, (node) => {
      // A path alone may name a standalone program (acp.js), rather than a
      // required module. Follow paths passed to runtime loaders, including
      // bundlePath factories, and direct require calls in the emitted code.
      if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'bundlePath')
        references(ts.isArrowFunction(node.initializer) ? node.initializer.body : node.initializer)
      if (ts.isMethodDeclaration(node) && node.name.getText(tree) === 'bundlePath' && node.body)
        references(node.body)
      if (
        ts.isNewExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'Worker'
      ) {
        const workerArguments = node.arguments ?? []
        for (const argument of workerArguments) references(argument)
      }
      if (!ts.isCallExpression(node)) return
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ['join', 'joinPath'].includes(node.expression.name.text)
      )
        return
      for (const argument of node.arguments) references(argument)
    })
  }
  return required
}
const fixture = { root: '', required: new Set(), packaged: new Set() }
// A real production build is preparation; assertions keep repository deadlines.
const PRODUCTION_BUILD_TIMEOUT_MS = 60_000
beforeAll(async () => {
  const bundles = buildBundles()
  for (const region of UI_TEXT_REGIONS) bundles.set(region.output, ['src/shared/l10n/en.ts'])
  fixture.root = mkdtempSync(path.join(tmpdir(), 'estimator-package-inventory-'))
  writeFileSync(path.join(fixture.root, '.prettierrc.json'), read('.prettierrc.json'))
  try {
    buildProductionPackage(root, fixture.root)
  } catch (error) {
    throw new Error(readFileSync(path.join(fixture.root, 'build.log'), 'utf8'), { cause: error })
  }
  fixture.required = requiredBundles(bundles, fixture.root)
  // Inventory all real emitted bundles with the builder's unchanged ignore
  // policy, without traversing the private build's source/test fixture trees.
  const publication = path.join(fixture.root, 'publication')
  mkdirSync(publication)
  cpSync(path.join(fixture.root, 'dist'), path.join(publication, 'dist'), { recursive: true })
  writeFileSync(path.join(publication, 'package.json'), read('package.json'))
  writeFileSync(path.join(publication, '.vscodeignore'), read('.vscodeignore'))
  const listed = await listFiles({ cwd: publication, dependencies: false })
  fixture.packaged = new Set(listed.map((file) => normalize(file)))
}, PRODUCTION_BUILD_TIMEOUT_MS)
afterAll(() => {
  if (fixture.root) rmSync(fixture.root, { recursive: true, force: true })
})
it('ships every built bundle production can require in the VSIX builder file list', () => {
  expect(fixture.required.has('dist/estimatePrices.js')).toBe(true)
  expect(fixture.required.has('dist/planSnapshot.js')).toBe(true)
  const missing = fixture.required
    .values()
    .filter((file) => !fixture.packaged.has(file))
    .toArray()
    .toSorted((left, right) => left.localeCompare(right, 'en'))
  expect(missing).toEqual([])
})
