// The model scans' cache and diff (M95 lane K, PLAN.md D74): a fresh scan
// of each provider's models on add, on Refresh, and when its cached scan is
// stale (older than `PROVIDER_SCAN_STALE_MS`, or a newer catalogue
// snapshot). Cached with its time, cancellable, one at a time per provider,
// and diffed against the last scan ("3 new models since the last scan",
// removed models and changed prices named). The fetch and parse stay
// behind `ModelFetcher` (lanes P and T, from the captures); prices stay
// behind the rows' fingerprint, which lane P computes from its price card.

import { PROVIDER_SCAN_STALE_MS, UI_TEXT } from '../../shared/constants'
import { plural } from '../../shared/l10n/text'
import type { ModelFetcher, ProviderEntry, ProviderModelRow } from './providerPorts'

/** One cached scan: the rows with the time they were fetched. */
export interface ModelScan {
  readonly providerId: string
  readonly fetchedAt: number
  /** Lane C's catalogue token when the scan ran; a newer one stales the scan. */
  readonly catalogue: string | undefined
  readonly rows: readonly ProviderModelRow[]
}

/** The scans' persistence (VS Code global state in production). */
export interface ScanStore {
  load(): Promise<readonly ModelScan[]>
  save(scans: readonly ModelScan[]): Promise<void>
}

export interface ModelScannerDeps {
  readonly fetch: ModelFetcher
  /** The provider's credential; undefined for a local server without auth. */
  readonly credentialFor: (entry: ProviderEntry) => Promise<string | undefined>
  readonly store: ScanStore
  readonly now: () => number
  readonly staleMs?: number | undefined
}

/** New, removed and repriced model ids against the last scan. */
export interface ScanDiff {
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly repriced: readonly string[]
}

export interface ScanOutcome {
  readonly rows: readonly ProviderModelRow[]
  /** Against the last scan; undefined when there was none, or from cache. */
  readonly diff: ScanDiff | undefined
  readonly fromCache: boolean
}

export interface ScanRequest {
  /** Skips a fresh cache (Refresh, or after adding the provider). */
  readonly refresh?: boolean | undefined
  /** Lane C's current catalogue token; a newer one stales the cache. */
  readonly catalogue?: string | undefined
}

/**
 * Diffs a scan against the last one. Ids compare exactly: `Model` and
 * `model` are different models, and only an identical id with a changed
 * price fingerprint is repriced.
 */
export function diffScans(
  previous: readonly ProviderModelRow[] | undefined,
  current: readonly ProviderModelRow[],
): ScanDiff {
  const before = new Map(previous?.map((row) => [row.id, row]))
  const after = new Map(current.map((row) => [row.id, row]))
  return {
    added: current.filter((row) => !before.has(row.id)).map((row) => row.id),
    removed: (previous ?? []).filter((row) => !after.has(row.id)).map((row) => row.id),
    repriced: current
      .filter((row) => {
        const old = before.get(row.id)
        return old !== undefined && old.priceFingerprint !== row.priceFingerprint
      })
      .map((row) => row.id),
  }
}

/** The diff in the panel's words; empty when nothing changed. */
export function scanDiffLines(diff: ScanDiff): readonly string[] {
  const lines: string[] = []
  if (diff.added.length > 0) {
    lines.push(plural(UI_TEXT.scanNewModels, diff.added.length))
  }
  if (diff.removed.length > 0) {
    lines.push(plural(UI_TEXT.scanRemovedModels, diff.removed.length))
  }
  if (diff.repriced.length > 0) {
    lines.push(plural(UI_TEXT.scanRepricedModels, diff.repriced.length))
  }
  return lines
}

/**
 * Re-reads the mutable abort state after awaits (as `isAbortRequested` in
 * `ModelApiHost`): a cancellation from another call lands between two
 * reads of the same signal.
 */
function isScanCancelled(signal: AbortSignal): boolean {
  return signal.aborted
}

function isFresh(
  scan: ModelScan,
  now: number,
  staleMs: number,
  catalogue: string | undefined,
): boolean {
  return (
    now - scan.fetchedAt < staleMs &&
    (catalogue === undefined || scan.catalogue === undefined || scan.catalogue === catalogue)
  )
}

/**
 * The scans, one at a time per provider: concurrent scans of one provider
 * join the running one, and a cancelled scan leaves the last scan standing.
 */
export function createModelScanner(deps: ModelScannerDeps): {
  readonly scan: (entry: ProviderEntry, request?: ScanRequest) => Promise<ScanOutcome>
  readonly cancelScan: (providerId: string) => boolean
} {
  const staleMs = deps.staleMs ?? PROVIDER_SCAN_STALE_MS
  let persistence = Promise.resolve()
  const running = new Map<
    string,
    { readonly promise: Promise<ScanOutcome>; readonly cancel: () => void }
  >()

  // One scan per provider at a time: the running scan is registered before
  // the first await, so a concurrent scan joins it instead of fetching.
  const scan = (entry: ProviderEntry, request: ScanRequest = {}): Promise<ScanOutcome> => {
    const joined = running.get(entry.id)
    if (joined !== undefined) {
      return joined.promise
    }
    const controller = new AbortController()
    const promise = (async (): Promise<ScanOutcome> => {
      const stored = await deps.store.load()
      const cached = stored.find((scan) => scan.providerId === entry.id)
      const hasPrevious = cached !== undefined
      const previousRows: readonly ProviderModelRow[] = cached === undefined ? [] : cached.rows
      if (
        cached !== undefined &&
        request.refresh !== true &&
        isFresh(cached, deps.now(), staleMs, request.catalogue)
      ) {
        return { rows: previousRows, diff: undefined, fromCache: true }
      }
      const credential = await deps.credentialFor(entry)
      if (isScanCancelled(controller.signal)) {
        return { rows: previousRows, diff: undefined, fromCache: true }
      }
      let fetched: readonly ProviderModelRow[]
      try {
        const answer = await deps.fetch.fetchModels(entry, credential, controller.signal)
        fetched = answer.rows
      } catch (error: unknown) {
        // A cancelled scan leaves the last scan standing, whatever the
        // fetch answered with.
        if (isScanCancelled(controller.signal)) {
          return { rows: previousRows, diff: undefined, fromCache: true }
        }
        throw error
      }
      if (isScanCancelled(controller.signal)) {
        return { rows: previousRows, diff: undefined, fromCache: true }
      }
      const outcome: ScanOutcome = {
        rows: fetched,
        diff: hasPrevious ? diffScans(previousRows, fetched) : undefined,
        fromCache: false,
      }
      const previousPersistence = persistence
      const saved = (async () => {
        await previousPersistence
        if (isScanCancelled(controller.signal)) {
          return
        }
        const kept = await deps.store.load()
        await deps.store.save([
          ...kept.filter((scan) => scan.providerId !== entry.id),
          {
            providerId: entry.id,
            fetchedAt: deps.now(),
            catalogue: request.catalogue,
            rows: fetched,
          },
        ])
      })()
      persistence = (async () => {
        try {
          await saved
        } catch {
          return
        }
      })()
      await saved
      return outcome
    })()
    running.set(entry.id, {
      promise,
      cancel: () => {
        controller.abort()
      },
    })
    // The map owns the running scan, never the scan itself: settling forgets
    // it, whatever the outcome was.
    const forget = (): void => {
      if (running.get(entry.id)?.promise === promise) {
        running.delete(entry.id)
      }
    }
    void promise.then(forget).catch(forget)
    return promise
  }

  return {
    scan,
    cancelScan: (providerId) => {
      const active = running.get(providerId)
      if (active === undefined) {
        return false
      }
      active.cancel()
      return true
    },
  }
}
