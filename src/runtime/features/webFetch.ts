import type { WebFetcher } from '../../core/web/webFetch'

export interface RuntimeWebFetchDeps {
  /** The existing pinned public-address transport and isolated converter. */
  readonly fetchPage: WebFetcher
  readonly assertCurrent: () => void
  /** Live trust, network policy and selected-model tool support. */
  readonly isOffered: () => boolean
}

/** Both backends share the real fetch; owner/policy loss cancels admission and withholds the page. */
export function createRuntimeWebFetch(deps: RuntimeWebFetchDeps) {
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const isActive = () => {
    if (ending.signal.aborted || !deps.isOffered()) return false
    try {
      deps.assertCurrent()
      return true
    } catch {
      return false
    }
  }
  const fetchPage: WebFetcher = async (url, signal, isStillAllowed) => {
    const joined = AbortSignal.any([signal, ending.signal])
    const isAllowed = () => isActive() && isStillAllowed?.() !== false
    joined.throwIfAborted()
    if (!isAllowed()) throw new Error('MHP_WEB_FETCH_UNAVAILABLE')
    const work = deps.fetchPage(url, joined, isAllowed)
    pending.add(work)
    try {
      const result = await work
      joined.throwIfAborted()
      if (!isAllowed()) throw new Error('MHP_WEB_FETCH_UNAVAILABLE')
      return result
    } finally {
      pending.delete(work)
    }
  }
  return {
    fetchPage,
    isOffered: isActive,
    dispose: (): Promise<void> => {
      ending.abort()
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
