// The Models table's search, filters, sorting and badges as pure
// functions (M95, PLAN.md D74): a searchable, sortable table with filters
// (tool calling, vision, reasoning, a context range, input, output and
// cached price ranges, free or local, provider, family) and badges
// (Recommended, Cheapest capable, Largest context, New). Pinned favourites
// sort first in the composer's picker (lane U); the ticked set is lane K's.

import { HARNESS_MIN_CONTEXT_TOKENS } from '../../shared/constants'

/** One row of the Models table (a scan joined with prices and flags). */
export interface ModelRow {
  readonly ref: string
  readonly providerId: string
  readonly modelId: string
  readonly label?: string | undefined
  readonly description?: string | undefined
  readonly toolCalling: boolean
  readonly vision: boolean
  readonly reasoning: boolean
  readonly contextTokens?: number | undefined
  /** USD per million tokens; absent means unpriced. */
  readonly inputPerMillion?: number | undefined
  readonly outputPerMillion?: number | undefined
  readonly cachedPerMillion?: number | undefined
  readonly freeOrLocal: boolean
  readonly recommended?: boolean | undefined
  /** The catalogue marks Together's serverless models; others default so. */
  readonly serverless?: boolean | undefined
  /** New since the last scan (from the scan diff). */
  readonly isNew?: boolean | undefined
}

/** Every filter the table offers, each alone or combined. */
export interface ModelFilter {
  readonly search?: string | undefined
  readonly toolCalling?: boolean | undefined
  readonly vision?: boolean | undefined
  readonly reasoning?: boolean | undefined
  readonly contextMin?: number | undefined
  readonly contextMax?: number | undefined
  readonly maxInputPerMillion?: number | undefined
  readonly maxOutputPerMillion?: number | undefined
  readonly maxCachedPerMillion?: number | undefined
  readonly freeOrLocal?: boolean | undefined
  readonly providerId?: string | undefined
  readonly family?: string | undefined
}

/**
 * A model's family for the family facet: the last path segment up to its
 * first separator (`openai/gpt-oss-20b` → `gpt`, `deepseek-flash` →
 * `deepseek`, `qwen3:8b` → `qwen3`), lowercased.
 */
export function familyOf(modelId: string): string {
  const last = modelId.split('/').at(-1) ?? modelId
  return (last.split(/[-_:.\s]/, 1)[0] ?? last).toLowerCase()
}

function isSearchMatch(row: ModelRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (needle === '') {
    return true
  }
  const haystacks = [row.modelId, row.label ?? '', row.description ?? '', row.providerId].map(
    (text) => text.toLowerCase(),
  )
  return haystacks.some((haystack) => haystack.includes(needle))
}

/**
 * The rows passing every set facet. Range bounds are inclusive; an
 * unpriced model passes no price facet but passes when no price facet is
 * set; a model with an unknown window passes no context facet.
 */
export function filterModels(rows: readonly ModelRow[], filter: ModelFilter): ModelRow[] {
  return rows.filter((row) => {
    if (!isSearchMatch(row, filter.search ?? '')) {
      return false
    }
    if (filter.toolCalling !== undefined && row.toolCalling !== filter.toolCalling) {
      return false
    }
    if (filter.vision !== undefined && row.vision !== filter.vision) {
      return false
    }
    if (filter.reasoning !== undefined && row.reasoning !== filter.reasoning) {
      return false
    }
    if (filter.contextMin !== undefined && (row.contextTokens ?? -1) < filter.contextMin) {
      return false
    }
    if (filter.contextMax !== undefined && (row.contextTokens ?? Infinity) > filter.contextMax) {
      return false
    }
    if (
      filter.maxInputPerMillion !== undefined &&
      (row.inputPerMillion === undefined || row.inputPerMillion > filter.maxInputPerMillion)
    ) {
      return false
    }
    if (
      filter.maxOutputPerMillion !== undefined &&
      (row.outputPerMillion === undefined || row.outputPerMillion > filter.maxOutputPerMillion)
    ) {
      return false
    }
    if (
      filter.maxCachedPerMillion !== undefined &&
      (row.cachedPerMillion === undefined || row.cachedPerMillion > filter.maxCachedPerMillion)
    ) {
      return false
    }
    if (filter.freeOrLocal !== undefined && row.freeOrLocal !== filter.freeOrLocal) {
      return false
    }
    if (filter.providerId !== undefined && row.providerId !== filter.providerId) {
      return false
    }
    if (filter.family !== undefined && familyOf(row.modelId) !== filter.family.toLowerCase()) {
      return false
    }
    return true
  })
}

export type ModelSortKey = 'name' | 'context' | 'input-price' | 'output-price'

/** The rows sorted by a key; ties and unknowns keep their relative order (stable). */
export function sortModels(
  rows: readonly ModelRow[],
  key: ModelSortKey,
  direction: 'asc' | 'desc' = 'asc',
): ModelRow[] {
  const sign = direction === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index }))
    .toSorted((a, b) => {
      const value = compareByKey(a.row, b.row, key)
      return value === 0 ? a.index - b.index : sign * value
    })
    .map((entry) => entry.row)
}

function compareByKey(a: ModelRow, b: ModelRow, key: ModelSortKey): number {
  switch (key) {
    case 'name': {
      return a.modelId.localeCompare(b.modelId)
    }
    case 'context': {
      return (a.contextTokens ?? -1) - (b.contextTokens ?? -1)
    }
    case 'input-price': {
      return (a.inputPerMillion ?? Infinity) - (b.inputPerMillion ?? Infinity)
    }
    case 'output-price': {
      return (a.outputPerMillion ?? Infinity) - (b.outputPerMillion ?? Infinity)
    }
  }
}

/** The four badges by their rules, over a fixture catalogue. */
export interface ModelBadges {
  readonly recommended: boolean
  readonly cheapestCapable: boolean
  readonly largestContext: boolean
  readonly isNew: boolean
}

/**
 * The badges for one row among its peers. Cheapest capable needs tool
 * calling, the harness's minimum context, a price and a runnable model —
 * a tool-less or unpriced model never wins it. Largest context needs the
 * widest known window. New comes from the scan diff.
 */
export function badgesFor(row: ModelRow, all: readonly ModelRow[]): ModelBadges {
  const capable = all.filter(
    (peer) =>
      peer.toolCalling &&
      (peer.contextTokens ?? 0) >= HARNESS_MIN_CONTEXT_TOKENS &&
      peer.inputPerMillion !== undefined &&
      peer.serverless !== false,
  )
  const cheapest =
    capable.length === 0 ? undefined : Math.min(...capable.map((peer) => peer.inputPerMillion ?? 0))
  const widest = Math.max(0, ...all.map((peer) => peer.contextTokens ?? 0))
  return {
    recommended: row.recommended === true && row.serverless !== false,
    cheapestCapable:
      cheapest !== undefined &&
      row.toolCalling &&
      (row.contextTokens ?? 0) >= HARNESS_MIN_CONTEXT_TOKENS &&
      row.inputPerMillion !== undefined &&
      row.inputPerMillion === cheapest &&
      row.serverless !== false,
    largestContext: (row.contextTokens ?? 0) > 0 && row.contextTokens === widest,
    isNew: row.isNew === true,
  }
}
