// Cross-bundle members, read from the built output (HOTFIX0181, PLAN.md D6).
//
// The Node bundles share code by loading one another: a build plugin points
// an import of a shared source module at the sibling bundle that carries it
// (`require("./modelApi.js")`). TypeScript checked that import against the
// source module. The sibling exports only what its own entry file exports, so
// a name the entry lacks is `undefined` when the code runs. 0.18.0 shipped
// that way: three names of transport.ts were missing from the Model API
// bundle and every turn on a configured provider failed before sending.
//
// This reads the bundles as they ship. For every bundle it finds the sibling
// bundles it loads, follows each loaded module to the members read from it,
// and compares those with the export list in the sibling's own text.
//
// Following is by binding, not by name: a name is resolved through the
// lexical scopes around each use (block, loop head, catch clause, function,
// class static block), so a local that reuses a module's minified name hides
// it only where the language says it does. A module, or the promise of one,
// is followed through the places the build keeps it: a variable, a property
// of `this`, a function that returns it, an `await`, a `.then` callback, a
// conditional, a destructuring. A use that cannot be followed is never
// passed over: it is reported, and the gate fails on it.

import ts from 'typescript'

const SIBLING = /^\.\/[\w.-]+\.js$/
// A text that loads a file at all: worth parsing.
const LOADS_A_FILE = /\b(?:require|import)\s*\(|\b(?:from|import)\s*["']\.\//
// Members of a module namespace that are not exports of the bundle.
const INTEROP = new Set(['default', '__esModule'])
const MODULE = 'module'
const PROMISE = 'promise'
const SNIPPET = 72

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
])
// Operators that look at a value and keep none of it.
const TESTS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
])

function siblingArgument(call) {
  const [argument] = call.arguments
  return argument !== undefined &&
    call.arguments.length === 1 &&
    ts.isStringLiteralLike(argument) &&
    SIBLING.test(argument.text)
    ? argument.text.slice(2)
    : undefined
}

const isLoad = (node) =>
  ts.isCallExpression(node) &&
  ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
    node.expression.kind === ts.SyntaxKind.ImportKeyword)

/** A `require(...)` or `import(...)` whose file is not written in the call. */
function isComputedLoad(node) {
  return isLoad(node) && node.arguments.length > 0 && !ts.isStringLiteralLike(node.arguments[0])
}

/** The sibling a `require("./x.js")` call names. */
function requiredSibling(node) {
  return ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'require'
    ? siblingArgument(node)
    : undefined
}

/** The sibling a native `import("./x.js")` names. */
function importedSibling(node) {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
    ? siblingArgument(node)
    : undefined
}

/** The sibling a static `import … from "./x.js"` or `export … from "./x.js"` names. */
function staticSibling(node) {
  return (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    SIBLING.test(node.moduleSpecifier.text)
    ? node.moduleSpecifier.text.slice(2)
    : undefined
}

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined
}

function unwrap(node) {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

/** esbuild's export annotation for Node's scanner: `0 && (module.exports = { ... })`. */
function annotationObject(node) {
  if (
    !ts.isBinaryExpression(node) ||
    node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken ||
    !ts.isNumericLiteral(node.left) ||
    node.left.text !== '0'
  )
    return
  const assignment = unwrap(node.right)
  return ts.isBinaryExpression(assignment) &&
    assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(assignment.left) &&
    ts.isIdentifier(assignment.left.expression) &&
    assignment.left.expression.text === 'module' &&
    assignment.left.name.text === 'exports' &&
    ts.isObjectLiteralExpression(assignment.right)
    ? assignment.right
    : undefined
}

/**
 * The names a file exports without an annotation: every `exports.NAME = ...`
 * of a generated or hand-written CommonJS file. Any other use of `exports`
 * or of `module.exports` leaves the list unknown.
 */
function assignedExports(source) {
  const names = new Set()
  let isOpen = false
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === 'exports') {
      const parent = node.parent
      if (!ts.isPropertyAccessExpression(parent) || parent.expression !== node) isOpen = true
      else if (
        ts.isBinaryExpression(parent.parent) &&
        parent.parent.left === parent &&
        parent.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
      )
        names.add(parent.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return !isOpen && names.size > 0 ? { names, spreads: [], isOpen: false } : undefined
}

/**
 * The names a CommonJS bundle exports: esbuild's annotation,
 * `0 && (module.exports = { a, b, ...require("./c.js") })`, or the file's own
 * `exports.NAME = ...` when it has none. `undefined` when neither says: its
 * exports are unknown.
 */
function exportList(source) {
  let list
  const visit = (node) => {
    const object = annotationObject(node)
    if (object === undefined) {
      ts.forEachChild(node, visit)
      return
    }
    list ??= { names: new Set(), spreads: [], isOpen: false }
    for (const property of object.properties) {
      if (ts.isShorthandPropertyAssignment(property)) list.names.add(property.name.text)
      else if (ts.isPropertyAssignment(property)) {
        const name = propertyNameText(property.name)
        if (name === undefined) list.isOpen = true
        else list.names.add(name)
      } else if (ts.isSpreadAssignment(property)) {
        const sibling = requiredSibling(unwrap(property.expression))
        if (sibling === undefined) list.isOpen = true
        else list.spreads.push(sibling)
      } else list.isOpen = true
    }
  }
  visit(source)
  return list ?? assignedExports(source)
}

function isFunction(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  )
}

/** Where `var` declarations land. */
function isVariableScope(node) {
  return ts.isSourceFile(node) || isFunction(node) || ts.isClassStaticBlockDeclaration(node)
}

/**
 * A node that can declare names of its own. A function's body block is the
 * function's scope, not a second one.
 */
function isScope(node) {
  return ts.isBlock(node)
    ? !isVariableScope(node.parent)
    : isVariableScope(node) ||
        ts.isCaseBlock(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isCatchClause(node) ||
        ts.isClassExpression(node)
}

function bindingNames(name, into) {
  if (ts.isIdentifier(name)) into.add(name.text)
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, into)
}

const isBlockScoped = (list) => (list.flags & ts.NodeFlags.BlockScoped) !== 0

/** `let`, `const`, class and function declarations among a block's own statements. */
function lexicalNames(statements, into) {
  for (const statement of statements) {
    if (ts.isVariableStatement(statement) && isBlockScoped(statement.declarationList))
      for (const declaration of statement.declarationList.declarations)
        bindingNames(declaration.name, into)
    else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    )
      into.add(statement.name.text)
  }
}

/** Every `var` under a node, down to the next function or static block. */
function hoistedNames(root, into) {
  const visit = (node) => {
    if (ts.isVariableDeclarationList(node) && !isBlockScoped(node))
      for (const declaration of node.declarations) bindingNames(declaration.name, into)
    if (isFunction(node) || ts.isClassStaticBlockDeclaration(node)) return
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(root, visit)
}

/** The names one scope declares. */
function declaredBy(scope, cache) {
  const known = cache.get(scope)
  if (known !== undefined) return known
  const names = new Set()
  if (isFunction(scope)) {
    for (const parameter of scope.parameters) bindingNames(parameter.name, names)
    if (ts.isFunctionExpression(scope) && scope.name !== undefined) names.add(scope.name.text)
    if (scope.body !== undefined) {
      hoistedNames(scope.body, names)
      if (ts.isBlock(scope.body)) lexicalNames(scope.body.statements, names)
    }
  } else if (ts.isSourceFile(scope)) {
    hoistedNames(scope, names)
    lexicalNames(scope.statements, names)
  } else if (ts.isClassStaticBlockDeclaration(scope)) {
    hoistedNames(scope.body, names)
    lexicalNames(scope.body.statements, names)
  } else if (ts.isBlock(scope)) lexicalNames(scope.statements, names)
  else if (ts.isCaseBlock(scope))
    for (const clause of scope.clauses) lexicalNames(clause.statements, names)
  else if (ts.isCatchClause(scope)) {
    if (scope.variableDeclaration !== undefined) bindingNames(scope.variableDeclaration.name, names)
  } else if (ts.isClassExpression(scope)) {
    if (scope.name !== undefined) names.add(scope.name.text)
  } else {
    // A loop head: `for (let i ...)`, `for (const x of ...)`.
    const { initializer } = scope
    if (
      initializer !== undefined &&
      ts.isVariableDeclarationList(initializer) &&
      isBlockScoped(initializer)
    )
      for (const declaration of initializer.declarations) bindingNames(declaration.name, names)
  }
  cache.set(scope, names)
  return names
}

function enclosingFunction(node) {
  let scope = node.parent
  while (scope !== undefined && !isFunction(scope)) scope = scope.parent
  return scope
}

/** An identifier that reads or writes a variable: not a property name, a label or a declaration. */
function isVariableUse(identifier) {
  const parent = identifier.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === identifier
  // In a pattern only a default value is read: `{ a = fallback }`.
  if (ts.isBindingElement(parent)) return parent.initializer === identifier
  const isLabel =
    ts.isLabeledStatement(parent) ||
    ts.isBreakStatement(parent) ||
    ts.isContinueStatement(parent) ||
    ts.isMetaProperty(parent)
  const isNamed =
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isClassLike(parent) ||
    isFunction(parent)
  return !isLabel && (!isNamed || parent.name !== identifier)
}

function isCallOf(node) {
  return ts.isCallExpression(node.parent) && node.parent.expression === node
}

/** `Promise.resolve().then(() => require("./x.js"))`: a dynamic import, lowered. */
function loweredImport(arrow) {
  const call = arrow.parent
  return arrow.parameters.length === 0 &&
    ts.isCallExpression(call) &&
    call.arguments[0] === arrow &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'then'
    ? call
    : undefined
}

/**
 * Every member one bundle reads from each sibling bundle it loads, and every
 * use of a loaded sibling that could not be followed to its members.
 */
function siblingReads(source) {
  const reads = new Map()
  const lost = new Map()
  const computed = []
  const declared = new WeakMap()
  const uses = new Map()
  const accesses = new Map()
  const queue = []
  const queued = new Set()
  const held = new Set()
  const scopeIds = new WeakMap()
  let nextScopeId = 1

  const usesOf = (name) => uses.get(name) ?? []
  const accessesOf = (name) => accesses.get(name) ?? []
  const scopeOf = (name, node) => {
    for (let current = node.parent; current !== undefined; current = current.parent)
      if (isScope(current) && declaredBy(current, declared).has(name)) return current
    return
  }
  const scopeId = (scope) => {
    if (scope === undefined) return 0
    let id = scopeIds.get(scope)
    if (id === undefined) {
      id = nextScopeId
      nextScopeId += 1
      scopeIds.set(scope, id)
    }
    return id
  }
  const follow = (node, sibling, kind) => {
    const key = `${String(node.pos)}:${String(node.end)}:${sibling}:${kind}`
    if (queued.has(key)) return
    queued.add(key)
    queue.push({ node, sibling, kind })
  }
  const note = (sibling, member) => {
    reads.get(sibling).add(member)
  }
  const lose = (sibling, node, form) => {
    const text = node.getText(source).replaceAll(/\s+/g, ' ')
    const shown = text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text
    lost.set(`${sibling} ${form} ${shown}`, { sibling, form, shown })
  }
  /** Runs once for each thing that holds a sibling: `first` is false on a repeat. */
  const first = (...key) => {
    const text = key.join(':')
    if (held.has(text)) return false
    held.add(text)
    return true
  }

  // esbuild's interop helper keeps the module it is given: __toESM(require("./x.js")).
  const helpers = new Map()
  const isInteropHelper = (callee) => {
    if (scopeOf(callee.text, callee) !== source) return false
    let known = helpers.get(callee.text)
    if (known === undefined) {
      known = false
      const visit = (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === callee.text &&
          node.initializer !== undefined &&
          isFunction(node.initializer)
        )
          known = node.initializer.getText(source).includes('__esModule')
        if (!isFunction(node)) ts.forEachChild(node, visit)
      }
      visit(source)
      helpers.set(callee.text, known)
    }
    return known
  }

  const holdVariable = (identifier, sibling, kind) => {
    const scope = scopeOf(identifier.text, identifier)
    if (!first('variable', scopeId(scope), identifier.text, sibling, kind)) return
    for (const use of usesOf(identifier.text))
      if (use !== identifier && scopeOf(use.text, use) === scope) follow(use, sibling, kind)
  }
  // A property is known by its name alone, whatever object carries it: a
  // second property of the same name can only add reads to compare, and a
  // read the sibling does not export fails where it can be seen.
  const holdProperty = (target, sibling, kind) => {
    const name = target.name.text
    if (!first('property', name, sibling, kind)) return
    for (const access of accessesOf(name)) if (access !== target) follow(access, sibling, kind)
  }
  /** A method, or a function kept in a property, that returns it: every call by that name. */
  const holdMethod = (method, sibling, result) => {
    if (!first('method', method, sibling, result)) return
    for (const access of accessesOf(method)) {
      if (isCallOf(access)) follow(access.parent, sibling, result)
      else if (!(ts.isBinaryExpression(access.parent) && access.parent.left === access))
        lose(sibling, access.parent, `hands on ${method}, which returns it, without calling it`)
    }
  }
  const hold = (target, sibling, kind, at) => {
    if (ts.isIdentifier(target)) return holdVariable(target, sibling, kind)
    if (ts.isPropertyAccessExpression(target)) return holdProperty(target, sibling, kind)
    const isPattern = ts.isObjectBindingPattern(target)
    if (!isPattern && !ts.isObjectLiteralExpression(target))
      return lose(sibling, at, 'keeps it where the check cannot name it')
    if (kind !== MODULE) return lose(sibling, at, 'destructures the promise of it')
    const elements = isPattern ? target.elements : target.properties
    for (const element of elements) {
      // `...rest` copies every export into a new object: no one member is read.
      const isRest = isPattern
        ? element.dotDotDotToken !== undefined
        : ts.isSpreadAssignment(element)
      const key = isPattern ? (element.propertyName ?? element.name) : element.name
      const member = isRest || key === undefined ? undefined : propertyNameText(key)
      if (member === undefined) lose(sibling, at, 'destructures a member the check cannot name')
      else note(sibling, member)
    }
  }

  /** What a function returns reaches whoever calls it. */
  const holdReturn = (callable, sibling, kind, at) => {
    if (callable === undefined || callable.asteriskToken !== undefined)
      return lose(sibling, at, 'returns it where the check cannot follow')
    const isAsync =
      ts.canHaveModifiers(callable) &&
      (ts.getModifiers(callable) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      )
    const result = isAsync ? PROMISE : kind
    let value = callable
    while (ts.isParenthesizedExpression(value.parent)) value = value.parent
    const parent = value.parent
    // Called where it stands.
    if (ts.isCallExpression(parent) && parent.expression === value)
      return follow(parent, sibling, result)
    let name
    if (ts.isFunctionDeclaration(callable)) name = callable.name
    else if (ts.isVariableDeclaration(parent) && parent.initializer === value) name = parent.name
    else if (
      ts.isBinaryExpression(parent) &&
      parent.right === value &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    )
      name = parent.left
    else if (
      ts.isMethodDeclaration(callable) ||
      ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
        parent.initializer === value)
    ) {
      const method = propertyNameText(
        ts.isMethodDeclaration(callable) ? callable.name : parent.name,
      )
      return method === undefined
        ? lose(sibling, at, 'returns it from a method the check cannot name')
        : holdMethod(method, sibling, result)
    }
    if (name !== undefined && ts.isPropertyAccessExpression(name))
      return holdMethod(name.name.text, sibling, result)
    if (name === undefined || !ts.isIdentifier(name))
      return lose(sibling, at, 'returns it from a function the check cannot name')
    const scope = scopeOf(name.text, name)
    if (!first('function', scopeId(scope), name.text, sibling, result)) return
    for (const use of usesOf(name.text)) {
      if (use === name || scopeOf(use.text, use) !== scope) continue
      if (isCallOf(use)) follow(use.parent, sibling, result)
      else if (!(ts.isBinaryExpression(use.parent) && use.parent.left === use))
        lose(sibling, use.parent, `hands on ${name.text}, which returns it, without calling it`)
    }
  }

  /** Follows one expression whose value is a sibling's module, or the promise of it. */
  const trace = (start, sibling, startKind) => {
    let value = start
    let kind = startKind
    for (;;) {
      const parent = value.parent
      if (ts.isParenthesizedExpression(parent)) value = parent
      else if (ts.isAwaitExpression(parent)) {
        kind = MODULE
        value = parent
      } else if (ts.isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind
        if (ASSIGNMENTS.has(operator)) {
          // On the left it is written, not read.
          if (parent.left === value) return
          hold(parent.left, sibling, kind, parent)
          value = parent
        } else if (
          operator === ts.SyntaxKind.QuestionQuestionToken ||
          operator === ts.SyntaxKind.BarBarToken
        )
          value = parent
        else if (
          operator === ts.SyntaxKind.CommaToken ||
          operator === ts.SyntaxKind.AmpersandAmpersandToken
        ) {
          if (parent.right !== value) return
          value = parent
        } else if (TESTS.has(operator)) return
        else return lose(sibling, parent, 'uses it in an expression the check cannot follow')
      } else if (ts.isConditionalExpression(parent)) {
        if (parent.condition === value) return
        value = parent
      } else if (
        ts.isExpressionStatement(parent) ||
        ts.isTypeOfExpression(parent) ||
        ts.isVoidExpression(parent) ||
        (ts.isPrefixUnaryExpression(parent) &&
          parent.operator === ts.SyntaxKind.ExclamationToken) ||
        ((ts.isIfStatement(parent) ||
          ts.isWhileStatement(parent) ||
          ts.isDoStatement(parent) ||
          ts.isSwitchStatement(parent)) &&
          parent.expression === value) ||
        (ts.isForStatement(parent) && parent.condition === value)
      )
        // Tested or dropped: nothing of it is read.
        return
      else if (ts.isPropertyAccessExpression(parent) && parent.expression === value) {
        const member = parent.name.text
        if (kind === MODULE) return note(sibling, member)
        if (!isCallOf(parent)) return lose(sibling, parent, `reads ${member} of the promise of it`)
        if (member === 'then') {
          const [callback] = parent.parent.arguments
          if (callback === undefined) return
          if (!isFunction(callback))
            return lose(sibling, parent.parent, 'passes it to a callback the check cannot read')
          const [parameter] = callback.parameters
          if (parameter !== undefined) hold(parameter.name, sibling, MODULE, parent.parent)
          return
        }
        if (member !== 'catch' && member !== 'finally')
          return lose(sibling, parent, `reads ${member} of the promise of it`)
        value = parent.parent
      } else if (ts.isElementAccessExpression(parent) && parent.expression === value) {
        return kind === MODULE && ts.isStringLiteralLike(parent.argumentExpression)
          ? note(sibling, parent.argumentExpression.text)
          : lose(sibling, parent, 'reads a member the check cannot name')
      } else if (ts.isCallExpression(parent)) {
        if (parent.expression === value) return lose(sibling, parent, 'calls it as a function')
        if (
          kind !== MODULE ||
          parent.arguments[0] !== value ||
          !ts.isIdentifier(parent.expression) ||
          !isInteropHelper(parent.expression)
        )
          return lose(sibling, parent, 'passes it whole to other code')
        value = parent
      } else if (ts.isVariableDeclaration(parent) && parent.initializer === value)
        return hold(parent.name, sibling, kind, parent)
      else if (ts.isReturnStatement(parent))
        return holdReturn(enclosingFunction(parent), sibling, kind, parent)
      else if (ts.isArrowFunction(parent) && parent.body === value) {
        const lowered = loweredImport(parent)
        if (lowered === undefined) return holdReturn(parent, sibling, kind, parent)
        kind = PROMISE
        value = lowered
      } else return lose(sibling, parent, 'keeps it where the check cannot follow')
    }
  }

  const collect = (node) => {
    // The export annotation is never run: its spreads are the export list.
    if (annotationObject(node) !== undefined) return
    if (ts.isIdentifier(node)) {
      if (isVariableUse(node)) {
        if (!uses.has(node.text)) uses.set(node.text, [])
        uses.get(node.text).push(node)
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text
      if (!accesses.has(name)) accesses.set(name, [])
      accesses.get(name).push(node)
    }
    const required = requiredSibling(node)
    const sibling = required ?? importedSibling(node)
    if (sibling !== undefined) {
      if (!reads.has(sibling)) reads.set(sibling, new Set())
      follow(node, sibling, required === undefined ? PROMISE : MODULE)
    }
    // Which bundle a computed name loads cannot be read here: it is listed, and
    // the gate passes only the ones it has been told about.
    if (isComputedLoad(node)) computed.push(node.getText(source).replaceAll(/\s+/g, ' '))
    // The Node bundles are CommonJS. A static import of a sibling would be a
    // form this does not read, so it is said rather than skipped.
    const declared = staticSibling(node)
    if (declared !== undefined) {
      if (!reads.has(declared)) reads.set(declared, new Set())
      lose(
        declared,
        node,
        'takes it by a static import or re-export, which the check does not read',
      )
    }
    ts.forEachChild(node, collect)
  }
  collect(source)
  for (let item = queue.pop(); item !== undefined; item = queue.pop())
    trace(item.node, item.sibling, item.kind)
  return { reads, lost: lost.values().toArray(), computed }
}

/**
 * The bundles a build plugin points other bundles at (`deferredCohort` in
 * deferredBundles.mjs). Each must have members compared with it, or the gate
 * fails: these are the ones 0.18.0's missing exports were in.
 */
export const CROSS_BUNDLE_TARGETS = Object.freeze(['modelApi.js', 'modelApiBoundaries.js'])

/**
 * The loads by a computed name the gate accepts: the reader, a part of the
 * call that minifying does not rename, and below, why.
 *
 * - `configuredProviders.js`: configured.ts falls back from
 *   dist/providerCatalog.json to the same table written as a module beside
 *   it. That file is data (`module.exports = JSON.parse(...)`); the reader
 *   hands the whole module to its schema and calls no member of it.
 *
 * Any other computed load fails the gate, and so does an entry here whose
 * load is no longer in the build.
 */
export const COMPUTED_LOADS = Object.freeze([
  Object.freeze({
    reader: 'configuredProviders.js',
    fragment: String.raw`catalogFile.replace(/\.json$/,".js")`,
  }),
])

const sorted = (items) => [...items].toSorted((a, b) => a.localeCompare(b, 'en'))

/**
 * The cross-bundle members of a set of built bundles, by file name
 * (`modelApi.js`) and text.
 *
 * - `problems` names every member a bundle reads from a sibling that the
 *   sibling does not export.
 * - `verified` counts the members compared with each sibling's export list.
 *   A sibling no member was compared with is not in it.
 * - `unverified` lists siblings whose export list could not be read from
 *   their text, so nothing was compared with them.
 * - `unfollowed` names every use of a loaded sibling the check could not
 *   follow to the members read: the reader, the sibling and the form.
 * - `computed` lists every `require(...)` or `import(...)` whose file is
 *   worked out at run time, by reader and text: which bundle it loads is not
 *   in the text, so nothing can be compared for it.
 */
export function siblingExportProblems(files) {
  const exportLists = new Map()
  const readsByFile = new Map()
  const unfollowed = []
  const computed = []
  for (const [name, text] of files) {
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    exportLists.set(name, exportList(source))
    if (!LOADS_A_FILE.test(text)) continue
    const { reads, lost, computed: named } = siblingReads(source)
    readsByFile.set(name, reads)
    for (const call of named) computed.push({ reader: name, text: call })
    // A sibling outside this set is the package lists' concern.
    for (const { sibling, form, shown } of lost)
      if (files.has(sibling)) unfollowed.push(`${name} loads ${sibling} and ${form}: ${shown}`)
  }
  const resolved = new Map()
  const exportsOf = (name, trail = new Set()) => {
    if (resolved.has(name)) return resolved.get(name)
    const list = exportLists.get(name)
    if (list === undefined || list.isOpen || trail.has(name)) return
    const names = new Set(list.names)
    for (const spread of list.spreads) {
      const inner = exportsOf(spread, new Set([...trail, name]))
      if (inner === undefined) return
      for (const item of inner) names.add(item)
    }
    resolved.set(name, names)
    return names
  }
  const problems = []
  const verified = new Map()
  const unverified = new Set()
  for (const [name, reads] of readsByFile) {
    for (const [sibling, members] of reads) {
      if (!files.has(sibling)) continue
      const exported = exportsOf(sibling)
      if (exported === undefined) {
        unverified.add(sibling)
        continue
      }
      // Loaded and nothing read from it compares nothing: it is not verified.
      if (members.size > 0) verified.set(sibling, (verified.get(sibling) ?? 0) + members.size)
      for (const member of members)
        if (!exported.has(member) && !INTEROP.has(member))
          problems.push(`${name} reads ${member} from ${sibling}, which does not export it`)
    }
  }
  return {
    problems: sorted(problems),
    verified,
    unverified: sorted(unverified),
    unfollowed: sorted(unfollowed),
    computed: computed.toSorted(
      (a, b) => a.reader.localeCompare(b.reader, 'en') || a.text.localeCompare(b.text, 'en'),
    ),
  }
}

/**
 * Why a cross-bundle report does not pass, as sentences: a member a sibling
 * does not export, a use that could not be followed, a load by a computed
 * name that is not in `expectedComputed` (or an entry of it that matches no
 * load), a sibling whose export list could not be read, and each of
 * `targets` (the bundles a build plugin points others at) that no member was
 * compared with. Being loaded is not being checked: a target counts only by
 * the members compared with it.
 */
export function crossBundleFailures(report, targets, expectedComputed = []) {
  const isExpected = (load) =>
    expectedComputed.some(
      ({ reader, fragment }) => reader === load.reader && load.text.includes(fragment),
    )
  return [
    ...report.problems,
    ...report.unfollowed.map((sentence) => `${sentence} (not followed, so not checked)`),
    ...report.computed
      .filter((load) => !isExpected(load))
      .map(
        ({ reader, text }) =>
          `${reader} loads a file whose name is worked out at run time, ${text}: the check cannot tell which bundle that is, so nothing read from it is checked`,
      ),
    // A listed load that is gone would leave the list saying more than the build.
    ...expectedComputed
      .filter(({ reader, fragment }) =>
        report.computed.every((load) => !(load.reader === reader && load.text.includes(fragment))),
      )
      .map(
        ({ reader, fragment }) =>
          `${reader}: the computed load listed as expected (${fragment}) is not in the build`,
      ),
    ...report.unverified.map(
      (sibling) =>
        `${sibling}: its export list is not in its text, so nothing read from it was checked`,
    ),
    ...targets
      .filter((target) => (report.verified.get(target) ?? 0) === 0)
      .map(
        (target) =>
          `${target}: no member read from it was compared with its export list (nothing reads a member of it in a form the check follows)`,
      ),
  ]
}
