// The frozen arms' source closure (reviews RVCM1012B–C): the digest must
// cover every byte that decides an arm, discovered through the real
// resolver rather than a hand-kept file list or a pattern scanner, so a
// new helper an arm imports moves the digest without anyone updating a
// list, and no spelling of an edge slips past the freeze.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalize, collectArmSources } from '../../../src/core/eval/armSources'

/** Forward slashes everywhere, so the expectations read the same on Windows. */
function keyOf(file: string): string {
  return file.split(path.sep).join('/')
}

function digestOf(sources: unknown): string {
  return createHash('sha256').update(JSON.stringify(sources), 'utf8').digest('hex')
}

const trees: string[] = []
afterEach(() => {
  for (const tree of trees.splice(0)) rmSync(tree, { recursive: true, force: true })
})

/** A scratch harness: `owned/` stands in for `src/core/eval/`, `external/` for the rest of `src/`. */
function makeTree(
  owned: Record<string, string>,
  external: Record<string, string>,
): {
  ownedDir: string
  externalDir: string
} {
  const tree = mkdtempSync(path.join(tmpdir(), 'arm-sources-'))
  trees.push(tree)
  const ownedDir = path.join(tree, 'owned')
  const externalDir = path.join(tree, 'external')
  mkdirSync(ownedDir, { recursive: true })
  mkdirSync(externalDir, { recursive: true })
  for (const [name, content] of Object.entries(owned))
    writeFileSync(path.join(ownedDir, name), content)
  for (const [name, content] of Object.entries(external)) {
    writeFileSync(path.join(externalDir, name), content)
  }
  return { ownedDir, externalDir }
}

const ARM = `import { helper } from './helper'
import { answer } from '../external/values'
export const arm = { helper, answer }
`
const HELPER = `export function helper(): number {
  return 1
}
`
const VALUES = `export const answer = 42
`

function collectOwned(ownedDir: string) {
  return collectArmSources([path.join(ownedDir, 'arm.ts')])
}

/** The standard scratch harness: an arm importing an owned helper and one outside file. */
function makeArmTree(): { ownedDir: string; externalDir: string } {
  return makeTree({ 'arm.ts': ARM, 'helper.ts': HELPER }, { 'values.ts': VALUES })
}

describe('the frozen arms source closure', () => {
  it('covers the arm implementation files, and nothing else from the harness', () => {
    // The walker itself is in the closure: mechanisms.ts reaches it, so a
    // change to the walk moves the digest too. The driver and the production
    // host stay out: the harness measures them rather than freezing them.
    // Outside files (capabilities, presets, constants, the pinned schemas)
    // are covered by bytes below, not listed here.
    const sources = collectArmSources()
    expect(sources.files.map((file) => file.path).filter((key) => key.startsWith('src/'))).toEqual([
      'src/core/eval/armSources.ts',
      'src/core/eval/heldDeps.ts',
      'src/core/eval/mechanisms.ts',
      'src/core/eval/tasks.ts',
      'src/core/providers/capabilities.ts',
      'src/core/providers/capabilityRecord.ts',
      'src/core/providers/presets.ts',
      'src/shared/browserCheckConstants.ts',
      'src/shared/constants.ts',
      'src/shared/effort.ts',
      'src/shared/l10n/en.ts',
      'src/shared/l10n/forms.ts',
      'src/shared/l10n/text.ts',
      'src/shared/retryPolicy.ts',
      'src/shared/usdConstants.ts',
      'src/shared/usdSchema.ts',
    ])
  })

  it('keeps every key repository-relative, so the digest agrees across machines', () => {
    // Pinned dependencies the bundler follows (today zod, through the task
    // schemas) are hashed by bytes under `node_modules/`; nothing keeps a
    // local absolute path, which would freeze one machine's tree.
    const keys = collectArmSources().files.map((file) => file.path)
    expect(keys.length).toBeGreaterThan(16)
    for (const key of keys) {
      expect(key.startsWith('src/') || key.startsWith('node_modules/')).toBe(true)
    }
    expect(keys.some((key) => key.startsWith('node_modules/zod/'))).toBe(true)
  })

  it('collects the same closure twice', () => {
    expect(JSON.stringify(collectArmSources())).toBe(JSON.stringify(collectArmSources()))
  })

  it('covers an outside file by bytes, not by evaluated value', () => {
    // Review RVCM1012C finding 1: hashing an outside binding's current
    // value missed the implementation behind an accessor. Bytes cover
    // both the initializer and the getter.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `import { flags as state } from '../external/values'\nexport const arm = state\n`,
      },
      {
        'values.ts': `export const flags = {\n  get vision(): boolean {\n    return false\n  },\n}\n`,
      },
    )
    const before = digestOf(collectOwned(ownedDir))
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toContain(
      "from '../external/values'",
    )
    const externalDir = path.join(path.dirname(ownedDir), 'external')
    writeFileSync(
      path.join(externalDir, 'values.ts'),
      `export const flags = {\n  get vision(): boolean {\n    return true\n  },\n}\n`,
    )
    const after = digestOf(collectOwned(ownedDir))
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toContain(
      "from '../external/values'",
    )
    expect(after).not.toBe(before)
  })

  it('discovers an owned helper and hashes the outside file by bytes', () => {
    const { ownedDir, externalDir } = makeArmTree()
    const sources = collectOwned(ownedDir)
    // Byte-wise path order: the outside file sorts before the owned ones.
    expect(sources.files.map((file) => file.path)).toEqual([
      keyOf(path.join(externalDir, 'values.ts')),
      keyOf(path.join(ownedDir, 'arm.ts')),
      keyOf(path.join(ownedDir, 'helper.ts')),
    ])
  })

  it('moves when the helper implementation changes but the arm does not', () => {
    const { ownedDir } = makeArmTree()
    const before = digestOf(collectOwned(ownedDir))
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER.replace('return 1', 'return 2'))
    const after = digestOf(collectOwned(ownedDir))
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toBe(ARM)
    expect(after).not.toBe(before)
  })

  it('discovers a newly added helper through the existing import edge', () => {
    const { ownedDir } = makeArmTree()
    const before = digestOf(collectOwned(ownedDir))
    writeFileSync(path.join(ownedDir, 'bonus.ts'), `export const bonus = 'new helper'\n`)
    writeFileSync(
      path.join(ownedDir, 'helper.ts'),
      `import { bonus } from './bonus'\n${HELPER}export const helped = bonus\n`,
    )
    const sources = collectOwned(ownedDir)
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toBe(ARM)
    expect(sources.files.map((file) => file.path)).toContain(keyOf(path.join(ownedDir, 'bonus.ts')))
    expect(digestOf(sources)).not.toBe(before)
  })

  it('follows an edge a comment quote hides from a pattern scanner', () => {
    // Review RVCM1012C finding 2: a quote in a comment kept the clause
    // pattern from matching, so the helper escaped the freeze. The real
    // resolver follows the edge whatever the comment holds.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `import { helper } /* "reviewed helper" */ from './helper'\nexport const arm = helper\n`,
        'helper.ts': HELPER,
      },
      {},
    )
    const before = collectOwned(ownedDir)
    expect(before.files.map((file) => file.path)).toContain(keyOf(path.join(ownedDir, 'helper.ts')))
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER.replace('return 1', 'throw new Error()'))
    expect(digestOf(collectOwned(ownedDir))).not.toBe(digestOf(before))
  })

  it('follows a literal relative dynamic import', () => {
    // Review RVCM1012C finding 2: a top-level `await import('./helper')`
    // was neither followed nor refused. Literal specifiers are the
    // bundler's own edges, so they land in the closure.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `export function load(): Promise<unknown> {\n  return import('./helper')\n}\n`,
        'helper.ts': HELPER,
      },
      {},
    )
    const before = collectOwned(ownedDir)
    expect(before.files.map((file) => file.path)).toContain(keyOf(path.join(ownedDir, 'helper.ts')))
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER.replace('return 1', 'return 2'))
    expect(digestOf(collectOwned(ownedDir))).not.toBe(digestOf(before))
  })

  it('fails closed on a non-literal dynamic import', () => {
    // The bundler leaves `import(name)` for runtime, outside every hashed
    // edge, so the digest refuses it instead of freezing around it.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `export function load(name: string): Promise<unknown> {\n  return import(name)\n}\n`,
        'helper.ts': HELPER,
      },
      {},
    )
    expect(() => collectOwned(ownedDir)).toThrow(/non-literal dynamic import/)
  })

  it('fails closed on a non-literal require', () => {
    // The same runtime hole through the call the bundler cannot see.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `export function load(name: string): unknown {\n  return require(name)\n}\n`,
        'helper.ts': HELPER,
      },
      {},
    )
    expect(() => collectOwned(ownedDir)).toThrow(/non-literal dynamic import/)
  })

  it('fails closed on a template-substitution dynamic import', () => {
    // Review RVCM1012D finding 1: the strip pass replaced every template
    // with `""`, so `import(`${name}`)` read as `import("")` and a helper
    // mutation left the digest identical. The parser sees the
    // substitution, not a literal.
    const { ownedDir } = makeTree(
      {
        'arm.ts': [
          'export function load(name: string): Promise<unknown> {',
          '  return import(`${name}`)',
          '}',
          '',
        ].join('\n'),
        'helper.ts': HELPER,
      },
      {},
    )
    expect(() => collectOwned(ownedDir)).toThrow(/non-literal dynamic import/)
    // The refusal names the file and the 1-based line of the load.
    expect(() => collectOwned(ownedDir)).toThrow(/arm\.ts:2/)
  })

  it('fails closed on a concatenated dynamic import', () => {
    // `import("pre" + name)` starts with a quote, which the old scan
    // likewise accepted; the parser sees the concatenation, not a literal.
    const { ownedDir } = makeTree(
      {
        'arm.ts': `export function load(name: string): Promise<unknown> {\n  return import("pre" + name)\n}\n`,
        'helper.ts': HELPER,
      },
      {},
    )
    expect(() => collectOwned(ownedDir)).toThrow(/non-literal dynamic import/)
  })

  it('fails closed on every indirect require spelling, literal or not', () => {
    // Review RVCM1012D finding 1: the bundler leaves each of these for
    // runtime even with a literal specifier (probed on this rig:
    // `module.require`, `createRequire(…)(…)` and `new Worker(…)` never
    // land in the metafile), so every form is refused, literal or not.
    const arms: Record<string, string> = {
      'module.require': `export function load(name: string): unknown {\n  return module.require(name)\n}\n`,
      'literal module.require': `export function load(): unknown {\n  return module.require('./helper')\n}\n`,
      'optional require': `export function load(name: string): unknown {\n  return require?.(name)\n}\n`,
      'require alias': `const req = require\nexport function load(name: string): unknown {\n  return req(name)\n}\n`,
      'literal require alias': `const req = require\nexport function load(): unknown {\n  return req('./helper')\n}\n`,
      'createRequire result': `import { createRequire } from 'node:module'\nexport function load(name: string): unknown {\n  return createRequire(import.meta.url)(name)\n}\n`,
      'literal createRequire result': `import { createRequire } from 'node:module'\nexport function load(): unknown {\n  return createRequire(import.meta.url)('./helper')\n}\n`,
      'require.call': `export function load(name: string): unknown {\n  return require.call(null, name)\n}\n`,
    }
    for (const [label, arm] of Object.entries(arms)) {
      const { ownedDir } = makeTree({ 'arm.ts': arm, 'helper.ts': HELPER }, {})
      expect(() => collectOwned(ownedDir), label).toThrow(/leaves for runtime/)
    }
  })

  it('fails closed on every review-RVCM1012E spelling', () => {
    // Review RVCM1012E finding 1 (the TS walk's class) and finding 2
    // (two-argument URL, import.meta.resolve): each spelling below was
    // probed against esbuild 0.28.2 under the digest's own options and
    // leaves the helper out of the metafile, so the collector must refuse
    // it with file and line instead of freezing around it.
    const tree = mkdtempSync(path.join(tmpdir(), 'arm-sources-'))
    trees.push(tree)
    const ownedDir = path.join(tree, 'owned')
    mkdirSync(ownedDir, { recursive: true })
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER)
    const refusals: readonly (readonly [string, string, RegExp])[] = [
      [
        'import.defer(name)',
        `export function load(name: string): Promise<unknown> {\n  return import.defer(name)\n}\n`,
        /leaves for runtime/,
      ],
      [
        'import.defer(name as string)',
        `export function load(name: string): Promise<unknown> {\n  return import.defer(name as string)\n}\n`,
        /leaves for runtime/,
      ],
      [
        'function-local require alias',
        `export function load(): unknown {\n  const req = require\n  return req('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'assigned require alias',
        `let req: typeof require\nexport function setup(): void {\n  req = require\n}\nexport function load(): unknown {\n  return req('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'destructured require',
        `const { require: req } = module\nexport function load(): unknown {\n  return req('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'comma-sequence require',
        `export function load(): unknown {\n  return (0, require)('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        "module['require']",
        `export function load(): unknown {\n  return module['require']('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'module.require.call',
        `export function load(): unknown {\n  return module.require.call(null, './helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        "require['apply']",
        `export function load(): unknown {\n  return require['apply'](null, ['./helper.js'])\n}\n`,
        /leaves for runtime/,
      ],
      [
        'alias.call',
        `const req = require\nexport function load(): unknown {\n  return req.call(null, './helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'renamed createRequire',
        `import { createRequire as cr } from 'node:module'\nexport function load(): unknown {\n  return cr(import.meta.url)('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'namespaced createRequire',
        `import * as mod from 'node:module'\nexport function load(): unknown {\n  return mod.createRequire(import.meta.url)('./helper.js')\n}\n`,
        /leaves for runtime/,
      ],
      [
        'parenthesized Worker',
        `export function start(): unknown {\n  return new ((Worker))('./helper.js')\n}\n`,
        /Worker load/,
      ],
      [
        'cast Worker',
        `export function start(): unknown {\n  return new (Worker as any)('./helper.js')\n}\n`,
        /Worker load/,
      ],
      [
        'namespaced Worker',
        `import * as wt from 'node:worker_threads'\nexport function start(): unknown {\n  return new wt.Worker('./helper.js')\n}\n`,
        /Worker load/,
      ],
      [
        'renamed Worker',
        `import { Worker as Thread } from 'node:worker_threads'\nexport function start(): unknown {\n  return new Thread('./helper.js')\n}\n`,
        /Worker load/,
      ],
      [
        'aliased Worker',
        `import { Worker } from 'node:worker_threads'\nconst Maker = Worker\nexport function start(): unknown {\n  return new Maker('./helper.js')\n}\n`,
        /Worker load/,
      ],
      [
        'read through require.resolve',
        `import { readFileSync } from 'node:fs'\nexport function load(): string {\n  return readFileSync(require.resolve('./helper.js'), 'utf8')\n}\n`,
        /deferred module resolution/,
      ],
      [
        'destructured resolve',
        `const { resolve } = require\nexport function load(): unknown {\n  return resolve('./helper.js')\n}\n`,
        /deferred module resolution/,
      ],
      [
        'import.meta.resolve literal',
        `export const target: unknown = import.meta.resolve('./helper.ts')\n`,
        /deferred module resolution/,
      ],
      [
        'import.meta.resolve(name)',
        `export function load(name: string): unknown {\n  return import.meta.resolve(name)\n}\n`,
        /deferred module resolution/,
      ],
      [
        'two-argument URL literal',
        `export const url = new URL('./helper.ts', import.meta.url)\n`,
        /module-relative URL/,
      ],
      [
        'two-argument URL(name)',
        `export function locate(name: string): URL {\n  return new URL(name, import.meta.url)\n}\n`,
        /module-relative URL/,
      ],
      [
        'relative file read',
        `import { readFileSync } from 'node:fs'\nexport function load(): string {\n  return readFileSync('./helper.ts', 'utf8')\n}\n`,
        /outside the resolved closure/,
      ],
      [
        'namespaced relative file read',
        `import * as fs from 'node:fs'\nexport function load(): string {\n  return fs.readFileSync('./helper.ts', 'utf8')\n}\n`,
        /outside the resolved closure/,
      ],
      [
        'eval',
        `export function load(name: string): unknown {\n  return eval(name)\n}\n`,
        /dynamic evaluation/,
      ],
      [
        'new Function',
        `export function load(name: string): unknown {\n  return new Function(name)\n}\n`,
        /dynamic evaluation/,
      ],
    ]
    for (const [label, arm, pattern] of refusals) {
      writeFileSync(path.join(ownedDir, 'arm.ts'), arm)
      expect(() => collectOwned(ownedDir), label).toThrow(pattern)
      expect(() => collectOwned(ownedDir), label).toThrow(/arm\.ts:\d/)
    }
  })

  it('fails closed at the build on loads the bundler rejects outright', () => {
    // Literal and static `import.defer` never reach the walk: esbuild
    // 0.28.2 fails the cjs build on both (probed), as it does on a comma
    // sequence around `import`. Each still fails the digest, never freezes.
    const cases: Record<string, string> = {
      'literal import.defer': `export function load(): Promise<unknown> {\n  return import.defer('./helper')\n}\n`,
      'static import defer': `import defer * as helper from './helper'\nexport const arm = helper\n`,
      'sequenced import': `export function load(): Promise<unknown> {\n  return (0, import)('./helper')\n}\n`,
    }
    for (const [label, arm] of Object.entries(cases)) {
      const { ownedDir } = makeTree({ 'arm.ts': arm, 'helper.ts': HELPER }, {})
      expect(() => collectOwned(ownedDir), label).toThrow(/cannot resolve the arms from/)
    }
  })

  it('leaves the honest neighbours alone', () => {
    // The rule above refuses loads, not lookalikes: a bare platform
    // require, `path`'s own resolve, a computed file read (the loader
    // itself reads its closure inputs that way), a `Function` type
    // annotation and a one-argument URL all collect clean.
    const tree = mkdtempSync(path.join(tmpdir(), 'arm-sources-'))
    trees.push(tree)
    const ownedDir = path.join(tree, 'owned')
    mkdirSync(ownedDir, { recursive: true })
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER)
    const neighbours: Record<string, string> = {
      'bare platform require': `const fs = require('node:fs')\nexport const arm = typeof fs\n`,
      'path resolve': `const { resolve } = require('path')\nexport const arm = resolve('a', 'b')\n`,
      'computed file read': `import { readFileSync } from 'node:fs'\nexport function load(file: string): string {\n  return readFileSync(file, 'utf8')\n}\n`,
      'Function annotation': `export function run(task: Function): unknown {\n  return typeof task\n}\n`,
      'absolute file read': `import { readFileSync } from 'node:fs'\nexport function load(): string {\n  return readFileSync('/etc/hostname', 'utf8')\n}\n`,
    }
    for (const [label, arm] of Object.entries(neighbours)) {
      writeFileSync(path.join(ownedDir, 'arm.ts'), arm)
      expect(
        collectOwned(ownedDir).files.map((file) => file.path),
        label,
      ).toEqual([keyOf(path.join(ownedDir, 'arm.ts'))])
    }
  })

  it('fails closed on a Worker load, literal or not', () => {
    // Probed on this rig: even `new Worker('./helper')` never lands in
    // the metafile, so the worker file would decide the arm outside the
    // digest. `new URL(…)` alone is not refused: it parses data and loads
    // no file (zod's own schemas do exactly this, and the real closure
    // scans clean) — a URL nested in a loader is already refused above.
    for (const spec of ['name', "'./helper'"]) {
      const { ownedDir } = makeTree(
        {
          'arm.ts': `export function start(name: string): unknown {\n  return new Worker(${spec})\n}\n`,
          'helper.ts': HELPER,
        },
        {},
      )
      expect(() => collectOwned(ownedDir), spec).toThrow(/Worker load/)
    }
  })

  it('leaves validating URL constructions alone', () => {
    const { ownedDir } = makeTree(
      {
        'arm.ts': `export function check(input: string): boolean {\n  try {\n    new URL(input)\n    return true\n  } catch {\n    return false\n  }\n}\n`,
      },
      {},
    )
    expect(collectOwned(ownedDir).files.map((file) => file.path)).toEqual([
      keyOf(path.join(ownedDir, 'arm.ts')),
    ])
  })

  it('refuses every generated load spelling the bundler cannot see', () => {
    // Property sweep over the finding's class: loader forms (direct,
    // indirect, worker) against specifier forms (literal spellings,
    // interpolation, concatenation, bare names). A literal through a
    // direct loader collects the helper, because the bundler follows it;
    // everything else fails closed, because it runs at runtime outside
    // every hashed edge.
    const preludes: Record<string, string> = {
      'require alias': 'const req = require\n',
      createRequire: "import { createRequire } from 'node:module'\n",
    }
    const loaders: Record<string, { call: (spec: string) => string; indirect: boolean }> = {
      import: { call: (spec) => `import(${spec})`, indirect: false },
      require: { call: (spec) => `require(${spec})`, indirect: false },
      'module.require': { call: (spec) => `module.require(${spec})`, indirect: true },
      'optional require': { call: (spec) => `require?.(${spec})`, indirect: true },
      'require alias': { call: (spec) => `req(${spec})`, indirect: true },
      createRequire: { call: (spec) => `createRequire(import.meta.url)(${spec})`, indirect: true },
      'require.call': { call: (spec) => `require.call(null, ${spec})`, indirect: true },
      worker: { call: (spec) => `new Worker(${spec})`, indirect: true },
    }
    const literals = new Set(["'./helper'", '"./helper"', '`./helper`'])
    const nonLiterals = ['name', '`${name}`', '`./${name}`', '"pre" + name', '"./" + name']
    const tree = mkdtempSync(path.join(tmpdir(), 'arm-sources-'))
    trees.push(tree)
    const ownedDir = path.join(tree, 'owned')
    mkdirSync(ownedDir, { recursive: true })
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER)
    for (const [loaderName, loader] of Object.entries(loaders)) {
      for (const spec of [...literals, ...nonLiterals]) {
        const label = `${loaderName}(${spec})`
        writeFileSync(
          path.join(ownedDir, 'arm.ts'),
          `${preludes[loaderName] ?? ''}export function load(name: string): unknown {\n  return ${loader.call(spec)}\n}\n`,
        )
        if (!loader.indirect && literals.has(spec)) {
          expect(
            collectOwned(ownedDir).files.map((file) => file.path),
            label,
          ).toContain(keyOf(path.join(ownedDir, 'helper.ts')))
        } else if (loader.indirect) {
          expect(() => collectOwned(ownedDir), label).toThrow(/leaves for runtime/)
        } else {
          expect(() => collectOwned(ownedDir), label).toThrow(/non-literal dynamic import/)
        }
      }
    }
    // The allowed side moves the digest too: a helper mutation under a
    // literal `require` — the bundler's own edge — changes the closure.
    writeFileSync(
      path.join(ownedDir, 'arm.ts'),
      `export const answer: unknown = require('./helper')\n`,
    )
    const before = digestOf(collectOwned(ownedDir))
    expect(collectOwned(ownedDir).files.map((file) => file.path)).toContain(
      keyOf(path.join(ownedDir, 'helper.ts')),
    )
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER.replace('return 1', 'return 2'))
    expect(digestOf(collectOwned(ownedDir))).not.toBe(before)
  })

  it('sees loads through comment, string and regex camouflage', () => {
    // Call-like text in comments, strings, templates and regex literals
    // is never a load; a real non-literal load beside it still fails
    // closed. The old strip pass is gone; the parser never confuses the
    // two, in either direction.
    const camouflage = [
      '// import(helper) and require(helper) and a "quoted" call',
      '/* import(`./helper`) and require("./helper") */',
      'const decoy = "import(name) require(name)"',
      String.raw`const pattern = /import\(name\)/`,
      'const template = `import(name) ${decoy}`',
    ].join('\n')
    const clean = makeTree(
      {
        'arm.ts': `${camouflage}\nexport const arm = pattern.source + template\n`,
      },
      {},
    )
    expect(
      collectArmSources([path.join(clean.ownedDir, 'arm.ts')]).files.map((file) => file.path),
    ).toEqual([keyOf(path.join(clean.ownedDir, 'arm.ts'))])
    const dirty = makeTree(
      {
        'arm.ts': `${camouflage}\nexport function load(name: string): Promise<unknown> {\n  return import(name)\n}\n`,
      },
      {},
    )
    expect(() => collectOwned(dirty.ownedDir)).toThrow(/non-literal dynamic import/)
  })

  it('resolves a directory import to its index, like the build does', () => {
    // Review RVCM1012C finding 3: the hand resolver returned the
    // directory itself and died reading it. The real resolver reaches
    // the index file.
    const tree = mkdtempSync(path.join(tmpdir(), 'arm-sources-'))
    trees.push(tree)
    const ownedDir = path.join(tree, 'owned')
    mkdirSync(path.join(ownedDir, 'helpers'), { recursive: true })
    writeFileSync(
      path.join(ownedDir, 'arm.ts'),
      `import { helper } from './helpers'\nexport const arm = helper\n`,
    )
    writeFileSync(path.join(ownedDir, 'helpers', 'index.ts'), HELPER)
    const sources = collectArmSources([path.join(ownedDir, 'arm.ts')])
    expect(sources.files.map((file) => file.path)).toContain(
      keyOf(path.join(ownedDir, 'helpers', 'index.ts')),
    )
  })

  it('covers a namespace import of an outside file', () => {
    // No named-binding machinery remains to demand named imports: every
    // edge the bundler follows is hashed by bytes.
    const { ownedDir, externalDir } = makeTree(
      {
        'arm.ts': `import * as values from '../external/values'\nexport const arm = values.answer\n`,
        'helper.ts': HELPER,
      },
      { 'values.ts': VALUES },
    )
    const sources = collectOwned(ownedDir)
    expect(sources.files.map((file) => file.path)).toContain(
      keyOf(path.join(externalDir, 'values.ts')),
    )
  })

  it('ignores files nothing imports', () => {
    const { ownedDir } = makeTree(
      { 'arm.ts': ARM, 'helper.ts': HELPER, 'stray.ts': `export const stray = true\n` },
      { 'values.ts': VALUES },
    )
    const before = collectOwned(ownedDir)
    expect(before.files.map((file) => file.path)).not.toContain(
      keyOf(path.join(ownedDir, 'stray.ts')),
    )
    rmSync(path.join(ownedDir, 'stray.ts'))
    const after = collectOwned(ownedDir)
    expect(digestOf(after)).toBe(digestOf(before))
    expect(after.files.map((file) => file.path)).toEqual([
      keyOf(path.join(path.dirname(ownedDir), 'external', 'values.ts')),
      keyOf(path.join(ownedDir, 'arm.ts')),
      keyOf(path.join(ownedDir, 'helper.ts')),
    ])
  })

  it('ignores import-looking text inside strings and comments', () => {
    const { ownedDir } = makeTree(
      {
        'arm.ts': `const phantom = "import { ghost } from './ghost'"\n// import { wraith } from './wraith'\n/* import { specter } from './specter' */\nconst loader = "import(name)"\nexport const arm = phantom + loader\n`,
      },
      {},
    )
    const sources = collectArmSources([path.join(ownedDir, 'arm.ts')])
    expect(sources.files.map((file) => file.path)).toEqual([keyOf(path.join(ownedDir, 'arm.ts'))])
  })

  it('fails closed on a missing file', () => {
    const { ownedDir } = makeTree({ 'arm.ts': `import './absent'\n` }, {})
    expect(() => collectArmSources([path.join(ownedDir, 'arm.ts')])).toThrow(/cannot resolve/)
  })

  it('keeps an own __proto__ field through canonicalization', () => {
    // Review RVCM1012C finding 4: assigning the canonicalized entry to
    // `out['__proto__']` changed the prototype, so two values differing
    // only in that field serialized identically.
    const first = canonicalize(JSON.parse('{"__proto__":{"enabled":false}}'), 'first')
    const second = canonicalize(JSON.parse('{"__proto__":{"enabled":true}}'), 'second')
    expect(typeof first === 'object' && first !== null && Object.hasOwn(first, '__proto__')).toBe(
      true,
    )
    expect(JSON.stringify(first)).toBe('{"__proto__":{"enabled":false}}')
    expect(JSON.stringify(second)).toBe('{"__proto__":{"enabled":true}}')
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
  })

  it('fails closed on an unhashable canonical value', () => {
    expect(() => canonicalize(Infinity, 'where')).toThrow(/non-finite/)
    expect(() => canonicalize(() => 42, 'where')).toThrow(/non-data/)
    expect(() => canonicalize(undefined, 'where')).toThrow(/non-data/)
    expect(() => canonicalize(new Date(0), 'where')).toThrow(/class instance/)
  })
})
