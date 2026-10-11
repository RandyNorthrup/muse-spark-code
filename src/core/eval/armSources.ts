// HASH WHAT RUNS (PLAN.md M101, CM1012R7). The digest covers emitted
// self-contained bundle bytes and declared fixture snapshots. Runtime
// permissions enforce the frozen set regardless of loader spelling.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { buildSync } from 'esbuild'
import * as z from 'zod/mini'
// Type-only entry contract: the parent never loads the arm program.
import type { run } from './armDefinitions'
import {
  EVAL_ARM_SOURCE_SEARCH_DEPTH,
  EVAL_ARM_PROCESS_TIMEOUT_MS,
  EVAL_ARM_OUTPUT_MAX_BYTES,
  EVAL_TEMP_PREFIX,
  EVAL_ROOT_MASK,
} from '../../shared/constants'

export const ARM_SOURCE_ROOTS: readonly string[] = ['src/core/eval/armDefinitions.ts']

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
        contents: `import { run } from ${JSON.stringify('./' + slash(path.basename(entry)))};
Promise.resolve().then(() => run(${JSON.stringify(name)})).then(
  value => process.stdout.write(JSON.stringify(value)),
  error => { process.stderr.write(String(error?.code ?? "ARM_FAILED") + ": " + String(error?.stack ?? error)); process.exitCode = 1; }
);`,
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
    })
    const output = result.outputFiles[0]
    if (output === undefined) throw new Error('esbuild emitted no arm bundle')
    code = output.text
  } catch (error) {
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

/** No source execution in the parent. Node denies every undeclared filesystem read/load. */
export function executeArmBundle(bundle: ArmBundle): unknown {
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
        ['--permission', ...reads.map((file) => `--allow-fs-read=${file}`), entry],
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
