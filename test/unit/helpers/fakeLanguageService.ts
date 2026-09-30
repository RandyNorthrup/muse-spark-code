// A fake of VS Code's language services for the code intelligence tests
// (M67): documents read from the in-memory tool files (as VS Code holds
// them, BOM left out), and whatever answers a test gives each provider. A
// provider a test does not give answers as a language with no service does:
// nothing.

import type {
  CallDirection,
  CallHierarchyAnswer,
  CodeLocation,
  CodePosition,
  CodeSymbol,
  LanguageServiceHost,
  RenameEdits,
} from '../../../src/core/codeIntel/languageService'

const BOM = '\u{FEFF}'
// VS Code's `SymbolKind` values the tests use.
export const KIND = { class: 4, method: 5, function: 11, variable: 12, constant: 13 } as const

type Answer<T> = (path: string, at: CodePosition) => T | Promise<T>

export interface FakeServiceOptions {
  /** The documents' text by absolute path, read when a document is opened. */
  readonly files: ReadonlyMap<string, string>
  /** Absolute paths an editor holds unsaved changes to. */
  readonly dirty?: ReadonlySet<string>
  /** A document's text in VS Code when it differs from the disk. */
  readonly buffers?: Readonly<Record<string, string>>
  readonly symbols?: Readonly<Record<string, readonly CodeSymbol[]>>
  readonly workspace?: readonly CodeSymbol[] | ((query: string) => Promise<readonly CodeSymbol[]>)
  readonly definitions?: Answer<readonly CodeLocation[]>
  readonly references?: Answer<readonly CodeLocation[]>
  readonly hover?: Answer<readonly string[]>
  readonly calls?: (
    path: string,
    at: CodePosition,
    direction: CallDirection,
  ) => CallHierarchyAnswer | undefined
  readonly rename?: (path: string, at: CodePosition, newName: string) => Promise<RenameEdits>
  /** Folders a hover may describe outside the workspace; none unless given. */
  readonly libraryRoots?: readonly string[]
  /**
   * A folder an editor names files by (a link, such as the workspace opened
   * through one) → the real folder the files are kept under.
   */
  readonly links?: Readonly<Record<string, string>>
}

/** The path with a linked folder replaced by the real one. */
function throughLinks(path: string, links: Readonly<Record<string, string>> = {}): string {
  for (const [link, real] of Object.entries(links)) {
    if (path.startsWith(`${link}/`)) {
      return `${real}${path.slice(link.length)}`
    }
  }
  return path
}

export interface FakeLanguageService extends LanguageServiceHost {
  /** Each provider asked, in order: `definitions a.ts 2:5` and so on. */
  readonly asked: string[]
}

const LANGUAGES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  md: 'markdown',
  txt: 'plaintext',
}

function languageOf(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1)
  return LANGUAGES[extension] ?? extension
}

function describeAt(path: string, at: CodePosition): string {
  return `${path} ${String(at.line)}:${String(at.character)}`
}

/** A location in `path` at a 0-based line and column, `length` characters long. */
export function loc(
  path: string | undefined,
  line: number,
  character: number,
  length = 1,
): CodeLocation {
  return {
    path,
    range: { start: { line, character }, end: { line, character: character + length } },
  }
}

/** A symbol named `name` whose name starts at the 0-based line and column. */
export function sym(
  name: string,
  kind: number,
  path: string | undefined,
  line: number,
  character: number,
  extra: Partial<Pick<CodeSymbol, 'children' | 'container' | 'detail'>> = {},
): CodeSymbol {
  const location = loc(path, line, character, name.length)
  return {
    name,
    kind,
    detail: extra.detail,
    container: extra.container,
    location,
    selection: location.range,
    children: extra.children ?? [],
  }
}

/** What a provider a test does not give answers: nothing, as with no language service. */
function none(): readonly never[] {
  return []
}

export function fakeLanguageService(options: FakeServiceOptions): FakeLanguageService {
  const asked: string[] = []
  return {
    asked,
    open: (path) => {
      asked.push(`open ${path}`)
      const text = options.buffers?.[path] ?? options.files.get(throughLinks(path, options.links))
      if (text === undefined) {
        return Promise.reject(new Error(`cannot open ${path}`))
      }
      return Promise.resolve({
        languageId: languageOf(path),
        text: text.startsWith(BOM) ? text.slice(BOM.length) : text,
        isDirty: options.dirty?.has(path) === true,
      })
    },
    definitions: async (path, at) => {
      asked.push(`definitions ${describeAt(path, at)}`)
      return await (options.definitions ?? none)(path, at)
    },
    references: async (path, at) => {
      asked.push(`references ${describeAt(path, at)}`)
      return await (options.references ?? none)(path, at)
    },
    hover: async (path, at) => {
      asked.push(`hover ${describeAt(path, at)}`)
      return await (options.hover ?? none)(path, at)
    },
    documentSymbols: (path) => {
      asked.push(`symbols ${path}`)
      return Promise.resolve(options.symbols?.[path] ?? [])
    },
    workspaceSymbols: async (query) => {
      asked.push(`workspace ${query}`)
      const { workspace } = options
      return typeof workspace === 'function'
        ? await workspace(query)
        : (workspace ?? []).filter((symbol) =>
            symbol.name.toLowerCase().includes(query.toLowerCase()),
          )
    },
    callHierarchy: (path, at, direction) => {
      asked.push(`calls ${direction} ${describeAt(path, at)}`)
      return Promise.resolve(options.calls?.(path, at, direction))
    },
    rename: async (path, at, newName) => {
      asked.push(`rename ${describeAt(path, at)} ${newName}`)
      return await (options.rename?.(path, at, newName) ??
        Promise.resolve({ files: [], fileOperations: 'none' }))
    },
    libraryRoots: () => options.libraryRoots ?? [],
  }
}
