import { useCallback, useMemo, useRef, useState } from 'react'

/** One request runner for every request the node files/Git pages make.
RVM110U2 round 3: each request of a kind runs under a generation id with
its own AbortController. Starting a request of the same kind either drops
(mutations and page turns: the previous call may still be applied on the
server, so a second one must wait for it to settle — RVM110U1 P2 #2) or,
with `supersede`, aborts the previous one and starts (a new search
invalidates its pending pages). A response is applied only while its id
is still current: late, aborted or superseded responses are dropped by
checking `isCurrent()` (and the signal) before touching state. Per-kind
busy membership disables the matching control, so Show more cannot be
double-clicked. Clearing results or submitting a new search calls
`invalidate`, which aborts the kind and retires its id. */

export type NodeRequestWork<T> = (signal: AbortSignal, isCurrent: () => boolean) => Promise<T>

export interface NodeRequestStartOptions {
  /** Abort the in-flight request of this kind and start. Default drops. */
  readonly supersede?: boolean
}

export interface NodeRequestRunner {
  /** Starts `work` unless the kind is busy (then `undefined`, dropped). */
  readonly start: <T>(
    kind: string,
    work: NodeRequestWork<T>,
    options?: NodeRequestStartOptions,
  ) => Promise<T> | undefined
  /** Aborts the kind's in-flight request and retires its id. */
  readonly invalidate: (kind: string) => void
  /** Aborts every in-flight request; locks clear as each settles. */
  readonly abortAll: () => void
  /** Kinds with an unsettled request. Disables the matching controls. */
  readonly busy: ReadonlySet<string>
}

export function useRequestRunner(): NodeRequestRunner {
  const generations = useRef(new Map<string, number>())
  const live = useRef(new Map<string, { id: number; controller: AbortController }>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const setKindBusy = useCallback((kind: string, isBusy: boolean) => {
    setBusy((previous) => {
      if (previous.has(kind) === isBusy) return previous
      const next = new Set(previous)
      if (isBusy) next.add(kind)
      else next.delete(kind)
      return next
    })
  }, [])
  const start = useCallback(
    <T>(kind: string, work: NodeRequestWork<T>, options?: NodeRequestStartOptions) => {
      const current = live.current.get(kind)
      if (current !== undefined && options?.supersede !== true) return
      current?.controller.abort()
      const id = (generations.current.get(kind) ?? 0) + 1
      generations.current.set(kind, id)
      const controller = new AbortController()
      live.current.set(kind, { id, controller })
      setKindBusy(kind, true)
      const isCurrent = () => generations.current.get(kind) === id
      const pending = (async () => {
        try {
          return await work(controller.signal, isCurrent)
        } finally {
          // Only the current id releases the kind: a superseded request
          // settles without clearing its replacement's lock, and an
          // invalidated one without clearing the next search.
          if (live.current.get(kind)?.id === id) {
            live.current.delete(kind)
            setKindBusy(kind, false)
          }
        }
      })()
      return pending
    },
    [setKindBusy],
  )
  const invalidate = useCallback(
    (kind: string) => {
      live.current.get(kind)?.controller.abort()
      generations.current.set(kind, (generations.current.get(kind) ?? 0) + 1)
      if (live.current.delete(kind)) setKindBusy(kind, false)
    },
    [setKindBusy],
  )
  const abortAll = useCallback(() => {
    for (const entry of live.current.values()) entry.controller.abort()
  }, [])
  return useMemo(() => ({ start, invalidate, abortAll, busy }), [start, invalidate, abortAll, busy])
}
