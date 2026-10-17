import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'

const comparePaths = (left: string, right: string) => left.localeCompare(right)

it('warms every module imported by a deferred webview surface or code fence', () => {
  const root = fileURLToPath(new URL('../../src/webview/', import.meta.url))
  const imports = new Set<string>()
  function importsOf(file: string) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const paths: string[] = []
    let hasDeferredSurface = false
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        if (ts.isIdentifier(node.expression) && node.expression.text === 'deferred') {
          hasDeferredSurface = true
        }
        const argument = node.arguments[0]
        if (
          argument !== undefined &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          ts.isStringLiteral(argument)
        ) {
          paths.push(
            path
              .relative(root, path.resolve(path.dirname(file), argument.text))
              .replaceAll('\\', '/'),
          )
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return { paths, hasDeferredSurface }
  }
  const entries = readdirSync(root, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
    const file = path.resolve(entry.parentPath, entry.name)
    const { paths, hasDeferredSurface } = importsOf(file)
    if (hasDeferredSurface || entry.name === 'CodeBlock.tsx') {
      for (const path of paths) imports.add(path)
    }
  }
  const helper = fileURLToPath(new URL('helpers/warmDeferredSurfaces.ts', import.meta.url))
  expect([...imports].toSorted(comparePaths)).toEqual(
    importsOf(helper).paths.toSorted(comparePaths),
  )
})
