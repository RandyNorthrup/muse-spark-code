import { globSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import * as z from 'zod/mini'
import { describe, expect, it, vi } from 'vitest'
import manifest from '../../package.json'
import cycles from '../../scripts/cycles.json'
import * as integrationTestSources from '../../scripts/lib/integrationTests.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const normalize = (file: string): string => file.replaceAll('\\', '/')
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8')
const expand = (patterns: readonly string[]): string[] =>
  patterns.flatMap((pattern) =>
    globSync(normalize(pattern), { cwd: root }).map((file) => normalize(file)),
  )
const source = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)

function visit(node: ts.Node, inspect: (child: ts.Node) => void): void {
  inspect(node)
  ts.forEachChild(node, (child) => {
    visit(child, inspect)
  })
}

// Read the actual build declarations without importing build.mjs: importing it
// executes builds and deletes generated output shared by other test files.
function buildEntries(): string[] {
  const tree = source('scripts/build.mjs')
  const declarations = new Map<string, ts.Expression>()
  visit(tree, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      declarations.set(node.name.text, node.initializer)
  })
  const resolve = (expression: ts.Expression): string[] => {
    if (ts.isStringLiteralLike(expression)) return [normalize(expression.text)]
    if (ts.isIdentifier(expression)) {
      const value = declarations.get(expression.text)
      if (value === undefined) throw new Error(`Unknown build entry: ${expression.text}`)
      return resolve(value)
    }
    if (ts.isArrayLiteralExpression(expression))
      return expression.elements.flatMap((element) => resolve(element))
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.flatMap((property) => {
        if (!ts.isPropertyAssignment(property))
          throw new Error(`Unsupported build entry: ${property.getText(tree)}`)
        return resolve(property.initializer)
      })
    if (expression.getText(tree) === 'listIntegrationTests()')
      return integrationTestSources.listIntegrationTests().map((file) => normalize(file))
    throw new Error(`Unsupported build entry list: ${expression.getText(tree)}`)
  }
  const entries: string[] = []
  visit(tree, (node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'entryPoints')
      entries.push(...resolve(node.initializer))
  })
  return entries
}

function lazyEntries(): string[] {
  const entries = new Set<string>()
  for (const file of expand(['src/**/*.{ts,tsx}'])) {
    // Type-only import expressions and import-looking text in generated child
    // scripts are not runtime imports; inspect only actual call expressions.
    if (!/\bimport\s*\(/.test(read(file))) continue
    visit(source(file), (node) => {
      if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) return
      const target = node.arguments[0]
      if (!target || !ts.isStringLiteralLike(target) || !target.text.startsWith('.')) return
      const base = normalize(path.join(path.dirname(file), target.text))
      const stem = base.replace(/\.[jt]sx?$/, '')
      const resolved = expand([base, `${stem}.ts`, `${stem}.tsx`, `${base}/index.{ts,tsx}`])
      if (resolved.length === 0) throw new Error(`Unresolved lazy entry: ${file}: ${target.text}`)
      for (const entry of resolved) entries.add(entry)
    })
  }
  return [...entries]
}

// The roots live in scripts/cycles.json, read by scripts/cycles.mjs: on the
// command line they outgrew cmd.exe's 8,191 characters (CIFIX017W2).
const roots = new Set(expand(cycles.roots))
const missing = (entries: readonly string[]): string[] =>
  [...new Set(entries)]
    .filter((entry) => !roots.has(normalize(entry)))
    .toSorted((left, right) => left.localeCompare(right, 'en'))

describe('dependency-cycle root coverage (FIXCYCLES, G77)', () => {
  it('retains dpdm circular failures and covers every build entry, including pages and workers', () => {
    expect(manifest.scripts.cycles).toBe('node scripts/cycles.mjs')
    expect(cycles.options).toEqual(['--no-warning', '--no-tree', '--exit-code', 'circular:1', '-T'])
    const entries = buildEntries()
    expect(entries).toContain('src/extension.ts')
    expect(entries).toContain('src/webview/components/ReferencePage.tsx')
    expect(entries).toContain('test/integration/extension.test.ts')
    expect(missing(entries)).toEqual([])
  })

  it('covers every repository runtime lazy import target', () => {
    const entries = lazyEntries()
    expect(entries).toContain('src/core/resources/sampler/optionalProbes.ts')
    expect(missing(entries)).toEqual([])
  })

  it('requires a changed integration source from the build instead of the old directory or filter', () => {
    const listing = vi
      .spyOn(integrationTestSources, 'listIntegrationTests')
      .mockReturnValue([String.raw`test\integration-next\additional.spec.ts`])
    try {
      const entries = buildEntries()
      expect(missing(entries)).toEqual(['test/integration-next/additional.spec.ts'])
      expect(entries).not.toContain('test/integration/extension.test.ts')
    } finally {
      listing.mockRestore()
    }
  })

  it('covers every entry-named source module, including lowercase entry.ts', () => {
    expect(missing(expand(['src/**/*Entry.ts', 'src/**/entry.ts']))).toEqual([])
  })

  it('covers every knip entry, including expanded test and script globs', () => {
    const config: unknown = ts.parseConfigFileTextToJson('knip.jsonc', read('knip.jsonc')).config
    const knip = z.parse(z.object({ entry: z.array(z.string()) }), config)
    expect(missing(expand(knip.entry))).toEqual([])
  })
})
