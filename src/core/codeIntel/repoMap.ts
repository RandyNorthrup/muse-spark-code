// The repo map (M67, PLAN.md D49; Aider's idea over VS Code's services):
// the workspace's files ranked by how often other files use the names they
// define, each with its most used definitions, within a token budget. The
// names are counted in the files' text (read confined, like the search
// tool's); where each widely used name is defined comes from the workspace
// symbols of VS Code's language services. A name defined in several files
// shares its weight among them. The lookups stop at the time budget or a
// Stop, and the map then says it is partial.

import {
  MODEL_TEXT,
  REPO_MAP_CHARS_PER_TOKEN,
  REPO_MAP_CONCURRENCY,
  REPO_MAP_MAX_FILE_CHARS,
  REPO_MAP_MAX_FILES,
  REPO_MAP_MAX_LOOKUPS,
  REPO_MAP_MIN_NAME_CHARS,
  REPO_MAP_PROMPT_TIME_BUDGET_MS,
  REPO_MAP_PROMPT_TOKENS,
  REPO_MAP_SYMBOLS_PER_FILE,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { withDeadline } from '../timeouts'
import {
  ask,
  bareName,
  type CodeIntelDeps,
  CodeIntelQuery,
  CodeIntelRefusal,
  compareText,
  joinLines,
  kindName,
} from './codeIntelQuery'
import type { CodePosition, CodeSymbol } from './languageService'

export interface RepoMapOptions {
  readonly maxTokens: number
  readonly timeBudgetMs: number
  readonly signal?: AbortSignal | undefined
}

// A name as most languages spell one: a letter, `_` or `$`, then those or digits.
const NAME = /[\p{L}_$][\p{L}\p{N}_$]*/gu
const INDENT = '  '
// Between the prompt section's heading, its lead and the map.
const SECTION_BREAK = '\n\n'
const BUDGET_SPENT = 'the repo map time budget is spent'
// What `Limits.within` settles with when the turn is stopped.
const STOPPED = Symbol('stopped')

interface Definition {
  readonly name: string
  readonly kind: number
  readonly at: CodePosition
  weight: number
}

interface RankedFile {
  readonly relative: string
  score: number
  readonly definitions: Definition[]
}

/** Each name of `min` characters or more in the text, with how often it occurs. */
/** A file left out of the counts: unreadable, not text, or too long. */
const NO_NAMES: ReadonlyMap<string, number> = new Map()

function countNames(text: string): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const [name] of text.matchAll(NAME)) {
    if (name.length >= REPO_MAP_MIN_NAME_CHARS) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * The time budget and the Stop that end the map's work early. It listens
 * for the Stop once, and `close` takes the listener off again, so a turn
 * that asks for many maps collects none.
 */
class Limits {
  private readonly stopped: Promise<typeof STOPPED>
  /** Takes the Stop listener off when the map is done. */
  private readonly listening = new AbortController()

  public constructor(
    private readonly now: () => number,
    private readonly deadline: number,
    private readonly signal: AbortSignal | undefined,
  ) {
    // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
    this.stopped = new Promise<typeof STOPPED>((resolve) => {
      signal?.addEventListener(
        'abort',
        () => {
          resolve(STOPPED)
        },
        { once: true, signal: this.listening.signal },
      )
    })
  }

  public isOver(): boolean {
    return this.signal?.aborted === true || this.now() >= this.deadline
  }

  /**
   * The value of the work `start` begins, or `undefined` once the time is up
   * or the turn is stopped: when that is so already the work is not begun,
   * and otherwise it is left to finish on its own.
   */
  public async within<T>(start: () => Promise<T>): Promise<T | undefined> {
    if (this.isOver()) {
      return undefined
    }
    const remainingMs = Math.max(this.deadline - this.now(), 1)
    const boxed = async () => ({ value: await start() })
    try {
      const settled = await Promise.race([
        withDeadline(boxed(), remainingMs, BUDGET_SPENT),
        this.stopped,
      ])
      return settled === STOPPED ? undefined : settled.value
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'DeadlineError') {
        return undefined
      }
      throw error
    }
  }

  public close(): void {
    this.listening.abort()
  }
}

/**
 * Runs `work` over `items`, a few at a time, until the limits say stop;
 * returns the results of the batches that finished, in order. A batch the
 * limits cut off is left to run, and its results are dropped: nothing it
 * finds later reaches the map or its counts.
 */
async function inBatches<T, R>(
  items: readonly T[],
  limits: Limits,
  work: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = []
  while (results.length < items.length) {
    const batch = items.slice(results.length, results.length + REPO_MAP_CONCURRENCY)
    const finished = await limits.within(
      async () => await Promise.all(batch.map(async (item) => await work(item))),
    )
    if (finished === undefined) {
      break
    }
    for (const result of finished) {
      results.push(result)
    }
  }
  return results
}

/** Name → file → how often the file uses it, over the files that could be read. */
async function readUses(
  query: CodeIntelQuery,
  files: readonly string[],
  limits: Limits,
): Promise<{
  readonly uses: ReadonlyMap<string, ReadonlyMap<string, number>>
  readonly read: number
}> {
  const counted = await inBatches(files, limits, async (relative) => {
    let text: string | undefined
    try {
      const file = await query.confine(relative)
      text = await query.deps.io.readFile(file.checkedAbsolute, file.checkedAbsolute)
    } catch {
      // A file that is not confined UTF-8 text is left out of the counts, as
      // the search tool leaves it out.
      return { relative, names: NO_NAMES }
    }
    return {
      relative,
      names:
        text === undefined || text.length > REPO_MAP_MAX_FILE_CHARS ? NO_NAMES : countNames(text),
    }
  })
  const uses = new Map<string, Map<string, number>>()
  for (const { relative, names } of counted) {
    for (const [name, count] of names) {
      const perFile = uses.get(name) ?? new Map<string, number>()
      perFile.set(relative, count)
      uses.set(name, perFile)
    }
  }
  return { uses, read: counted.length }
}

/** The names used by two files or more, the most widely used first. */
function candidates(uses: ReadonlyMap<string, ReadonlyMap<string, number>>): readonly string[] {
  return [...uses]
    .filter(([, perFile]) => perFile.size > 1)
    .toSorted(([a, left], [b, right]) => right.size - left.size || compareText(a, b))
    .slice(0, REPO_MAP_MAX_LOOKUPS)
    .map(([name]) => name)
}

function rank(
  definitions: ReadonlyMap<string, readonly { relative: string; symbol: CodeSymbol }[]>,
  uses: ReadonlyMap<string, ReadonlyMap<string, number>>,
): readonly RankedFile[] {
  const files = new Map<string, RankedFile>()
  const ranked: RankedFile[] = []
  for (const [name, found] of definitions) {
    const definers = new Set(found.map((entry) => entry.relative))
    const users = uses.get(name) ?? new Map<string, number>()
    let usedElsewhere = 0
    for (const [relative, count] of users) {
      if (!definers.has(relative)) {
        usedElsewhere += count
      }
    }
    if (usedElsewhere === 0) {
      continue
    }
    const weight = usedElsewhere / definers.size
    const credited = new Set<string>()
    for (const { relative, symbol } of found) {
      // Overloads and redeclarations in one file count once.
      if (credited.has(relative)) {
        continue
      }
      credited.add(relative)
      let file = files.get(relative)
      if (file === undefined) {
        file = { relative, score: 0, definitions: [] }
        files.set(relative, file)
        ranked.push(file)
      }
      file.score += weight
      file.definitions.push({ name, kind: symbol.kind, at: symbol.selection.start, weight })
    }
  }
  return ranked.toSorted((a, b) => b.score - a.score || compareText(a.relative, b.relative))
}

function fileBlock(file: RankedFile): string {
  const shown = file.definitions
    .toSorted((a, b) => b.weight - a.weight || a.at.line - b.at.line || compareText(a.name, b.name))
    .slice(0, REPO_MAP_SYMBOLS_PER_FILE)
    .toSorted((a, b) => a.at.line - b.at.line || a.at.character - b.at.character)
    .map(
      (definition) =>
        `${INDENT}${String(definition.at.line + 1)}: ${kindName(definition.kind)} ${definition.name}`,
    )
  return [file.relative, ...shown].join('\n')
}

/** The length of lines joined one per line (`joinLines`). */
function joinedLength(lines: readonly string[]): number {
  return lines.reduce((total, line) => total + line.length, Math.max(lines.length - 1, 0))
}

/**
 * The map as lines within `budget` characters, every line counted: the
 * lead, as many ranked files as fit, the line counting the rest, and the
 * notes. When the lead, that line and the notes alone do not fit, those
 * lines, and `fits` false.
 */
function renderLines(
  ranked: readonly RankedFile[],
  budget: number,
  notes: readonly string[],
): { readonly lines: readonly string[]; readonly fits: boolean } {
  const blocks: string[] = []
  const compose = (): readonly string[] => {
    const hidden = ranked.length - blocks.length
    return [
      MODEL_TEXT.repoMapLead,
      ...blocks,
      ...(hidden > 0 ? [fill(MODEL_TEXT.codeIntelMore, { count: String(hidden) })] : []),
      ...notes,
    ]
  }
  if (joinedLength(compose()) > budget) {
    return { lines: compose(), fits: false }
  }
  for (const file of ranked) {
    blocks.push(fileBlock(file))
    if (joinedLength(compose()) > budget) {
      blocks.pop()
      break
    }
  }
  return { lines: compose(), fits: true }
}

/** The refusal for a budget too small for the answer's own fixed text. */
function tooSmall(maxTokens: number, lines: readonly string[]): CodeIntelRefusal {
  return new CodeIntelRefusal(
    fill(MODEL_TEXT.repoMapBudgetTooSmall, {
      tokens: String(maxTokens),
      needed: String(Math.ceil(joinedLength(lines) / REPO_MAP_CHARS_PER_TOKEN)),
    }),
  )
}

interface BuiltMap {
  readonly ranked: readonly RankedFile[]
  /** What the map could not cover: lookups cut short, files past the cap. */
  readonly notes: readonly string[]
}

/**
 * The ranked files, or the refusal when no language service answers
 * workspace symbols (the map would be empty for want of one, not for want
 * of code).
 */
async function buildMap(query: CodeIntelQuery, options: RepoMapOptions): Promise<BuiltMap> {
  const { now } = query.deps
  const limits = new Limits(now, now() + options.timeBudgetMs, options.signal)
  try {
    return await buildWithin(query, limits)
  } finally {
    limits.close()
  }
}

async function buildWithin(query: CodeIntelQuery, limits: Limits): Promise<BuiltMap> {
  const found = await limits.within(async () => await query.deps.io.listFiles())
  if (found === undefined) {
    return { ranked: [], notes: [MODEL_TEXT.repoMapNoFiles] }
  }
  const listed = found.toSorted((a, b) => compareText(a, b))
  const files = listed.slice(0, REPO_MAP_MAX_FILES)
  const { uses, read } = await readUses(query, files, limits)
  const names = candidates(uses)
  const lookups = await inBatches(names, limits, async (name) => {
    const found = await ask(query.service.workspaceSymbols(name))
    const exact = await Promise.all(
      found
        .filter((symbol) => bareName(symbol) === name)
        .map(async (symbol) => ({ symbol, file: await query.place(symbol.location.path) })),
    )
    const inside = exact.flatMap(({ symbol, file }) =>
      file === undefined ? [] : [{ relative: file.relative, symbol }],
    )
    return { name, answered: found.length, inside }
  })
  const definitions = new Map<string, readonly { relative: string; symbol: CodeSymbol }[]>()
  for (const { name, inside } of lookups) {
    if (inside.length > 0) {
      definitions.set(name, inside)
    }
  }
  const looked = lookups.length
  // No service only when every lookup ran and none found anything: a map
  // cut short by the time or a Stop is a partial map, not a missing service.
  if (looked > 0 && looked === names.length && lookups.every((lookup) => lookup.answered === 0)) {
    throw new CodeIntelRefusal(MODEL_TEXT.repoMapNoService, UI_TEXT.repoMapNoService)
  }
  const notes = [
    ...(read < files.length
      ? [fill(MODEL_TEXT.repoMapFilesRead, { done: String(read), total: String(files.length) })]
      : []),
    ...(looked < names.length
      ? [fill(MODEL_TEXT.repoMapPartial, { done: String(looked), total: String(names.length) })]
      : []),
    ...(files.length < listed.length
      ? [
          fill(MODEL_TEXT.repoMapFilesCapped, {
            count: String(files.length),
            total: String(listed.length),
          }),
        ]
      : []),
  ]
  return { ranked: rank(definitions, uses), notes }
}

/**
 * The `repo_map` tool's answer within `maxTokens`, all of its text counted;
 * the refusal names the budget needed when its fixed text does not fit.
 */
export async function repoMap(query: CodeIntelQuery, options: RepoMapOptions): Promise<string> {
  const { ranked, notes } = await buildMap(query, options)
  const budget = options.maxTokens * REPO_MAP_CHARS_PER_TOKEN
  if (ranked.length === 0) {
    const empty = [MODEL_TEXT.repoMapEmpty, ...notes]
    if (joinedLength(empty) > budget) {
      throw tooSmall(options.maxTokens, empty)
    }
    return joinLines(empty)
  }
  const { lines, fits } = renderLines(ranked, budget, notes)
  if (!fits) {
    throw tooSmall(options.maxTokens, lines)
  }
  return joinLines(lines)
}

/**
 * The system prompt's section (opt in, M67): the map within its own budget
 * and time, its heading counted, undefined when no file ranks (or, never
 * with the fixed budget, when its fixed text would not fit). Rejects with
 * the refusal when no language service answers.
 */
export async function repoMapSection(
  deps: CodeIntelDeps,
  signal: AbortSignal,
): Promise<string | undefined> {
  const options = {
    maxTokens: REPO_MAP_PROMPT_TOKENS,
    timeBudgetMs: REPO_MAP_PROMPT_TIME_BUDGET_MS,
    signal,
  }
  const { ranked, notes } = await buildMap(new CodeIntelQuery(deps), options)
  const heading = `${MODEL_TEXT.repoMapSection}${SECTION_BREAK}${MODEL_TEXT.repoMapSectionLead}${SECTION_BREAK}`
  const { lines, fits } = renderLines(
    ranked,
    options.maxTokens * REPO_MAP_CHARS_PER_TOKEN - heading.length,
    notes,
  )
  return !fits || ranked.length === 0 ? undefined : `${heading}${joinLines(lines)}`
}
