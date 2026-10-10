// The latest local draft behind a composite editor (M96 U1, RVCM962
// finding 2): the host owns the value, but the user edits faster than a
// host round-trip. Every edit builds on the latest local draft (a
// functional update), never on host props that may be stale, so rapid
// consecutive edits cannot overwrite each other before the host's reply
// renders. A host value that matches the draft or a value already sent is
// an echo and keeps the draft; anything else (reapply, reset, import, a
// suggestion) replaces it.
import { useLayoutEffect, useRef, useState } from 'react'

const SENT_HISTORY_LIMIT = 16

interface DraftState<T> {
  readonly prop: T
  readonly draft: T
  readonly sent: readonly string[]
}

/**
 * @param prop the host-owned value, referentially stable across renders
 * that carry no new host data (a value rebuilt every render needs a
 * useMemo on its host inputs, or every local render looks external).
 */
export function usePropDraft<T>(prop: T): [draft: T, update: (next: (previous: T) => T) => T] {
  const [state, setState] = useState<DraftState<T>>({ prop, draft: prop, sent: [] })
  // Event handlers read the latest draft through this mirror: state from
  // the render closure may predate an edit posted earlier in the same tick.
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })
  if (state.prop !== prop) {
    const arrived = JSON.stringify(prop)
    const echoed = state.sent.indexOf(arrived)
    if (echoed !== -1 || arrived === JSON.stringify(state.draft)) {
      setState({
        prop,
        draft: state.draft,
        sent: echoed === -1 ? [] : state.sent.slice(echoed + 1),
      })
    } else {
      setState({ prop, draft: prop, sent: [] })
    }
  }
  const update = (next: (previous: T) => T): T => {
    const value = next(latest.current.draft)
    const sent = [...latest.current.sent, JSON.stringify(value)].slice(-SENT_HISTORY_LIMIT)
    latest.current = { prop: latest.current.prop, draft: value, sent }
    setState(latest.current)
    return value
  }
  return [state.draft, update]
}
