// HASH WHAT RUNS (PLAN.md M101, CM1012R7) — and say plainly what each layer
// does and does not do (PLAN.md M101 threat model, review RVCM1012I). The
// digest covers the entry prologue, the emitted self-contained bundle bytes
// and declared fixture snapshots. At freeze time the bundler's own metafile
// refuses every external load outside a short allowlist, so an accidental
// undeclared import (a stray built-in) fails before any child runs. At run
// time the child runs under Node's `--permission` flags with reads granted
// only to the frozen files, so an undeclared file read fails. Neither layer
// stops a deliberately hostile arm (a computed loader name, process
// internals, an unconfined built-in such as `node:sqlite`, a native
// add-on): the arms are this project's own reviewed code, changed only
// through review, and the digest changes with them.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { buildSync, type Metafile } from 'esbuild'
import * as z from 'zod/mini'
// Type-only entry contract: the parent never loads the arm program.
import type { run } from './armDefinitions'
import {
  EVAL_ARM_ALLOWED_BUILTINS,
  EVAL_ARM_MIN_NODE_VERSION,
  EVAL_ARM_MIN_NODE_VERSION_23,
  EVAL_ARM_SOURCE_SEARCH_DEPTH,
  EVAL_ARM_PROCESS_TIMEOUT_MS,
  EVAL_ARM_OUTPUT_MAX_BYTES,
  EVAL_TEMP_PREFIX,
  EVAL_ROOT_MASK,
} from '../../shared/constants'

export const ARM_SOURCE_ROOTS: readonly string[] = ['src/core/eval/armDefinitions.ts']

const allowedBuiltins = new Set<string>(EVAL_ARM_ALLOWED_BUILTINS)

function parseNodeVersion(version: string): { major: number; minor: number } | undefined {
  const match = /^v?(\d+)\.(\d+)/.exec(version)
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) ? { major, minor } : undefined
}

/**
The evaluation is a development and CI tool: it refuses to run on a Node
without the permission flags it confines arms with (RVCM1012H finding 2).
The product floor stays where `package.json` engines puts it.
*/
export function requireEvalArmRuntime(version: string = process.version): void {
  const floor22 = parseNodeVersion(EVAL_ARM_MIN_NODE_VERSION)
  const floor23 = parseNodeVersion(EVAL_ARM_MIN_NODE_VERSION_23)
  const current = parseNodeVersion(version)
  // The permission flags are unflagged only from 22.13.0 and 23.5.0: the
  // 23.0–23.4 line still gates them behind `--experimental-permission`
  // (review RVCM1012I finding 3). A later major line has the stable flags.
  const isSupported =
    floor22 !== undefined &&
    floor23 !== undefined &&
    current !== undefined &&
    ((current.major === floor22.major && current.minor >= floor22.minor) ||
      (current.major === floor23.major && current.minor >= floor23.minor) ||
      current.major > floor23.major)
  if (!isSupported) {
    throw new Error(
      `the frozen arm evaluation needs Node ${EVAL_ARM_MIN_NODE_VERSION} or ${EVAL_ARM_MIN_NODE_VERSION_23} or newer for its permission flags (this run uses ${version}); the extension itself still supports older Node 22`,
    )
  }
}

/**
Every external load the bundler left for the child fails the freeze
unless the allowlist names it (reviews RVCM1012H finding 1, RVCM1012I
finding 2). The check reads the same build's own metafile — probed on
this rig, the CJS `outputs[].imports` list is empty, and the external
loads live in `inputs[*].imports` with `external: true` — never a second
resolver. Bundled relative loads and package dependencies are inlined,
so a remaining external is a built-in: `node:`-prefixed or bare (both
spellings are refused alike, so there is no deny-list to miss one), and
a `..` segment (the `node:fs/../sqlite` dodge) fails too. Computed
loader names never reach the metafile; they are outside the freeze's
threat model (PLAN.md M101: arms change only through review).
*/
function refuseNonAllowlistedBuiltinImports(metafile: Metafile, root: string): void {
  const externals = new Set<string>()
  for (const input of Object.values(metafile.inputs)) {
    for (const load of input.imports) {
      if (load.external) externals.add(load.path)
    }
  }
  for (const specifier of [...externals].toSorted(comparePath)) {
    const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier
    const parts = bare.split('/')
    const base = parts[0]
    if (base === undefined || base === '' || parts.includes('..') || !allowedBuiltins.has(base)) {
      throw new Error(
        `the frozen arm sources cannot use ${specifier}: outside the frozen arm allowlist (${slash(root)})`,
      )
    }
  }
}

export interface ArmFixture {
  /** Relative to the executing bundle, never a directory permission. */
  readonly path: string
  readonly bytes: Uint8Array
}

export interface ArmBundle {
  readonly name: string
  readonly code: string
  readonly fixtures: readonly ArmFixture[]
  /** SHA-256 of the bundle and fixture bytes, with their logical names. */
  readonly sha256: string
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1
  return left > right ? 1 : 0
}

function slash(file: string): string {
  return file.replaceAll('\\', '/')
}

export function armRepoRoot(): string {
  const anchor = ARM_SOURCE_ROOTS[0]
  if (anchor === undefined) throw new Error('the frozen arm sources need at least one root')
  let dir = realpathSync(process.cwd())
  for (let depth = 0; depth < EVAL_ARM_SOURCE_SEARCH_DEPTH; depth += 1) {
    if (existsSync(path.join(dir, anchor))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('the frozen arm sources need the repository root above the working directory')
}

function digestBytes(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Names are portable and exact; no traversal, wildcard permissions or bundle collision. */
function fixtureName(file: string): string {
  const name = slash(file)
  if (
    name === '' ||
    name === '.' ||
    name === 'arm.cjs' ||
    path.posix.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    name.split('/').some((part) => ['..', '', '.'].includes(part)) ||
    /[*?:]/.test(name)
  )
    throw new Error(`the frozen arm fixture has an invalid path: ${name}`)
  return name
}

export function armBundleDigest(bundle: Pick<ArmBundle, 'code' | 'fixtures'>): string {
  const seen = new Set<string>()
  const fixtures = bundle.fixtures
    .map((fixture) => {
      const name = fixtureName(fixture.path)
      const identity = name.toLowerCase()
      if (seen.has(identity)) throw new Error(`the frozen arm fixture is repeated: ${name}`)
      seen.add(identity)
      return { path: name, sha256: digestBytes(fixture.bytes) }
    })
    .toSorted((left, right) => comparePath(left.path, right.path))
  return digestBytes(JSON.stringify({ bundle: digestBytes(bundle.code), fixtures }))
}

/** Build once; the returned bytes are both hashed and executed, never rebuilt by the executor. */
export function buildArmBundle(
  root: string,
  name: Parameters<typeof run>[0],
  fixtures: readonly ArmFixture[] = [],
): ArmBundle {
  if (!existsSync(root)) throw new Error(`the frozen arm sources cannot read ${slash(root)}`)
  const entry = realpathSync(root)
  let code: string
  try {
    const result = buildSync({
      stdin: {
        // Self-executing in the permission-limited child: call the arm's
        // `run` with the arm name from `argv` and write exactly one JSON
        // value to `stdout`. A throw exits nonzero with the refusal on
        // `stderr`, which the executor maps to a failed task. This runs in
        // the child host context, not a sandbox: it confines nothing by
        // itself (review RVCM1012I finding 1).
        contents: String.raw`import { run } from ${JSON.stringify('./' + slash(path.basename(entry)))};
const __armName = process.argv[2];
if (typeof __armName !== 'string' || __armName === '') {
  process.stderr.write('the frozen arm bundle was started without an arm name\n');
  process.exitCode = 1;
} else {
  Promise.resolve()
    .then(() => run(__armName))
    .then(
      (value) => {
        process.stdout.write(JSON.stringify(value));
      },
      (error) => {
        const code = error && error.code !== undefined ? String(error.code) : 'UNKNOWN';
        process.stderr.write(code + ': ' + String((error && error.stack) || error) + '\n');
        process.exitCode = 1;
      },
    );
}`,
        resolveDir: path.dirname(entry),
        sourcefile: 'arm-entry.ts',
        loader: 'ts',
      },
      absWorkingDir: path.dirname(entry),
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      minify: true,
      legalComments: 'none',
      logLevel: 'silent',
      metafile: true,
    })
    const output = result.outputFiles[0]
    if (output === undefined) throw new Error('esbuild emitted no arm bundle')
    // Outside the resolve wrapper so a refusal keeps its own message.
    refuseNonAllowlistedBuiltinImports(result.metafile, root)
    code = output.text
  } catch (error) {
    if (error instanceof Error && error.message.includes('outside the frozen arm allowlist'))
      throw error
    throw new Error(`the frozen arm sources cannot resolve ${slash(root)}`, { cause: error })
  }
  // Snapshot caller-owned bytes, so later fixture changes cannot move an admitted run.
  const snapshot = fixtures.map((fixture) => ({
    path: fixtureName(fixture.path),
    bytes: Uint8Array.from(fixture.bytes),
  }))
  const bundle = { name, code, fixtures: snapshot }
  return { ...bundle, sha256: armBundleDigest(bundle) }
}

/** No source execution in the parent. The bundle runs in the child host
context under `--permission`, with reads granted only to the frozen
bundle and fixture files: an undeclared filesystem read or load fails
there. That is the whole run-time layer — it does not confine built-ins
the grants do not cover, and it stops no deliberately hostile arm
(review RVCM1012I finding 1). A refusal is an error, never a pass: the
caller maps a throw to a failed task before any model request.
*/
export function executeArmBundle(bundle: ArmBundle): unknown {
  requireEvalArmRuntime()
  if (armBundleDigest(bundle) !== bundle.sha256)
    throw new Error('the frozen arm bundle changed after freezing')
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), EVAL_TEMP_PREFIX)))
  try {
    const entry = path.join(dir, 'arm.cjs')
    writeFileSync(entry, bundle.code, { flag: 'wx' })
    const reads = [entry]
    for (const fixture of bundle.fixtures) {
      const file = path.join(dir, fixtureName(fixture.path))
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, fixture.bytes, { flag: 'wx' })
      reads.push(realpathSync(file))
    }
    let stdout: string
    try {
      stdout = execFileSync(
        process.execPath,
        ['--permission', ...reads.map((file) => `--allow-fs-read=${file}`), entry, bundle.name],
        {
          cwd: dir,
          // No inherited credentials, NODE_OPTIONS, preload or loader configuration.
          env: {},
          encoding: 'utf8',
          timeout: EVAL_ARM_PROCESS_TIMEOUT_MS,
          // A stalled program cannot ignore the deadline by handling SIGTERM.
          killSignal: 'SIGKILL',
          maxBuffer: EVAL_ARM_OUTPUT_MAX_BYTES,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `the frozen arm ${bundle.name} could not run: ${detail.replaceAll(dir, () => EVAL_ROOT_MASK)}`,
        { cause: error },
      )
    }
    const value: unknown = JSON.parse(stdout)
    return z.json().parse(value)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
The canonical JSON value: sorted keys, kept array order, and an own
`__proto__` field kept as data (review RVCM1012C finding 4). Plain
assignment to `out['__proto__']` would change the object's prototype
instead of creating an enumerable own field, so two values differing
only in that field would serialize identically; the field is defined
instead, and survives `JSON.stringify` as `{"__proto__":…}`.
Anything that has no JSON meaning (a function, `undefined`, a symbol,
a non-finite number, a class instance) throws, so an unhashable value
breaks the digest instead of hashing as `{}` or `null`.
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
