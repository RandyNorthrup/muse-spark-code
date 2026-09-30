// The read-only code intelligence tools (M67, PLAN.md D49) over a fake of
// VS Code's language services: confined inputs, workspace-relative,
// sorted and capped answers that count what they leave out, lookups by
// name, and "no language service" instead of an empty answer.

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CodeIntelDeps } from '../../src/core/codeIntel/codeIntelQuery'
import { answerCodeIntel, type CodeIntelReadTool } from '../../src/core/codeIntel/codeIntelTools'
import type { CodeLocation } from '../../src/core/codeIntel/languageService'
import {
  CODE_INTEL_HOVER_MAX_CHARS,
  CODE_INTEL_MAX_LOCATIONS,
  UI_TEXT,
} from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import {
  type FakeServiceOptions,
  fakeLanguageService,
  KIND,
  loc,
  sym,
} from './helpers/fakeLanguageService'
import { memoryToolIo, type MemoryToolIo, realPathThrough } from './helpers/fakeToolIo'

const ROOT = '/ws'
const A = `${ROOT}/src/a.ts`
const B = `${ROOT}/src/b.ts`
const Z = `${ROOT}/src/z.ts`
const LIB = '/lib/lib.d.ts'
const OTHER = '/other/c.ts'
const FILES = {
  'src/a.ts': 'export function greet(name: string): string {\n  return `hi ${name}`\n}\n',
  'src/b.ts': "import { greet } from './a'\ngreet('x')\ngreet('y')\n",
  'src/z.ts': 'greeting\n  greet()\n',
  'notes.txt': 'plain words greet\n',
}
const GREET = sym('greet', KIND.function, A, 0, 16)
const START = { line: 0, character: 0 }

type Options = Omit<FakeServiceOptions, 'files'> & {
  readonly io?: MemoryToolIo
  readonly realPath?: (path: string) => Promise<string>
  /** The folder the workspace is opened as, when not the files' own (a link to it). */
  readonly workspaceRoot?: string
}

function setup(options: Options = {}) {
  const io = options.io ?? memoryToolIo(FILES, ROOT)
  const service = fakeLanguageService({ files: io.files, ...options })
  const deps: CodeIntelDeps = {
    service,
    workspaceRoot: options.workspaceRoot ?? ROOT,
    platform: 'linux',
    io: options.realPath === undefined ? io : { ...io, realPath: options.realPath },
    now: () => 0,
  }
  return {
    io,
    service,
    ask: async (tool: CodeIntelReadTool, args: unknown) => await answerCodeIntel(tool, args, deps),
  }
}

/** The answer's text; fails the test when the call was refused. */
async function textOf(answer: Promise<Awaited<ReturnType<typeof answerCodeIntel>>>) {
  const settled = await answer
  if (!settled.ok) {
    throw new Error(`refused: ${settled.reason}`)
  }
  return settled.text
}

/** The refusal's reason for the model; fails the test when the call was answered. */
async function reasonOf(answer: Promise<Awaited<ReturnType<typeof answerCodeIntel>>>) {
  const refused = await refusalOf(answer)
  return refused.reason
}

/** The refusal's reasons; fails the test when the call was answered. */
async function refusalOf(answer: Promise<Awaited<ReturnType<typeof answerCodeIntel>>>) {
  const settled = await answer
  if (settled.ok) {
    throw new Error(`answered: ${settled.text}`)
  }
  return settled
}

afterEach(() => {
  vi.useRealTimers()
})

describe('find_definition and find_references', () => {
  it('answers workspace-relative places with their lines, and counts what is outside', async () => {
    const t = setup({
      definitions: () => [loc(A, 0, 16), loc(LIB, 5, 0), loc(undefined, 1, 1), loc(OTHER, 0, 0)],
    })
    const text = await textOf(t.ask('findDefinition', { path: 'src/b.ts', line: 2, column: 1 }))
    expect(text).toBe(
      [
        'src/a.ts:1:17: export function greet(name: string): string {',
        '[left out 3 outside the workspace: library declarations or other folders]',
      ].join('\n'),
    )
    expect(t.service.asked).toContain(`definitions ${B} 1:0`)
  })

  it('finds a name on a line, in a file, or among the workspace symbols', async () => {
    const t = setup({
      definitions: () => [loc(A, 0, 16)],
      workspace: [
        sym('greet', KIND.function, Z, 1, 0),
        // As TypeScript gives one: the name with its call parentheses, the
        // range from the start of the declaration.
        { ...GREET, name: 'greet()', selection: { start: START, end: GREET.selection.end } },
        sym('greet', KIND.function, LIB, 0, 0),
        sym('greeter', KIND.class, A, 0, 0),
      ],
    })
    expect(
      await textOf(t.ask('findDefinition', { path: 'src/b.ts', line: 3, symbol: 'greet' })),
    ).toContain('Using `greet` at src/b.ts:3:1.')
    // The first whole-word use in the file: `greeting` is another name.
    expect(await textOf(t.ask('findDefinition', { path: 'src/z.ts', symbol: 'greet' }))).toContain(
      'Using `greet` at src/z.ts:2:3.',
    )
    // By name alone: the first in place order, the provider's range moved to
    // the name, the others listed, and the library's left out.
    const byName = await textOf(t.ask('findDefinition', { symbol: 'greet' }))
    expect(byName).toContain('Using `greet` at src/a.ts:1:17.')
    expect(byName).toContain('Also named `greet`: src/z.ts:2:1.')
    expect(byName).not.toContain('lib')
    expect(t.service.asked).toContain(`definitions ${A} 0:16`)
  })

  it('refuses arguments that name nothing, or a place outside the workspace', async () => {
    const io = memoryToolIo(FILES, ROOT, undefined, { linked: '/elsewhere' })
    const t = setup({ io })
    const reasons = await Promise.all(
      [
        {},
        { path: 'src/b.ts' },
        { path: 'src/b.ts', column: 2 },
        { path: 'src/b.ts', line: 0, column: 1 },
        { path: 'src/b.ts', line: 1.5, column: 1 },
        { path: 'src/b.ts', symbol: 'absent' },
        { path: 'src/b.ts', line: 1, symbol: 'nowhere' },
        { symbol: 'unknown' },
        { symbol: 'two\nlines' },
        { path: '../etc/passwd', line: 1, column: 1 },
        { path: 'linked/x.ts', line: 1, column: 1 },
        { path: 7 },
      ].map(async (args) => await reasonOf(t.ask('findReferences', args))),
    )
    expect(reasons).toEqual([
      expect.stringContaining('name the symbol by path, line and column'),
      expect.stringContaining('name the symbol by path, line and column'),
      'line and column must be whole numbers from 1',
      'line and column must be whole numbers from 1',
      'line and column must be whole numbers from 1',
      '`absent` does not occur in src/b.ts',
      '`nowhere` does not occur in src/b.ts:1',
      expect.stringContaining('no workspace symbol is named `unknown`'),
      'symbol must be a single line of 1 to 200 characters',
      'path ../etc/passwd is outside the workspace',
      'path linked/x.ts leads outside the workspace through a link',
      expect.stringContaining('invalid arguments'),
    ])
  })

  it('says "no language service" for a file none answers, and "none here" for one that does', async () => {
    const t = setup({ symbols: { [B]: [GREET] } })
    const refused = await refusalOf(
      t.ask('findDefinition', { path: 'notes.txt', line: 1, column: 1 }),
    )
    expect(refused.reason).toContain(
      'no language service answered for notes.txt (language plaintext)',
    )
    expect(refused.visibleReason).toBe(fill(UI_TEXT.codeIntelNoService, { path: 'notes.txt' }))
    // The file's service answers (it lists symbols), but may not provide this.
    expect(await textOf(t.ask('findReferences', { path: 'src/b.ts', line: 1, column: 1 }))).toBe(
      "No references at src/b.ts:1:1: the file's language service found none there. Not every language's service provides references, so use search to be sure.",
    )
  })

  it('sorts, removes repeats and caps a long answer, counting the rest', async () => {
    const many: CodeLocation[] = Array.from({ length: CODE_INTEL_MAX_LOCATIONS + 50 }, (_, index) =>
      loc(index % 2 === 0 ? B : A, index, 0),
    )
    const t = setup({ references: () => [...many, many[0]!, many[1]!] })
    const text = await textOf(t.ask('findReferences', { path: 'src/a.ts', symbol: 'greet' }))
    const lines = text.split('\n').slice(1)
    expect(lines).toHaveLength(CODE_INTEL_MAX_LOCATIONS + 1)
    expect(lines[0]).toBe('src/a.ts:2:1: return `hi ${name}`')
    expect(lines.at(-1)).toBe('[50 more not shown]')
    expect(lines.filter((line) => line.startsWith('src/b.ts'))).toHaveLength(25)
  })

  it('places a result by its real path when the workspace is opened through a link', async () => {
    const real = '/real/ws'
    const t = setup({
      realPath: (path) =>
        path === '/broken'
          ? Promise.reject(new Error('EACCES'))
          : Promise.resolve(path.startsWith(ROOT) ? `${real}${path.slice(ROOT.length)}` : path),
      definitions: () => [loc(`${real}/src/a.ts`, 0, 16), loc('/broken', 0, 0)],
    })
    const text = await textOf(t.ask('findDefinition', { path: 'src/b.ts', line: 2, column: 1 }))
    expect(text).toBe(
      [
        'src/a.ts:1:17',
        '[left out 1 outside the workspace: library declarations or other folders]',
      ].join('\n'),
    )
  })

  it('ends a call the language service does not answer in time', async () => {
    vi.useFakeTimers()
    const t = setup({ definitions: () => new Promise<readonly CodeLocation[]>(() => undefined) })
    const pending = t.ask('findDefinition', { path: 'src/b.ts', line: 2, column: 1 })
    await vi.advanceTimersByTimeAsync(20_000)
    const refused = await refusalOf(pending)
    expect(refused.reason).toContain('did not answer within 20 seconds')
    expect(refused.visibleReason).toBe(fill(UI_TEXT.codeIntelTimedOut, { seconds: 20 }))
  })

  it("passes the language service's own failure on", async () => {
    const t = setup({ definitions: () => Promise.reject(new Error('the server crashed')) })
    await expect(t.ask('findDefinition', { path: 'src/b.ts', line: 2, column: 1 })).rejects.toThrow(
      'the server crashed',
    )
  })
})

describe('workspace_symbols and document_symbols', () => {
  it('lists exact names first, then by place, with containers and the count outside', async () => {
    const t = setup({
      workspace: [
        sym('greeter', KIND.class, A, 0, 0),
        sym('Greet', KIND.function, A, 2, 0),
        sym('greet', KIND.method, B, 4, 2, { container: 'Host' }),
        sym('greet', KIND.function, LIB, 0, 0),
        { ...GREET, name: 'greet()', selection: { start: START, end: GREET.selection.end } },
      ],
    })
    expect(await textOf(t.ask('workspaceSymbols', { query: 'greet' }))).toBe(
      [
        'src/a.ts:1:17: function greet()',
        'src/b.ts:5:3: method greet (in Host)',
        'src/a.ts:3:1: function Greet',
        'src/a.ts:1:1: class greeter',
        '[left out 1 outside the workspace: library declarations or other folders]',
      ].join('\n'),
    )
    expect(await textOf(t.ask('workspaceSymbols', { query: 'nothing' }))).toContain(
      'No workspace symbols match `nothing` in the workspace.',
    )
    expect(await reasonOf(t.ask('workspaceSymbols', { query: '' }))).toBe(
      'query must be a single line of 1 to 200 characters',
    )
  })

  it("outlines a file's symbols to their depth, counting the deeper ones", async () => {
    const deepest = sym('inner', KIND.variable, A, 3, 8)
    const local = sym('count', KIND.variable, A, 2, 6, { children: [deepest] })
    const method = sym('run', KIND.method, A, 1, 2, { detail: '(x: number)', children: [local] })
    const t = setup({
      symbols: {
        [A]: [
          sym('LATER', KIND.constant, A, 9, 0),
          sym('Host', KIND.class, A, 0, 0, { children: [method] }),
        ],
      },
    })
    expect(await textOf(t.ask('documentSymbols', { path: 'src/a.ts' }))).toBe(
      [
        'src/a.ts (typescript):',
        '1:1 class Host',
        '  2:3 method run (x: number)',
        '    3:7 variable count',
        '10:1 constant LATER',
        '[1 more not shown]',
      ].join('\n'),
    )
    const refused = await refusalOf(t.ask('documentSymbols', { path: 'notes.txt' }))
    expect(refused.reason).toContain('no language service answered for notes.txt')
  })
})

describe('hover', () => {
  it("joins the hover's parts, clips a long one, and says when there is none", async () => {
    const t = setup({
      symbols: { [B]: [GREET] },
      hover: (path) =>
        path === A
          ? ['', '```ts\nfunction greet(name: string): string\n```', ' Says hi. ']
          : ['x'.repeat(CODE_INTEL_HOVER_MAX_CHARS + 10)],
    })
    expect(await textOf(t.ask('hover', { path: 'src/a.ts', line: 1, column: 17 }))).toBe(
      '```ts\nfunction greet(name: string): string\n```\n\nSays hi.',
    )
    const long = await textOf(t.ask('hover', { path: 'src/z.ts', line: 1, column: 1 }))
    expect(long).toHaveLength(CODE_INTEL_HOVER_MAX_CHARS)
    expect(long.endsWith('…')).toBe(true)
    const none = setup({ symbols: { [B]: [GREET] }, hover: () => ['  '] })
    expect(await textOf(none.ask('hover', { path: 'src/b.ts', line: 1, column: 1 }))).toContain(
      'No hover information at src/b.ts:1:1:',
    )
  })

  it('holds back the hover of a symbol defined only outside the workspace and its libraries', async () => {
    const secret = ['```ts\nconst TOKEN: "sk-live-123"\n```']
    const outside = setup({ hover: () => secret, definitions: () => [loc(OTHER, 0, 13)] })
    const heldBack = await textOf(outside.ask('hover', { path: 'src/b.ts', line: 2, column: 1 }))
    expect(heldBack).toBe(
      'The hover is held back: this symbol is defined only outside the workspace (1 definitions), in files the tools do not show.',
    )
    expect(heldBack).not.toContain('sk-live')
    // A language's bundled library, a workspace file among the definitions,
    // or no definition at all keep the hover.
    const library = setup({
      hover: () => secret,
      definitions: () => [loc(LIB, 0, 0)],
      libraryRoots: ['/lib'],
    })
    const mixed = setup({
      hover: () => secret,
      definitions: () => [loc(OTHER, 0, 0), loc(A, 0, 16)],
    })
    const bare = setup({ hover: () => secret })
    for (const t of [library, mixed, bare]) {
      expect(await textOf(t.ask('hover', { path: 'src/b.ts', line: 2, column: 1 }))).toContain(
        'sk-live',
      )
    }
    const unresolvable = setup({
      hover: () => secret,
      definitions: () => [loc('/elsewhere/x.ts', 0, 0)],
      libraryRoots: ['/lib'],
      realPath: (path) =>
        path === '/elsewhere/x.ts' ? Promise.reject(new Error('EACCES')) : Promise.resolve(path),
    })
    expect(
      await textOf(unresolvable.ask('hover', { path: 'src/b.ts', line: 2, column: 1 })),
    ).toContain('held back')
  })
})

describe('files with unsaved changes', () => {
  it("refuses a position there, and answers from the editor's lines with a note", async () => {
    const edited = "import { greet } from './a'\n// a new line\ngreet('x')\n"
    const t = setup({
      dirty: new Set([B]),
      buffers: { [B]: edited },
      references: () => [loc(B, 2, 0), loc(A, 0, 16)],
    })
    t.io.unsaved.add(B)
    expect(await reasonOf(t.ask('findReferences', { path: 'src/b.ts', line: 2, column: 1 }))).toBe(
      'src/b.ts has unsaved changes in an editor, so its lines differ from what read_file shows; name the symbol without a line, or ask the user to save the file',
    )
    // By name, the editor's text is where the name is found, and the lines
    // shown are the editor's, said so.
    expect(await textOf(t.ask('findReferences', { path: 'src/b.ts', symbol: 'greet' }))).toBe(
      [
        'Using `greet` at src/b.ts:1:10.',
        'src/a.ts:1:17: export function greet(name: string): string {',
        "src/b.ts:3:1: greet('x')",
        "[unsaved changes in an editor: src/b.ts; their lines here are the editor's, not what read_file shows]",
      ].join('\n'),
    )
  })

  it('finds them by the real path when the workspace is opened through a link', async () => {
    // The editor names b.ts by the link; the language service by its real path.
    const link = '/link/ws'
    const edited = "import { greet } from './a'\n// a new line\ngreet('x')\n"
    const t = setup({
      workspaceRoot: link,
      links: { [link]: ROOT },
      realPath: realPathThrough(link, ROOT),
      dirty: new Set([`${link}/src/b.ts`]),
      buffers: { [`${link}/src/b.ts`]: edited },
      references: () => [loc(B, 2, 0), loc(A, 0, 16)],
    })
    t.io.unsaved.add(`${link}/src/b.ts`)
    expect(await textOf(t.ask('findReferences', { path: 'src/a.ts', symbol: 'greet' }))).toBe(
      [
        'Using `greet` at src/a.ts:1:17.',
        'src/a.ts:1:17: export function greet(name: string): string {',
        "src/b.ts:3:1: greet('x')",
        "[unsaved changes in an editor: src/b.ts; their lines here are the editor's, not what read_file shows]",
      ].join('\n'),
    )
    // An editor holding the real path: a position named through the link is refused.
    const real = setup({
      workspaceRoot: link,
      links: { [link]: ROOT },
      realPath: realPathThrough(link, ROOT),
      dirty: new Set([B]),
      buffers: { [B]: edited },
      // The service outlines the editor's document, the one it has open.
      symbols: { [B]: [sym('main', KIND.function, B, 2, 0)] },
    })
    real.io.unsaved.add(B)
    expect(
      await reasonOf(real.ask('findReferences', { path: 'src/b.ts', line: 3, column: 1 })),
    ).toContain('src/b.ts has unsaved changes in an editor')
    // Its outline is the editor's, asked at the editor's path, and said so.
    expect(await textOf(real.ask('documentSymbols', { path: 'src/b.ts' }))).toBe(
      [
        'src/b.ts (typescript):',
        '3:1 function main',
        "[unsaved changes in an editor: src/b.ts; their lines here are the editor's, not what read_file shows]",
      ].join('\n'),
    )
  })
})

describe('call_hierarchy', () => {
  const caller = sym('main', KIND.function, B, 0, 9)
  const ranges = Array.from({ length: 7 }, (_, index) => loc(B, index + 1, 2).range)

  it('lists the callers with their call sites, and the callees the other way', async () => {
    const log = sym('log', KIND.method, LIB, 0, 0)
    const t = setup({
      symbols: { [B]: [caller] },
      calls: (path, _at, direction) => {
        if (direction === 'incoming') {
          return {
            item: GREET,
            calls: [
              { symbol: caller, ranges },
              { symbol: sym('lib', KIND.function, LIB, 0, 0), ranges: [] },
            ],
            otherItems: 0,
          }
        }
        // Outgoing: the sites are in the file of the function asked about
        // (main in b.ts; log outside), not in the callee's.
        return path === B
          ? {
              item: caller,
              calls: [{ symbol: GREET, ranges: [loc(B, 1, 0).range] }],
              otherItems: 1,
            }
          : { item: log, calls: [{ symbol: GREET, ranges: [loc(LIB, 4, 0).range] }], otherItems: 0 }
      },
    })
    expect(await textOf(t.ask('callHierarchy', { path: 'src/a.ts', line: 1, column: 17 }))).toBe(
      [
        'Calls to function greet at src/a.ts:1:17:',
        'src/b.ts:1:10: function main (calls at 2:3, 3:3, 4:3, 5:3, 6:3, +2)',
        '[left out 1 outside the workspace: library declarations or other folders]',
      ].join('\n'),
    )
    expect(
      await textOf(
        t.ask('callHierarchy', { path: 'src/b.ts', line: 1, column: 10, direction: 'outgoing' }),
      ),
    ).toBe(
      [
        'Calls from function main at src/b.ts:1:10:',
        'src/a.ts:1:17: function greet (called at src/b.ts:2:1)',
        "[1 more functions share this position (overloads or merged declarations) and were not asked; ask at each one's own declaration for its calls]",
      ].join('\n'),
    )
    expect(
      await textOf(
        t.ask('callHierarchy', { path: 'src/a.ts', line: 1, column: 17, direction: 'outgoing' }),
      ),
    ).toBe(
      [
        'Calls from method log at outside the workspace:',
        'src/a.ts:1:17: function greet (called at 5:1 of its file outside the workspace)',
      ].join('\n'),
    )
  })

  it('says why there is no hierarchy: nothing callable here, or no language service', async () => {
    const t = setup({ symbols: { [B]: [caller] } })
    expect(
      await reasonOf(t.ask('callHierarchy', { path: 'src/b.ts', line: 1, column: 1 })),
    ).toContain('nothing at src/b.ts:1:1 has a call hierarchy here')
    expect(
      await reasonOf(t.ask('callHierarchy', { path: 'notes.txt', line: 1, column: 1 })),
    ).toContain('no language service answered for notes.txt')
  })
})
