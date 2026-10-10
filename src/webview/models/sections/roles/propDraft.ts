// The latest local draft behind a composite editor (M96 U1, RVCM962
// finding 2): the host owns the value, but the user edits faster than a
// host round-trip. Every edit builds on the latest local draft (a
// functional update), never on host props that may be stale, so rapid
// consecutive edits cannot overwrite each other before the host's reply
// renders. Unchanged cloned host values answer no fields. Changed object
// fields reconcile independently: echoes keep pending edits, while external
// values (reapply, reset, import, suggestions) replace the fields they answer.
import { useLayoutEffect, useRef, useState } from 'react'

interface DraftState<T> {
  readonly prop: T
  readonly draft: T
  readonly sent: readonly T[]
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? Reflect.get(value, key) : undefined
}

function applyReply(previous: unknown, arrived: unknown, draft: object, sent: readonly unknown[]) {
  const keys = new Set([
    ...Object.keys(isObject(previous) ? previous : {}),
    ...Object.keys(isObject(arrived) ? arrived : {}),
  ])
  for (const key of keys) {
    const before = field(previous, key)
    const value = field(arrived, key)
    if (JSON.stringify(value) === JSON.stringify(before)) continue
    const pending = sent.map((item) => field(item, key))
    if (pending.some((item) => JSON.stringify(item) === JSON.stringify(value))) continue
    const local = field(draft, key)
    // Caps within the same entry answer independently too. Structural array
    // changes are whole values; equal-length arrays reconcile their fields.
    if (
      isObject(value) &&
      isObject(before) &&
      isObject(local) &&
      (!Array.isArray(value) ||
        (Array.isArray(before) &&
          Array.isArray(local) &&
          value.length === before.length &&
          value.length === local.length))
    )
      applyReply(before, value, local, pending)
    else if (!isObject(arrived) || !Object.hasOwn(arrived, key)) Reflect.deleteProperty(draft, key)
    else Reflect.set(draft, key, value)
  }
}

/**
 * @param prop the host-owned value, referentially stable across renders
 * that carry no new host data (a value rebuilt every render needs a
 * useMemo on its host inputs, or every local render looks external).
 */
export function usePropDraft<T extends object | undefined>(
  prop: T,
): [draft: T, update: (next: (previous: T) => T) => T] {
  const [state, setState] = useState<DraftState<T>>({ prop, draft: prop, sent: [] })
  // Event handlers read the latest draft through this mirror: state from
  // the render closure may predate an edit posted earlier in the same tick.
  const latest = useRef(state)
  useLayoutEffect(() => {
    latest.current = state
  })
  if (state.prop !== prop) {
    const arrived = JSON.stringify(prop)
    const echoed = state.sent.findIndex((value) => JSON.stringify(value) === arrived)
    if (arrived === JSON.stringify(state.prop)) {
      setState({ ...state, prop })
    } else if (echoed !== -1 || arrived === JSON.stringify(state.draft)) {
      setState({
        prop,
        draft: state.draft,
        sent: echoed === -1 ? [] : state.sent.slice(echoed + 1),
      })
    } else if (state.draft !== undefined && !Array.isArray(state.draft)) {
      const draft = structuredClone(state.draft)
      applyReply(state.prop, prop, draft, state.sent)
      setState({ prop, draft, sent: state.sent })
    } else {
      setState({ prop, draft: prop, sent: [] })
    }
  }
  const update = (next: (previous: T) => T): T => {
    const value = next(latest.current.draft)
    const sent = [...latest.current.sent, value]
    latest.current = { prop: latest.current.prop, draft: value, sent }
    setState(latest.current)
    return value
  }
  return [state.draft, update]
}
