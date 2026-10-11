// Release-train bundle diet: every top-level initialiser in the shared
// constants module must stay droppable, so a bundle that imports one name
// does not carry the rest. esbuild drops an unused export only when its
// initialiser is side-effect free: a call, a tagged template, a `new` with
// non-literal arguments or a read on a global (Number.MAX_SAFE_INTEGER)
// pins the statement into every importer. A /* @__PURE__ */ call drops only
// when its own arguments are droppable too, so nested `z.*` builders need
// the no-argument IIFE form; this test enforces exactly that.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  IDE_IMAGE_TOOLS,
  IDE_PAID_TOOLS,
  IDE_WEB_FETCH_TOOL,
  WEB_FETCH_TOOLS,
} from '../../src/shared/constants'

const CONSTANTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/shared/constants.ts',
)

const GLOBAL_ROOTS = new Set([
  'Number',
  'Math',
  'JSON',
  'Object',
  'String',
  'Intl',
  'Date',
  'process',
  'globalThis',
  'Boolean',
  'Array',
  'Symbol',
  'BigInt',
  'Reflect',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'RegExp',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Error',
  'console',
])

function hasPureComment(node: ts.Node, source: string, sourceFile: ts.SourceFile): boolean {
  return source.slice(node.getFullStart(), node.getStart(sourceFile)).includes('@__PURE__')
}

function rootName(node: ts.Expression): string | undefined {
  let current = node
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression
  }
  return ts.isIdentifier(current) ? current.text : undefined
}

interface Finding {
  readonly name: string
  readonly line: number
  readonly reason: string
}

// An initialiser esbuild can drop when its export goes unused. Function
// bodies never run at module load, so the check does not descend into them:
// a no-argument IIFE is droppable as a unit when marked /* @__PURE__ */.
function findPinning(
  node: ts.Node,
  source: string,
  sourceFile: ts.SourceFile,
): Finding | undefined {
  let finding: Finding | undefined = undefined
  const visit = (child: ts.Node): void => {
    if (
      finding !== undefined ||
      ts.isArrowFunction(child) ||
      ts.isFunctionExpression(child) ||
      ts.isFunctionDeclaration(child)
    ) {
      return
    }
    if (ts.isTaggedTemplateExpression(child)) {
      finding = { name: '', line: 0, reason: 'tagged template (String.raw is a call)' }
      return
    }
    if (
      ts.isPropertyAccessExpression(child) &&
      !ts.isCallExpression(child.parent) &&
      !ts.isNewExpression(child.parent)
    ) {
      const root = rootName(child.expression)
      if (root !== undefined && GLOBAL_ROOTS.has(root)) {
        finding = { name: '', line: 0, reason: `read on global ${root}` }
        return
      }
    }
    // Bare construction with literal arguments drops on its own.
    if (ts.isNewExpression(child)) {
      const args = child.arguments ?? []
      if (args.every((argument) => findPinning(argument, source, sourceFile) === undefined)) return
      finding = { name: '', line: 0, reason: 'impure new arguments' }
      return
    }
    if (ts.isCallExpression(child)) {
      // The proven droppable shape for nested builders: a marked
      // no-argument factory. Anything else must earn it argument by argument.
      if (hasPureComment(child, source, sourceFile) && isPureIife(child)) return
      const areArgsDroppable = child.arguments.every(
        (argument) => findPinning(argument, source, sourceFile) === undefined,
      )
      // A mark asserts the whole call, callee included; without one the
      // call pins, whatever it reads.
      if (!areArgsDroppable || !hasPureComment(child, source, sourceFile)) {
        finding = { name: '', line: 0, reason: 'impure call arguments' }
        return
      }
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return finding
}

// A marked no-argument immediately invoked factory: the proven droppable
// shape for nested builders (see usdSchema.ts).
function isPureIife(node: ts.CallExpression | ts.NewExpression): boolean {
  return (
    ts.isCallExpression(node) &&
    node.arguments.length === 0 &&
    (ts.isArrowFunction(node.expression) || ts.isFunctionExpression(node.expression)) &&
    node.expression.parameters.length === 0
  )
}

function scanConstants(): string[] {
  const source = readFileSync(CONSTANTS_PATH, 'utf8')
  const sourceFile = ts.createSourceFile(CONSTANTS_PATH, source, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  for (const statement of sourceFile.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) !==
        true
    ) {
      continue
    }
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined || !ts.isIdentifier(declaration.name)) continue
      const finding = findPinning(declaration.initializer, source, sourceFile)
      if (finding === undefined) continue
      const { line } = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile))
      problems.push(`${declaration.name.text} (line ${String(line + 1)}): ${finding.reason}`)
    }
  }
  return problems
}

describe('train bundle diet', () => {
  it('keeps every shared constants initialiser droppable', () => {
    expect(scanConstants()).toEqual([])
  })

  it('keeps the literal tool sets in sync with their constants', () => {
    // Literal members so non-fetching bundles drop the sets (a template
    // over the constant pins them instead); this pins the sync.
    expect(WEB_FETCH_TOOLS).toEqual(new Set(['web_fetch', `mcp__ide__${IDE_WEB_FETCH_TOOL}`]))
    expect(IDE_PAID_TOOLS).toEqual(
      new Set([
        `mcp__ide__${IDE_IMAGE_TOOLS.generateImage}`,
        `mcp__ide__${IDE_IMAGE_TOOLS.editImage}`,
      ]),
    )
  })
})
