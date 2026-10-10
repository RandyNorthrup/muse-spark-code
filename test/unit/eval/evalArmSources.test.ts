// The frozen arms' source closure (review RVCM1012B finding 1): the digest
// must cover every byte that decides an arm, discovered through the import
// graph rather than a hand-kept file list, so a new helper an arm imports
// moves the digest without anyone updating a list.

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectArmSources } from '../../../src/core/eval/armSources'

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

function collectOwned(ownedDir: string, externalDir: string, table?: Record<string, unknown>) {
  const answerKey = keyOf(path.join(externalDir, 'values.ts'))
  return collectArmSources([path.join(ownedDir, 'arm.ts')], {
    [answerKey]: table ?? { answer: 42 },
  })
}

/** The standard scratch harness: an arm importing an owned helper and one outside value. */
function makeArmTree(): { ownedDir: string; externalDir: string } {
  return makeTree({ 'arm.ts': ARM, 'helper.ts': HELPER }, { 'values.ts': VALUES })
}

describe('the frozen arms source closure', () => {
  it('covers the arm implementation files, and nothing else', () => {
    // The walker itself is in the closure: mechanisms.ts reaches it, so a
    // change to the walk moves the digest too. The driver and the production
    // host stay out: the harness measures them rather than freezing them.
    expect(collectArmSources().files.map((file) => file.path)).toEqual([
      'src/core/eval/armSources.ts',
      'src/core/eval/heldDeps.ts',
      'src/core/eval/mechanisms.ts',
      'src/core/eval/tasks.ts',
    ])
  })

  it('covers the outside bindings the arms draw, by value', () => {
    expect(collectArmSources().values.map((value) => [value.module, value.name])).toEqual([
      ['src/core/providers/capabilities.ts', 'CONSERVATIVE_CAPABILITIES'],
      ['src/core/providers/presets.ts', 'FORMAT_QUIRKS'],
      ['src/shared/constants.ts', 'EVAL_APPROVAL_MODE'],
      ['src/shared/constants.ts', 'EVAL_ARM_SOURCE_SEARCH_DEPTH'],
      ['src/shared/constants.ts', 'EVAL_COMPACT_BULK_LINES'],
      ['src/shared/constants.ts', 'EVAL_COMPACT_BULK_LINE_CHARS'],
      ['src/shared/constants.ts', 'EVAL_COMPACT_VALUE_LINE'],
      ['src/shared/constants.ts', 'EVAL_COMPACT_WINDOW_TOKENS'],
      ['src/shared/constants.ts', 'EVAL_LONG_EVIDENCE_LINES'],
      ['src/shared/constants.ts', 'EVAL_LONG_EVIDENCE_LINE_CHARS'],
      ['src/shared/constants.ts', 'EVAL_LONG_EVIDENCE_MIDDLE_LINE'],
      ['src/shared/constants.ts', 'EVAL_LONG_EVIDENCE_RECALL_OFFSET'],
      ['src/shared/constants.ts', 'EVAL_SPLITS'],
      ['src/shared/constants.ts', 'MODEL_API_CONTEXT_WINDOW'],
      ['src/shared/constants.ts', 'OBS_PACK_THRESHOLD_CHARS'],
      ['src/shared/constants.ts', 'OBS_PACK_WHOLE_SENDS'],
    ])
  })

  it('collects the same closure twice', () => {
    expect(JSON.stringify(collectArmSources())).toBe(JSON.stringify(collectArmSources()))
  })

  it('discovers an owned helper and hashes the outside binding by value', () => {
    const { ownedDir, externalDir } = makeArmTree()
    const sources = collectOwned(ownedDir, externalDir)
    expect(sources.files.map((file) => file.path)).toEqual([
      keyOf(path.join(ownedDir, 'arm.ts')),
      keyOf(path.join(ownedDir, 'helper.ts')),
    ])
    expect(sources.values).toEqual([
      { module: keyOf(path.join(externalDir, 'values.ts')), name: 'answer', json: 42 },
    ])
  })

  it('moves when the helper implementation changes but the arm does not', () => {
    const { ownedDir, externalDir } = makeArmTree()
    const before = digestOf(collectOwned(ownedDir, externalDir))
    writeFileSync(path.join(ownedDir, 'helper.ts'), HELPER.replace('return 1', 'return 2'))
    const after = digestOf(collectOwned(ownedDir, externalDir))
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toBe(ARM)
    expect(after).not.toBe(before)
  })

  it('discovers a newly added helper through the existing import edge', () => {
    const { ownedDir, externalDir } = makeArmTree()
    const before = digestOf(collectOwned(ownedDir, externalDir))
    writeFileSync(path.join(ownedDir, 'bonus.ts'), `export const bonus = 'new helper'\n`)
    writeFileSync(
      path.join(ownedDir, 'helper.ts'),
      `import { bonus } from './bonus'\n${HELPER}export const helped = bonus\n`,
    )
    const sources = collectOwned(ownedDir, externalDir)
    expect(readFileSync(path.join(ownedDir, 'arm.ts'), 'utf8')).toBe(ARM)
    expect(sources.files.map((file) => file.path)).toContain(keyOf(path.join(ownedDir, 'bonus.ts')))
    expect(digestOf(sources)).not.toBe(before)
  })

  it('ignores files nothing imports', () => {
    const { ownedDir, externalDir } = makeTree(
      { 'arm.ts': ARM, 'helper.ts': HELPER, 'stray.ts': `export const stray = true\n` },
      { 'values.ts': VALUES },
    )
    const before = collectOwned(ownedDir, externalDir)
    expect(before.files.map((file) => file.path)).not.toContain(
      keyOf(path.join(ownedDir, 'stray.ts')),
    )
    rmSync(path.join(ownedDir, 'stray.ts'))
    const after = collectOwned(ownedDir, externalDir)
    expect(digestOf(after)).toBe(digestOf(before))
    expect(after.files.map((file) => file.path)).toEqual([
      keyOf(path.join(ownedDir, 'arm.ts')),
      keyOf(path.join(ownedDir, 'helper.ts')),
    ])
  })

  it('ignores import-looking text inside strings and comments', () => {
    const { ownedDir } = makeTree(
      {
        'arm.ts': `const phantom = "import { ghost } from './ghost'"\n// import { wraith } from './wraith'\n/* import { specter } from './specter' */\nexport const arm = phantom\n`,
      },
      {},
    )
    const sources = collectArmSources([path.join(ownedDir, 'arm.ts')], {})
    expect(sources.files.map((file) => file.path)).toEqual([keyOf(path.join(ownedDir, 'arm.ts'))])
    expect(sources.values).toEqual([])
  })

  it('fails closed on a missing file', () => {
    const { ownedDir } = makeTree({ 'arm.ts': `import './absent'\n` }, {})
    expect(() => collectArmSources([path.join(ownedDir, 'arm.ts')], {})).toThrow(/cannot resolve/)
  })

  it('fails closed on an unlisted outside module', () => {
    const { ownedDir, externalDir } = makeTree(
      { 'arm.ts': `import { secret } from '../external/secret'\nexport const arm = secret\n` },
      { 'secret.ts': `export const secret = 1\n` },
    )
    expect(() => collectOwned(ownedDir, externalDir)).toThrow(/cannot cover/)
  })

  it('fails closed on a function-valued outside binding', () => {
    const { ownedDir, externalDir } = makeArmTree()
    expect(() => collectOwned(ownedDir, externalDir, { answer: () => 42 })).toThrow(
      /belongs in src\/core\/eval/,
    )
  })

  it('fails closed on a namespace import of an outside module', () => {
    const { ownedDir, externalDir } = makeTree(
      {
        'arm.ts': `import * as values from '../external/values'\nexport const arm = values.answer\n`,
        'helper.ts': HELPER,
      },
      { 'values.ts': VALUES },
    )
    expect(() => collectOwned(ownedDir, externalDir)).toThrow(/named imports/)
  })

  it('resolves aliases to module-side names and skips inline types', () => {
    const { ownedDir, externalDir } = makeTree(
      {
        'arm.ts': `import { answer as result, type Missing } from '../external/values'\nexport const arm = result\n`,
      },
      { 'values.ts': VALUES },
    )
    const sources = collectOwned(ownedDir, externalDir)
    expect(sources.values).toEqual([
      { module: keyOf(path.join(externalDir, 'values.ts')), name: 'answer', json: 42 },
    ])
  })

  it('fails closed on a non-finite outside value', () => {
    const { ownedDir, externalDir } = makeArmTree()
    expect(() => collectOwned(ownedDir, externalDir, { answer: Infinity })).toThrow(/non-finite/)
  })
})
