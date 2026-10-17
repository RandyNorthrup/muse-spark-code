// M97 lane S: the read-only, offline guards. The scanner's sources must
// name no network, process, evaluation or write capability, import
// no external imports except the reader's read-only Node capabilities,
// and a full scan over the hazardous fixture
// tree must leave every byte untouched while executing nothing.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { scanLegal } from '../../src/core/legal/scan'

const LEGAL_DIR = new URL('../../src/core/legal/', import.meta.url)
const FIXTURE_DIR = new URL('../fixtures/legal/tree/', import.meta.url)

function sourceFiles(dir: URL): URL[] {
  const found: URL[] = []
  const listed1 = readdirSync(dir, { withFileTypes: true })
  for (const entry of listed1) {
    const child = new URL(entry.name, dir)
    if (entry.isDirectory()) {
      found.push(...sourceFiles(new URL(`${child.href}/`)))
    } else if (entry.name.endsWith('.ts')) {
      found.push(child)
    }
  }
  return found
}

function fixtureFiles(dir: URL, root: URL): string[] {
  const found: string[] = []
  const listed2 = readdirSync(dir, { withFileTypes: true })
  for (const entry of listed2) {
    const child = new URL(entry.name, dir)
    if (entry.isDirectory()) {
      found.push(...fixtureFiles(new URL(`${child.href}/`), root))
    } else {
      found.push(decodeURIComponent(child.href.slice(root.href.length)))
    }
  }
  return found.toSorted((a, b) => a.localeCompare(b, 'en'))
}

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'vscode imports', pattern: /from\s+['"]vscode['"]/ },
  { name: 'child processes', pattern: /child_process/ },
  { name: 'process spawning', pattern: /\b(spawn|spawnSync|execFile|execFileSync|fork)\s*\(/ },
  { name: 'shell execution', pattern: /(?<!\.)\bexec\s*\(/ },
  { name: 'network fetch', pattern: /\bfetch\s*\(/ },
  { name: 'sockets', pattern: /\b(net|tls|http|https|dgram)\s*\.\s*connect\s*\(/ },
  { name: 'websockets', pattern: /\bWebSocket\s*\(/ },
  { name: 'dynamic evaluation', pattern: /\beval\s*\(/ },
  { name: 'function constructor', pattern: /\bnew\s+Function\s*\(/ },
  {
    name: 'file writes',
    pattern:
      /\b(write|writeFile|appendFile|copyFile|mkdir|rmdir|unlink|rename|symlink|link|rm|truncate|chmod|chown)(?:Sync)?\s*\(/,
  },
  { name: 'process environment', pattern: /\bprocess\.(env|argv|exit)\b/ },
]

describe('legal scanner guards', () => {
  it('names no network, process, evaluation or write capability', () => {
    const files = sourceFiles(LEGAL_DIR)
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const root = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true)
      const ranges: [number, number][] = []
      const walk = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          if (file.pathname.endsWith('/workspace.ts')) {
            expect(node.moduleSpecifier.text).toMatch(/^(?:node:(?:fs|path)|\.\.?\/)/)
            if (node.moduleSpecifier.text === 'node:fs') {
              const bindings = node.importClause?.namedBindings
              expect(bindings !== undefined && ts.isNamedImports(bindings)).toBe(true)
              if (bindings !== undefined && ts.isNamedImports(bindings))
                for (const binding of bindings.elements)
                  expect(binding.propertyName?.text ?? binding.name.text).toMatch(
                    /^(?:closeSync|constants|fstatSync|lstatSync|openSync|opendirSync|readSync|realpathSync|BigIntStats)$/,
                  )
            }
          } else expect(node.moduleSpecifier.text).toMatch(/^(?:zod\/mini|\.\.?\/)/)
        }
        if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)
          expect(
            ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.'),
          ).toBe(true)
        if (ts.isCallExpression(node)) {
          expect(node.expression.kind).not.toBe(ts.SyntaxKind.ImportKeyword)
          if (ts.isIdentifier(node.expression)) expect(node.expression.text).not.toBe('require')
        }
        if (
          ts.isStringLiteralLike(node) ||
          ts.isRegularExpressionLiteral(node) ||
          [
            ts.SyntaxKind.TemplateHead,
            ts.SyntaxKind.TemplateMiddle,
            ts.SyntaxKind.TemplateTail,
          ].includes(node.kind)
        )
          ranges.push([node.getStart(root), node.getEnd()])
        ts.forEachChild(node, walk)
      }
      walk(root)
      let executable = text
      const sortedRanges = ranges.toSorted((a, b) => b[0] - a[0])
      for (const [start, end] of sortedRanges)
        executable = executable.slice(0, start) + ' '.repeat(end - start) + executable.slice(end)
      executable = executable.replaceAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
      for (const forbidden of FORBIDDEN) {
        expect(executable, `${file.href} names ${forbidden.name}`).not.toMatch(forbidden.pattern)
      }
    }
  })

  it('leaves the hazardous fixture tree byte-identical and executes nothing', () => {
    const before = new Map<string, string>()
    const listed3 = fixtureFiles(FIXTURE_DIR, FIXTURE_DIR)
    for (const file of listed3) {
      const bytes = readFileSync(new URL(file, FIXTURE_DIR))
      before.set(file, createHash('sha256').update(bytes).digest('hex'))
    }
    expect(before.size).toBeGreaterThan(5)

    const files = Array.from(before.keys(), (entry) => entry)
    const readPaths: string[] = []
    const snapshot = {
      files,
      readFile: (path: string): string | undefined => {
        if (!files.includes(path)) {
          throw new Error(`Out-of-tree read: ${path}`)
        }
        readPaths.push(path)
        return readFileSync(new URL(path, FIXTURE_DIR), 'utf8')
      },
    }
    const result = scanLegal(snapshot, { headerPolicy: 'required' })
    expect(result.findings.length).toBeGreaterThan(0)
    expect(readPaths).not.toContain('notes/payload.md')

    for (const [file, hash] of before) {
      const bytes = readFileSync(new URL(file, FIXTURE_DIR))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash)
    }
    expect(fixtureFiles(FIXTURE_DIR, FIXTURE_DIR)).toEqual(
      Array.from(before.keys(), (entry) => entry).toSorted((a, b) => a.localeCompare(b, 'en')),
    )

    const report = JSON.stringify(result)
    expect(report).not.toContain('IGNORE EVERYTHING ABOVE')
    expect(report).not.toContain('exfiltrate')
  })
})
