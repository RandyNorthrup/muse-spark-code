// The read-only code intelligence tools (M67, PLAN.md D49): definitions,
// references, workspace and document symbols, hover and the call
// hierarchy, answered from VS Code's language services for both backends.
// Every answer is workspace-relative, sorted, capped with the rest counted,
// and says how many results outside the workspace it left out; a file whose
// language has no service answers "no language service", never nothing.

import {
  CODE_INTEL_HOVER_MAX_CHARS,
  CODE_INTEL_MAX_CALL_SITES,
  CODE_INTEL_MAX_CALLS,
  CODE_INTEL_MAX_LOCATIONS,
  CODE_INTEL_MAX_SYMBOLS,
  CODE_INTEL_SYMBOL_DEPTH,
  type CodeIntelTool,
  MODEL_TEXT,
  REPO_MAP_DEFAULT_TOKENS,
  REPO_MAP_MAX_TOKENS,
  REPO_MAP_TIME_BUDGET_MS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import {
  ask,
  bareName,
  byPlace,
  checkName,
  clipText,
  compareText,
  type CodeIntelAnswer,
  type CodeIntelDeps,
  CodeIntelQuery,
  CodeIntelRefusal,
  joinLines,
  kindName,
  parseArgs,
  type PlacedFile,
  placeText,
} from './codeIntelQuery'
import {
  callHierarchyArgs,
  documentSymbolsArgs,
  locateArgs,
  repoMapArgs,
  workspaceSymbolsArgs,
} from './definitions'
import type { CodeLocation, CodePosition, CodeRange, CodeSymbol } from './languageService'
import { repoMap } from './repoMap'

export type CodeIntelReadTool = Exclude<CodeIntelTool, 'renameSymbol'>

const INDENT = '  '

interface PlacedResult {
  readonly file: PlacedFile
  readonly relative: string
  readonly at: CodePosition
}

/** The notes under a listing: what was not shown, and what was outside. */
function listingNotes(hidden: number, outside: number): readonly string[] {
  return [
    ...(hidden > 0 ? [fill(MODEL_TEXT.codeIntelMore, { count: String(hidden) })] : []),
    ...(outside > 0 ? [fill(MODEL_TEXT.codeIntelOutside, { count: String(outside) })] : []),
  ]
}

/** A symbol found twice (a provider's repeat) is one; two symbols at one place are two. */
function symbolKey(symbol: CodeSymbol): string {
  return `${String(symbol.kind)} ${symbol.name}`
}

/**
 * Each result placed in the workspace (sorted, a repeat of the same place
 * and `sameness` left out), and the count left outside.
 */
async function placeAll<T>(
  query: CodeIntelQuery,
  items: readonly T[],
  where: (item: T) => { readonly path: string | undefined; readonly at: CodePosition },
  sameness: (item: T) => string = () => '',
): Promise<{
  readonly inside: readonly (PlacedResult & { readonly item: T })[]
  readonly outside: number
}> {
  const placed = await Promise.all(
    items.map(async (item) => {
      const { path, at } = where(item)
      const file = await query.place(path)
      return file === undefined ? undefined : { item, file, relative: file.relative, at }
    }),
  )
  const seen = new Set<string>()
  const inside = byPlace(placed.filter((entry) => entry !== undefined)).filter((entry) => {
    const key = `${placeText(entry.relative, entry.at)} ${sameness(entry.item)}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  return { inside, outside: placed.filter((entry) => entry === undefined).length }
}

/** Locations as `path:line:column: the line`, capped, with the notes. */
async function locationListing(
  query: CodeIntelQuery,
  locations: readonly CodeLocation[],
): Promise<readonly string[]> {
  const { inside, outside } = await placeAll(query, locations, (location) => ({
    path: location.path,
    at: location.range.start,
  }))
  const shown = inside.slice(0, CODE_INTEL_MAX_LOCATIONS)
  const lines = await Promise.all(
    shown.map(async (entry) => {
      const place = placeText(entry.relative, entry.at)
      const text = await query.preview(entry.file, entry.at.line)
      return text === undefined ? place : `${place}: ${text}`
    }),
  )
  return [...lines, ...listingNotes(inside.length - shown.length, outside)]
}

async function findLocations(
  query: CodeIntelQuery,
  raw: unknown,
  what: string,
  find: (path: string, at: CodePosition) => Promise<readonly CodeLocation[]>,
): Promise<string> {
  const target = await query.target(parseArgs(locateArgs, raw))
  const locations = await ask(find(target.file.absolute, target.at))
  return locations.length === 0
    ? await query.nothingAt(what, target)
    : joinLines([target.lead, ...(await locationListing(query, locations))])
}

/**
 * The hover, unless the symbol is defined only in files outside the
 * workspace that are no language's library: a hover shows what its
 * declaration says (its documentation, a constant's literal type), and the
 * tools show nothing of such files. A symbol with no definition to judge
 * (a keyword, a literal) keeps its hover.
 */
async function hover(query: CodeIntelQuery, raw: unknown): Promise<string> {
  const target = await query.target(parseArgs(locateArgs, raw))
  const parts = await ask(query.service.hover(target.file.absolute, target.at))
  const text = parts
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join('\n\n')
  if (text === '') {
    return await query.nothingAt('hover information', target)
  }
  const definitions = await ask(query.service.definitions(target.file.absolute, target.at))
  const describable = await Promise.all(
    definitions.map(async (definition) => await query.isDescribable(definition.path)),
  )
  const isHeldBack = definitions.length > 0 && describable.every((isShown) => !isShown)
  return joinLines([
    target.lead,
    isHeldBack
      ? fill(MODEL_TEXT.codeIntelHoverHeldBack, { count: String(definitions.length) })
      : clipText(text, CODE_INTEL_HOVER_MAX_CHARS),
  ])
}

function symbolLabel(symbol: CodeSymbol): string {
  const detail = symbol.detail === undefined || symbol.detail === '' ? '' : ` ${symbol.detail}`
  return `${kindName(symbol.kind)} ${symbol.name}${detail}`
}

function symbolStart(symbol: CodeSymbol): CodePosition {
  return symbol.selection.start
}

function compareSymbols(a: CodeSymbol, b: CodeSymbol): number {
  const left = symbolStart(a)
  const right = symbolStart(b)
  return left.line - right.line || left.character - right.character || compareText(a.name, b.name)
}

/** How many symbols a tree holds, its root included. */
function countSymbols(symbols: readonly CodeSymbol[]): number {
  return symbols.reduce((total, symbol) => total + 1 + countSymbols(symbol.children), 0)
}

/** The outline, depth-first in document order, within the depth and the cap. */
function outlineLines(symbols: readonly CodeSymbol[]): readonly string[] {
  const lines: string[] = []
  const walk = (level: readonly CodeSymbol[], depth: number) => {
    const ordered = level.toSorted((a, b) => compareSymbols(a, b))
    for (const symbol of ordered) {
      if (lines.length >= CODE_INTEL_MAX_SYMBOLS) {
        return
      }
      const at = symbolStart(symbol)
      lines.push(
        `${INDENT.repeat(depth)}${String(at.line + 1)}:${String(at.character + 1)} ${symbolLabel(symbol)}`,
      )
      if (depth + 1 < CODE_INTEL_SYMBOL_DEPTH) {
        walk(symbol.children, depth + 1)
      }
    }
  }
  walk(symbols, 0)
  return lines
}

async function documentSymbols(query: CodeIntelQuery, raw: unknown): Promise<string> {
  const { path } = parseArgs(documentSymbolsArgs, raw)
  // The outline of the editor's text when one holds unsaved changes to the
  // file, asked at that editor's path (it may name the file another way).
  const { file, document } = await query.openAsEdited(await query.confine(path))
  query.noteDocument(file, document)
  const symbols = await ask(query.service.documentSymbols(file.absolute))
  if (symbols.length === 0) {
    throw query.noService(file, document)
  }
  const lines = outlineLines(symbols)
  return joinLines([
    `${file.relative} (${document.languageId}):`,
    ...lines,
    ...listingNotes(countSymbols(symbols) - lines.length, 0),
  ])
}

/** Exact names first (then the same name in another case), then by place. */
function symbolRank(symbol: CodeSymbol, query: string): number {
  const name = bareName(symbol)
  if (name === query) {
    return 0
  }
  return name.toLowerCase() === query.toLowerCase() ? 1 : 2
}

async function workspaceSymbols(query: CodeIntelQuery, raw: unknown): Promise<string> {
  const text = checkName('query', parseArgs(workspaceSymbolsArgs, raw).query)
  const found = await ask(query.service.workspaceSymbols(text))
  const { inside, outside } = await placeAll(
    query,
    found,
    (symbol) => ({ path: symbol.location.path, at: symbol.selection.start }),
    symbolKey,
  )
  if (inside.length === 0) {
    return joinLines([
      fill(MODEL_TEXT.codeIntelNoSymbolsMatch, { query: text }),
      ...listingNotes(0, outside),
    ])
  }
  // Each at its name, which a provider's range may start before.
  const named = await Promise.all(
    inside.map(async (entry) => ({ ...entry, at: await query.nameStart(entry.file, entry.item) })),
  )
  const ranked = byPlace(named).toSorted(
    (a, b) => symbolRank(a.item, text) - symbolRank(b.item, text),
  )
  const shown = ranked.slice(0, CODE_INTEL_MAX_SYMBOLS)
  return joinLines([
    ...shown.map((entry) => {
      const { container } = entry.item
      const within = container === undefined || container === '' ? '' : ` (in ${container})`
      return `${placeText(entry.relative, entry.at)}: ${kindName(entry.item.kind)} ${entry.item.name}${within}`
    }),
    ...listingNotes(inside.length - shown.length, outside),
  ])
}

/**
 * Each call site, a few listed and the rest counted: `line:column`, or
 * `path:line:column` when the sites are in a file the line does not name.
 */
function callSites(ranges: readonly CodeRange[], relative?: string): string {
  const sorted = ranges
    .map((range) => range.start)
    .toSorted((a, b) => a.line - b.line || a.character - b.character)
  const listed = sorted
    .slice(0, CODE_INTEL_MAX_CALL_SITES)
    .map((at) =>
      relative === undefined
        ? `${String(at.line + 1)}:${String(at.character + 1)}`
        : placeText(relative, at),
    )
  const hidden = sorted.length - listed.length
  return (hidden > 0 ? [...listed, `+${String(hidden)}`] : listed).join(', ')
}

async function callHierarchy(query: CodeIntelQuery, raw: unknown): Promise<string> {
  const args = parseArgs(callHierarchyArgs, raw)
  const target = await query.target(args)
  const direction = args.direction ?? 'incoming'
  const answer = await ask(query.service.callHierarchy(target.file.absolute, target.at, direction))
  if (answer === undefined) {
    const symbols = await ask(query.service.documentSymbols(target.file.absolute))
    throw symbols.length === 0
      ? query.noService(target.file, target.document)
      : new CodeIntelRefusal(
          fill(MODEL_TEXT.codeIntelNoCallHierarchy, {
            place: placeText(target.file.relative, target.at),
          }),
        )
  }
  const itemFile = await query.place(answer.item.location.path)
  const header = fill(
    direction === 'incoming' ? MODEL_TEXT.codeIntelCallsTo : MODEL_TEXT.codeIntelCallsFrom,
    {
      symbol: `${kindName(answer.item.kind)} ${answer.item.name}`,
      place:
        itemFile === undefined
          ? MODEL_TEXT.codeIntelOutsideWorkspace
          : placeText(itemFile.relative, answer.item.selection.start),
    },
  )
  const { inside, outside } = await placeAll(
    query,
    answer.calls,
    (call) => ({ path: call.symbol.location.path, at: call.symbol.selection.start }),
    (call) => symbolKey(call.symbol),
  )
  const shown = inside.slice(0, CODE_INTEL_MAX_CALLS)
  // Incoming calls are in the caller's file, the line's own; outgoing ones
  // are in the file of the function asked about, named with each site.
  const sitesOf = (ranges: readonly CodeRange[]): string => {
    if (direction === 'incoming') {
      return fill(MODEL_TEXT.codeIntelCallSites, { sites: callSites(ranges) })
    }
    return itemFile === undefined
      ? fill(MODEL_TEXT.codeIntelCalledOutside, { sites: callSites(ranges) })
      : fill(MODEL_TEXT.codeIntelCalledAt, { sites: callSites(ranges, itemFile.relative) })
  }
  return joinLines([
    target.lead,
    header,
    ...(outside === 0 && inside.length === 0 ? [MODEL_TEXT.codeIntelNoCalls] : []),
    ...shown.map(
      (entry) =>
        `${placeText(entry.relative, entry.at)}: ${kindName(entry.item.symbol.kind)} ${entry.item.symbol.name} (${sitesOf(entry.item.ranges)})`,
    ),
    ...listingNotes(inside.length - shown.length, outside),
    ...(answer.otherItems > 0
      ? [fill(MODEL_TEXT.codeIntelOtherCallItems, { count: String(answer.otherItems) })]
      : []),
  ])
}

async function repoMapTool(query: CodeIntelQuery, raw: unknown, signal: AbortSignal | undefined) {
  const { max_tokens: requested } = parseArgs(repoMapArgs, raw)
  const maxTokens = Math.min(
    Math.max(Math.floor(requested ?? REPO_MAP_DEFAULT_TOKENS), 1),
    REPO_MAP_MAX_TOKENS,
  )
  return await repoMap(query, { maxTokens, timeBudgetMs: REPO_MAP_TIME_BUDGET_MS, signal })
}

async function answerText(
  tool: CodeIntelReadTool,
  query: CodeIntelQuery,
  raw: unknown,
  signal: AbortSignal | undefined,
): Promise<string> {
  switch (tool) {
    case 'findDefinition': {
      return await findLocations(query, raw, 'definition', (path, at) =>
        query.service.definitions(path, at),
      )
    }
    case 'findReferences': {
      return await findLocations(query, raw, 'references', (path, at) =>
        query.service.references(path, at),
      )
    }
    case 'hover': {
      return await hover(query, raw)
    }
    case 'documentSymbols': {
      return await documentSymbols(query, raw)
    }
    case 'workspaceSymbols': {
      return await workspaceSymbols(query, raw)
    }
    case 'callHierarchy': {
      return await callHierarchy(query, raw)
    }
    case 'repoMap': {
      return await repoMapTool(query, raw, signal)
    }
  }
}

/**
 * One read-only call: the answer, or the refusal with its reason. Anything
 * else (the language service's own failure) is thrown for the caller to
 * report as a failed call.
 */
export async function answerCodeIntel(
  tool: CodeIntelReadTool,
  raw: unknown,
  deps: CodeIntelDeps,
  signal?: AbortSignal,
): Promise<CodeIntelAnswer> {
  const query = new CodeIntelQuery(deps)
  try {
    const text = await answerText(tool, query, raw, signal)
    return { ok: true, text: joinLines([text, ...query.unsavedNotes()]) }
  } catch (error: unknown) {
    if (error instanceof CodeIntelRefusal) {
      return { ok: false, reason: error.message, visibleReason: error.visibleReason }
    }
    throw error
  }
}
