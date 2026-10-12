// Lane PROVERR: `modelsPanelUnavailable` ("… is not available in this
// build") is raised only where a part of the build is truly missing. This
// guard parses the product code (never a file list): every read of the key
// must sit inside a `lazyBundleLoader` call's `unavailable` wiring or inside
// the models panel's own crash boundary (a class with `componentDidCatch`).
// Anything else — a provider refusal, a config problem, a failed send — has
// its own true sentence.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const SRC = path.resolve('src')
const KEY = 'modelsPanelUnavailable'

async function sources(dir: string): Promise<string[]> {
  const found: string[] = []
  const names = await readdir(dir, { withFileTypes: true })
  for (const name of names) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) found.push(...(await sources(full)))
    else if (name.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) found.push(full)
  }
  return found
}

function isKeyRead(node: ts.Node, sf: ts.SourceFile): boolean {
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false
  const text = node.getText(sf)
  return text === `UI_TEXT.${KEY}` || text === `UI_TEXT['${KEY}']`
}

function isAllowedScope(node: ts.Node, sf: ts.SourceFile): boolean {
  let current: ts.Node = node
  while (!ts.isSourceFile(current)) {
    if (ts.isCallExpression(current) && current.expression.getText(sf).endsWith('lazyBundleLoader'))
      return true
    if (
      (ts.isClassDeclaration(current) || ts.isClassExpression(current)) &&
      current.members.some(
        (member) =>
          ts.isMethodDeclaration(member) && member.name.getText(sf) === 'componentDidCatch',
      )
    )
      return true
    current = current.parent
  }
  return false
}

function misuse(file: string, source: string): string[] {
  const problems: string[] = []
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const visit = (node: ts.Node): void => {
    if (isKeyRead(node, sf) && !isAllowedScope(node, sf)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      problems.push(`${file}:${String(line)}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return problems
}

describe('modelsPanelUnavailable is only a missing bundle', () => {
  it('finds no read of the key outside bundle-loading code', async () => {
    const problems: string[] = []
    const files = await sources(SRC)
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (!source.includes(KEY)) continue
      problems.push(...misuse(file, source))
    }
    expect(problems).toEqual([])
  })
})
