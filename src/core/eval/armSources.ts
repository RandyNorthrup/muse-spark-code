// The frozen arms' source closure (PLAN.md M101, reviews RVCM1012B–C).
//
// `evalHarnessDigest` must cover every byte that decides an arm, not only
// each arm's `change` callback source: a helper the callback references
// (the auto-compaction admission's `noop`), an imported value it spreads
// (the strict-tools arm's capabilities) and the implementation behind an
// accessor it reads all decide the arm as much as the callback text does.
// The previous repair walked the import graph with a regular-expression
// scanner and hashed outside bindings by their current runtime values.
// Review RVCM1012C showed that design cannot hold the freeze: an accessor
// changes behaviour without changing the hashed value (finding 1), a quote
// in a comment hides a real edge from the clause pattern and relative
// dynamic imports are neither followed nor refused (finding 2), and
// directory resolution disagrees with the real resolver (finding 3).
// Patching the scanner again would only move the holes.
//
// This module therefore asks the real resolver instead of reimplementing
// one: each arm root is bundled by esbuild (already a build dependency,
// never shipped — no production bundle imports the evaluation harness)
// with `bundle: true, write: false, metafile: true`, and every input file
// the metafile reports contributes its exact bytes (sorted path +
// content). Every runtime edge esbuild follows is covered — static
// imports, re-exports, `require` calls and literal dynamic imports — and
// directory and index resolution is exactly what the build does, because
// it is the build. Anything esbuild cannot resolve fails the digest with
// its own error. A runtime load fails the digest with its file and line
// instead of hashing around it, by one rule: the TypeScript walk below
// finds every load site (a dynamic `import()`, any `require` spelling, a
// `new Worker(…)`, a `new URL(specifier, base)`, an
// `import.meta.resolve(…)`, a file read of a module-relative path, a
// dynamic evaluation), and
// every site is refused unless esbuild placed its target in the closure —
// the walk's findings are compared against the build's own metafile, and
// every mismatch fails with file and line. A non-literal specifier has no
// determinate target, so it always mismatches; a literal through a loader
// esbuild never follows (`module.require`, `require?.()`, a require alias
// in any scope, a destructured or comma-sequence loader, `require` through
// `call`/`apply`/`bind`, `createRequire(…)(…)` under any local name, a
// `Worker` under parens, casts, renames or namespaces) mismatches too —
// each probed on this rig, none ever lands in the metafile. A `new URL(…)`
// with one argument alone is data, not a load — zod's own schemas validate
// with one — while a two-argument URL (a module base the metafile never
// records) is refused with its file and line. `esbuild` and `typescript`
// themselves stay external: the resolver is tooling, not harness
// behaviour. Bare and `node:` specifiers the bundler leaves out are the
// platform, not the harness; bare packages it bundles (today zod, through
// the task schemas) are hashed by bytes like any other input, pinned by
// the lockfile.
//
// The production system under test is deliberately outside the closure:
// the arm modules reach it nowhere (the held-deps list lives in
// `./heldDeps` precisely so the digest need not depend on the driver,
// which drives `ModelApiHost`). Pinning the host would freeze production
// code the harness is meant to measure.
//
// Paths are normalized to forward slashes before comparing or hashing, so
// the digest is stable on Windows; bytes are hashed raw, and the
// repository pins `eol=lf` (`.gitattributes`), so checkouts agree byte
// for byte. Every collected key is repository-relative, so the digest
// agrees across machines; scratch trees outside the repository keep an
// absolute key, which the frozen roots never produce.

import { createHash } from 'node:crypto'
import { buildSync } from 'esbuild'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { EVAL_ARM_SOURCE_SEARCH_DEPTH } from '../../shared/constants'

/** The modules that define the frozen arms: every arm runs only once `EVAL_ARMS` names it. */
export const ARM_SOURCE_ROOTS: readonly string[] = ['src/core/eval/mechanisms.ts']

/** One file the resolver reached, by repository-relative path with its bytes' digest. */
export interface ArmSourceFile {
  readonly path: string
  readonly sha256: string
}

/** The arm closure: every file the resolver reached, by bytes. */
export interface ArmSources {
  readonly files: readonly ArmSourceFile[]
}

/** Compares strings byte-wise, never by locale, so digests agree on every platform. */
function comparePath(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

/** Forward slashes everywhere, so Windows checkouts hash like POSIX ones. */
function slash(file: string): string {
  return file.replaceAll('\\', '/')
}

/**
 * The repository root for a run inside it: the first directory at or above
 * the working directory that holds the arm roots. Throws instead of
 * guessing, so the digest never hashes a stranger tree.
 */
function resolveRepoRoot(): string {
  const anchor = ARM_SOURCE_ROOTS[0]
  if (anchor === undefined) throw new Error('the frozen arm sources need at least one root')
  let dir = process.cwd()
  for (let depth = 0; depth < EVAL_ARM_SOURCE_SEARCH_DEPTH; depth += 1) {
    if (existsSync(path.join(dir, anchor))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('the frozen arm sources need the repository root above the working directory')
}

/** Resolves a root to an absolute entry file; a missing entry fails the digest. */
function resolveEntry(root: string, repoRoot: string): string {
  const absolute = path.isAbsolute(root) ? root : path.join(repoRoot, root)
  if (!existsSync(absolute)) throw new Error(`the frozen arm sources cannot read ${slash(root)}`)
  return absolute
}

/** The loader words, compared as identifiers the parser found, never as text. */
const REQUIRE_WORD = 'require'
const CREATE_REQUIRE_WORD = 'createRequire'
const WORKER_WORD = 'Worker'
const URL_WORD = 'URL'
const RESOLVE_WORD = 'resolve'

/** `loader.call/apply/bind(…)`: the loader through its method. */
const LOADER_METHOD_WORDS: ReadonlySet<string> = new Set(['call', 'apply', 'bind'])

/** File reads: a module-relative target runs outside every hashed edge. */
const FS_READ_WORDS: ReadonlySet<string> = new Set([
  'readFileSync',
  'readFile',
  'readdirSync',
  'readdir',
  'statSync',
  'stat',
  'lstatSync',
  'lstat',
  'existsSync',
  'accessSync',
  'access',
  'openSync',
  'open',
  'createReadStream',
  'realpathSync',
  'realpath',
])

/** The extensions the bundler probes when a relative load names no file. */
const LOAD_TARGET_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.mjs',
  '.cjs',
]

/**
 * Whether a loader's specifier is readable at all: a string literal or a
 * substitution-free template. Anything else — a name, an interpolation, a
 * concatenation — has no determinate target, so it always mismatches the
 * closure below.
 */
function isLiteralSpecifier(node: ts.Expression): boolean {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
}

/** Parentheses and assertions around a specifier change nothing; see through them. */
function unwrapSpecifier(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

/**
 * Parentheses, assertions and a comma sequence around a callee or a
 * constructor change nothing: `(0, require)(…)` calls the loader, and
 * `new ((Worker))(…)` constructs the worker. See through them all.
 */
function unwrapCallee(node: ts.Expression): ts.Expression {
  let current = unwrapSpecifier(node)
  while (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    current = unwrapSpecifier(current.right)
  }
  return current
}

/**
 * The member name of `a.b` or `a['b']` with a string literal; undefined
 * for any other access, so `a[b]` never counts as a named member.
 */
function accessName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  const argument = ts.isElementAccessExpression(node) ? node.argumentExpression : undefined
  return argument !== undefined && ts.isStringLiteral(argument) ? argument.text : undefined
}

/**
 * Whether a call is a dynamic `import(…)` — or `import.defer(…)`, whose
 * callee parses as a MetaProperty on the import keyword rather than the
 * keyword itself (probed). `ts.isImportCall` answers the same at runtime
 * but is absent from the compiler's public types, so the walk tests the
 * shape directly.
 */
function importCallee(callee: ts.Expression): 'direct' | 'deferred' | undefined {
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return 'direct'
  const isDeferred =
    ts.isMetaProperty(callee) && callee.keywordToken === ts.SyntaxKind.ImportKeyword
  return isDeferred ? 'deferred' : undefined
}

/** Every local name a loader may hide behind, found by the parser in every scope. */
interface LoaderNames {
  readonly requireNames: ReadonlySet<string>
  readonly requireFactoryNames: ReadonlySet<string>
  readonly workerNames: ReadonlySet<string>
  readonly resolveNames: ReadonlySet<string>
}

/** `createRequire` under any local name, or `something.createRequire`. */
function isCreateRequireFactory(node: ts.Expression, names: ReadonlySet<string>): boolean {
  return (ts.isIdentifier(node) && names.has(node.text)) || accessName(node) === CREATE_REQUIRE_WORD
}

/** The loader itself under any spelling: `require`, an alias, or `x.require` / `x['require']`. */
function isRequireValue(node: ts.Expression, names: LoaderNames): boolean {
  const bare = unwrapCallee(node)
  return (
    (ts.isIdentifier(bare) && names.requireNames.has(bare.text)) ||
    accessName(bare) === REQUIRE_WORD
  )
}

/** `require.resolve` / `alias.resolve`: the resolution half of a deferred load. */
function isRequireResolve(node: ts.Expression, names: LoaderNames): boolean {
  return (
    accessName(node) === RESOLVE_WORD &&
    (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
    isRequireValue(node.expression, names)
  )
}

type Refusal = (node: ts.Node, what: string) => never

/** One load site's context: the names loaders hide behind and the closure the build reported. */
interface LoadSite {
  readonly names: LoaderNames
  /** Every metafile input as a slashed absolute path: the closure a target must sit in. */
  readonly inputs: ReadonlySet<string>
  readonly file: string
}

/**
 * The candidate files a relative specifier may resolve to, slashed for
 * comparison: the path itself, each probed extension, each probed index
 * file, and the TypeScript sources behind an explicit `.js` suffix.
 */
function resolveLoadTargets(file: string, specifier: string): string[] {
  const base = path.resolve(path.dirname(file), specifier)
  const candidates = [
    base,
    ...LOAD_TARGET_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...LOAD_TARGET_EXTENSIONS.map((extension) => path.join(base, `index${extension}`)),
  ]
  if (/\.m?jsx?$/.test(base)) {
    candidates.push(base.replace(/\.m?js$/, '.ts'), base.replace(/\.m?js$/, '.tsx'))
  }
  return candidates.map((candidate) => slash(candidate))
}

/** Whether a specifier is absolute on either platform's terms, before comparing. */
function isAbsoluteSpecifier(specifier: string): boolean {
  return path.isAbsolute(specifier) || path.win32.isAbsolute(specifier)
}

/**
 * Admits one direct `import(…)` / `require(…)` specifier exactly when the
 * bundler placed its target in the closure: module-relative and absolute
 * specifiers must resolve to a metafile input, or the load runs at runtime
 * outside every hashed edge. Bare and `node:` specifiers are the platform
 * or a hashed dependency, never a hidden edge.
 */
function checkBundledSpecifier(
  node: ts.CallExpression,
  specifier: ts.Expression | undefined,
  site: LoadSite,
  fail: Refusal,
): void {
  if (specifier === undefined || !isLiteralSpecifier(unwrapSpecifier(specifier))) {
    fail(node, 'a non-literal dynamic import')
  }
  const literal = unwrapSpecifier(specifier)
  const text = ts.isStringLiteral(literal)
    ? literal.text
    : (literal as ts.NoSubstitutionTemplateLiteral).text
  if (text.startsWith('.')) {
    const isPlaced = resolveLoadTargets(site.file, text).some((target) => site.inputs.has(target))
    if (!isPlaced) {
      fail(node, 'a module load the bundler did not place in the closure')
    }
    return
  }
  if (isAbsoluteSpecifier(text) && !site.inputs.has(slash(path.normalize(text)))) {
    fail(node, 'a module load the bundler did not place in the closure')
  }
}

/**
 * Admits one file read exactly when its target cannot be module-relative:
 * a relative literal reads bytes the metafile never records. A computed
 * path stays allowed: the loader itself reads its closure inputs that way.
 */
function checkFsRead(node: ts.CallExpression, fail: Refusal): void {
  const target = node.arguments[0]
  if (target === undefined) return
  const literal = unwrapSpecifier(target)
  if (
    (ts.isStringLiteral(literal) || ts.isNoSubstitutionTemplateLiteral(literal)) &&
    literal.text.startsWith('.')
  ) {
    fail(node, 'a file read outside the resolved closure')
  }
}

/**
 * Refuses one call that may load a module at runtime. A direct `import()`
 * or `require()` whose literal target sits in the metafile inputs is the
 * bundler's own edge and needs no refusal; every other shape — a
 * non-literal specifier, `import.defer`, an optional or aliased loader, a
 * destructured or comma-sequence loader, `x.require` / `x['require']`, the
 * loader through `call`/`apply`/`bind`, `createRequire(…)(…)` under any
 * name, `require.resolve`, `import.meta.resolve`, a module-relative
 * file read and a dynamic evaluation (`eval`, `Function`) — runs outside
 * the closure and fails the digest.
 */
/**
 * Whether the callee hides behind a comma sequence: `(0, require)(…)` and
 * `(0, import)(…)` call the loader, but the bundler follows neither
 * (probed) — the helper never lands in the metafile even with a literal.
 */
function isCommaSequence(node: ts.Expression): boolean {
  let current = node
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.CommaToken
}

/** `globalThis`, `global`, `window`, `self`: holders of an indirect evaluator. */
const GLOBAL_HOLDER_WORDS: ReadonlySet<string> = new Set(['globalThis', 'global', 'window', 'self'])

function checkLoadCall(node: ts.CallExpression, site: LoadSite, fail: Refusal): void {
  const names = site.names
  const callee = unwrapCallee(node.expression)
  const isSequenced = isCommaSequence(node.expression)
  // `import.defer(…)` parses beside `import(…)` (probed): its callee is
  // a MetaProperty, not the ImportKeyword, and the deferred helper never
  // lands in the closure. A comma sequence around `import` is likewise
  // never followed.
  const importForm = importCallee(callee)
  if (importForm !== undefined) {
    if (importForm === 'deferred' || isSequenced) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    checkBundledSpecifier(node, node.arguments[0], site, fail)
    return
  }
  // `eval(…)` and `Function(…)` hide their target behind a string the
  // bundler never follows: whatever they load runs outside the closure.
  if (ts.isIdentifier(callee) && (callee.text === 'eval' || callee.text === 'Function')) {
    fail(node, 'a dynamic evaluation outside the resolved closure')
  }
  if (ts.isIdentifier(callee) && names.requireNames.has(callee.text)) {
    // An optional `require?.(…)` is never followed (probed), and neither
    // is a call through an alias or a comma sequence: each runs at runtime
    // whatever the specifier reads, so each fails whatever it is — even a
    // literal, whose target the bundler never placed in the closure.
    if (isSequenced || node.questionDotToken !== undefined || callee.text !== REQUIRE_WORD) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    checkBundledSpecifier(node, node.arguments[0], site, fail)
    return
  }
  if (ts.isIdentifier(callee) && names.resolveNames.has(callee.text)) {
    fail(node, 'a deferred module resolution the bundler leaves for runtime')
  }
  if (ts.isIdentifier(callee) && FS_READ_WORDS.has(callee.text)) {
    checkFsRead(node, fail)
    return
  }
  if (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) {
    const name = accessName(callee)
    // `module.require(…)` / `module['require'](…)`: never followed, even
    // with a literal (probed).
    if (name === REQUIRE_WORD) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    // `require.call/apply/bind`, the same through an alias or through
    // `module.require`, and a `createRequire` result's method: the loader
    // through its method, never followed.
    const receiver = unwrapCallee(callee.expression)
    if (
      name !== undefined &&
      LOADER_METHOD_WORDS.has(name) &&
      (isRequireValue(callee.expression, names) ||
        (ts.isCallExpression(receiver) &&
          isCreateRequireFactory(unwrapCallee(receiver.expression), names.requireFactoryNames)))
    ) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    // `require.resolve(…)` and `import.meta.resolve(…)`: a module load by
    // another name — the metafile records neither target.
    if (name === RESOLVE_WORD && (isRequireResolve(callee, names) || ts.isMetaProperty(receiver))) {
      fail(node, 'a deferred module resolution the bundler leaves for runtime')
    }
    // `fs.readFileSync('./relative')` and every namespace spelling: the
    // bytes read never land in the metafile.
    if (name !== undefined && FS_READ_WORDS.has(name)) {
      checkFsRead(node, fail)
      return
    }
    // `globalThis.eval(…)` / `globalThis.Function(…)`: the evaluator
    // through its holder, as blind as the bare form.
    if (
      (name === 'eval' || name === 'Function') &&
      ts.isIdentifier(receiver) &&
      GLOBAL_HOLDER_WORDS.has(receiver.text)
    ) {
      fail(node, 'a dynamic evaluation outside the resolved closure')
    }
    return
  }
  // `createRequire(url)(…)` under any local name: the factory's result
  // loads at runtime, never followed even with a literal (probed).
  if (
    ts.isCallExpression(callee) &&
    isCreateRequireFactory(unwrapCallee(callee.expression), names.requireFactoryNames)
  ) {
    fail(node, 'an indirect module load the bundler leaves for runtime')
  }
}

/**
 * Refuses one construction that loads outside the closure: every `new
 * Worker(…)` spelling — bare, parenthesized, cast, renamed or namespaced —
 * never lands in the metafile (probed), and a `new URL(specifier, base)`
 * carries a module base the metafile never records. A one-argument `new
 * URL(input)` alone is deliberately not refused: it parses data and loads
 * no file.
 */
function checkNew(node: ts.NewExpression, site: LoadSite, fail: Refusal): void {
  const target = unwrapCallee(node.expression)
  if (
    (ts.isIdentifier(target) && site.names.workerNames.has(target.text)) ||
    accessName(target) === WORKER_WORD
  ) {
    fail(node, 'a Worker load the bundler leaves for runtime')
  }
  if (ts.isIdentifier(target) && target.text === URL_WORD && (node.arguments?.length ?? 0) >= 2) {
    fail(node, 'a module-relative URL the bundler leaves for runtime')
  }
  // `new Function(…)` builds a loader-hiding evaluator out of a string the
  // bundler never follows.
  if (ts.isIdentifier(target) && target.text === 'Function') {
    fail(node, 'a dynamic evaluation outside the resolved closure')
  }
}

/**
 * Refuses every load in one closure file that the bundler left for
 * runtime: the file is parsed, so call-like text in comments, strings,
 * templates and regex literals is never mistaken for a load, in either
 * direction — and a template substitution or concatenation is never
 * mistaken for a literal. Every literal through a direct loader is then
 * compared against the build's own metafile inputs, so a spelling the walk
 * admits but the bundler never followed still fails with file and line.
 */
function refuseDynamicLoads(
  source: string,
  key: string,
  inputs: ReadonlySet<string>,
  file: string,
): void {
  const tree = ts.createSourceFile(key, source, ts.ScriptTarget.ESNext, false)
  const fail: Refusal = (node, what) => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
    throw new Error(`the frozen arm sources cannot cover ${what} in ${key}:${String(line)}`)
  }
  const requireNames = new Set<string>([REQUIRE_WORD])
  const requireFactoryNames = new Set<string>([CREATE_REQUIRE_WORD])
  const workerNames = new Set<string>([WORKER_WORD])
  const resolveNames = new Set<string>()
  // A loader's local names survive renaming at the import site:
  // `import { createRequire as cr }` and `import { Worker as Thread }`.
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      const imported = element.propertyName?.text ?? element.name.text
      if (imported === CREATE_REQUIRE_WORD) requireFactoryNames.add(element.name.text)
      else if (imported === WORKER_WORD) workerNames.add(element.name.text)
    }
  }
  // Every binding of a loader name in every scope: `const req = require`,
  // `const req = module.require`, `const req = createRequire(url)`,
  // `const { require: req } = module`, `const w = ns.Worker` and plain
  // `req = require` assignments — an alias of an alias chains through the
  // same sets, so bindings settle to a fixpoint whatever order they read in.
  const bindings: { name: string; init: ts.Expression }[] = []
  const gather = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer !== undefined) {
      if (ts.isIdentifier(node.name)) {
        bindings.push({ name: node.name.text, init: node.initializer })
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue
          const renamed = element.propertyName
          const property =
            renamed !== undefined && (ts.isIdentifier(renamed) || ts.isStringLiteral(renamed))
              ? renamed.text
              : element.name.text
          if (property === REQUIRE_WORD) requireNames.add(element.name.text)
          if (property === CREATE_REQUIRE_WORD) requireFactoryNames.add(element.name.text)
          if (property === WORKER_WORD) workerNames.add(element.name.text)
          if (property !== RESOLVE_WORD) continue
          // `const { resolve } = require`: the destructured resolution,
          // not a path operation — but only when the source is the
          // loader itself (`const { resolve } = path` stays allowed).
          const holder = unwrapCallee(node.initializer)
          if (ts.isIdentifier(holder) && requireNames.has(holder.text)) {
            resolveNames.add(element.name.text)
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      bindings.push({ name: node.left.text, init: node.right })
    }
    ts.forEachChild(node, gather)
  }
  gather(tree)
  const trackBinding = (name: string, init: ts.Expression): void => {
    const value = unwrapCallee(init)
    if (ts.isIdentifier(value)) {
      if (requireNames.has(value.text)) requireNames.add(name)
      if (requireFactoryNames.has(value.text)) requireFactoryNames.add(name)
      if (workerNames.has(value.text)) workerNames.add(name)
      return
    }
    const member = accessName(value)
    if (member === REQUIRE_WORD) requireNames.add(name)
    if (member === CREATE_REQUIRE_WORD) requireFactoryNames.add(name)
    if (member === WORKER_WORD) workerNames.add(name)
    if (
      member === RESOLVE_WORD &&
      (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))
    ) {
      // `r = require.resolve`: the assigned resolution, not a path
      // operation — the destructured form is settled during gathering.
      const holder = unwrapCallee(value.expression)
      if (ts.isIdentifier(holder) && requireNames.has(holder.text)) resolveNames.add(name)
    }
    if (
      ts.isCallExpression(value) &&
      isCreateRequireFactory(unwrapCallee(value.expression), requireFactoryNames)
    ) {
      requireNames.add(name)
    }
  }
  const loaderNameCount = (): number =>
    requireNames.size + requireFactoryNames.size + workerNames.size + resolveNames.size
  let isSettled = false
  while (!isSettled) {
    const known = loaderNameCount()
    for (const { name, init } of bindings) {
      if (
        resolveNames.has(name) ||
        requireNames.has(name) ||
        requireFactoryNames.has(name) ||
        workerNames.has(name)
      ) {
        continue
      }
      trackBinding(name, init)
    }
    isSettled = loaderNameCount() === known
  }
  const names: LoaderNames = { requireNames, requireFactoryNames, workerNames, resolveNames }
  const site: LoadSite = { names, inputs, file }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) checkLoadCall(node, site, fail)
    else if (ts.isNewExpression(node)) checkNew(node, site, fail)
    ts.forEachChild(node, visit)
  }
  visit(tree)
}

function digestBytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Walks the arm roots' import closure with the real resolver and returns
 * every input file's bytes. The same roots and tree always hash the same;
 * any behaviour-deciding byte moves the digest, wherever it is built —
 * an accessor implementation as much as an initializer, because bytes are
 * hashed, never evaluated values.
 */
export function collectArmSources(roots: readonly string[] = ARM_SOURCE_ROOTS): ArmSources {
  const head = roots[0]
  if (head === undefined) throw new Error('the frozen arm sources need at least one root')
  const repoRoot = resolveRepoRoot()
  const digests = new Map<string, string>()
  for (const root of roots) {
    const entry = resolveEntry(root, repoRoot)
    let inputs: Record<string, { bytes: number }>
    try {
      const result = buildSync({
        entryPoints: [entry],
        bundle: true,
        write: false,
        metafile: true,
        platform: 'node',
        format: 'cjs',
        external: ['esbuild', 'typescript'],
        logLevel: 'silent',
        absWorkingDir: repoRoot,
      })
      inputs = result.metafile.inputs
    } catch (error) {
      if (error instanceof Error && error.message.includes('the frozen arm sources')) throw error
      const detail = error instanceof Error ? error.message.split('\n', 1)[0] : String(error)
      throw new Error(
        `the frozen arm sources cannot resolve the arms from ${slash(root)}: ${detail ?? 'unknown failure'}`,
        { cause: error },
      )
    }
    // The closure the walk compares every literal load target against:
    // slashed absolute paths, so Windows checkouts compare like POSIX ones.
    const closed = new Set(Object.keys(inputs).map((input) => slash(path.resolve(repoRoot, input))))
    for (const input of Object.keys(inputs)) {
      const absolute = path.resolve(repoRoot, input)
      const relative = path.relative(repoRoot, absolute)
      // Repository-relative keys keep the frozen digest identical on every
      // machine. Scratch trees outside the repository (the tests below)
      // keep their absolute key; the frozen roots never do, which the
      // repository-relative test below pins.
      const key = slash(
        relative === '' || relative.startsWith('..') || path.isAbsolute(relative)
          ? absolute
          : relative,
      )
      if (digests.has(key)) continue
      let bytes: Buffer
      try {
        bytes = readFileSync(absolute)
      } catch {
        throw new Error(`the frozen arm sources cannot read ${key}`)
      }
      refuseDynamicLoads(bytes.toString('utf8'), key, closed, absolute)
      digests.set(key, digestBytes(bytes))
    }
  }
  return {
    files: Array.from(digests, ([filePath, sha256]) => ({ path: filePath, sha256 })).toSorted(
      (left, right) => comparePath(left.path, right.path),
    ),
  }
}

/**
 * The canonical JSON value: sorted keys, kept array order, and an own
 * `__proto__` field kept as data (review RVCM1012C finding 4). Plain
 * assignment to `out['__proto__']` would change the object's prototype
 * instead of creating an enumerable own field, so two values differing
 * only in that field would serialize identically; the field is defined
 * instead, and survives `JSON.stringify` as `{"__proto__":…}`.
 * Anything that has no JSON meaning (a function, `undefined`, a symbol,
 * a non-finite number, a class instance) throws, so an unhashable value
 * breaks the digest instead of hashing as `{}` or `null`.
 */
export function canonicalize(value: unknown, where: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`the frozen arm sources cannot hash ${where}: a non-finite number`)
    }
    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError(`the frozen arm sources cannot hash ${where}: a non-data binding`)
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => canonicalize(entry, `${where}[${String(index)}]`))
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== null && prototype !== Object.prototype) {
    throw new TypeError(`the frozen arm sources cannot hash ${where}: a class instance`)
  }
  const out: Record<string, unknown> = {}
  const entries = Object.entries(value).toSorted(([left], [right]) => comparePath(left, right))
  for (const [key, entry] of entries) {
    const canonical = canonicalize(entry, `${where}.${key}`)
    if (key === '__proto__') {
      Object.defineProperty(out, key, {
        value: canonical,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    } else {
      out[key] = canonical
    }
  }
  return out
}
