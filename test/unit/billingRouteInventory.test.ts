import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { expect, expectTypeOf, it } from 'vitest'
import type {
  ConversationOwner,
  PayerCredential,
} from '../../src/core/backends/modelapi/billingRoute'

it('keeps conversation ownership distinct from the credential paying an attempt', () => {
  expectTypeOf<ConversationOwner>().not.toExtend<PayerCredential>()
  expectTypeOf<PayerCredential>().not.toExtend<ConversationOwner>()
})

/** The initializer of `const billingRoute` in a block around this call, nearest first. */
function routeConstAround(from: ts.Node, source: ts.SourceFile): ts.Expression | undefined {
  let at = from
  while (!ts.isSourceFile(at)) {
    if (ts.isBlock(at)) {
      for (const statement of at.statements) {
        if (!ts.isVariableStatement(statement)) continue
        for (const declaration of statement.declarationList.declarations) {
          if (declaration.name.getText(source) === 'billingRoute') return declaration.initializer
        }
      }
    }
    at = at.parent
  }
  return undefined
}

it('inventories every transport entry and requires the single route resolver', () => {
  const root = path.resolve('src')
  const sites: string[] = []
  const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
  for (const file of files) {
    if (!file.endsWith('.ts')) continue
    const normalized = file.replaceAll('\\', '/')
    const text = readFileSync(path.join(root, file), 'utf8')
    if (!text.includes('RequestTransport')) continue
    const source = ts.createSourceFile(normalized, text, ts.ScriptTarget.Latest, true)
    const receivers = new Set<string>()
    const collect = (node: ts.Node) => {
      if (
        ts.isNewExpression(node) &&
        node.expression.getText(source).endsWith('RequestTransport')
      ) {
        const parent = node.parent
        if (ts.isVariableDeclaration(parent)) receivers.add(parent.name.getText(source))
        else if (ts.isBinaryExpression(parent)) receivers.add(parent.left.getText(source))
      }
      ts.forEachChild(node, collect)
    }
    collect(source)
    if (normalized.endsWith('/transport.ts')) receivers.add('this')
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const member = node.expression
        if (
          ['request', 'streamRequest'].includes(member.name.text) &&
          receivers.has(member.expression.getText(source))
        ) {
          sites.push(`${normalized}:${member.name.text}`)
          const init = node.arguments[1]
          expect(init && ts.isObjectLiteralExpression(init), normalized).toBe(true)
          if (init && ts.isObjectLiteralExpression(init)) {
            if (normalized.endsWith('/transport.ts')) {
              expect(
                init.properties.some(
                  (field) =>
                    ts.isSpreadAssignment(field) && field.expression.getText(source) === 'init',
                ),
              ).toBe(true)
            } else {
              const field = init.properties.find(
                (entry) =>
                  (ts.isPropertyAssignment(entry) || ts.isShorthandPropertyAssignment(entry)) &&
                  entry.name.getText(source) === 'billingRoute',
              )
              // Inline, or the one route an attempt freezes for its resend: a const of that
              // name in a function around the call, resolved the same way.
              let route: ts.Expression | undefined
              if (field && ts.isPropertyAssignment(field)) route = field.initializer
              else if (field && ts.isShorthandPropertyAssignment(field))
                route = routeConstAround(node, source)
              expect(
                route &&
                  ts.isAwaitExpression(route) &&
                  ts.isCallExpression(route.expression) &&
                  route.expression.expression.getText(source) === 'resolveAttemptBillingRoute',
                normalized,
              ).toBe(true)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(sites.toSorted((left, right) => left.localeCompare(right))).toEqual([
    'core/backends/modelapi/client.ts:request',
    'core/backends/modelapi/client.ts:request',
    'core/backends/modelapi/client.ts:request',
    'core/backends/modelapi/client.ts:streamRequest',
    'core/backends/modelapi/providerClient.ts:request',
    'core/backends/modelapi/providerClient.ts:request',
    'core/backends/modelapi/providerClient.ts:streamRequest',
    'core/backends/modelapi/transport.ts:request',
    'core/providers/configured.ts:request',
    'core/providers/configured.ts:request',
    // The probe's and the commands' reads share one request since the
    // int/recovery merges (bf7fcb66a1).
    'runtime/providerReads.ts:request',
  ])
})
