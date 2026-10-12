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
// bundles it loads and each member it reads from them, and compares with the
// export list in the sibling's own text.

import ts from 'typescript'

const SIBLING = /^\.\/[\w.-]+\.js$/
// Members of a module namespace that are not exports of the bundle.
const INTEROP = new Set(['default', '__esModule'])

function unwrap(node) {
  let current = node
  while (ts.isParenthesizedExpression(current)) current = current.expression
  return current
}

function siblingArgument(call) {
  const [argument] = call.arguments
  return argument !== undefined &&
    call.arguments.length === 1 &&
    ts.isStringLiteral(argument) &&
    SIBLING.test(argument.text)
    ? argument.text.slice(2)
    : undefined
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

function propertyNameText(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined
}

/**
 * The names a CommonJS bundle exports, from esbuild's annotation for Node's
 * export scanner, `0 && (module.exports = { a, b, ...require("./c.js") })`.
 * `undefined` when the text has no such annotation: its exports are unknown.
 */
function exportList(source) {
  let list
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ts.isNumericLiteral(node.left) &&
      node.left.text === '0'
    ) {
      const assignment = unwrap(node.right)
      if (
        ts.isBinaryExpression(assignment) &&
        assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(assignment.left) &&
        ts.isIdentifier(assignment.left.expression) &&
        assignment.left.expression.text === 'module' &&
        assignment.left.name.text === 'exports' &&
        ts.isObjectLiteralExpression(assignment.right)
      ) {
        list ??= { names: new Set(), spreads: [], isOpen: false }
        for (const property of assignment.right.properties) {
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
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return list
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

function bindingNames(name, into) {
  if (ts.isIdentifier(name)) into.add(name.text)
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, into)
}

/** Every name a function declares: parameters, its own name and its locals. */
function declaredIn(scope, cache) {
  const known = cache.get(scope)
  if (known !== undefined) return known
  const names = new Set()
  for (const parameter of scope.parameters) bindingNames(parameter.name, names)
  if (ts.isFunctionExpression(scope) && scope.name !== undefined) names.add(scope.name.text)
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) bindingNames(node.name, names)
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name)
      names.add(node.name.text)
    // A nested function's locals are its own.
    if (isFunction(node)) return
    ts.forEachChild(node, visit)
  }
  if (scope.body !== undefined) ts.forEachChild(scope.body, visit)
  cache.set(scope, names)
  return names
}

function enclosingFunction(node) {
  let scope = node.parent
  while (scope !== undefined && !isFunction(scope)) scope = scope.parent
  return scope
}

/**
 * How an expression holding a sibling's module is used: the binding that
 * keeps it (`alias`, in `scope`; a module-level binding has no scope), the
 * members a destructuring names (`pattern`), or one member read on the spot.
 */
function useOfModule(expression, isAwaited) {
  let value = expression
  while (ts.isParenthesizedExpression(value.parent)) value = value.parent
  const parent = value.parent
  if (ts.isVariableDeclaration(parent) && parent.initializer === value)
    return ts.isIdentifier(parent.name)
      ? { alias: parent.name.text, scope: enclosingFunction(parent) }
      : { pattern: parent.name }
  if (
    !isAwaited &&
    ts.isBinaryExpression(parent) &&
    parent.right === value &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(parent.left)
  )
    // A module initialised on first use assigns its module-level binding.
    return { alias: parent.left.text, scope: undefined }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === value)
    return { member: parent.name.text }
  return ts.isElementAccessExpression(parent) &&
    parent.expression === value &&
    ts.isStringLiteral(parent.argumentExpression)
    ? { member: parent.argumentExpression.text }
    : {}
}

/** How a promise of a sibling's module is used: awaited, or read in `.then`. */
function useOfPromise(promise) {
  let value = promise
  while (ts.isParenthesizedExpression(value.parent)) value = value.parent
  const next = value.parent
  if (ts.isAwaitExpression(next)) return useOfModule(next, true)
  if (
    ts.isPropertyAccessExpression(next) &&
    next.expression === value &&
    next.name.text === 'then' &&
    ts.isCallExpression(next.parent)
  ) {
    const [callback] = next.parent.arguments
    const parameter =
      callback !== undefined && isFunction(callback) ? callback.parameters[0] : undefined
    if (parameter === undefined) return {}
    return ts.isIdentifier(parameter.name)
      ? { alias: parameter.name.text, scope: callback }
      : { pattern: parameter.name }
  }
  return {}
}

/** How one `require("./x.js")` is used, through esbuild's wrappers. */
function useOfRequire(call) {
  let value = call
  for (;;) {
    const parent = value.parent
    // Parentheses, or the interop wrapper: __toESM(require("./x.js")) or (…, 1).
    if (
      ts.isParenthesizedExpression(parent) ||
      (ts.isCallExpression(parent) &&
        parent.arguments[0] === value &&
        ts.isIdentifier(parent.expression) &&
        (parent.arguments.length === 1 ||
          (parent.arguments.length === 2 && ts.isNumericLiteral(parent.arguments[1]))))
    )
      value = parent
    else break
  }
  const holder = value.parent
  // A lowered dynamic import: Promise.resolve().then(() => require("./x.js")).
  return ts.isArrowFunction(holder) &&
    holder.body === value &&
    holder.parameters.length === 0 &&
    ts.isCallExpression(holder.parent) &&
    holder.parent.arguments[0] === holder &&
    ts.isPropertyAccessExpression(holder.parent.expression) &&
    holder.parent.expression.name.text === 'then'
    ? useOfPromise(holder.parent)
    : useOfModule(value, false)
}

/** The member a node reads from the binding `alias`, as `alias.member` or `alias["member"]`. */
function memberOf(node, alias) {
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === alias &&
    ts.isIdentifier(node.name)
  )
    return node.name.text
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === alias &&
    ts.isStringLiteral(node.argumentExpression)
  )
    return node.argumentExpression.text
  return
}

/** Every member this bundle reads from each sibling bundle it loads. */
function siblingReads(source) {
  const reads = new Map()
  const note = (sibling, member) => {
    if (member !== undefined) reads.get(sibling).add(member)
  }
  const moduleAliases = new Map()
  const localAliases = []
  const collect = (node) => {
    const required = requiredSibling(node)
    const sibling = required ?? importedSibling(node)
    if (sibling !== undefined) {
      if (!reads.has(sibling)) reads.set(sibling, new Set())
      const use = required === undefined ? useOfPromise(node) : useOfRequire(node)
      if (use.member !== undefined) note(sibling, use.member)
      else if (use.pattern !== undefined) {
        if (ts.isObjectBindingPattern(use.pattern))
          for (const element of use.pattern.elements)
            if (element.dotDotDotToken === undefined)
              note(sibling, propertyNameText(element.propertyName ?? element.name))
      } else if (use.alias !== undefined) {
        if (use.scope === undefined) moduleAliases.set(use.alias, sibling)
        else localAliases.push({ alias: use.alias, sibling, scope: use.scope })
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(source)

  const declared = new WeakMap()
  if (moduleAliases.size > 0) {
    // One walk for every module-level binding. A function that declares the
    // same name holds its own value under it.
    const hidden = new Map()
    const walk = (node) => {
      const shadowed = isFunction(node)
        ? [...declaredIn(node, declared)].filter((name) => moduleAliases.has(name))
        : []
      for (const name of shadowed) hidden.set(name, (hidden.get(name) ?? 0) + 1)
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const base = node.expression
        if (ts.isIdentifier(base) && moduleAliases.has(base.text) && !hidden.get(base.text))
          note(moduleAliases.get(base.text), memberOf(node, base.text))
      }
      ts.forEachChild(node, walk)
      for (const name of shadowed) hidden.set(name, hidden.get(name) - 1)
    }
    walk(source)
  }
  for (const { alias, sibling, scope } of localAliases) {
    const walk = (node) => {
      if (node !== scope && isFunction(node) && declaredIn(node, declared).has(alias)) return
      note(sibling, memberOf(node, alias))
      ts.forEachChild(node, walk)
    }
    walk(scope)
  }
  return reads
}

/**
 * The cross-bundle members of a set of built bundles, by file name
 * (`modelApi.js`) and text. `problems` names every member a bundle reads from
 * a sibling that the sibling does not export. `verified` counts the members
 * checked against each sibling; `unverified` lists siblings whose export list
 * could not be read from their text, so nothing was checked against them.
 */
export function siblingExportProblems(files) {
  const exportLists = new Map()
  const readsByFile = new Map()
  for (const [name, text] of files) {
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    exportLists.set(name, exportList(source))
    if (/(?:require|import)\(["']\.\//.test(text)) readsByFile.set(name, siblingReads(source))
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
      // A sibling outside this set is the package lists' concern.
      if (!files.has(sibling)) continue
      const exported = exportsOf(sibling)
      if (exported === undefined) {
        unverified.add(sibling)
        continue
      }
      verified.set(sibling, (verified.get(sibling) ?? 0) + members.size)
      for (const member of members)
        if (!exported.has(member) && !INTEROP.has(member))
          problems.push(`${name} reads ${member} from ${sibling}, which does not export it`)
    }
  }
  return {
    problems: problems.toSorted((a, b) => a.localeCompare(b, 'en')),
    verified,
    unverified: [...unverified].toSorted((a, b) => a.localeCompare(b, 'en')),
  }
}
