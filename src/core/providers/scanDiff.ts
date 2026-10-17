import { type UsdAmount } from '../../shared/usd'
// A model scan diffed against the last one (M95, PLAN.md D74): a fresh
// scan of each provider's models is cached with its time and diffed
// ("3 new models since the last scan", removed models and changed prices
// named). Cancellation, one-scan-at-a-time and the cache itself are lane
// K's; the pure diff and the staleness rule live here.

import { PROVIDER_SCAN_STALE_MS } from '../../shared/constants'
import { fill, plural, UI_TEXT } from '../../shared/l10n/text'

/** One scanned model row (a scan joined with capabilities and prices). */
export interface ScannedModel {
  readonly id: string
  readonly contextTokens?: number | undefined
  readonly inputUsd?: UsdAmount | undefined
  readonly outputUsd?: UsdAmount | undefined
  readonly cachedUsd?: UsdAmount | undefined
}

/** A provider's cached scan: its models and when they were fetched. */
export interface ModelScan {
  readonly providerId: string
  readonly scannedAtMs: number
  readonly models: readonly ScannedModel[]
}

/** A price that changed between scans, with both ends named. */
export interface Reprice {
  readonly id: string
  readonly field: 'inputUsd' | 'outputUsd' | 'cachedUsd'
  readonly before: UsdAmount | undefined
  readonly after: UsdAmount | undefined
}

export interface ScanDiff {
  /** Ids in the current scan but not the last (compared exactly: ids are case-sensitive). */
  readonly newIds: readonly string[]
  /** Ids in the last scan but not the current. */
  readonly removedIds: readonly string[]
  readonly repriced: readonly Reprice[]
  /** "3 new models since the last scan", in plain words. */
  readonly summary: string
}

function describeDiff(
  isFirst: boolean,
  modelCount: number,
  diff: Omit<ScanDiff, 'summary'>,
): string {
  if (isFirst) {
    return modelCount === 0
      ? UI_TEXT.providerText.scan.empty
      : plural(UI_TEXT.providerText.scan.first, modelCount)
  }
  const parts: string[] = []
  if (diff.newIds.length > 0) {
    parts.push(plural(UI_TEXT.providerText.scan.new, diff.newIds.length))
  }
  if (diff.removedIds.length > 0) {
    parts.push(plural(UI_TEXT.providerText.scan.removed, diff.removedIds.length))
  }
  if (diff.repriced.length > 0) {
    const count = new Set(diff.repriced.map((change) => change.id)).size
    parts.push(plural(UI_TEXT.providerText.scan.repriced, count))
  }
  return parts.length === 0
    ? UI_TEXT.providerText.scan.unchanged
    : fill(UI_TEXT.providerText.scan.since, { changes: parts.join(', ') })
}

/**
 * Diff a scan against the last one. A first scan (no previous) names its
 * count; otherwise new, removed and repriced models are named exactly.
 */
export function diffModelScans(previous: ModelScan | undefined, current: ModelScan): ScanDiff {
  if (previous === undefined) {
    return {
      newIds: current.models.map((model) => model.id),
      removedIds: [],
      repriced: [],
      summary: describeDiff(true, current.models.length, {
        newIds: [],
        removedIds: [],
        repriced: [],
      }),
    }
  }
  const before = new Map(previous.models.map((model) => [model.id, model]))
  const now = new Map(current.models.map((model) => [model.id, model]))
  const newIds = current.models.filter((model) => !before.has(model.id)).map((model) => model.id)
  const removedIds = previous.models.filter((model) => !now.has(model.id)).map((model) => model.id)
  const repriced: Reprice[] = []
  for (const model of current.models) {
    const old = before.get(model.id)
    if (old === undefined) {
      continue
    }
    for (const field of ['inputUsd', 'outputUsd', 'cachedUsd'] as const) {
      if (old[field] !== model[field]) {
        repriced.push({ id: model.id, field, before: old[field], after: model[field] })
      }
    }
  }
  const partial = { newIds, removedIds, repriced }
  return { ...partial, summary: describeDiff(false, current.models.length, partial) }
}

/**
 * Whether a cached scan is stale: older than `PROVIDER_SCAN_STALE_MS`, or
 * from the future (the clock moved; refetch rather than trust it).
 */
export function isScanStale(
  scannedAtMs: number,
  nowMs: number,
  staleMs: number = PROVIDER_SCAN_STALE_MS,
): boolean {
  return !Number.isFinite(scannedAtMs) || scannedAtMs > nowMs || nowMs - scannedAtMs > staleMs
}
