// The UI state outside React (M25, PLAN.md D28). The reducer used to live in
// App's `useReducer`, so a render error that swapped the tree for the crash
// screen also dropped the conversation and every host message that arrived
// while the screen showed. The store keeps reducing whatever React does; the
// app reads it through `useSyncExternalStore`, and the persister saves it to
// VS Code's webview state so the crash screen's Reload comes back with it.

import { WEBVIEW_STATE_SAVE_MS } from '../../shared/constants'
import { isEstimatorHostMessage, parseHostToWebviewMessage } from '../../shared/protocol'
import { wireWordForLog } from '../../core/logging'
import type { ErrorReporter } from '../errorReport'
import type { MessageSource } from '../hostBridge'
import { webviewStateOf, type WebviewState } from './snapshot'
import { type UiAction, uiReducer, type UiState } from './uiState'

export interface UiStore {
  readonly getState: () => UiState
  readonly dispatch: (action: UiAction) => void
  readonly subscribe: (listener: () => void) => () => void
  /**
  The app's first render of the conversation committed: a crash after it
  is not the restored state's doing, one before it is (its transcript is
  then saved without the rows, or the reload would crash again).
  */
  readonly noteRendered: () => void
  readonly hasRendered: () => boolean
}

export function createUiStore(initial: UiState): UiStore {
  let state = initial
  let isRendered = false
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = uiReducer(state, action)
      if (next === state) {
        return
      }
      state = next
      for (const listener of listeners) {
        listener()
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    noteRendered: () => {
      isRendered = true
    },
    hasRendered: () => isRendered,
  }
}

/**
What was dropped: the message's `type` when it names one, else its shape.
Never content: only the protocol word (a non-word becomes the fixed phrase)
or the top-level key names (RLWINFIX).
*/
function describeDroppedMessage(input: unknown): string {
  if (input === null || typeof input !== 'object') return `a ${typeof input} body`
  const type = 'type' in input && typeof input.type === 'string' ? input.type : undefined
  return type === undefined
    ? `keys ${Object.keys(input).join(',')}`
    : `type ${wireWordForLog(type)}`
}

/**
Reduce every message the host posts to `target` into the store. One that
fails validation is dropped, and one the reducer throws on is lost; both
are reported to the host's log (M39). Returns the unsubscribe.
*/
export function listenToHost(
  store: UiStore,
  target: MessageSource,
  now: () => number,
  report: ErrorReporter,
): () => void {
  let generation = 0
  let isActive = true
  const isCurrent = (owner: number) => isActive && owner === generation
  const onMessage = (event: MessageEvent<unknown>) => {
    // M103 U: makerEntry routes this namespace to its own lazy schema/store.
    // Chat must not load those schemas or report valid maker traffic as a fault.
    const raw = event.data
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'type' in raw &&
      typeof raw.type === 'string' &&
      raw.type.startsWith('maker')
    )
      return
    if (isEstimatorHostMessage(event.data)) {
      const owner = generation
      void import('../../shared/estimatorProtocol')
        .then(async (parser) => {
          if (!isCurrent(owner)) return
          const parsed = await parser.parseHostToEstimatorMessage(event.data)
          if (!isCurrent(owner)) return
          if (!parsed.ok) {
            report('hostMessage', parsed.error)
            store.dispatch({
              type: 'hostMessage',
              message: {
                type: 'estimatorFailure',
                diagnostic: { estimateDiagnostic: 'invalid-input' },
              },
              at: now(),
            })
            return
          }
          store.dispatch({ type: 'hostMessage', message: parsed.message, at: now() })
        })
        .catch((error: unknown) => {
          if (!isCurrent(owner)) return
          report('hostMessage', error)
          store.dispatch({
            type: 'hostMessage',
            message: {
              type: 'estimatorFailure',
              diagnostic: { estimateDiagnostic: 'source-unavailable' },
            },
            at: now(),
          })
        })
      return
    }
    const parsed = parseHostToWebviewMessage(event.data)
    if (!parsed.ok) {
      const reason = `Dropped malformed host message (${describeDroppedMessage(event.data)}): ${parsed.error}`
      console.warn(reason)
      report('hostMessage', reason)
      // M107: a refused resource status replaces the shown one with "unavailable".
      if (
        typeof event.data === 'object' &&
        event.data !== null &&
        'type' in event.data &&
        event.data.type === 'resourceStatus'
      )
        store.dispatch({
          type: 'hostMessage',
          message: { type: 'resourceStatus', status: null },
          at: now(),
        })
      return
    }
    if (parsed.message.type === 'conversationCleared' || parsed.message.type === 'historyLoaded')
      generation++
    try {
      store.dispatch({ type: 'hostMessage', message: parsed.message, at: now() })
    } catch (error: unknown) {
      // Outside React's error boundary: without this the message would be
      // lost with no trace (M39).
      console.error(error)
      report('hostMessage', error)
    }
  }
  target.addEventListener('message', onMessage)
  return () => {
    isActive = false
    generation++
    target.removeEventListener('message', onMessage)
  }
}

export interface Persister {
  /**
  Save now (before a reload, or as the page goes away). Without the
  transcript when the state itself is what crashed the first render.
  */
  readonly flush: (isTranscriptKept: boolean) => void
}

/**
Save the store's state through `save` (VS Code's `setState`) at most once
per `delayMs` while it changes: serialising a long conversation on every
streamed delta would cost more than the delta.
*/
export function persistStore(
  store: UiStore,
  save: (state: WebviewState) => void,
  delayMs = WEBVIEW_STATE_SAVE_MS,
): Persister {
  let timer: ReturnType<typeof setTimeout> | undefined
  let saved: UiState | undefined
  const cancel = () => {
    if (timer === undefined) {
      return
    }
    clearTimeout(timer)
    timer = undefined
  }
  const write = (isTranscriptKept: boolean) => {
    cancel()
    saved = store.getState()
    save(webviewStateOf(saved, isTranscriptKept))
  }
  store.subscribe(() => {
    if (timer !== undefined || store.getState() === saved) {
      return
    }
    timer = setTimeout(() => {
      timer = undefined
      // Not while a reply streams (M39): its state changes many times a
      // second, and each save serialises the whole conversation. The turn's
      // end is a change of its own, which saves; a reload or a closing panel
      // still saves at once (`flush`).
      if (store.getState().activeTurnId !== undefined) {
        return
      }
      write(true)
    }, delayMs)
  })
  return { flush: write }
}
