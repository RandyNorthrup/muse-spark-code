// The Model API backend's capped-list search and listing: the executors
// plus the row paging, the note naming the offset that fetches the rest,
// and the past-end refusals. dist/modelApi.js loads this through
// dist/modelApiTools.js on the first search or listing; type-only imports
// back stay erased.
import path from 'node:path'
import {
  LIST_FILES_DEFAULT_LIMIT,
  MODEL_API_TOOLS,
  SEARCH_HIT_MAX_CHARS,
  SEARCH_MAX_CANDIDATES,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_HITS,
  SEARCH_MAX_RESULTS,
  SEARCH_PATTERN_MAX_LENGTH,
  SEARCH_TIMEOUT_MS,
} from '../../../shared/constants'
import { compileGlob, GLOB_LIMITS } from './globLimits'
import type { SearchHit, ToolContext, ToolOutcome, TouchedFiles } from './tools'
import { clip, errorMessage, failure } from '../../toolEdit'

/** One page of a search's rows, with the row count the page was taken from. */
export interface SearchPage {
  readonly rows: readonly string[]
  readonly total: number
}

// The search's output modes (mirrors OUTPUT_MODES in tools.ts, which owns
// the value for argument validation; the union here must match it).
export type SearchOutputMode = 'content' | 'files_with_matches' | 'count'

// A validated `search` call (mirrors searchArgs in tools.ts, which owns the
// schema; the shape here must accept what it validates).
export interface SearchCallArgs {
  readonly pattern: string
  readonly output_mode?: SearchOutputMode | undefined
  readonly max_results?: number | undefined
  readonly glob?: string | undefined
  readonly offset?: number | undefined
}

// A validated `list_files` call (mirrors listFilesArgs in tools.ts, which
// owns the schema; the shape here must accept what it validates).
export interface ListFilesCallArgs {
  readonly limit?: number | undefined
  readonly glob?: string | undefined
  readonly offset?: number | undefined
}

/**
The rows a search reports for its mode, one page. `offset` skips that
many rows first, so every capped list stays reachable.
*/
export function searchPage(
  hits: readonly SearchHit[],
  mode: SearchOutputMode,
  limit: number,
  offset = 0,
): SearchPage {
  const skip = Math.max(Math.floor(offset), 0)
  if (mode === 'content') {
    return {
      rows: hits
        .slice(skip, skip + limit)
        .map((hit) => `${hit.file}:${String(hit.line)}: ${hit.text}`),
      total: hits.length,
    }
  }
  const perFile = new Map<string, number>()
  for (const hit of hits) {
    perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1)
  }
  const rows = Array.from(perFile, ([file, count]) =>
    mode === 'count' ? `${file}: ${String(count)}` : file,
  )
  return { rows: rows.slice(skip, skip + limit), total: rows.length }
}

/**
The page note for a capped row list: which rows these are, how many
there are, and the offset that fetches the rest. `isFloor` when the
search itself stopped at its own cap, so the total is a floor.
*/
export function pageNote(
  tool: string,
  skip: number,
  shown: number,
  total: number,
  isFloor: boolean,
  noun = 'matches',
): string {
  const floor = isFloor ? 'at least ' : ''
  return `[${noun} ${String(skip + 1)}-${String(skip + shown)} of ${floor}${String(total)}; call ${tool} again with offset ${String(skip + shown)} for the rest]`
}

/** A search offset past what the search returned: narrow, don't widen. */
export function searchPastEnd(offset: number, total: number, isFloor: boolean): string {
  return isFloor
    ? `offset ${String(offset)} is past the ${String(total)} matches returned (of at least ${String(total)}); narrow the pattern or the glob`
    : `offset ${String(offset)} is past the last of ${String(total)} matches; use an offset from 0 to ${String(total - 1)}`
}

/** Which rows a floored search page shows: the cap stopped it, not the offset. */
export function searchFloorNote(offset: number, shown: number, total: number): string {
  return `[showing matches ${String(offset + 1)}-${String(offset + shown)} of at least ${String(total)}; the search stopped at its own cap, narrow the pattern or the glob for the rest]`
}

/** A listing offset past the last file: the valid range rides along. */
export function listPastEnd(offset: number, total: number): string {
  return `offset ${String(offset)} is past the last of ${String(total)} files; use an offset from 0 to ${String(total - 1)}`
}
export async function listMatching(
  context: ToolContext,
  glob: string | undefined,
): Promise<readonly string[]> {
  // Compiled before the listing, so a refused glob costs no file walk.
  const matches = glob === undefined ? undefined : compileGlob(glob)
  const files = await context.io.listFiles(context.signal)
  context.signal?.throwIfAborted()
  // What the permission settings deny is neither listed nor searched (M78).
  return files.filter(
    (file) => (matches === undefined || matches(file)) && context.files?.isDenied([file]) !== true,
  )
}

export async function search(args: SearchCallArgs, context: ToolContext): Promise<ToolOutcome> {
  if (args.pattern.length > SEARCH_PATTERN_MAX_LENGTH) {
    return failure(`pattern longer than ${String(SEARCH_PATTERN_MAX_LENGTH)} characters`)
  }
  const mode = args.output_mode ?? 'content'
  const limit = Math.max(Math.min(args.max_results ?? SEARCH_MAX_RESULTS, SEARCH_MAX_RESULTS), 1)
  const p = context.platform === 'win32' ? path.win32 : path.posix
  let candidates: readonly string[]
  try {
    candidates = await listMatching(context, args.glob)
  } catch (error: unknown) {
    context.signal?.throwIfAborted()
    return failure(errorMessage(error))
  }
  // A workspace too large to search in the budget is searched in part, and
  // the model is told so rather than handed a silent subset (D27).
  const searched = candidates.slice(0, SEARCH_MAX_CANDIDATES)
  const outcome = await context.io.searchFiles(
    {
      pattern: args.pattern,
      root: context.workspaceRoot,
      maxFileBytes: SEARCH_MAX_FILE_BYTES,
      maxHits: SEARCH_MAX_HITS,
      maxHitChars: SEARCH_HIT_MAX_CHARS,
      denyRead: context.files?.denyGlobs ?? [],
      globLimits: GLOB_LIMITS,
      files: searched.map((relative) => ({
        relative,
        absolute: p.join(context.workspaceRoot, ...relative.split('/')),
      })),
    },
    context.signal,
  )
  context.signal?.throwIfAborted()
  // Every candidate, searched or not: its name may be in a hit or a count.
  const touched: TouchedFiles = { names: candidates, complete: true }
  if (!outcome.ok) {
    return { ...failure(outcome.reason), touched }
  }
  // The page size stays capped, and every page names what is left and the
  // offset that fetches it.
  const offset = Math.max(Math.floor(args.offset ?? 0), 0)
  const page = searchPage(outcome.hits, mode, limit, offset)
  // At the search's own hit cap (or a timeout) the total is a floor: the
  // rest is reached by narrowing the pattern or glob, not by offset.
  const isFloor = outcome.hits.length >= SEARCH_MAX_HITS || outcome.isPartial === true
  if (page.rows.length === 0 && page.total > 0) {
    return {
      ...failure(searchPastEnd(offset, page.total, isFloor)),
      touched,
    }
  }
  const notes = [
    ...(searched.length < candidates.length
      ? [
          `[searched the first ${String(searched.length)} of ${String(candidates.length)} files; narrow the search with glob]`,
        ]
      : []),
    ...(outcome.isPartial === true
      ? [
          `[the search stopped after ${String(SEARCH_TIMEOUT_MS)} ms; these results are partial, narrow the pattern or the glob]`,
        ]
      : []),
    ...(offset + page.rows.length < page.total
      ? [pageNote(MODEL_API_TOOLS.search, offset, page.rows.length, page.total, isFloor)]
      : []),
    ...(isFloor && page.rows.length > 0 && offset + page.rows.length >= page.total
      ? [searchFloorNote(offset, page.rows.length, page.total)]
      : []),
    // A cut hit line names its file and line: the full line is reached
    // through read_file, never through a wider search window.
    ...(page.rows.some((row) => row.includes('[line cut to '))
      ? ['[a shown hit line is cut; read its file with read_file for the full line]']
      : []),
  ]
  const found = page.rows.length === 0 ? 'No matches.' : page.rows.join('\n')
  const body = [found, ...notes].join('\n')
  // D121: no trimming of ours — the matches ride whole; the row keeps the
  // display clip, and the host's one bound cuts with a spill downstream.
  return { output: body, visibleOutput: clip(body), touched }
}

export async function listFiles(
  args: ListFilesCallArgs,
  context: ToolContext,
): Promise<ToolOutcome> {
  const limit = Math.max(args.limit ?? LIST_FILES_DEFAULT_LIMIT, 1)
  let files: readonly string[]
  try {
    files = await listMatching(context, args.glob)
  } catch (error: unknown) {
    context.signal?.throwIfAborted()
    return failure(errorMessage(error))
  }
  // The page size stays capped, and every page names what is left and the
  // offset that fetches it. The paging helpers load with the deferred
  // per-call helpers chunk, beside the hook fields and previews.
  const offset = Math.max(Math.floor(args.offset ?? 0), 0)
  const shown = files.slice(offset, offset + limit)
  if (shown.length === 0 && files.length > 0) {
    return {
      ...failure(listPastEnd(offset, files.length)),
      touched: { names: files, complete: true },
    }
  }
  const tail =
    offset + shown.length < files.length
      ? `\n${pageNote(MODEL_API_TOOLS.listFiles, offset, shown.length, files.length, false, 'files')}`
      : ''
  const body = shown.length === 0 ? 'No files.' : `${shown.join('\n')}${tail}`
  // Every file listed, shown or counted.
  // D121: no trimming of ours — the listing rides whole; the row keeps the
  // display clip, and the host's one bound cuts with a spill downstream.
  return {
    output: body,
    visibleOutput: clip(body),
    touched: { names: files, complete: true },
  }
}
