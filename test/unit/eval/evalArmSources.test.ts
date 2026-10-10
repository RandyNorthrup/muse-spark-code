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
