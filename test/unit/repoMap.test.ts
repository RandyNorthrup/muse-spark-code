// The repo map (M67, PLAN.md D49): files ranked by how often other files
// use the names they define, within a token budget and a time budget, as
// a tool and as the opt-in section of the Model API's system prompt.

import { getEventListeners } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { answerCodeIntel } from '../../src/core/codeIntel/codeIntelTools'
import type { CodeSymbol } from '../../src/core/codeIntel/languageService'
import { repoMapSection } from '../../src/core/codeIntel/repoMap'
import {
  REPO_MAP_CHARS_PER_TOKEN,
  REPO_MAP_MAX_FILE_CHARS,
  REPO_MAP_MAX_FILES,
  REPO_MAP_PROMPT_TOKENS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fakeLanguageService, KIND, sym } from './helpers/fakeLanguageService'
import { memoryToolIo, type MemoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'
const CORE = `${ROOT}/src/core.ts`
const TWO = `${ROOT}/src/two.ts`
const FILES = {
  'src/core.ts': 'export function helper() {}\nexport const TABLE = 1\n',
  'src/one.ts': "import { helper, TABLE } from './core'\nhelper(TABLE)\nhelper()\n",
  'src/two.ts': "import { helper } from './core'\nhelper()\nexport function oneThing() {}\n",
  'src/three.ts': 'oneThing()\n',
}
const DEFINED: Readonly<Record<string, readonly CodeSymbol[]>> = {
  helper: [
    sym('helper', KIND.function, CORE, 0, 16),
    sym('helper', KIND.function, '/lib/x.d.ts', 0, 0),
  ],
  TABLE: [sym('TABLE', KIND.constant, CORE, 1, 13)],
  oneThing: [sym('oneThing', KIND.function, TWO, 2, 16)],
}

/** Workspace symbols as a server answers them: the definitions, and near misses for the rest. */
function answers(query: string): Promise<readonly CodeSymbol[]> {
  return Promise.resolve(DEFINED[query] ?? [sym(`${query}Like`, KIND.variable, CORE, 0, 0)])
}

function setup(
  options: {
    readonly io?: MemoryToolIo
    readonly workspace?: (query: string) => Promise<readonly CodeSymbol[]>
    readonly now?: () => number
  } = {},
) {
  const io = options.io ?? memoryToolIo(FILES, ROOT)
  const service = fakeLanguageService({ files: io.files, workspace: options.workspace ?? answers })
  const deps: CodeIntelDeps = {
    service,
    workspaceRoot: ROOT,
    platform: 'linux',
    io,
    now: options.now ?? (() => 0),
  }
  return {
    service,
    deps,
    map: async (args: unknown = {}) => {
      const answer = await answerCodeIntel('repoMap', args, deps)
      return answer.ok ? answer.text : `refused: ${answer.reason} / ${answer.visibleReason}`
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('repo map', () => {
  it('ranks the files other files use most, with their most used definitions', async () => {
    const t = setup()
    const text = await t.map()
    expect(text.split('\n').slice(1)).toEqual([
      'src/core.ts',
      '  1: function helper',
      '  2: constant TABLE',
      'src/two.ts',
      '  3: function oneThing',
    ])
    expect(text).not.toContain('x.d.ts')
  })

  it('keeps all its text within the token budget and counts the files left out', async () => {
    const t = setup()
    const text = await t.map({ max_tokens: 60 })
    expect(text).toContain('src/core.ts')
    expect(text).not.toContain('src/two.ts')
    expect(text).toContain('[1 more not shown]')
    // The lead and the count of the files left out are counted too.
    for (const tokens of [46, 59, 60, 62, 63]) {
      const answer = await t.map({ max_tokens: tokens })
      expect(answer).not.toContain('refused')
      expect(answer.length).toBeLessThanOrEqual(tokens * 4)
    }
    expect(await t.map({ max_tokens: 46 })).toContain('[2 more not shown]')
    // A budget that cannot hold even those says what would.
    const refusal =
      "max_tokens 1 cannot hold the map's own lead and notes; ask again with max_tokens of at least 46"
    expect(await t.map({ max_tokens: 0 })).toBe(`refused: ${refusal} / ${refusal}`)
    const alone = setup({ io: memoryToolIo({ 'solo.ts': 'const lonely = 1\n' }, ROOT) })
    expect(await alone.map({ max_tokens: 5 })).toContain('refused: max_tokens 5 cannot hold')
  })

  it('says when no language service answers, and when no file ranks', async () => {
    const none = setup({ workspace: () => Promise.resolve([]) })
    expect(await none.map()).toContain(`refused: no language service answered workspace symbols`)
    expect(await none.map()).toContain(UI_TEXT.repoMapNoService)
    const alone = setup({ io: memoryToolIo({ 'solo.ts': 'const lonely = 1\n' }, ROOT) })
    expect(await alone.map()).toBe(
      'No workspace file defines a name that other files use, as far as the workspace symbols show.',
    )
    expect(await repoMapSection(alone.deps, new AbortController().signal)).toBeUndefined()
  })

  it('stops its lookups at the time budget and says the map is partial', async () => {
    const names = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    const files = Object.fromEntries(
      Array.from({ length: 3 }, (_, index) => [`f${String(index)}.ts`, names]),
    )
    let clock = 0
    const slow = setup({
      io: memoryToolIo(files, ROOT),
      now: () => clock,
      workspace: (query) => {
        clock += 6000
        return answers(query)
      },
    })
    expect(await slow.map()).toContain('[partial: looked up 8 of 10 names within the time budget]')
    vi.useFakeTimers()
    const stuck = setup({ workspace: () => new Promise(() => undefined) })
    const pending = stuck.map()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toContain('[partial: looked up 0 of 8 names within the time budget]')
  })

  it('keeps nothing from a batch the time cut off, and calls a cut map partial, not unserved', async () => {
    // One lookup of the batch never answers: the others' definitions, found
    // before the cut, stay out of the map the note says was not looked up.
    vi.useFakeTimers()
    const cut = setup({
      workspace: (query) => (query === 'import' ? new Promise(() => undefined) : answers(query)),
    })
    const pending = cut.map()
    await vi.advanceTimersByTimeAsync(10_000)
    const text = await pending
    expect(text).not.toContain('src/core.ts')
    expect(text).toContain('[partial: looked up 0 of')
    vi.useRealTimers()
    // Lookups that found nothing before the time ran out: a partial map.
    const names = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet'
    let clock = 0
    const empty = setup({
      io: memoryToolIo({ 'f0.ts': names, 'f1.ts': names }, ROOT),
      now: () => clock,
      workspace: () => {
        clock += 6000
        return Promise.resolve([])
      },
    })
    const partial = await empty.map()
    expect(partial).not.toContain('refused')
    expect(partial).toContain('[partial: looked up 8 of 10 names within the time budget]')
  })

  it('says how many files it read when the reading runs out of time, or the listing does', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`f${String(index).padStart(2, '0')}.ts`, 'shared']),
    )
    const io = memoryToolIo(files, ROOT)
    let clock = 0
    const readFile = io.readFile
    io.readFile = async (path, expected) => {
      clock += 1000
      return await readFile(path, expected)
    }
    const slow = setup({ io, now: () => clock })
    expect(await slow.map()).toContain('[partial: read 16 of 20 files within the time budget]')
    vi.useFakeTimers()
    const unlisted = memoryToolIo(FILES, ROOT)
    unlisted.listFiles = () => new Promise(() => undefined)
    const pending = setup({ io: unlisted }).map()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await pending).toContain(
      "[partial: the workspace's files were not listed within the time budget]",
    )
  })

  it('leaves no listener on the turn signal, however many maps it makes', async () => {
    const turn = new AbortController()
    const t = setup()
    for (let index = 0; index < 12; index += 1) {
      await repoMapSection(t.deps, turn.signal)
    }
    expect(getEventListeners(turn.signal, 'abort')).toHaveLength(0)
  })

  it('reads confined UTF-8 files only, up to its caps', async () => {
    const files: Record<string, string> = {
      ...FILES,
      'big.ts': 'helper '.repeat(REPO_MAP_MAX_FILE_CHARS),
    }
    for (let index = 0; index < REPO_MAP_MAX_FILES; index += 1) {
      files[`z/${String(index).padStart(4, '0')}.ts`] = 'x'
    }
    const io = memoryToolIo(files, ROOT)
    const unreadable = `${ROOT}/src/one.ts`
    const readFile = io.readFile
    io.readFile = (path, expected) =>
      path === unreadable ? Promise.reject(new Error('not UTF-8')) : readFile(path, expected)
    const text = await setup({ io }).map()
    expect(text).toContain(
      `[ranked the first ${String(REPO_MAP_MAX_FILES)} of ${String(REPO_MAP_MAX_FILES + 5)} files]`,
    )
    // Without one.ts, and with big.ts left out, only two.ts uses helper.
    expect(text).toContain('src/core.ts\n  1: function helper')
    expect(text).not.toContain('TABLE')
  })

  it('makes the system prompt section, or nothing once a Stop has come', async () => {
    const t = setup()
    const section = await repoMapSection(t.deps, new AbortController().signal)
    expect(section?.startsWith('# Repo map\n\nThe workspace as this session began')).toBe(true)
    expect(section).toContain('src/core.ts')
    const stopped = new AbortController()
    stopped.abort()
    const quiet = setup()
    expect(await repoMapSection(quiet.deps, stopped.signal)).toBeUndefined()
    expect(quiet.service.asked.some((call) => call.startsWith('workspace'))).toBe(false)
  })

  it('keeps the whole prompt section, its heading included, within its budget', async () => {
    // 150 files each defining a name another file uses: far more than fits.
    const names = Array.from({ length: 150 }, (_, index) => `definedInFile${String(index)}`)
    const files: Record<string, string> = { 'src/user.ts': names.join('\n') }
    for (const [index, name] of names.entries()) {
      files[`src/d${String(index)}.ts`] = `export function ${name}() {}\n`
    }
    const many = setup({
      io: memoryToolIo(files, ROOT),
      workspace: (query) => {
        const index = names.indexOf(query)
        return Promise.resolve(
          index === -1
            ? []
            : [sym(query, KIND.function, `${ROOT}/src/d${String(index)}.ts`, 0, 16)],
        )
      },
    })
    const section = await repoMapSection(many.deps, new AbortController().signal)
    expect(section).toContain('more not shown]')
    expect(section?.length).toBeLessThanOrEqual(REPO_MAP_PROMPT_TOKENS * REPO_MAP_CHARS_PER_TOKEN)
  })
})
