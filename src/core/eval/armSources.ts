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
// its own error. A load the bundler leaves for runtime fails the digest
// with its file and line instead of hashing around it: a dynamic
// `import()` or bare `require()` whose specifier is not a string literal,
// and every indirect loader spelling (`module.require`, an optional
// `require?.()`, a `const req = require` alias, `createRequire(…)(…)` and
// `require.call/apply/bind`) and every `new Worker(…)`, literal or not —
// none of those is ever followed (each probed on this rig), so each would
// run outside every hashed edge. The refusal is parsed, not
// pattern-matched: each file in the closure is read with the TypeScript
// compiler, so call-like text in comments, strings, templates and regex
// literals is never mistaken for a load, in either direction. A `new
// URL(…)` alone is data, not a load — zod's own schemas validate with one
// — while a URL nested in a loader is refused with it. `esbuild` and
// `typescript` themselves stay external: the resolver is tooling, not
// harness behaviour. Bare and `node:` imports the bundler leaves out are the
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

/**
 * Whether a loader's specifier is visible to the bundler: a string literal
 * or a substitution-free template (probed: both land in the metafile, so
 * either is in it or the build above already failed on it). Anything else
 * — a name, an interpolation, a concatenation — runs at runtime, outside
 * every hashed edge.
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

/** `createRequire` or `something.createRequire`: the factory whose result loads. */
function isCreateRequireFactory(node: ts.Expression): boolean {
  return (
    (ts.isIdentifier(node) && node.text === CREATE_REQUIRE_WORD) ||
    (ts.isPropertyAccessExpression(node) && node.name.text === CREATE_REQUIRE_WORD)
  )
}

type Refusal = (node: ts.Node, what: string) => never

/**
 * Refuses one call that may load a module at runtime. A dynamic `import()`
 * or bare `require()` with a literal specifier is the bundler's own edge
 * and needs no refusal; anything else the bundler cannot see fails the
 * digest with its file and line.
 */
function checkLoadCall(node: ts.CallExpression, aliases: ReadonlySet<string>, fail: Refusal): void {
  const callee = node.expression
  if (callee.kind === ts.SyntaxKind.ImportKeyword) {
    const specifier = node.arguments[0]
    if (specifier === undefined || !isLiteralSpecifier(unwrapSpecifier(specifier))) {
      fail(node, 'a non-literal dynamic import')
    }
    return
  }
  if (ts.isIdentifier(callee) && (callee.text === REQUIRE_WORD || aliases.has(callee.text))) {
    // An optional `require?.(…)` is never followed (probed), and neither
    // is a call through an alias: both run at runtime whatever the
    // specifier reads, so both fail whatever it is.
    if (node.questionDotToken !== undefined || aliases.has(callee.text)) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    const specifier = node.arguments[0]
    if (specifier === undefined || !isLiteralSpecifier(unwrapSpecifier(specifier))) {
      fail(node, 'a non-literal dynamic import')
    }
    return
  }
  if (ts.isPropertyAccessExpression(callee)) {
    // `module.require(…)`: never followed, even with a literal (probed).
    if (callee.name.text === REQUIRE_WORD) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    // `require.call/apply/bind(…)`: the loader through its method.
    if (
      ts.isIdentifier(callee.expression) &&
      (callee.expression.text === REQUIRE_WORD || aliases.has(callee.expression.text)) &&
      ['call', 'apply', 'bind'].includes(callee.name.text)
    ) {
      fail(node, 'an indirect module load the bundler leaves for runtime')
    }
    return
  }
  // `createRequire(url)(…)`: the factory's result loads at runtime, never
  // followed even with a literal (probed).
  if (ts.isCallExpression(callee) && isCreateRequireFactory(callee.expression)) {
    fail(node, 'an indirect module load the bundler leaves for runtime')
  }
}

/**
 * Refuses one `new Worker(…)` load: the worker file runs outside every
 * hashed edge — never followed, even with a literal (probed) — so every
 * spelling fails the digest. A `new URL(…)` alone is deliberately not
 * refused: it parses data and loads no file.
 */
function checkWorker(node: ts.NewExpression, fail: Refusal): void {
  const target = ts.isParenthesizedExpression(node.expression)
    ? node.expression.expression
    : node.expression
  if (ts.isIdentifier(target) && target.text === WORKER_WORD) {
    fail(node, 'a Worker load the bundler leaves for runtime')
  }
}

/**
 * Refuses every load in one closure file that the bundler leaves for
 * runtime: the file is parsed, so call-like text in comments, strings,
 * templates and regex literals is never mistaken for a load, in either
 * direction — and a template substitution or concatenation is never
 * mistaken for the literal the old strip pass saw.
 */
function refuseDynamicLoads(source: string, key: string): void {
  const tree = ts.createSourceFile(key, source, ts.ScriptTarget.ESNext, false)
  const fail: Refusal = (node, what) => {
    const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
    throw new Error(`the frozen arm sources cannot cover ${what} in ${key}:${String(line)}`)
  }
  // Every local name for the module loader: `const req = require`,
  // `const req = module.require` and `const req = createRequire(url)` all
  // load at runtime when called, exactly like the indirect forms above
  // (an alias of an alias chains through the same set, in order).
  const aliases = new Set<string>()
  for (const statement of tree.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.initializer === undefined || !ts.isIdentifier(declaration.name)) continue
      const init = declaration.initializer
      if (
        (ts.isIdentifier(init) && (init.text === REQUIRE_WORD || aliases.has(init.text))) ||
        (ts.isPropertyAccessExpression(init) && init.name.text === REQUIRE_WORD) ||
        (ts.isCallExpression(init) && isCreateRequireFactory(init.expression))
      ) {
        aliases.add(declaration.name.text)
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) checkLoadCall(node, aliases, fail)
    else if (ts.isNewExpression(node)) checkWorker(node, fail)
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
      refuseDynamicLoads(bytes.toString('utf8'), key)
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
