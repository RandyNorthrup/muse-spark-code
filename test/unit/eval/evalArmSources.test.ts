// R9 threat model (PLAN.md M101, review RVCM1012I): hash the bundle that
// executes. The freeze-time metafile allowlist stops accidental undeclared
// imports; Node's `--permission` flags stop undeclared file reads and loads
// at run time. A deliberately hostile arm is out of scope: arms change only
// through review.
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVAL_ARM_PROCESS_TIMEOUT_MS } from '../../../src/shared/constants'
import {
  armBundleDigest,
  buildArmBundle,
  canonicalize,
  executeArmBundle,
  requireEvalArmRuntime,
  type ArmFixture,
} from '../../../src/core/eval/armSources'
import { frozenBundleChange } from '../../../src/core/eval/mechanisms'

const trees: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true })
})

function tree(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'arm-bundle-')))
  trees.push(root)
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, bytes)
  }
  return root
}

function bundle(root: string, fixtures: readonly ArmFixture[] = []) {
  return buildArmBundle(path.join(root, 'arm.ts'), 'probe', fixtures)
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')
}

describe('frozen arm bundle execution', () => {
  it('executes the exact bundled bytes after source and helper change', () => {
    const root = tree({
      'arm.ts': "import { value } from './helper'; export const run = () => value",
      'helper.ts': 'export const value = 1',
    })
    const frozen = bundle(root)
    expect(executeArmBundle(frozen)).toBe(1)
    writeFileSync(path.join(root, 'helper.ts'), 'export const value = 2')
    writeFileSync(
      path.join(root, 'arm.ts'),
      "import { value } from './helper'; export const run = () => value + 1",
    )
    expect(executeArmBundle(frozen)).toBe(1)
    const changed = bundle(root)
    expect(changed.sha256).not.toBe(frozen.sha256)
    expect(executeArmBundle(changed)).toBe(3)
  })

  it('changes the digest for any changed bundled byte and rejects snapshot mutation', () => {
    const root = tree({ 'arm.ts': 'export const run = () => 1' })
    const frozen = bundle(root)
    const changed = { ...frozen, code: frozen.code + '\n' }
    expect(armBundleDigest(changed)).not.toBe(frozen.sha256)
    expect(() => executeArmBundle(changed)).toThrow('changed after freezing')
  })

  it('bundles accessors and package dependencies without externals', () => {
    const root = tree({
      'arm.ts':
        "import { state } from './helper'; import { answer } from 'answer'; export const run = () => [state.value, answer]",
      'helper.ts': 'export const state = { get value() { return 1 } }',
      'node_modules/answer/package.json': '{"main":"index.js"}',
      'node_modules/answer/index.js': 'exports.answer = 42',
    })
    const frozen = bundle(root)
    expect(executeArmBundle(frozen)).toEqual([1, 42])
    writeFileSync(path.join(root, 'helper.ts'), 'export const state = { get value() { return 2 } }')
    const changed = bundle(root)
    expect(changed.sha256).not.toBe(frozen.sha256)
    expect(executeArmBundle(changed)).toEqual([2, 42])
  })

  it('uses the real resolver for directory, .jsx and absolute .js mappings', () => {
    const root = tree({
      'arm.ts': 'export const run = () => 0',
      'helper/index.ts': 'export const first = 1',
      'view.tsx': 'export const second = 2',
      'value.ts': 'export const third = 3',
    })
    const absolute = path.join(root, 'value.js').replaceAll('\\', '/')
    writeFileSync(
      path.join(root, 'arm.ts'),
      `import { first } from './helper'; import { second } from './view.jsx'; import { third } from ${JSON.stringify(absolute)}; export const run = async () => [first, second, third, (await import('./view.jsx')).second]`,
    )
    const frozen = bundle(root)
    expect(executeArmBundle(frozen)).toEqual([1, 2, 3, 2])
    for (const [name, content] of [
      ['view.tsx', 'export const second = 4'],
      ['value.ts', 'export const third = 5'],
    ]) {
      writeFileSync(path.join(root, name!), content!)
      expect(bundle(root).sha256).not.toBe(frozen.sha256)
    }
  })

  it('keeps emitted bytes and digests identical across roots and symlink aliases', () => {
    const files = {
      'arm.ts': "import { value } from './helper'; export const run = () => value",
      'helper.ts': 'export const value = 1',
    }
    const first = tree(files)
    const second = tree(files)
    const alias = path.join(second, 'alias')
    symlinkSync(first, alias, 'junction')
    const left = bundle(first)
    expect(bundle(second).code).toBe(left.code)
    expect(bundle(second).sha256).toBe(left.sha256)
    expect(bundle(alias).sha256).toBe(left.sha256)
    expect(executeArmBundle(bundle(alias))).toBe(1)
    expect(realpathSync(alias)).toBe(first)
  })

  it('canonicalizes the execution directory under a symlinked temp root', () => {
    const root = tree({ 'arm.ts': 'export const run = () => __filename' })
    const temp = tree({})
    const alias = path.join(temp, 'alias')
    symlinkSync(root, alias, 'junction')
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, alias)
    const nested = tree({ 'arm.ts': 'export const run = () => __filename' })
    expect(nested).toBe(realpathSync(nested))
    const file = executeArmBundle(bundle(nested))
    expect(typeof file).toBe('string')
    // The child directory has been cleaned; compare its canonical parent.
    if (typeof file !== 'string') throw new TypeError('the child did not return its filename')
    expect(path.dirname(path.dirname(file))).toBe(root)
  })

  it('snapshots declared fixtures by bytes and grants only each exact file', () => {
    const root = tree({
      'arm.ts':
        "import { readFileSync } from 'node:fs'; import path from 'node:path'; export const run = () => readFileSync(path.join(__dirname, 'fixtures', 'value.txt'), 'utf8')",
    })
    const bytes = Buffer.from('first')
    const frozen = bundle(root, [{ path: String.raw`fixtures\value.txt`, bytes }])
    bytes.fill(0)
    expect(executeArmBundle(frozen)).toBe('first')
    const changed = bundle(root, [{ path: 'fixtures/value.txt', bytes: Buffer.from('second') }])
    expect(changed.sha256).not.toBe(frozen.sha256)
    expect(executeArmBundle(changed)).toBe('second')
    writeFileSync(
      path.join(root, 'arm.ts'),
      "import { readFileSync } from 'node:fs'; import path from 'node:path'; export const run = () => readFileSync(path.join(__dirname, 'fixtures', 'other.txt'), 'utf8')",
    )
    expect(() => executeArmBundle(bundle(root, frozen.fixtures))).toThrow(/ERR_ACCESS_DENIED/)
    frozen.fixtures[0]!.bytes.fill(0)
    expect(() => executeArmBundle(frozen)).toThrow('changed after freezing')
  })

  it('refuses fixture traversal, wildcards, bundle collisions and portable duplicate names', () => {
    const root = tree({ 'arm.ts': 'export const run = () => 1' })
    for (const name of [
      '../secret',
      String.raw`..\secret`,
      '/secret',
      String.raw`C:\secret`,
      'fixtures/*',
      'arm.cjs',
      '',
    ]) {
      expect(() => bundle(root, [{ path: name, bytes: Buffer.from('x') }]), name).toThrow(
        'invalid path',
      )
    }
    expect(() =>
      bundle(
        root,
        ['value.txt', 'VALUE.txt'].map((file) => ({ path: file, bytes: Buffer.from('x') })),
      ),
    ).toThrow('repeated')
  })

  it('blocks dynamic require and computed import of undeclared files at runtime', () => {
    // The permission grants cover only the frozen bundle and fixture files:
    // loading any other file fails in the child, however it is spelled.
    const root = tree({ 'arm.ts': '', 'helper.js': 'module.exports = 1' })
    const helper = path.join(root, 'helper.js')
    writeFileSync(
      path.join(root, 'arm.ts'),
      `export const run = () => { const target = ${JSON.stringify(helper)}; return require(target); }`,
    )
    const frozen = bundle(root) // Builds successfully: enforcement belongs to execution.
    expect(() => executeArmBundle(frozen)).toThrow(/ERR_ACCESS_DENIED/)
    // A dynamic `import()` of an undeclared file fails the same way.
    writeFileSync(
      path.join(root, 'arm.ts'),
      `export const run = async () => { const target = ${JSON.stringify(pathToFileURL(helper).href)}; return import(target); }`,
    )
    expect(new URL(pathToFileURL(helper).href).protocol).toBe('file:')
    expect(() => executeArmBundle(bundle(root))).toThrow(/ERR_ACCESS_DENIED/)
  })

  it('blocks the whole indirect-loader class, including every review-F escape', () => {
    // Static imports of loaders fail the freeze instead (pinned below), so
    // every spelling here reaches the permission denial through a global.
    const root = tree({ 'arm.ts': '', 'helper.js': 'module.exports = 1' })
    const helper = JSON.stringify(path.join(root, 'helper.js'))
    const probes = [
      'const loaders = { req: require }; return loaders.req(target)',
      'const load = (loader) => loader(target); return load(require)',
      'return module[`require`](target)',
      'return Reflect.apply(require, null, [target])',
      'const resolve = require.resolve; const find = resolve; return require(find(target))',
      'const req = require; const { resolve: find } = req; return req(find(target))',
      'const F = Function; return new F("load", "target", "return load(target)")(require, target)',
      'return new globalThis.Function("load", "target", "return load(target)")(require, target)',
      'const req = require; return req(target)',
      'return require?.(target)',
      'return require.call(null, target)',
      'return module.require.call(module, target)',
      'return (0, require)(target)',
      'return eval("require(target)")',
    ]
    for (const probe of probes) {
      writeFileSync(
        path.join(root, 'arm.ts'),
        `export function run() { const target = ${helper}; ${probe}; }`,
      )
      expect(() => executeArmBundle(bundle(root)), probe).toThrow(/ERR_ACCESS_DENIED/)
    }
  })

  it('blocks module-relative reads through computed paths, renamed reads and URL constructors', () => {
    const root = tree({ 'arm.ts': '' })
    const probes = [
      "readFileSync(path.join(__dirname, 'helper.js'), 'utf8')",
      "read('./helper.js', 'utf8')",
      "readFileSync('helper.js', 'utf8')",
      "readFileSync(new Locator('./helper.js', pathToFileURL(__filename)), 'utf8')",
    ]
    for (const probe of probes) {
      writeFileSync(
        path.join(root, 'arm.ts'),
        `import { readFileSync, readFileSync as read } from 'node:fs'; import path from 'node:path'; import { URL as Locator, pathToFileURL } from 'node:url'; export const run = () => ${probe}`,
      )
      expect(() => executeArmBundle(bundle(root)), probe).toThrow(/ERR_ACCESS_DENIED/)
    }
  })

  it('refuses workers and child processes at freeze time', () => {
    const root = tree({ 'arm.ts': '' })
    const frozenProbes = [
      "import { Worker } from 'node:worker_threads'; export const run = async () => { const worker = new Worker('1', { eval: true }); await worker.terminate(); return 1 }",
      "import { execFileSync } from 'node:child_process'; export const run = () => execFileSync(process.execPath, ['-e', 'process.stdout.write(\"1\")'], { encoding: 'utf8' })",
      "import { createRequire } from 'node:module'; export const run = () => createRequire(__filename)('./helper.js')",
    ]
    for (const probe of frozenProbes) {
      writeFileSync(path.join(root, 'arm.ts'), probe)
      expect(() => bundle(root), probe).toThrow(/outside the frozen arm allowlist/)
    }
  })

  it('refuses a non-allowlisted built-in at freeze time', () => {
    const root = tree({ 'arm.ts': '' })
    const cases: [source: string, specifier: string][] = [
      // Review RVCM1012H finding 1: an undeclared database must not reach a
      // run, so its only outside input cannot change a frozen result.
      [
        "import { DatabaseSync } from 'node:sqlite'; export const run = () => new DatabaseSync('data.db').prepare('SELECT x FROM t').get()",
        'node:sqlite',
      ],
      // Review RVCM1012I finding 2: bare spellings fail like `node:`-prefixed
      // ones — there is no deny-list to miss them — and neither does a `..`
      // dodge through an allowlisted name.
      ["const target = require('process'); export const run = () => target", 'process'],
      ["import os from 'os'; export const run = () => os.platform()", 'os'],
      ["import crypto from 'crypto'; export const run = () => crypto", 'crypto'],
      [
        "import slash from 'node:fs/../sqlite'; export const run = () => slash",
        'node:fs/../sqlite',
      ],
      ["import { test } from 'node:test'; export const run = () => test", 'node:test'],
      [
        "import { execFileSync } from 'node:child_process'; export const run = () => execFileSync",
        'node:child_process',
      ],
      [
        "import { Worker } from 'node:worker_threads'; export const run = () => Worker",
        'node:worker_threads',
      ],
      ["import net from 'node:net'; export const run = () => net", 'node:net'],
      ["import https from 'node:https'; export const run = () => https", 'node:https'],
      [
        "import inspector from 'node:inspector'; export const run = () => inspector",
        'node:inspector',
      ],
      ["import { register } from 'node:module'; export const run = () => register", 'node:module'],
    ]
    for (const [source, specifier] of cases) {
      writeFileSync(path.join(root, 'arm.ts'), source)
      expect(() => bundle(root), specifier).toThrow(
        `the frozen arm sources cannot use ${specifier}: outside the frozen arm allowlist`,
      )
    }
  })

  it('maps an undeclared file read at run time to a failed task, never a pass', () => {
    // The runner path reports a run-time refusal as an error, never as a
    // pass: the child exits nonzero, so the change throws before any model
    // request. A computed built-in loader name is outside the threat model
    // (PLAN.md M101) and is not refused here — only the freeze-time
    // allowlist and the file grants are.
    const root = tree({
      'arm.ts':
        "import { readFileSync } from 'node:fs'; export const run = () => readFileSync('/definitely-outside-the-grants.txt', 'utf8')",
    })
    expect(() => executeArmBundle(bundle(root))).toThrow(/ERR_ACCESS_DENIED/)
    expect(() => frozenBundleChange(bundle(root))).toThrow(/ERR_ACCESS_DENIED/)
  })

  it('covers the entry prologue with the frozen digest', () => {
    const root = tree({ 'arm.ts': 'export const run = () => 1' })
    const frozen = bundle(root)
    expect(frozen.code).toContain('started without an arm name')
    expect(executeArmBundle(frozen)).toBe(1)
    const tampered = { ...frozen, code: `${frozen.code} ` }
    expect(armBundleDigest(tampered)).not.toBe(frozen.sha256)
    expect(() => executeArmBundle(tampered)).toThrow('changed after freezing')
  })

  it('refuses to run on a Node without the permission flags and names the minimum', () => {
    // Review RVCM1012I finding 3: the 23.0–23.4 line still gates the flags
    // behind `--experimental-permission`, so only 23.5.0 and newer qualify.
    for (const version of [
      'v22.12.0',
      'v22.0.0',
      'v21.7.1',
      'v23.0.0',
      'v23.4.0',
      'not-a-version',
    ]) {
      expect(() => {
        requireEvalArmRuntime(version)
      }, version).toThrow(/22\.13\.0/)
    }
    for (const version of ['v23.4.0', 'v23.0.0']) {
      expect(() => {
        requireEvalArmRuntime(version)
      }, version).toThrow(/23\.5\.0/)
    }
    for (const version of [
      'v22.13.0',
      'v22.23.3',
      'v23.5.0',
      'v23.6.1',
      'v24.21.0',
      process.version,
    ]) {
      expect(() => {
        requireEvalArmRuntime(version)
      }, version).not.toThrow()
    }
  })

  it('allows Node built-ins and bundled literal loads with no undeclared reads', () => {
    const root = tree({
      'arm.ts':
        "import path from 'node:path'; export const run = async () => [path.basename('a/b'), require('./helper').value, (await import('./helper')).value]",
      'helper.ts': 'export const value = 42',
    })
    expect(executeArmBundle(bundle(root))).toEqual(['b', 42, 42])
  })

  it('kills a stalled arm despite a SIGTERM handler and cleans its files', () => {
    const releaseMs = EVAL_ARM_PROCESS_TIMEOUT_MS + 1500
    const root = tree({
      'arm.ts': `export const run = () => new Promise(resolve => {
        process.on('SIGTERM', () => {});
        setTimeout(() => resolve(1), ${String(releaseMs)});
      })`,
    })
    for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, root)
    const frozen = bundle(root)
    const before = readdirSync(root)
    const start = performance.now()
    expect(() => executeArmBundle(frozen)).toThrow(/ETIMEDOUT/)
    // Allow one second for parent scheduling; the child's fallback takes longer.
    expect(performance.now() - start).toBeLessThan(EVAL_ARM_PROCESS_TIMEOUT_MS + 1000)
    expect(readdirSync(root)).toEqual(before)
  })

  it('fails honestly on missing entries, unresolved imports and invalid child output', () => {
    const root = tree({ 'arm.ts': "import './missing'; export const run = () => 1" })
    expect(() => bundle(root)).toThrow('cannot resolve')
    expect(() => buildArmBundle(path.join(root, 'missing.ts'), 'probe')).toThrow('cannot read')
    writeFileSync(
      path.join(root, 'arm.ts'),
      "export const run = () => { process.stdout.write('bad-json'); return 1 }",
    )
    expect(() => executeArmBundle(bundle(root))).toThrow(SyntaxError)
  })

  it('enforces the allowlist from the bundler metafile, with no scanner cast', () => {
    // Review RVCM1012I finding 2: the freeze reads the same build's own
    // metafile (`inputs[*].imports`, `external: true`), never a second
    // resolver or a TypeScript-compiler scan.
    const source = readFileSync(path.resolve('src/core/eval/armSources.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]typescript['"]|refuseDynamicLoads|as ts\./)
    expect(source).toMatch(/metafile: true/)
    expect(source).toMatch(/refuseNonAllowlistedBuiltinImports/)
  })

  it('keeps an own __proto__ field and refuses non-data canonical values', () => {
    const first: unknown = JSON.parse('{"__proto__":{"value":1}}')
    const second: unknown = JSON.parse('{"__proto__":{"value":2}}')
    expect(JSON.stringify(canonicalize(first, 'probe'))).toBe('{"__proto__":{"value":1}}')
    expect(hash(canonicalize(first, 'probe'))).not.toBe(hash(canonicalize(second, 'probe')))
    for (const value of [() => 1, undefined, Symbol('x'), NaN, new Date()]) {
      expect(() => canonicalize(value, 'probe')).toThrow('cannot hash')
    }
  })
})
