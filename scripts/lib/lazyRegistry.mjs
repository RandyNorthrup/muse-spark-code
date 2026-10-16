// The lazy-bundle registry's scanner: every dist file the sources load by
// file name, read from the TypeScript syntax tree of each source that can
// hold one. scripts/gen-lazy-registry.mjs resolves each name through the
// build's own redirect map (DEFERRED_OUTFILES) and emitted files, attributes
// it to the side whose bundles contain the loading source, and writes or
// checks src/shared/lazyBundles.generated.ts.
//
// Redesigned for the 0.18.1 candidate (reviews RVDIET0181 and
// RVAPP-DIET0181). The scan read lines with regular expressions before, and
// each review found a form it missed without saying so: a template literal,
// a name wrapped onto its own line, a constant loaded in the file that
// defines it, a line it skipped by its shape. The tree has no such forms: a
// literal is a literal wherever it stands, and a load whose file name is
// worked out at run time is recorded and fails unless it is listed below
// with its reason. Nothing is skipped.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const TS_EXTENSIONS = new Set(['.ts', '.tsx'])

// Text beside a bare file name that says the name is a bundle's: the dist
// prefix or one of the loader adapters whose argument is the file name.
const LOADER_HINTS = [
  'dist',
  'distDir',
  'bundlePath',
  'bundleFile',
  'BUNDLE_FILE',
  '__dirname',
  'Worker',
  'workerPath',
  'loadBundle',
  'requireFile',
  'joinPath',
  'asWebviewUri',
  'loadModule',
  'path.join',
  'path.dirname',
  'path.resolve',
  'bundleRoot',
  'extensionUri',
  'extensionPath',
  'packageRoot',
]

const BASENAME = /^(?!\.)[A-Za-z0-9_.-]+\.js$/u
const STRING_LITERAL = /(['"`])((?:(?!\1)[^\\]|\\.)*?)\1/g
const IDENTIFIER_CHARACTER = /[\w$]/u
const LOAD_CALL = /(\bimport\(|\brequire\()/u

/**
 * Loads whose file name is worked out at run time, each with the reason the
 * registry still knows the file: where the name is a literal the scan reads.
 * `call` is the callee and its first argument without white space. Any other
 * computed load fails the check, and so does an entry here that no longer
 * matches a load in the source.
 */
export const COMPUTED_SOURCE_LOADS = Object.freeze([
  Object.freeze({
    importer: 'src/host/lazyBundle.ts',
    call: 'createRequire(file)(file)',
    reason:
      'The adapter every deferred bundle loads through: its callers pass the path, and each names the file in a literal or a bundle-name constant the scan reads.',
  }),
  Object.freeze({
    importer: 'src/core/providers/configured.ts',
    call: String.raw`import(pathToFileURL(options.catalogFile.replace(/\.json$/,'.js')).href)`,
    reason:
      'The provider catalog beside the JSON file the caller names: data handed whole to its schema, written by scripts/build.mjs as dist/providerCatalog.js, which both package lists carry.',
  }),
  Object.freeze({
    importer: 'src/core/imageResize.ts',
    call: 'new Worker(workerPath)',
    reason:
      "The image worker: the path defaults to path.join(__dirname, 'imageResizeWorker.js') in the same function, a literal the scan reads.",
  }),
  Object.freeze({
    importer: 'src/host/backend/toolIo.ts',
    call: 'new Worker(workerPath)',
    reason:
      'The search worker: the caller passes the path, built from the SEARCH_WORKER_FILE constant the scan reads.',
  }),
  Object.freeze({
    importer: 'src/host/web/pageConverter.ts',
    call: 'new Worker(path)',
    reason:
      'The page worker: the caller passes the path, built from the PAGE_WORKER_FILE constant the scan reads.',
  }),
])

/**
 * File names the sources spell that the process holding the source does not
 * load, each with its reason and the package that must carry the file. The
 * generator takes no load from such a name (it gives no side to the file and
 * asks nothing of the other package), checks that the build emits the file
 * and that the named package carries it, and fails on an entry the source no
 * longer holds. The line scan skipped this form by its shape and said
 * nothing; here it is listed.
 */
export const NAMED_NOT_LOADED = Object.freeze([
  Object.freeze({
    importer: 'src/runtime/schedules/wake.ts',
    symbol: 'agentFileBeside',
    value: 'acp.js',
    carriedBy: 'acp',
    reason:
      'The agent script the operating system starts for a scheduled wake: a path handed to the OS beside process.execPath by the agent runtime (src/runtime/schedules/runtimeEntry.ts), never a module the process holding dist/schedules.js loads. VS Code loads that bundle too and never calls this.',
  }),
])

/**
 * Whether the text reads the constant as a whole name: no identifier
 * character on either side. A search, never an expression built from the
 * name: the name comes out of scanned source.
 */
export function hasIdentifier(text, identifier) {
  if (identifier === '') return false
  let at = text.indexOf(identifier)
  while (at !== -1) {
    const before = text.charAt(at - 1)
    const after = text.charAt(at + identifier.length)
    if (!IDENTIFIER_CHARACTER.test(before) && !IDENTIFIER_CHARACTER.test(after)) return true
    at = text.indexOf(identifier, at + 1)
  }
  return false
}

/** The file's lines with comments removed and strings kept whole. */
export function codeLines(text) {
  const lines = []
  let current = ''
  let quote = null
  let i = 0
  const push = (char) => {
    if (char === '\n') {
      lines.push(current)
      current = ''
    } else {
      current += char
    }
  }
  while (i < text.length) {
    const char = text[i]
    const next = text[i + 1]
    if (quote === null && char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      continue
    }
    if (quote === null && char === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') {
          lines.push(current)
          current = ''
        }
        i += 1
      }
      i += 2
      continue
    }
    if (quote === null && ["'", '"', '`'].includes(char)) {
      quote = char
      push(char)
      i += 1
      continue
    }
    if (quote !== null && char === '\\') {
      push(char)
      push(next ?? '')
      i += 2
      continue
    }
    if (quote !== null && char === quote) {
      quote = null
      push(char)
      i += 1
      continue
    }
    push(char)
    i += 1
  }
  lines.push(current)
  return lines
}

const byCodeUnit = (a, b) => (a < b ? -1 : Number(a > b))

// In name order, so the scan reads the same on every file system.
function sourceFiles(directory, skip) {
  const found = []
  for (const name of readdirSync(directory).toSorted(byCodeUnit)) {
    const file = path.join(directory, name)
    if (statSync(file).isDirectory()) found.push(...sourceFiles(file, skip))
    else if (file !== skip && TS_EXTENSIONS.has(path.extname(name))) found.push(file)
  }
  return found
}

const isPathValue = (value) =>
  value.startsWith('dist/') || value.startsWith('./') || value.startsWith('../')

const isNameLiteral = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)

const hasLoaderHint = (text) => LOADER_HINTS.some((hint) => text.includes(hint))

/** A source that can hold a load at all: a literal ending in .js, or a load call. */
function mayLoad(text) {
  return (
    text.includes(".js'") ||
    text.includes('.js"') ||
    text.includes('.js`') ||
    text.includes('import(') ||
    text.includes('equire(') ||
    text.includes('new Worker(')
  )
}

function isCreateRequireCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'createRequire'
  )
}

/** `require` and every name this file binds to a `createRequire(...)` result. */
function requireNames(tree) {
  const names = new Set(['require'])
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isCreateRequireCall(node.initializer)
    ) {
      names.add(node.name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return names
}

/**
 * The argument naming the file when the node loads one: a dynamic import, a
 * require (Node's, or one made by createRequire) or a worker start. `null`
 * for a load with no argument, `undefined` for any other node.
 */
function loadArgument(node, requires) {
  if (ts.isCallExpression(node)) {
    const callee = node.expression
    const isLoad =
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) && requires.has(callee.text)) ||
      isCreateRequireCall(callee)
    return isLoad ? (node.arguments[0] ?? null) : undefined
  }
  return ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Worker'
    ? (node.arguments?.[0] ?? null)
    : undefined
}

const withoutSpace = (text) => text.replaceAll(/\s+/gu, '')

/** The callee and first argument of a load, without white space. */
function callText(node, argument, tree) {
  const callee = withoutSpace(node.expression.getText(tree))
  const call = `${callee}(${withoutSpace(argument.getText(tree))})`
  return ts.isNewExpression(node) ? `new ${call}` : call
}

// The expression a name stands in: its calls, member reads, joins and waits,
// up to the declaration, property, statement or function that holds it. An
// array or an object ends it, so a list of names is never read as one call.
const CHAIN_KINDS = new Set([
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.NewExpression,
  ts.SyntaxKind.PropertyAccessExpression,
  ts.SyntaxKind.ElementAccessExpression,
  ts.SyntaxKind.BinaryExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.TemplateExpression,
  ts.SyntaxKind.TemplateSpan,
])

function chainRoot(node) {
  let top = node
  while (top.parent !== undefined && CHAIN_KINDS.has(top.parent.kind)) top = top.parent
  return top
}

/** The name the expression is stored under, when it is stored directly. */
function holderName(top, tree) {
  const holder = top.parent
  if (holder === undefined) return ''
  const isHeld =
    (ts.isVariableDeclaration(holder) ||
      ts.isPropertyAssignment(holder) ||
      ts.isPropertyDeclaration(holder) ||
      ts.isParameter(holder)) &&
    holder.initializer === top
  return isHeld ? holder.name.getText(tree) : ''
}

function isInLoadCall(node, requires) {
  for (let at = node; at.parent !== undefined; at = at.parent) {
    if (!CHAIN_KINDS.has(at.parent.kind)) return false
    const argument = loadArgument(at.parent, requires)
    if (argument !== undefined && argument !== null && argument === at) return true
  }
  return false
}

/**
 * The function, method or module-level declaration a node stands in:
 * `ModelApiHost.toolAssist`, `agentFileBeside`, `WEB_FETCH_BUNDLE_FILE`.
 * A registry row names this instead of a line number, so an unrelated edit
 * of the file does not make the registry stale.
 */
function symbolOf(node) {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    const isMember =
      ts.isMethodDeclaration(at) ||
      ts.isPropertyDeclaration(at) ||
      ts.isGetAccessorDeclaration(at) ||
      ts.isSetAccessorDeclaration(at) ||
      ts.isConstructorDeclaration(at)
    if (isMember && ts.isClassLike(at.parent)) {
      const owner = at.parent.name?.text ?? '(class)'
      const member = ts.isConstructorDeclaration(at) ? 'constructor' : at.name.getText()
      return `${owner}.${member}`
    }
    if (ts.isFunctionDeclaration(at) && at.name !== undefined) return at.name.text
    if (ts.isClassDeclaration(at) && at.name !== undefined) return at.name.text
    if (!ts.isVariableDeclaration(at) || !ts.isIdentifier(at.name)) continue
    const isFunction =
      at.initializer !== undefined &&
      (ts.isArrowFunction(at.initializer) || ts.isFunctionExpression(at.initializer))
    const isModuleLevel = ts.isSourceFile(at.parent.parent.parent)
    if (isFunction || isModuleLevel) return at.name.text
  }
  return '(module)'
}

/**
 * @typedef {object} LazyRequest
 * @property {string} importer root-relative source with forward slashes
 * @property {number} line 1-based line of the naming literal
 * @property {string} value the dist name as spelled (dist/, relative or bare)
 * @property {string} symbol the function, method or constant it stands in
 * @property {string|undefined} identifier the const holding it, when assigned
 *
 * @typedef {object} ComputedLoad
 * @property {string} importer root-relative source with forward slashes
 * @property {number} line 1-based line of the load
 * @property {string} call the callee and its first argument, no white space
 *
 * @typedef {object} LazyScan
 * @property {LazyRequest[]} requests
 * @property {Map<string, string>} definitions bundle-name constant to defining file
 * @property {Map<string, string[]>} uses constant to every other mentioning file
 * @property {Map<string, string[]>} usesLoad constant to files loading by it
 * @property {ComputedLoad[]} computed loads whose file name is not a literal
 */

/**
 * One parsed source: the tree, its comment-free lines, and the literals that
 * start on each line (for the rules that read what stands beside a name).
 */
function parseSource(file, text) {
  const tree = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  return { tree, lines: codeLines(text), requires: requireNames(tree) }
}

/** A module name the bundler reads, never a file loaded by name at run time. */
function isStaticSpecifier(node) {
  const parent = node.parent
  return (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
  )
}

const lineOf = (tree, node) => tree.getLineAndCharacterOfPosition(node.getStart(tree)).line

/** What stands beside a node: its expression, the name holding it, its line. */
function contextOf(node, source) {
  const top = chainRoot(node)
  const line = source.lines[lineOf(source.tree, node)] ?? ''
  return { top, text: `${holderName(top, source.tree)} ${top.getText(source.tree)}\n${line}`, line }
}

/** Another path literal in the same expression: `join('./dist', 'x.js')`. */
function hasSiblingPath(top, node) {
  let isFound = false
  const visit = (child) => {
    if (isFound) return
    if (child !== node && isNameLiteral(child)) {
      if (isPathValue(child.text) && !child.text.endsWith('.js')) isFound = true
      return
    }
    ts.forEachChild(child, visit)
  }
  visit(top)
  return isFound
}

/** The file name a literal gives, or nothing when it names no bundle. */
function literalRequest(node, source) {
  const value = node.text
  if (value.includes('@') || isStaticSpecifier(node)) return
  const parent = node.parent
  if (!value.endsWith('.js')) {
    if (!isPathValue(value)) return
    // A path stem joined with a `.js` fragment names its bundle.
    const isJoined =
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      parent.left === node &&
      isNameLiteral(parent.right) &&
      parent.right.text === '.js'
    if (isJoined) return { value: `${value}.js` }
    // An extensionless relative name in a load is a redirected bundle (the
    // map knows it) or an import the bundler inlines.
    return isInLoadCall(node, source.requires) ? { value } : undefined
  }
  const context = contextOf(node, source)
  const isAssigned = ts.isVariableDeclaration(parent) && parent.initializer === node
  if (isPathValue(value)) {
    // An entry-relative name always counts: only a load spells one. A dist/
    // path counts where it is passed, stored or keyed; alone in a list (the
    // report's frame set) it is data.
    const isListed =
      ts.isArrayLiteralExpression(parent) &&
      !/[(:=]/u.test(context.line.replaceAll(STRING_LITERAL, ''))
    return isListed && value.startsWith('dist/') ? undefined : { value }
  }
  if (!BASENAME.test(value.split('/').pop() ?? '')) return
  // A bare name is a bundle's when a constant holds it, or when it stands
  // beside a loader or another path.
  if (isAssigned && ts.isIdentifier(parent.name)) return { value, identifier: parent.name.text }
  return hasLoaderHint(context.text) || hasSiblingPath(context.top, node) ? { value } : undefined
}

/** Whether a read of a bundle-name constant is where a bundle loads. */
function isLoadUse(node, source) {
  if (isInLoadCall(node, source.requires)) return true
  const { text } = contextOf(node, source)
  return LOAD_CALL.test(text) || hasLoaderHint(text)
}

/** A mention of a constant that reads it: not its declaration, not an import of it. */
function isRead(node) {
  const parent = node.parent
  const isDeclared = ts.isVariableDeclaration(parent) && parent.name === node
  const isImported =
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent)
  return !isDeclared && !isImported
}

/**
 * Every dist name the sources load by file name, with the constants that
 * hold such names, where each constant is read and loaded, and every load
 * whose file name is not a literal.
 *
 * A literal counts when it names the file: an entry-relative path always; a
 * dist/ path unless it stands alone in a list; a bare `name.js` when a
 * constant holds it or it stands beside a loader hint or another path; an
 * extensionless relative name only as the argument of a load. Module names in
 * `import ... from` never count (the bundler inlines those). A template with
 * no substitution is a literal like any other; a load whose argument is
 * anything else is recorded in `computed`.
 * @param {string} root repository root
 * @param {string} generatedFile root-relative generated registry to skip
 * @returns {LazyScan}
 */
export function scanRequests(root, generatedFile) {
  const files = sourceFiles(path.join(root, 'src'), path.join(root, generatedFile))
  const relative = (file) => path.relative(root, file).replaceAll('\\', '/')
  const texts = new Map()
  for (const file of files) texts.set(file, readFileSync(file, 'utf8').replaceAll('\r\n', '\n'))
  const parsed = new Map()
  const sourceOf = (file) => {
    const known = parsed.get(file)
    if (known !== undefined) return known
    const source = parseSource(file, texts.get(file) ?? '')
    parsed.set(file, source)
    return source
  }
  const requests = []
  const definitions = new Map()
  const naming = new Set()
  const pending = []
  const computed = []
  for (const [file, text] of texts) {
    if (!mayLoad(text)) continue
    const source = sourceOf(file)
    const importer = relative(file)
    const visit = (node) => {
      if (isNameLiteral(node)) {
        const found = literalRequest(node, source)
        if (found !== undefined) {
          naming.add(node)
          requests.push({
            importer,
            line: lineOf(source.tree, node) + 1,
            symbol: symbolOf(node),
            ...found,
          })
        }
        const holder = node.parent
        if (
          node.text.endsWith('.js') &&
          ts.isVariableDeclaration(holder) &&
          holder.initializer === node &&
          ts.isIdentifier(holder.name)
        ) {
          definitions.set(holder.name.text, importer)
        }
      }
      const argument = loadArgument(node, source.requires)
      if (argument !== undefined && argument !== null && !isNameLiteral(argument)) {
        pending.push({
          importer,
          line: lineOf(source.tree, node) + 1,
          call: callText(node, argument, source.tree),
          argument,
        })
      }
      ts.forEachChild(node, visit)
    }
    visit(source.tree)
  }
  // A load is followed when its argument holds the name: a literal the scan
  // took as a request (`require(path.join(dir, 'x.js'))`, `'./x' + '.js'`) or
  // a bundle-name constant. Anything else is worked out at run time.
  const holdsName = (node) => {
    if (naming.has(node)) return true
    return ts.isIdentifier(node) && definitions.has(node.text)
      ? true
      : ts.forEachChild(node, (child) => (holdsName(child) ? true : undefined)) === true
  }
  for (const { argument, ...load } of pending) {
    if (!holdsName(argument)) computed.push(load)
  }
  // Where each bundle-name constant is read: every other file mentioning it,
  // and every file, its own included, that reads it where a bundle loads. A
  // name only framed, listed or logged is data, never a load.
  const uses = new Map()
  const usesLoad = new Map()
  for (const identifier of definitions.keys()) {
    uses.set(identifier, [])
    usesLoad.set(identifier, [])
  }
  for (const [file, text] of texts) {
    const mentioned = definitions.keys().filter((identifier) => hasIdentifier(text, identifier))
    const names = new Set(mentioned)
    if (names.size === 0) continue
    const source = sourceOf(file)
    const importer = relative(file)
    const read = new Set()
    const loaded = new Set()
    const visit = (node) => {
      if (ts.isIdentifier(node) && names.has(node.text) && isRead(node)) {
        read.add(node.text)
        if (isLoadUse(node, source)) loaded.add(node.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source.tree)
    for (const identifier of read) {
      if (definitions.get(identifier) !== importer) uses.get(identifier)?.push(importer)
    }
    for (const identifier of loaded) usesLoad.get(identifier)?.push(importer)
  }
  return { requests, definitions, uses, usesLoad, computed }
}

/**
 * The computed loads the registry cannot stand behind: every one that is not
 * listed with its reason, and every listed one the source no longer holds.
 * @param {readonly ComputedLoad[]} computed
 * @param {readonly {importer: string, call: string, reason: string}[]} [listed]
 * @returns {string[]} one sentence per failure, empty when all are listed
 */
export function computedLoadFailures(computed, listed = COMPUTED_SOURCE_LOADS) {
  const failures = []
  const matched = new Set()
  for (const load of computed) {
    const entry = listed.find((item) => item.importer === load.importer && item.call === load.call)
    if (entry === undefined) {
      failures.push(
        `${load.importer}:${String(load.line)} loads a file whose name is worked out at run time (${load.call}): name the file in a literal, or list the load with its reason in COMPUTED_SOURCE_LOADS (scripts/lib/lazyRegistry.mjs)`,
      )
    } else {
      matched.add(entry)
    }
  }
  for (const entry of listed) {
    if (!matched.has(entry)) {
      failures.push(
        `COMPUTED_SOURCE_LOADS lists ${entry.call} in ${entry.importer}, which the source no longer holds: remove the entry`,
      )
    }
  }
  return failures
}

/**
 * What one request loads: { mapped } for a redirect-map target, { file }
 * for a dist basename, { bundled: true } for an import the bundler inlines
 * (an entry-relative name whose source exists and the map does not cover).
 * dist/ prefixes and bare basenames always name dist files.
 * @param {string} root repository root
 * @param {Map<string, string>} deferredOutfiles absolute source entry to dist output
 * @param {LazyRequest} request
 * @returns {{ mapped?: string, file?: string, bundled?: true }}
 */
export function resolveRequest(root, deferredOutfiles, request) {
  const { importer, value } = request
  if (value.startsWith('dist/')) return { file: value.slice('dist/'.length) }
  if (value.startsWith('./') || value.startsWith('../')) {
    const stem = path.resolve(root, path.dirname(importer), value).replace(/\.js$/, '')
    for (const [source, output] of deferredOutfiles) {
      if (path.resolve(source) === `${stem}.ts`) {
        return { mapped: output.replace(/^dist\//, '') }
      }
    }
    if (!value.endsWith('.js')) return { bundled: true }
    return existsSync(`${stem}.ts`) || existsSync(`${stem}.tsx`)
      ? { bundled: true }
      : { file: value.split('/').pop() ?? value }
  }
  return { file: value.split('/').pop() ?? value }
}
