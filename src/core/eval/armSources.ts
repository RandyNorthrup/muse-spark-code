// The frozen arms' source closure (PLAN.md M101, review RVCM1012B finding 1).
//
// `evalHarnessDigest` must cover every byte that decides an arm, not only
// each arm's `change` callback source: a helper the callback references
// (the auto-compaction admission's `noop`) or an imported value it spreads
// (the strict-tools arm's capabilities) decides the arm as much as the
// callback text does. This module therefore walks the static import graph
// starting at the modules that define the arms, instead of a hand-kept
// file list a new helper would silently miss:
//
// - A file the walk reaches inside the harness's own package
//   (`src/core/eval/`) contributes its full bytes. A new helper an arm
//   imports there is discovered automatically.
// - A relative import that escapes the package contributes the imported
//   bindings' canonical runtime values, so arm-deciding data (capability
//   and quirk records, frozen windows and thresholds) is covered wherever
//   it is built, while the producing module's unrelated bytes (provider
//   descriptions, UI text) stay out of the freeze.
// - Anything else fails closed with a naming error: an unlisted outside
//   module, a missing file, a namespace import of one (names must stay
//   explicit), a side-effect-only one, or a function-valued binding (a
//   helper with behaviour belongs in the harness package, where its bytes
//   are hashed). A future arm dependency that this cannot cover breaks the
//   digest loudly instead of slipping past it.
// - `import type` statements are skipped: types are erased before the run,
//   and the typecheck gate guards them. Bare and `node:` imports are the
//   platform and the pinned dependencies, not the harness.
// - The production system under test is deliberately outside the closure:
//   the arm modules reach it nowhere (the held-deps list lives in
//   `./heldDeps` precisely so the digest need not depend on the driver,
//   which drives `ModelApiHost`). Pinning the host would freeze production
//   code the harness is meant to measure.
//
// The scanner reads static `import`/`export ... from` statements with one
// tokenizer pass that skips comments and string literals first, so an
// import-looking line inside a task fixture (the `main.js` content
// importing `./util.js`) is never followed. A pathologically quoted
// regular-expression literal could confuse it; none of the frozen files
// contains one, and an unresolvable phantom fails closed. Paths are
// normalized to forward slashes before comparing or hashing, so the digest
// is stable on Windows; bytes are hashed raw, and the repository pins
// `eol=lf` (`.gitattributes`), so checkouts agree byte for byte.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { EVAL_ARM_SOURCE_SEARCH_DEPTH } from '../../shared/constants'

// The outside modules' namespaces, loaded dynamically so the static walk
// below never sees a namespace import clause of its own: only named imports
// contribute values, and a namespace import anywhere else fails closed.
const capabilitiesModule = await import('../providers/capabilities')
const constantsModule = await import('../../shared/constants')
const presetsModule = await import('../providers/presets')

/** The modules that define the frozen arms: every arm runs only once `EVAL_ARMS` names it. */
export const ARM_SOURCE_ROOTS: readonly string[] = ['src/core/eval/mechanisms.ts']

/** One harness-owned file the walk reached, by repository-relative path with its bytes' digest. */
export interface ArmSourceFile {
  readonly path: string
  readonly sha256: string
}

/** One imported binding from outside the harness package, with its canonical value. */
export interface ArmSourceValue {
  readonly module: string
  readonly name: string
  readonly json: unknown
}

/** The arm closure: every owned file's bytes plus every outside binding's value. */
export interface ArmSources {
  readonly files: readonly ArmSourceFile[]
  readonly values: readonly ArmSourceValue[]
}

/**
 * Outside modules an arm dependency may draw values from, by
 * repository-relative path. A new one is a deliberate scope decision with
 * its own review, never a silent addition: the walk throws on any other.
 */
const ARM_VALUE_MODULES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'src/core/providers/capabilities.ts': Object.fromEntries(Object.entries(capabilitiesModule)),
  'src/core/providers/presets.ts': Object.fromEntries(Object.entries(presetsModule)),
  'src/shared/constants.ts': Object.fromEntries(Object.entries(constantsModule)),
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

/** Reads the root's bytes and reports whether it is repository-relative. */
function readRoot(root: string): { absolute: string; key: string; anchored: boolean } {
  if (path.isAbsolute(root)) {
    if (!existsSync(root)) throw new Error(`the frozen arm sources cannot read ${slash(root)}`)
    return { absolute: root, key: slash(root), anchored: false }
  }
  const absolute = path.join(resolveRepoRoot(), root)
  if (!existsSync(absolute)) throw new Error(`the frozen arm sources cannot read ${slash(root)}`)
  return { absolute, key: slash(root), anchored: true }
}

const SCAN =
  /(?<skip>\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*?`)|(?<side>\bimport\s*['"](?<sideSpec>[^'"]+)['"])|(?<clause>\bimport\s+(?!type\b)(?<importClause>[^'";]*?)\bfrom\s*['"](?<importSpec>[^'"]+)['"]|\bexport\s+(?!type\b)[^'";]*?\bfrom\s*['"](?<exportSpec>[^'"]+)['"])/g

/** The module-side names an import clause draws: the default, the named, never inline types. */
function clauseNames(clause: string, where: string): { namespace: boolean; names: string[] } {
  if (clause.includes('*')) return { namespace: true, names: [] }
  const names: string[] = []
  const def = clause.split('{', 1)[0]?.trim().replace(/,$/, '')
  if (def !== undefined && def !== '') names.push('default')
  const group = /\{([^}]*)\}/.exec(clause)?.[1]
  if (group === undefined) return { namespace: false, names }
  for (const specifier of group.split(',')) {
    const trimmed = specifier.trim()
    if (trimmed === '' || /^type\s+\S/u.test(trimmed)) continue
    const [name] = trimmed.split(/\s+as\s+/u, 2)
    if (name === undefined || name === '')
      throw new Error(`the frozen arm sources cannot parse ${where}`)
    names.push(name)
  }
  return { namespace: false, names }
}

/** Resolves a relative specifier beside its importer; a missing file fails the digest. */
function resolveRelative(spec: string, importer: string, absolute: string): string {
  const base = path.resolve(path.dirname(absolute), spec)
  const candidates = [base, `${base}.ts`, path.join(base, 'index.ts')]
  if (spec.endsWith('.js')) candidates.push(`${base.slice(0, -'.js'.length)}.ts`)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`the frozen arm sources cannot resolve ${spec} from ${slash(importer)}`)
}

/**
 * The canonical JSON value: sorted keys, kept array order. Anything that
 * has no JSON meaning (a function, `undefined`, a symbol, a non-finite
 * number, a class instance) throws, so an unhashable binding breaks the
 * digest instead of hashing as `{}` or `null`.
 */
function canonicalize(value: unknown, where: string): unknown {
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
    out[key] = canonicalize(entry, `${where}.${key}`)
  }
  return out
}

function digestBytes(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Walks the static import closure of the arm roots and returns every
 * harness-owned file's bytes plus every outside binding's canonical value.
 * The same roots and tree always hash the same; any behaviour-deciding
 * byte or value moves the digest.
 */
export function collectArmSources(
  roots: readonly string[] = ARM_SOURCE_ROOTS,
  valueModules: Readonly<Record<string, Readonly<Record<string, unknown>>>> = ARM_VALUE_MODULES,
): ArmSources {
  const head = roots[0]
  if (head === undefined) throw new Error('the frozen arm sources need at least one root')
  const first = readRoot(head)
  const seenFiles = new Set<string>()
  const fileList: ArmSourceFile[] = []
  const seenValues = new Set<string>()
  const valueList: ArmSourceValue[] = []
  const queue: { absolute: string; key: string }[] = []
  for (const root of roots) {
    const entry = readRoot(root)
    if (entry.anchored !== first.anchored) {
      throw new Error('the frozen arm sources need roots from one tree')
    }
    queue.push({ absolute: entry.absolute, key: entry.key })
  }
  const ownedPrefix = first.anchored ? 'src/core/eval/' : `${slash(path.dirname(first.absolute))}/`
  const isOwned = (key: string): boolean => key.startsWith(ownedPrefix)
  const keyOf = (absolute: string): string =>
    slash(first.anchored ? path.relative(resolveRepoRoot(), absolute) : absolute)
  while (queue.length > 0) {
    const current = queue.pop()
    if (current === undefined) break
    if (seenFiles.has(current.key)) continue
    if (!isOwned(current.key)) {
      throw new Error(`the frozen arm sources never visit ${current.key} directly`)
    }
    seenFiles.add(current.key)
    fileList.push({ path: current.key, sha256: digestBytes(readFileSync(current.absolute)) })
    const source = readFileSync(current.absolute, 'utf8')
    SCAN.lastIndex = 0
    for (let match = SCAN.exec(source); match !== null; match = SCAN.exec(source)) {
      const groups = match.groups
      if (groups === undefined || groups['skip'] !== undefined) continue
      const sideSpec = groups['sideSpec']
      if (groups['side'] !== undefined) {
        if (typeof sideSpec === 'string' && sideSpec.startsWith('.')) {
          const absolute = resolveRelative(sideSpec, current.key, current.absolute)
          const key = keyOf(absolute)
          if (!isOwned(key)) {
            throw new Error(`the frozen arm sources cannot cover ${sideSpec} from ${current.key}`)
          }
          queue.push({ absolute, key })
        }
        continue
      }
      const spec = groups['importSpec'] ?? groups['exportSpec']
      if (typeof spec !== 'string' || !spec.startsWith('.')) continue
      const absolute = resolveRelative(spec, current.key, current.absolute)
      const key = keyOf(absolute)
      if (isOwned(key)) {
        queue.push({ absolute, key })
        continue
      }
      const importClause = groups['importClause']
      if (groups['importSpec'] !== undefined) {
        if (importClause === undefined) continue
        const { namespace, names } = clauseNames(importClause, `${current.key} from ${spec}`)
        const moduleRecord = valueModules[key]
        if (moduleRecord === undefined) {
          throw new Error(`the frozen arm sources cannot cover ${spec} from ${current.key}`)
        }
        if (namespace) {
          throw new Error(`the frozen arm sources need named imports from ${spec}`)
        }
        for (const name of names) {
          if (!Object.hasOwn(moduleRecord, name)) {
            throw new Error(`the frozen arm sources cannot find ${name} in ${spec}`)
          }
          const value = moduleRecord[name]
          if (typeof value === 'function') {
            throw new TypeError(
              `the frozen arm sources cannot hash ${name} in ${spec}: a helper belongs in src/core/eval/`,
            )
          }
          const valueKey = JSON.stringify([key, name])
          if (seenValues.has(valueKey)) continue
          seenValues.add(valueKey)
          valueList.push({ module: key, name, json: canonicalize(value, `${key}:${name}`) })
        }
        continue
      }
      throw new Error(`the frozen arm sources cannot cover ${spec} re-exported from ${current.key}`)
    }
  }
  return {
    files: fileList.toSorted((left, right) => comparePath(left.path, right.path)),
    values: valueList.toSorted(
      (left, right) => comparePath(left.module, right.module) || comparePath(left.name, right.name),
    ),
  }
}
