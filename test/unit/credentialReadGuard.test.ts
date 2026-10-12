// CATCHMONEY R3: reads that guard money, consent or credentials are
// three-valued by construction. This guard parses the money, consent and
// credential modules and fails when a `catch` handler returns an absence
// literal (`false`, `undefined`, `[]`, `{}`) for a read that can fail,
// unless the absence is PROVEN (returned under a named condition on the
// failure, so a missing file reads absent but an unreadable one cannot) or
// DOCUMENTED (a `read-state: cert TBL-nn` marker whose row exists in the
// certification's three-state table). Reintroducing a collapsing boolean
// (`hasProviderCredential`, `hasModelApiCredential`) fails too.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const ROOT = path.resolve('.')
const CERT = path.join(ROOT, 'docs', 'certification', 'catch-money.md')

/** The money, consent and credential modules this construction covers. */
const GUARDED_PATHS = [
  'src/host/auth',
  'src/core/paid',
  'src/acp/paid.ts',
  'src/runtime/paidGrants.ts',
  'src/runtime/damageNotice.ts',
  'src/runtime/schedules',
  'src/runtime/resources',
]

/** Collapsing booleans: deleted, and must never come back. */
const BANNED_READ_NAMES = new Set(['hasProviderCredential', 'hasModelApiCredential'])

const MARKER = /read-state:\s*cert\s*(TBL-\d+)/i

function sourceFiles(): string[] {
  const files: string[] = []
  const walk = (entry: string) => {
    const stat = fs.statSync(entry)
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) walk(path.join(entry, child))
    } else if (/\.tsx?$/.test(entry) && !/\.test\.|\/test\//.test(entry)) {
      files.push(entry)
    }
  }
  for (const guarded of GUARDED_PATHS) walk(path.join(ROOT, guarded))
  return files
}

/** Whether `node` (a condition) names an expected condition on the failure. */
function isNamedCondition(node: ts.Node, binding: string | undefined): boolean {
  if (binding === undefined) return false
  let isNamed = false
  const visit = (current: ts.Node): void => {
    if (isNamed) return
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      hasBinding(current.left, binding) &&
      !(ts.isIdentifier(current.right) && current.right.text === 'Error')
    ) {
      // `error instanceof SyntaxError` proves a shape; a bare `instanceof
      // Error` (or a typeof test) is only the kind preamble and proves nothing.
      isNamed = true
      return
    }
    if (
      ts.isBinaryExpression(current) &&
      (current.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        current.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
      (hasBinding(current.left, binding) || hasBinding(current.right, binding))
    ) {
      // `error.message === '...'` or `storeErrorCode(error) === 'ENOENT'`.
      isNamed = true
      return
    }
    if (
      ts.isCallExpression(current) &&
      current.arguments.some((argument) => hasBinding(argument, binding))
    ) {
      // `storeErrorCode(error)`, `hasCode(error, 'ENOENT')`: a named probe.
      isNamed = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(node)
  return isNamed
}

function hasBinding(node: ts.Node, binding: string): boolean {
  if (ts.isIdentifier(node)) return node.text === binding
  let isFound = false
  ts.forEachChild(node, function visit(child) {
    if (!isFound) {
      if (ts.isIdentifier(child) && child.text === binding) isFound = true
      else ts.forEachChild(child, visit)
    }
  })
  return isFound
}

function isAbsence(expression: ts.Expression): boolean {
  return (
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined') ||
    (ts.isArrayLiteralExpression(expression) && expression.elements.length === 0) ||
    (ts.isObjectLiteralExpression(expression) && expression.properties.length === 0)
  )
}

/** Whether `node` (a block or statement) always leaves via throw or return. */
function isExiting(node: ts.Node): boolean {
  if (ts.isBlock(node)) {
    const last = node.statements.at(-1)
    return last !== undefined && isExiting(last)
  }
  return (
    ts.isReturnStatement(node) ||
    ts.isThrowStatement(node) ||
    (ts.isIfStatement(node) &&
      isExiting(node.thenStatement) &&
      node.elseStatement !== undefined &&
      isExiting(node.elseStatement))
  )
}

interface Violation {
  readonly file: string
  readonly line: number
  readonly detail: string
}

function scanFile(relative: string, requiredRows: Set<string>): Violation[] {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const source = ts.createSourceFile(relative, text, ts.ScriptTarget.ESNext, true)
  const violations: Violation[] = []
  const lineOf = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1

  // The collapsing booleans must never come back.
  const ban = (node: ts.Node): void => {
    if (
      (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      BANNED_READ_NAMES.has(node.name.text)
    ) {
      violations.push({
        file: relative,
        line: lineOf(node),
        detail: `collapsing boolean ${node.name.text} reintroduced: use readModelApiCredential`,
      })
    }
    ts.forEachChild(node, ban)
  }
  ban(source)

  const checkCatch = (node: ts.CatchClause): void => {
    const binding =
      node.variableDeclaration !== undefined && ts.isIdentifier(node.variableDeclaration.name)
        ? node.variableDeclaration.name.text
        : undefined
    const marker = MARKER.exec(node.getFullText(source))?.[1]
    // Absence-return sites: direct returns, and the arms of a returned ternary.
    const sites: { expression: ts.Expression; condition: ts.Expression | undefined }[] = []
    const collect = (current: ts.Node): void => {
      if (ts.isReturnStatement(current) && current.expression !== undefined) {
        const returned = current.expression
        if (isAbsence(returned)) {
          sites.push({ expression: returned, condition: undefined })
        } else if (ts.isConditionalExpression(returned)) {
          for (const arm of [returned.whenTrue, returned.whenFalse]) {
            if (isAbsence(arm)) sites.push({ expression: arm, condition: returned.condition })
          }
        }
        return
      }
      // Do not descend into nested functions: their failures are their own.
      if (ts.isFunctionLike(current)) return
      ts.forEachChild(current, collect)
    }
    collect(node.block)
    if (sites.length === 0) return

    // Proof: an if in the catch whose condition names the failure, either
    // wrapping the return or guarding before it (always exits).
    const guards: ts.IfStatement[] = []
    const gather = (current: ts.Node): void => {
      if (ts.isIfStatement(current) && isNamedCondition(current.expression, binding)) {
        guards.push(current)
      }
      if (!ts.isFunctionLike(current)) ts.forEachChild(current, gather)
    }
    gather(node.block)

    const isWithin = (child: ts.Node, parent: ts.Node): boolean => {
      if (parent === child) return true
      let isFound = false
      ts.forEachChild(parent, (candidate) => {
        if (!isFound && (candidate === child || isWithin(child, candidate))) isFound = true
      })
      return isFound
    }
    const statements = [...node.block.statements]
    const indexOf = (target: ts.Node): number =>
      statements.findIndex((entry) => entry === target || isWithin(target, entry))
    const isGuardedBefore = (guard: ts.IfStatement, site: ts.Expression): boolean => {
      const guardIndex = indexOf(guard)
      const siteIndex = indexOf(site)
      return (
        guardIndex !== -1 &&
        siteIndex !== -1 &&
        guardIndex < siteIndex &&
        isExiting(guard.thenStatement) &&
        guard.elseStatement === undefined
      )
    }

    for (const site of sites) {
      if (site.condition !== undefined) {
        // A returned ternary proves only under a named condition.
        if (isNamedCondition(site.condition, binding)) continue
      } else if (
        guards.some(
          (guard) => isWithin(site.expression, guard) || isGuardedBefore(guard, site.expression),
        )
      ) {
        continue
      }
      if (marker === undefined) {
        violations.push({
          file: relative,
          line: lineOf(site.expression),
          detail:
            'catch returns an absence literal for a read that can fail: prove it under a named ' +
            'condition on the failure, or document it with `read-state: cert TBL-nn`',
        })
      } else {
        requiredRows.add(marker)
      }
    }
  }

  const walk = (node: ts.Node): void => {
    if (ts.isCatchClause(node)) checkCatch(node)
    ts.forEachChild(node, walk)
  }
  walk(source)
  return violations
}

describe('three-valued money, consent and credential reads', () => {
  it('has no collapsing boolean and no unproven absence return', () => {
    const requiredRows = new Set<string>()
    const violations: Violation[] = []
    for (const file of sourceFiles()) {
      const relative = path.relative(ROOT, file).split(path.sep).join('/')
      violations.push(...scanFile(relative, requiredRows))
    }
    expect(
      violations.map(
        (violation) => `${violation.file}:${String(violation.line)}: ${violation.detail}`,
      ),
    ).toEqual([])
    const cert = fs.readFileSync(CERT, 'utf8')
    const rows = [...requiredRows].toSorted((left, right) => left.localeCompare(right))
    for (const row of rows) {
      expect(cert, `certification row ${row} is missing`).toContain(row)
    }
  })
})
