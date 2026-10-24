// Production builds only: src/shared/constants.ts with every constant whose
// value is literal arithmetic, or an interpolation of its own string
// constants, written as the literal it evaluates to.
//
// Why: esbuild keeps a top-level `const X = 5 * 60_000` or
// `` const Y = `${A}.${B}` `` in every bundle that imports anything from the
// file, used or not (it cannot prove arithmetic or a template free of side
// effects), while a plain literal, object or array it can drop. Each merged
// lane's new tunables therefore grew every bundle. Folding keeps the source
// readable (units and derivations stay written out) and lets the bundles
// carry only the constants they read.
//
// The fold is exact: a numeric expression is computed with the same
// JavaScript operators, in the same order, as at run time, and written with
// `String(value)`, which round-trips to the same double; only finite values
// fold. A string folds only from string literals and string constants already
// folded above it in the file. Anything else (an import, a call, a member
// read, a non-finite number) stays as written.
import path from 'node:path'
import ts from 'typescript'
import { readCompiledSource } from './compiledSources.mjs'

const SOURCE = 'src/shared/constants.ts'
const NUMERIC = new Map([
  [ts.SyntaxKind.PlusToken, (a, b) => a + b],
  [ts.SyntaxKind.MinusToken, (a, b) => a - b],
  [ts.SyntaxKind.AsteriskToken, (a, b) => a * b],
  [ts.SyntaxKind.SlashToken, (a, b) => a / b],
  [ts.SyntaxKind.PercentToken, (a, b) => a % b],
  [ts.SyntaxKind.AsteriskAsteriskToken, (a, b) => a ** b],
])

/** Rounding and bounds that answer the same for the same numbers. */
const MATH = new Map([
  ['ceil', Math.ceil],
  ['floor', Math.floor],
  ['round', Math.round],
  ['trunc', Math.trunc],
  ['max', Math.max],
  ['min', Math.min],
])
/** Constant members of `Number`. */
const NUMBER_MEMBERS = new Map([
  ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
  ['MIN_SAFE_INTEGER', Number.MIN_SAFE_INTEGER],
])

/**
The value of a constant expression, or undefined when it is not one:
numbers from numeric literals, unary signs, parentheses, arithmetic,
`Number`'s safe-integer bounds and `Math`'s rounding and bounds; strings
from literals, templates and `+` over strings. A name or a member is read
only from a constant folded above: `known.scalars` by name,
`known.records` for a literal object's literal properties.
*/
function evaluate(input, known) {
  let node = input
  while (ts.isParenthesizedExpression(node)) node = node.expression
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return known.scalars.get(node.text)
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
    const owner = node.expression.text
    return owner === 'Number'
      ? NUMBER_MEMBERS.get(node.name.text)
      : known.records.get(owner)?.get(node.name.text)
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'Math'
  ) {
    const operate = MATH.get(node.expression.name.text)
    const values = node.arguments.map((argument) => evaluate(argument, known))
    return operate === undefined || values.some((value) => typeof value !== 'number')
      ? undefined
      : operate(...values)
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const value = evaluate(node.operand, known)
    if (typeof value !== 'number') return
    if (node.operator === ts.SyntaxKind.MinusToken) return -value
    return node.operator === ts.SyntaxKind.PlusToken ? value : undefined
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text
    for (const span of node.templateSpans) {
      const value = evaluate(span.expression, known)
      if (typeof value !== 'string') return
      text += value + span.literal.text
    }
    return text
  }
  if (ts.isBinaryExpression(node)) {
    const left = evaluate(node.left, known)
    const right = evaluate(node.right, known)
    if (typeof left === 'string' && typeof right === 'string')
      return node.operatorToken.kind === ts.SyntaxKind.PlusToken ? left + right : undefined
    if (typeof left !== 'number' || typeof right !== 'number') return
    const operate = NUMERIC.get(node.operatorToken.kind)
    return operate === undefined ? undefined : operate(left, right)
  }
  return
}

/** The literal text for a folded value, or undefined when it cannot be written exactly. */
function literalText(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (!Number.isFinite(value)) return
  // A negative zero has no literal; `String` would write `0`.
  return Object.is(value, -0) ? undefined : String(value)
}

/** Whether the node is already the literal a fold would write. */
function isPlainLiteral(node) {
  return (
    ts.isNumericLiteral(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    (ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand))
  )
}

/**
constants.ts's text with every foldable constant expression written as
its literal: whole initializers, and the property values and elements of
object and array initializers. Pure: the same text gives the same result.
*/
export function foldConstantSource(source, fileName = SOURCE) {
  const tree = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const known = { scalars: new Map(), records: new Map() }
  const replacements = []
  /** Folds `node`; its value when it is one, a literal object's folded properties otherwise. */
  const fold = (node) => {
    const value = evaluate(node, known)
    const text = value === undefined ? undefined : literalText(value)
    if (text !== undefined) {
      if (!isPlainLiteral(node))
        replacements.push({ start: node.getStart(tree), end: node.end, text })
      return { scalar: value }
    }
    // Not one value: fold inside the literals esbuild can drop whole.
    const inner =
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isParenthesizedExpression(node)
        ? node.expression
        : node
    if (ts.isObjectLiteralExpression(inner)) {
      const record = new Map()
      for (const property of inner.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const folded = fold(property.initializer).scalar
        const name =
          ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
            ? property.name.text
            : undefined
        if (folded !== undefined && name !== undefined) record.set(name, folded)
      }
      return { record }
    }
    if (ts.isArrayLiteralExpression(inner)) for (const element of inner.elements) fold(element)
    return {}
  }
  for (const statement of tree.statements) {
    if (
      !ts.isVariableStatement(statement) ||
      (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    )
      continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue
      const { scalar, record } = fold(declaration.initializer)
      if (scalar !== undefined) known.scalars.set(declaration.name.text, scalar)
      if (record !== undefined) known.records.set(declaration.name.text, record)
    }
  }
  let contents = source
  const lastFirst = replacements.toSorted((a, b) => b.start - a.start)
  for (const replacement of lastFirst)
    contents =
      contents.slice(0, replacement.start) + replacement.text + contents.slice(replacement.end)
  return contents
}

/** Whether `file` is src/shared/constants.ts. */
export function isConstantsSource(file) {
  return path.resolve(file) === path.resolve(SOURCE)
}

/**
The plugin: constants.ts folded for a production bundle. A build that also
compresses its model text loads the file through that plugin, which folds
first (compressedModelText.mjs), so this one is appended last and only
answers for builds without it.
*/
export const foldedConstants = {
  name: 'folded-constants',
  setup(build) {
    build.onLoad({ filter: /[/\\]shared[/\\]constants\.ts$/ }, (args) => {
      if (!isConstantsSource(args.path)) return
      return {
        contents: foldConstantSource(readCompiledSource(args.path), args.path),
        loader: 'ts',
        resolveDir: path.dirname(args.path),
        watchFiles: [args.path],
      }
    })
  },
}

/** A production bundle's options with the fold appended after its own plugins. */
export function withFoldedConstants(options) {
  return { ...options, plugins: [...(options.plugins ?? []), foldedConstants] }
}
