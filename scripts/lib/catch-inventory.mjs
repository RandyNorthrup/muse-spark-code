// The catch-clause inventory (CATCHAUDIT lane): every `catch` clause and
// promise `.catch(` handler under src, classified into exactly one class.
//
// Classes:
// - NARROW: the handler tests the error for a named, expected condition (an
//   `instanceof` or brand-guard check, a `.code`/`.name` comparison, an abort
//   check) and rethrows or reports everything else.
// - REPORTED: every path rethrows, returns/throws a failure that carries the
//   cause (`cause`, the error passed through), or records the failure: a log
//   through a redacting formatter (failureForLog and friends), the error sent
//   through a record-bound channel (the webview's webviewErrorReport), a
//   fixed-message log on a path that returns nothing to the person, or a
//   fixed-vocabulary code (observeError and friends, the `deps.failed()` and
//   `questionFailed()` / `questionStateNotSaved()` markers). A fixed throw or
//   fallback counts as REPORTED when the same handler also records the kind:
//   the person gets a typed failure and the record keeps the cause.
// - SWALLOW: the handler neither uses the error nor rethrows nor reports.
// - GENERIC: the handler replaces whatever was thrown with one fixed sentence
//   or generic error for every cause. A fixed-string log without the error
//   (and without a recorded code) plus a fallback return is GENERIC; logging
//   the raw error outside a redacting formatter is GENERIC too, never
//   REPORTED, so the audit cannot bless a privacy leak.
// - CLEANUP: a swallow-shaped handler on an already-failing path, marked by a
//   reason comment on the catch line or as the handler's leading comment
//   (prettier expands an empty `catch { // reason }` onto its own lines, so a
//   same-line comment does not survive formatting; the leading comment is the
//   stable form).
//
// The classifier is conservative: when unsure it answers SWALLOW or GENERIC,
// never NARROW or REPORTED. A `throw` inside a nested function does not
// count; only the handler's own level (including nested blocks, excluding
// nested functions and classes) decides. `console.*` is a devtools sink, not
// the failure record: it neither reports nor poisons.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const CLASSES = ['NARROW', 'REPORTED', 'SWALLOW', 'GENERIC', 'CLEANUP']

/** A call that carries the error's kind into the record, redacted. */
const REDACTING_FNS = new Set(['failureForLog', 'stderrForLog', 'wireWordForLog'])
/** A call that records the failure under a fixed-vocabulary code. */
const CODE_RECORD_FNS = new Set(['observeError', 'recordError', 'reportError'])
/** A `report(x, error)`-shaped call posts the failure to the host's record. */
const ERROR_SINK_FNS = new Set(['report', 'notify', 'record'])
/**
 * A formatter whose result reaches the failure record with the error: the
 * webview's M39 host channel (`postMessage(webviewErrorReport(source, error))`).
 */
const ERROR_CHANNEL_FNS = new Set(['webviewErrorReport', 'reportWebviewErrorMessage'])
const LOG_METHODS = new Set(['warn', 'error', 'info', 'debug', 'log', 'trace'])
const BRAND_GUARD = /^is[A-Z][A-Za-z0-9]*$/
const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
])

const FUNCTION_LIKE = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
])

/** Walk a handler body without descending into nested functions or classes. */
function walkOwn(node, visit) {
  visit(node)
  if (FUNCTION_LIKE.has(node.kind)) return
  ts.forEachChild(node, (child) => walkOwn(child, visit))
}

/** The expression with parentheses and non-null assertions stripped. */
function unparen(node) {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  )
    current = current.expression
  return current
}

/**
 * Whether the expression reads the caught error: the binding itself or a
 * property chain rooted at it (`error`, `error.code`, `error?.name`).
 */
function readsError(node, binding) {
  if (binding === undefined) return false
  let isFound = false
  const visit = (current) => {
    if (isFound) return
    if (ts.isIdentifier(current) && current.text === binding) isFound = true
    else ts.forEachChild(current, visit)
  }
  visit(unparen(node))
  return isFound
}

/** A member chain rooted at the error binding (`error.code`, `error?.x`). */
function isErrorMember(node, binding) {
  let current = unparen(node)
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    current = unparen(current.expression)
  return ts.isIdentifier(current) && current.text === binding
}

function calleeName(expression) {
  const target = unparen(expression)
  if (ts.isIdentifier(target)) return target.text
  return ts.isPropertyAccessExpression(target) ? target.name.text : undefined
}

/** A call that funnels the error into a sink: `report(kind, error)`. */
function isErrorSinkCall(node, binding) {
  if (!ts.isCallExpression(node)) return false
  const name = calleeName(node.expression)
  if (name === undefined) return false
  if (ERROR_SINK_FNS.has(name))
    return node.arguments.some((argument) => readsError(argument, binding))
  // The error passed to a record-bound formatter (`webviewErrorReport(source,
  // error)`) reaches the host's failure record with the send.
  return (
    ERROR_CHANNEL_FNS.has(name) && node.arguments.some((argument) => readsError(argument, binding))
  )
}

/** A redacting formatter call that carries the error (`failureForLog(error)`). */
function isRedactedCall(node, binding) {
  if (!ts.isCallExpression(node)) return false
  const name = calleeName(node.expression)
  return (
    name !== undefined &&
    REDACTING_FNS.has(name) &&
    node.arguments.some((argument) => readsError(argument, binding))
  )
}

function isCodeRecordCall(node) {
  return ts.isCallExpression(node) && CODE_RECORD_FNS.has(calleeName(node.expression) ?? '')
}

/**
 * A fixed-diagnostic marker: the dependencies' documented `failed()` (the
 * question stack funnels it to a fixed-vocabulary code) and the agent's own
 * `questionFailed()` / `questionStateNotSaved()`, whose bodies are a single
 * fixed-message log. Scoped to zero-argument calls on `deps`/`this`
 * receivers, so an unrelated `failed()` cannot bless a handler.
 */
const DIAGNOSTIC_MARKERS = new Set(['failed', 'questionFailed', 'questionStateNotSaved'])
function isDiagnosticMarkerCall(node) {
  if (!ts.isCallExpression(node) || node.arguments.length > 0) return false
  const target = unparen(node.expression)
  if (!ts.isPropertyAccessExpression(target) || !DIAGNOSTIC_MARKERS.has(target.name.text))
    return false
  const receiver = unparen(target.expression)
  return (
    receiver.kind === ts.SyntaxKind.ThisKeyword ||
    (ts.isIdentifier(receiver) && receiver.text === 'deps') ||
    (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'deps')
  )
}

/**
 * Calls verified (by reading their bodies) to carry only fixed vocabulary
 * from the error: `storeErrorCode` reads only `.code`;
 * `describeStoreError` runs `redactSecrets` over the message;
 * `errorKind` (conversationController.ts) returns only `.code`, `.name` or
 * `typeof`; `errorName` (accountHost.ts) returns only `.name`; `codeOf`
 * (pageConverter.ts, webFetcher.ts, runtimeStore.ts) reads only `.code`.
 * Anything else wrapping the error is opaque to this gate and counts as a
 * leak, so `String(error)` can no longer pass as REPORTED. A bare `describe`
 * stays a leak: the same name is `redactSecrets`-wrapped in one module and
 * a raw message in three others, so the gate cannot bless it by name.
 */
const SAFE_ERROR_FNS = new Set([
  'storeErrorCode',
  'describeStoreError',
  'errorKind',
  'errorName',
  'codeOf',
])

/** A logger call (`log.warn(...)`, never `console.*`). */
function isLogCall(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(unparen(node.expression)))
    return false
  const access = unparen(node.expression)
  if (!LOG_METHODS.has(access.name.text)) return false
  const receiver = unparen(access.expression)
  return !(ts.isIdentifier(receiver) && receiver.text === 'console')
}

/** The error identifier reaches a log call outside a redacting formatter. */
function isRawErrorLog(node, binding) {
  if (binding === undefined || !isLogCall(node)) return false
  const redacted = new Set()
  const mark = (current) => {
    if (!ts.isCallExpression(current)) {
      ts.forEachChild(current, mark)
      return
    }
    const callee = calleeName(current.expression) ?? ''
    if (REDACTING_FNS.has(callee) || SAFE_ERROR_FNS.has(callee)) {
      for (const argument of current.arguments) collect(argument, true)
      return
    }
    // An identifier inside any other call (String(error), a template span, a
    // concatenation, an unverified local describe()) is a leak, not a
    // blessing: collect it as raw so the handler cannot count as REPORTED.
    ts.forEachChild(current, (child) => collect(child, false))
  }
  const collect = (current, inside) => {
    if (ts.isIdentifier(current) && current.text === binding) {
      if (inside) {
        redacted.add(true)
      } else {
        redacted.add(false)
      }
      return
    }
    if (!inside && ts.isCallExpression(current)) {
      mark(current)
      return
    }
    ts.forEachChild(current, (child) => collect(child, inside))
  }
  for (const argument of node.arguments) collect(argument, false)
  return redacted.has(false)
}

/** Whether the node sits in a condition slot: if/while/ternary/case/&&/||/!. */
function isTestPosition(node) {
  let current = node
  let parent = current.parent
  while (parent !== undefined) {
    if (
      (ts.isIfStatement(parent) && parent.expression === current) ||
      (ts.isConditionalExpression(parent) && parent.condition === current) ||
      (ts.isWhileStatement(parent) && parent.expression === current) ||
      (ts.isDoStatement(parent) && parent.expression === current) ||
      (ts.isCaseClause(parent) && parent.expression === current) ||
      (ts.isPrefixUnaryExpression(parent) && parent.operator === ts.SyntaxKind.ExclamationToken)
    )
      return true
    if (
      ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      current = parent
      parent = parent.parent
      continue
    }
    if (ts.isParenthesizedExpression(parent)) {
      current = parent
      parent = parent.parent
      continue
    }
    return false
  }
  return false
}

/** A named-condition test on the caught error. */
function isErrorTest(node, binding) {
  if (binding === undefined) return false
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword)
      return readsError(node.left, binding)
    if (COMPARISON.has(node.operatorToken.kind))
      return isErrorMember(node.left, binding) || isErrorMember(node.right, binding)
  }
  if (ts.isCallExpression(node)) {
    const name = calleeName(node.expression)
    if (
      name !== undefined &&
      BRAND_GUARD.test(name) &&
      node.arguments.some((argument) => readsError(argument, binding)) &&
      isTestPosition(node)
    )
      return true
  }
  return false
}

/** An abort check (`signal.aborted`, the conventional cancellation test). */
function isAbortTest(node) {
  let isFound = false
  const visit = (current) => {
    if (isFound) return
    if (
      ts.isPropertyAccessExpression(current) &&
      current.name.text === 'aborted' &&
      isTestPosition(current)
    )
      isFound = true
    else ts.forEachChild(current, visit)
  }
  visit(node)
  return isFound
}

/** A thrown/returned value that carries the cause's kind. */
function carriesCause(expression, binding) {
  const target = unparen(expression)
  if (binding !== undefined && ts.isIdentifier(target) && target.text === binding) return true
  if (ts.isCallExpression(target))
    return (
      binding !== undefined && target.arguments.some((argument) => readsError(argument, binding))
    )
  if (ts.isNewExpression(target) || ts.isObjectLiteralExpression(target)) {
    let isFound = false
    const visit = (current) => {
      if (isFound) return
      if (
        ts.isPropertyAssignment(current) &&
        ts.isIdentifier(current.name) &&
        current.name.text === 'cause'
      )
        isFound = true
      else ts.forEachChild(current, visit)
    }
    visit(target)
    return isFound
  }
  return false
}

function isMeaningfulReturn(node) {
  if (node.expression === undefined) return false
  const target = unparen(node.expression)
  if (target.kind === ts.SyntaxKind.NullKeyword || target.kind === ts.SyntaxKind.UndefinedKeyword)
    return false
  if (ts.isIdentifier(target) && target.text === 'undefined') return false
  if (ts.isVoidExpression(target)) return false
  return true
}

/** Which branch establishes a specific expected condition (never all Errors). */
function expectedBranch(expression, binding, truth) {
  let node = unparen(expression)
  while (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    node = unparen(node.operand)
    truth = !truth
  }
  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken)
      return (
        truth &&
        (expectedBranch(node.left, binding, true) || expectedBranch(node.right, binding, true))
      )
    if (operator === ts.SyntaxKind.BarBarToken)
      return (
        !truth &&
        (expectedBranch(node.left, binding, false) || expectedBranch(node.right, binding, false))
      )
    if (operator === ts.SyntaxKind.InstanceOfKeyword)
      return (
        truth &&
        readsError(node.left, binding) &&
        !(ts.isIdentifier(node.right) && node.right.text === 'Error')
      )
    if (COMPARISON.has(operator)) {
      const isEqual =
        operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        operator === ts.SyntaxKind.EqualsEqualsToken
      const value = isErrorMember(node.left, binding)
        ? node.right
        : isErrorMember(node.right, binding)
          ? node.left
          : undefined
      return truth === isEqual && value !== undefined && ts.isStringLiteralLike(unparen(value))
    }
  }
  return truth && (isErrorTest(node, binding) || isAbortTest(node)) && !ts.isBinaryExpression(node)
}

/** Follow the handler's own paths; opaque loops/try/switch never prove a report. */
function handlerPaths(body, binding) {
  const expression = (input, states) => {
    const node = unparen(input)
    if (ts.isConditionalExpression(node))
      return [
        ...expression(node.whenTrue, branch(node.condition, states, true)),
        ...expression(node.whenFalse, branch(node.condition, states, false)),
      ]
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      const isTruthy = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      return [
        ...branch(node.left, states, !isTruthy),
        ...expression(node.right, branch(node.left, states, isTruthy)),
      ]
    }
    let isRecorded = false
    let isLogged = false
    walkOwn(node, (child) => {
      // Conditional work may never execute, so do not let it prove this path.
      if (child !== node) return
      isRecorded =
        isErrorSinkCall(child, binding) || isCodeRecordCall(child) || isDiagnosticMarkerCall(child)
      isLogged = isLogCall(child) && !isRawErrorLog(child, binding)
      if (isLogged) {
        const visit = (part) => {
          if (ts.isConditionalExpression(part) || FUNCTION_LIKE.has(part.kind)) return
          if (ts.isBinaryExpression(part) && part.operatorToken.kind !== ts.SyntaxKind.PlusToken)
            return
          isRecorded ||= isRedactedCall(part, binding)
          ts.forEachChild(part, visit)
        }
        for (const argument of child.arguments) visit(argument)
      }
      if (!isLogged && ts.isCallExpression(child))
        isRecorded ||= child.arguments.some(
          (argument) =>
            ERROR_CHANNEL_FNS.has(calleeName(unparen(argument).expression ?? argument) ?? '') &&
            readsError(argument, binding),
        )
    })
    return states.map((state) => ({
      ...state,
      recorded: state.recorded || isRecorded,
      logged: state.logged || isLogged,
      carried: carriesCause(node, binding),
    }))
  }
  const branch = (condition, states, truth) =>
    expression(condition, states).map((state) => ({
      ...state,
      expected: state.expected || expectedBranch(condition, binding, truth),
    }))
  const statements = (nodes, states) => {
    let paths = states
    for (const node of nodes) {
      const done = paths.filter((state) => state.done)
      const live = paths.filter((state) => !state.done)
      paths = [...done, ...statement(node, live)]
    }
    return paths
  }
  const statement = (node, states) => {
    if (ts.isBlock(node)) return statements(node.statements, states)
    if (ts.isIfStatement(node))
      return [
        ...statement(node.thenStatement, branch(node.expression, states, true)),
        ...(node.elseStatement === undefined
          ? branch(node.expression, states, false)
          : statement(node.elseStatement, branch(node.expression, states, false))),
      ]
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      const isThrow = ts.isThrowStatement(node)
      const values = node.expression === undefined ? states : expression(node.expression, states)
      return values.map((state) => ({
        ...state,
        done: true,
        recorded: state.recorded || (node.expression !== undefined && state.carried),
        generic: isThrow || isMeaningfulReturn(node),
      }))
    }
    if (ts.isExpressionStatement(node)) return expression(node.expression, states)
    if (ts.isVariableStatement(node)) {
      let paths = states
      for (const declaration of node.declarationList.declarations)
        if (declaration.initializer !== undefined)
          paths = expression(declaration.initializer, paths)
      return paths
    }
    // Unsupported control flow cannot establish coverage. Later unconditional
    // reporting can still cover it; early exits are conservatively unreported.
    return ts.isIterationStatement(node, false) ||
      ts.isTryStatement(node) ||
      ts.isSwitchStatement(node)
      ? [...states, ...states.map((state) => ({ ...state, done: true, generic: true }))]
      : states
  }
  const initial = [{ recorded: false, logged: false, expected: false, done: false, generic: false }]
  return ts.isBlock(body)
    ? statements(body.statements, initial)
    : expression(body, initial).map((state) => ({
        ...state,
        generic: isMeaningfulReturn({ expression: body }),
        recorded: state.recorded || state.carried,
      }))
}

/**
 * Classify one handler body. `binding` is the caught name, if any.
 * `catchLine` is the source line of the `catch` keyword or `.catch(` call;
 * `leading` is the handler's leading comment text, if any. A reason comment
 * in either place marks CLEANUP.
 */
export function classifyHandler(body, options) {
  const { binding, catchLine, leading } = options
  const block = ts.isBlock(body) ? body : undefined
  if (block === undefined && body === undefined)
    return hasReason(catchLine, leading) ? 'CLEANUP' : 'SWALLOW'
  let hasRawLog = false
  let hasErrorUse = false
  let hasReplacement = block === undefined && isMeaningfulReturn({ expression: body })
  walkOwn(body, (node) => {
    hasRawLog ||= isRawErrorLog(node, binding)
    hasErrorUse ||= binding !== undefined && ts.isIdentifier(node) && node.text === binding
    hasReplacement ||=
      ts.isThrowStatement(node) || (ts.isReturnStatement(node) && isMeaningfulReturn(node))
  })
  const paths = handlerPaths(body, binding)
  if (
    !hasRawLog &&
    paths.some((state) => state.expected) &&
    paths.every((state) => state.recorded || (state.logged && !state.generic) || state.expected)
  )
    return 'NARROW'
  if (!hasRawLog && paths.every((state) => state.recorded || (state.logged && !state.generic)))
    return 'REPORTED'
  if (!hasRawLog && !hasErrorUse && !hasReplacement && paths.every((state) => !state.logged))
    return hasReason(catchLine, leading) ? 'CLEANUP' : 'SWALLOW'
  return 'GENERIC'
}

function hasReason(catchLine, leading) {
  return catchLine.includes('//') || catchLine.includes('/*') || (leading ?? '').trim().length > 0
}

function snippetOf(source, node) {
  return node.getText(source).replaceAll(/\s+/gu, ' ').trim().slice(0, 80)
}

function catchLineOf(source, position) {
  const text = source.text
  let start = position
  while (start > 0 && text[start - 1] !== '\n') start--
  let end = position
  while (end < text.length && text[end] !== '\n') end++
  return text.slice(start, end)
}

/** The comment text directly inside the handler's opening brace, if any. */
function leadingOf(source, body) {
  if (!ts.isBlock(body)) return ''
  // getEnd sits past `}`: step back onto it. A first statement's own start
  // scans back over exactly its leading trivia.
  // The span holds only trivia (whitespace and comments): statements start
  // after it, and strings cannot appear before the first statement.
  const innerEnd =
    body.statements.length > 0 ? body.statements[0].getStart(source) : body.getEnd() - 1
  return source.text.slice(body.getStart(source) + 1, innerEnd)
}

function isCatchProperty(expression) {
  const target = unparen(expression)
  if (ts.isPropertyAccessExpression(target)) return target.name.text === 'catch'
  if (ts.isElementAccessExpression(target)) {
    const argument = unparen(target.argumentExpression)
    return ts.isStringLiteralLike(argument) && argument.text === 'catch'
  }
  return false
}

/** Token identity ignores formatting, but binds the handler to its work and owner. */
function siteIdentity(node, source) {
  const context = []
  let current = node
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (current.name !== undefined) context.push(current.name.getText(source))
    if (ts.isIfStatement(current)) context.push(current.expression.getText(source))
    current = current.parent
  }
  const text = [...context, node.parent.getText(source)].join('\n')
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, text)
  const tokens = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    tokens.push(scanner.getTokenText())
  return createHash('sha256').update(JSON.stringify(tokens)).digest('hex')
}

/** Every catch clause and `.catch(` handler in one parsed source file. */
export function classifySource(relative, source) {
  const entries = []
  const visit = (node) => {
    if (ts.isCatchClause(node)) {
      const binding =
        node.variableDeclaration !== undefined && ts.isIdentifier(node.variableDeclaration.name)
          ? node.variableDeclaration.name.text
          : undefined
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      entries.push({
        file: relative,
        line,
        identity: siteIdentity(node, source),
        class: classifyHandler(node.block, {
          binding,
          catchLine: catchLineOf(source, node.getStart(source)),
          leading: leadingOf(source, node.block),
        }),
        snippet: snippetOf(source, node.block),
      })
    } else if (
      ts.isCallExpression(node) &&
      isCatchProperty(node.expression) &&
      node.arguments.length > 0
    ) {
      const [handler] = node.arguments
      if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
        const binding =
          handler.parameters.length > 0 && ts.isIdentifier(handler.parameters[0].name)
            ? handler.parameters[0].name.text
            : undefined
        const line = source.getLineAndCharacterOfPosition(node.expression.getStart(source)).line + 1
        entries.push({
          file: relative,
          line,
          identity: siteIdentity(node, source),
          class: classifyHandler(handler.body, {
            binding,
            catchLine: catchLineOf(source, node.expression.getStart(source)),
            leading: leadingOf(source, handler.body),
          }),
          snippet: snippetOf(source, handler.body),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return entries
}

/**
 * Every catch site under `<root>/src`, paths normalised to `/`. When
 * `subpaths` (like `['src/acp', 'src/webview']`) is given, only those
 * directories are read: a test that asserts on some areas need not parse
 * the whole tree inside its timeout. The gate script scans everything.
 */
export function scanCatches(root, subpaths = ['src']) {
  const files = subpaths
    .flatMap((subpath) =>
      fs
        .readdirSync(path.join(root, subpath), { recursive: true })
        .filter((file) => /\.[cm]?tsx?$/.test(file) && !file.endsWith('.d.ts'))
        .map((file) => path.join(root, subpath, file)),
    )
    .toSorted((left, right) => left.localeCompare(right))
  const entries = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    if (!text.includes('catch')) continue
    const relative = path.relative(root, file).replaceAll('\\', '/')
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ESNext,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : undefined,
    )
    entries.push(...classifySource(relative, source))
  }
  return entries
}

/** The committed ratchet counts for `root`. */
export function readBaseline(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'catch-baseline.json'), 'utf8'))
}

/** Counts per top-level area (`src/<area>`) and class. */
export function countByArea(entries) {
  const counts = {}
  for (const entry of entries) {
    const segments = entry.file.split('/')
    const area = segments.length > 2 ? (segments[1] ?? 'root') : 'root'
    counts[area] ??= { NARROW: 0, REPORTED: 0, SWALLOW: 0, GENERIC: 0, CLEANUP: 0 }
    counts[area][entry.class] += 1
  }
  return counts
}

/**
 * The ratchet: live SWALLOW/GENERIC counts must equal the baseline exactly.
 * A rise fails; a fall without a lowered baseline fails too, so the number
 * only goes down and is always exact.
 */
export function checkBaseline(entries, baseline) {
  if (baseline.version !== 2 || !Array.isArray(baseline.sites))
    return ['Catch baseline lacks site identities; migrate it without increasing the accepted debt']
  const live = countByArea(entries)
  const problems = []
  const accepted = new Map()
  for (const site of baseline.sites) {
    const key = JSON.stringify([site.file, site.class, site.identity])
    accepted.set(key, (accepted.get(key) ?? 0) + 1)
  }
  for (const entry of entries) {
    if (entry.class !== 'SWALLOW' && entry.class !== 'GENERIC') continue
    const key = JSON.stringify([entry.file, entry.class, entry.identity])
    const remaining = accepted.get(key) ?? 0
    if (remaining === 0)
      problems.push(
        `${entry.file}:${String(entry.line)}: new ${entry.class} catch site; handle or report the failure`,
      )
    else accepted.set(key, remaining - 1)
  }
  if (accepted.values().some((count) => count > 0))
    problems.push(
      'Accepted catch sites were removed or changed; regenerate the lowered site baseline',
    )
  const areas = new Set([...Object.keys(live), ...Object.keys(baseline.counts ?? {})])
  const names = [...areas].toSorted((left, right) => left.localeCompare(right))
  for (const area of names) {
    for (const kind of ['SWALLOW', 'GENERIC']) {
      const now = live[area]?.[kind] ?? 0
      const was = baseline.counts?.[area]?.[kind] ?? 0
      if (now > was)
        problems.push(
          `${area}: ${kind} rose from ${String(was)} to ${String(now)}; handle the named condition or report the failure`,
        )
      else if (now < was)
        problems.push(
          `${area}: ${kind} fell from ${String(was)} to ${String(now)} without lowering the baseline; regenerate it with node scripts/catch-inventory.mjs --write-baseline`,
        )
    }
  }
  return problems
}

export function renderMarkdown(entries, counts) {
  const lines = [
    '# Catch inventory',
    '',
    'Every `catch` clause and `.catch(` handler under `src`, one class each.',
    '',
    '| area | NARROW | REPORTED | SWALLOW | GENERIC | CLEANUP |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  const names = Object.keys(counts).toSorted((left, right) => left.localeCompare(right))
  for (const area of names)
    lines.push(
      `| ${area} | ${String(counts[area].NARROW)} | ${String(counts[area].REPORTED)} | ${String(counts[area].SWALLOW)} | ${String(counts[area].GENERIC)} | ${String(counts[area].CLEANUP)} |`,
    )
  lines.push('', '| file | line | class | handler |', '| --- | ---: | --- | --- |')
  for (const entry of entries)
    lines.push(
      `| ${entry.file} | ${String(entry.line)} | ${entry.class} | \`${entry.snippet.replaceAll('`', "'")}\` |`,
    )
  return `${lines.join('\n')}\n`
}
