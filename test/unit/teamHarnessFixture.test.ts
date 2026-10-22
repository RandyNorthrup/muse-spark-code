// P2-7: the browser harness's teamTree message must parse. teamTreeSchema
// wants exact strings for the two dollar fields; numbers leave the tree
// unmounted and every team-harness case times out waiting for it.
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { teamTreeSchema } from '../../src/shared/teamView'

/** The actual `teamTreeFixture` arrow's text, found in the harness page. */
function fixtureExpression(html: string): string {
  for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const file = ts.createSourceFile(
      'harness.js',
      script[1] ?? '',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    )
    const found = findFixture(file, file)
    if (found !== undefined) return found
  }
  throw new Error('teamTreeFixture missing from the harness page')
}

function findFixture(node: ts.Node, file: ts.SourceFile): string | undefined {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'teamTreeFixture' &&
    node.initializer !== undefined
  ) {
    return node.initializer.getText(file)
  }
  let found: string | undefined
  ts.forEachChild(node, (child) => {
    found ??= findFixture(child, file)
  })
  return found
}

describe('team harness tree fixture', () => {
  it('sends exact-string dollars the teamTree message parses', () => {
    const html = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')
    const tree = runInNewContext(`(${fixtureExpression(html)})()`, {})
    const parsed = teamTreeSchema.safeParse(tree)
    if (!parsed.success) throw new Error(`teamTreeFixture does not parse: ${parsed.error.message}`)
    expect(parsed.data.spentUsdToday).toBe('1.2')
    expect(parsed.data.budgetUsdToday).toBe('50')
  })
})
