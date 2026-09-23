// The UI state outside React (M25, PLAN.md D28). The reducer used to live in
// App's `useReducer`, so a render error that swapped the tree for the crash
// screen also dropped the conversation and every host message that arrived
// while the screen showed. The store keeps reducing whatever React does; the
// app reads it through `useSyncExternalStore`, and the persister saves it to
// VS Code's webview state so the crash screen's Reload comes back with it.

import { WEBVIEW_STATE_SAVE_MS } from '../../shared/constants'
import { parseHostToWebviewMessage } from '../../shared/protocol'
import { webviewStateOf, type WebviewState } from './snapshot'
import { type UiAction, uiReducer, type UiState } from './uiState'

export interface UiStore {
  readonly getState: () => UiState
  readonly dispatch: (action: UiAction) => void
  readonly subscribe: (listener: () => void) => () => void
  /**
   * The app's first render of the conversation committed: a crash after it
   * is not the restored state's doing, one before it is (its transcript is
   * then saved without the rows, or the reload would crash again).
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
 * Reduce every message the host posts to `target` into the store; anything
 * that fails validation is dropped with a warning. Returns the unsubscribe.
 */
export function listenToHost(store: UiStore, target: Window, now: () => number): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    const parsed = parseHostToWebviewMessage(event.data)
    if (!parsed.ok) {
      console.warn(`Dropped malformed host message: ${parsed.error}`)
      return
    }
    store.dispatch({ type: 'hostMessage', message: parsed.message, at: now() })
  }
  target.addEventListener('message', onMessage)
  return () => {
    target.removeEventListener('message', onMessage)
  }
}

export interface Persister {
  /**
   * Save now (before a reload, or as the page goes away). Without the
   * transcript when the state itself is what crashed the first render.
   */
  readonly flush: (isTranscriptKept: boolean) => void
}

/**
 * Save the store's state through `save` (VS Code's `setState`) at most once
 * per `delayMs` while it changes: serialising a long conversation on every
 * streamed delta would cost more than the delta.
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
      write(true)
    }, delayMs)
  })
  return { flush: write }
}
