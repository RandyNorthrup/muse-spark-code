// HASH WHAT RUNS (PLAN.md M101, CM1012R7). The digest covers the guard
// prefix, the emitted self-contained bundle bytes and declared fixture
// snapshots. A literal load of a built-in outside the allowlist fails the
// freeze; a computed one fails the run inside the guard (RVCM1012H). The
// emitted CJS bundle text is scanned because that bundle format records no
// external load in the build's file list (probed): the scan reads the same
// build's own output, never a second resolver.

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
  EVAL_ARM_ALLOWED_BUILTINS,
  EVAL_ARM_DENIED_BARE_BUILTINS,
  EVAL_ARM_MIN_NODE_VERSION,
  EVAL_ARM_SOURCE_SEARCH_DEPTH,
  EVAL_ARM_PROCESS_TIMEOUT_MS,
  EVAL_ARM_OUTPUT_MAX_BYTES,
  EVAL_TEMP_PREFIX,
  EVAL_ROOT_MASK,
} from '../../shared/constants'

export const ARM_SOURCE_ROOTS: readonly string[] = ['src/core/eval/armDefinitions.ts']

const allowedBuiltins = new Set<string>(EVAL_ARM_ALLOWED_BUILTINS)
const deniedBareBuiltins = new Set<string>(EVAL_ARM_DENIED_BARE_BUILTINS)

/** The global the bundle publishes its `run` under for the guard to call. */
const ARM_RUN_EXPORT = '__frozenArmRun'

/** The comment line dividing the guard prefix from the bundle text in one frozen file. */
const ARM_BUNDLE_MARKER = '// __FROZEN_ARM_BUNDLE_FOLLOWS__\n'

function parseNodeVersion(version: string): { major: number; minor: number } | undefined {
  const match = /^v?(\d+)\.(\d+)/.exec(version)
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  return Number.isSafeInteger(major) && Number.isSafeInteger(minor) ? { major, minor } : undefined
}

/**
 * The evaluation is a development and CI tool: it refuses to run on a Node
 * without the permission flags it confines arms with (RVCM1012H finding 2).
 * The product floor stays where `package.json` engines puts it.
 */
export function requireEvalArmRuntime(version: string = process.version): void {
  const minimum = parseNodeVersion(EVAL_ARM_MIN_NODE_VERSION)
  const current = parseNodeVersion(version)
  const isSupported =
    minimum !== undefined &&
    current !== undefined &&
    (current.major > minimum.major ||
      (current.major === minimum.major && current.minor >= minimum.minor))
  if (!isSupported) {
    throw new Error(
      `the frozen arm evaluation needs Node ${EVAL_ARM_MIN_NODE_VERSION} or newer for its permission flags (this run uses ${version}); the extension itself still supports older Node 22`,
    )
  }
}

/**
 * The guard prefix: frozen bytes that start the arm program inside a `vm`
 * context instead of the child host context (RVCM1012H finding 1). The
 * context's `require` loads only allowlisted Node built-ins (every other
 * bare load, however the name is computed, is refused, as is every relative
 * load and `process.getBuiltinModule`); a dynamic `import()` has no loader
 * callback and fails closed; `process` is a sanitized copy without
 * credentials, and only `stdout` carries the arm's JSON answer. The arm
 * program below the marker is parsed but never executes in the host
 * context: the guard returns first, then runs it in the context and calls
 * the exported `run` with the arm name from `argv`.
 */
function armGuardSource(): string {
  const allowed = JSON.stringify([...allowedBuiltins])
  return `'use strict';
const __armVm = require('node:vm');
const __armFs = require('node:fs');
const __armPath = require('node:path');
const __armMarker = ${JSON.stringify(ARM_BUNDLE_MARKER)};
const __armDoubleSep = __armPath.sep + __armPath.sep;
const __armNewline = __armMarker.slice(-1);
const __armAllowed = new Set(${allowed});
function __armBase(request) {
  const text = String(request);
  const bare = text.startsWith('node:') ? text.slice('node:'.length) : text;
  return bare.split('/')[0];
}
function __armRefuse(request) {
  const error = new Error('ERR_ACCESS_DENIED: the frozen arm cannot load ' + String(request) + ': outside the frozen arm allowlist');
  error.code = 'ERR_ACCESS_DENIED';
  throw error;
}
function __armRequire(request) {
  if (typeof request !== 'string') return require(request);
  if (request.startsWith('.') || request.startsWith('/') || request.startsWith('file:') || request.startsWith(__armDoubleSep) || __armPath.win32.isAbsolute(request)) __armRefuse(request);
  if (!__armAllowed.has(__armBase(request))) __armRefuse(request);
  return require(request);
}
__armRequire.resolve = (request) => __armRefuse(request);
const __armModule = { exports: {}, require: __armRequire };
const __armProcess = {
  env: {},
  argv: [process.execPath, __filename],
  execPath: process.execPath,
  version: process.version,
  cwd: () => process.cwd(),
  stdout: { write: (chunk, encoding, callback) => process.stdout.write(chunk, encoding, callback) },
  stderr: { write: (chunk, encoding, callback) => process.stderr.write(chunk, encoding, callback) },
  on: (event, listener) => process.on(event, listener),
  once: (event, listener) => process.once(event, listener),
  exitCode: undefined,
  getBuiltinModule: (id) => __armRefuse(id),
};
const __armSandbox = {
  require: __armRequire,
  module: __armModule,
  exports: __armModule.exports,
  __filename,
  __dirname,
  process: __armProcess,
  Buffer,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
  setImmediate,
  clearImmediate,
  setInterval,
  clearInterval,
  queueMicrotask,
  structuredClone,
  performance,
  atob,
  btoa,
  console: {
    log: (...args) => process.stderr.write(args.map(String).join(' ') + __armNewline),
    error: (...args) => process.stderr.write(args.map(String).join(' ') + __armNewline),
    warn: (...args) => process.stderr.write(args.map(String).join(' ') + __armNewline),
    info: (...args) => process.stderr.write(args.map(String).join(' ') + __armNewline),
    debug: (...args) => process.stderr.write(args.map(String).join(' ') + __armNewline),
  },
};
function __armFail(error) {
  const code = error && error.code !== undefined ? String(error.code) : 'UNKNOWN';
  process.stderr.write(code + ': ' + String((error && error.stack) || error) + __armNewline);
  process.exitCode = 1;
}
try {
  const __armOwn = __armFs.readFileSync(__filename, 'utf8');
  const __armAt = __armOwn.indexOf(__armMarker);
  if (__armAt < 0) throw new Error('the frozen arm bundle lost its guard marker');
  __armVm.runInNewContext(__armOwn.slice(__armAt + __armMarker.length), __armSandbox, { filename: __filename });
  const __armRun = __armSandbox.${ARM_RUN_EXPORT};
  if (typeof __armRun !== 'function') throw new Error('the frozen arm bundle exports no runnable');
  const __armName = process.argv[2];
  if (typeof __armName !== 'string' || __armName === '') throw new Error('the frozen arm bundle was started without an arm name');
  Promise.resolve()
    .then(() => __armRun(__armName))
    .then(
      (value) => {
        if (__armProcess.exitCode !== undefined && __armProcess.exitCode !== 0) {
          __armFail(new Error('the frozen arm set a failing exit code'));
          return;
        }
        process.stdout.write(JSON.stringify(value));
      },
      __armFail,
    );
} catch (error) {
  __armFail(error);
}
return;
`
}

/**
 * A literal external load the bundler left in the emitted bytes fails the
 * freeze unless the allowlist names it (RVCM1012H finding 1). Bundled
 * relative loads are already inlined, so a remaining literal is a built-in
 * or a package: `node:`-prefixed and denied-bare names are built-ins and
 * refused, anything else bare is a bundled dependency the run-time guard
 * still confines. Computed names stay for the guard, which sees the value.
 */
function refuseDeniedBuiltinLoads(code: string, root: string): void {
  const loads = code.matchAll(
    /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)|\bfrom\s+['"]([^'"]+)['"]/g,
  )
  for (const load of loads) {
    const specifier = load[1] ?? load[2]
    if (
      specifier === undefined ||
      specifier === '' ||
      specifier.startsWith('.') ||
      specifier.startsWith('/') ||
      specifier.startsWith('file:') ||
      specifier.startsWith('#') ||
      path.win32.isAbsolute(specifier)
    ) {
      continue
    }
    const isPrefixed = specifier.startsWith('node:')
    const base = (isPrefixed ? specifier.slice('node:'.length) : specifier).split('/', 2)[0]
    if (base === undefined || base === '' || allowedBuiltins.has(base)) continue
    if (isPrefixed || deniedBareBuiltins.has(base)) {
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
  let emitted: string
  try {
    const result = buildSync({
      stdin: {
        // A library, never self-executing: the guard below the marker runs
        // it in the sandbox and calls the published `run` with the arm name.
        contents: `import { run } from ${JSON.stringify('./' + slash(path.basename(entry)))};
globalThis.${ARM_RUN_EXPORT} = run;`,
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
    emitted = output.text
  } catch (error) {
    throw new Error(`the frozen arm sources cannot resolve ${slash(root)}`, { cause: error })
  }
  // Outside the resolve wrapper so a refusal keeps its own message.
  refuseDeniedBuiltinLoads(emitted, root)
  const code = `${armGuardSource()}${ARM_BUNDLE_MARKER}${emitted}`
  // Snapshot caller-owned bytes, so later fixture changes cannot move an admitted run.
  const snapshot = fixtures.map((fixture) => ({
    path: fixtureName(fixture.path),
    bytes: Uint8Array.from(fixture.bytes),
  }))
  const bundle = { name, code, fixtures: snapshot }
  return { ...bundle, sha256: armBundleDigest(bundle) }
}

/** No source execution in the parent. The guard prefix runs the bundle in a
 * sandbox that loads only allowlisted built-ins; Node denies every
 * undeclared filesystem read/load beside it. A refusal is an error, never a
 * pass: the caller maps a throw to a failed task before any model request.
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
