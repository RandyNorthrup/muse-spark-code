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
// its own error. A dynamic `import()` or `require()` call whose specifier
// is not a string literal is left for runtime by the bundler, so the
// digest refuses it with a clear error instead of hashing around it.
// `esbuild` itself stays external: the resolver is tooling, not harness
// behaviour. Bare and `node:` imports the bundler leaves out are the
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

/**
 * Comments and string literals, skipped before looking for runtime loading
 * calls, so an import-looking line inside a task fixture (the `main.js`
 * content importing `./util.js`) or a verifier prelude is never mistaken
 * for an edge the digest must refuse. A regular-expression literal holding
 * call-like text would read as a call, since literals are not stripped, so
 * the patterns below are strings, never literals: string contents always
 * strip as one unit. (A regular expression in a scanned file that confuses
 * the strip this way fails loudly, never as a skipped edge.)
 */
const SKIP = new RegExp(
  '/\\*[\\s\\S]*?\\*/|//[^\\n]*|\'(?:[^\'\\\\\\n]|\\\\.)*\'|"(?:[^"\\\\\\n]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*?`',
  'g',
)

/** The call words, kept out of any literal so this file never spells a call. */
const IMPORT_WORD = 'import'
const REQUIRE_WORD = 'require'

/** A runtime loading call: dynamic `import()` or a bare `require()` (never `obj.require`). */
const LOADER = new RegExp(String.raw`\b${IMPORT_WORD}\s*\(|(?<!\.)\b${REQUIRE_WORD}\s*\(`, 'g')

/**
 * Refuses a dynamic `import()` or `require()` call whose specifier the
 * bundler cannot see: it runs at runtime, outside every hashed edge, so
 * the digest fails closed instead of freezing around it. A string literal
 * (or a substitution-free template) is the bundler's own edge and needs
 * no refusal: it is either in the metafile or the build above already
 * failed on it.
 */
/**
 * Whether a dynamic loading call's template argument is a plain literal:
 * a closing backtick before any substitution. A substitution reads at
 * runtime, outside every hashed edge, so it fails the digest.
 */
function isLiteralTemplateSpecifier(arg: string, key: string): boolean {
  let index = 1
  while (index < arg.length) {
    const char = arg[index]
    if (char === '\\') {
      index += 1
    } else if (char === '`') {
      return true
    } else if (char === '$' && arg[index + 1] === '{') {
      throw new Error(`the frozen arm sources cannot cover a non-literal dynamic import in ${key}`)
    }
    index += 1
  }
  return false
}

function refuseDynamicLoads(source: string, key: string): void {
  const clean = source.replaceAll(SKIP, (match) => (match.startsWith('/') ? '' : '""'))
  LOADER.lastIndex = 0
  for (let found = LOADER.exec(clean); found !== null; found = LOADER.exec(clean)) {
    // Comments are already stripped above, so only whitespace can precede
    // the specifier.
    const arg = clean.slice(found.index + found[0].length).replace(/^\s+/, '')
    const quote = arg[0]
    if (quote === "'" || quote === '"') continue
    if (quote === '`' && isLiteralTemplateSpecifier(arg, key)) continue
    throw new Error(`the frozen arm sources cannot cover a non-literal dynamic import in ${key}`)
  }
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
        external: ['esbuild'],
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
