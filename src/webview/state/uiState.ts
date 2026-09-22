// Webview UI state: a pure reducer over host messages and local edits. No DOM
// access here; the components apply focus and caret changes.

import type { HostToWebviewMessage, SettingsSnapshot } from '../../shared/protocol'

export interface UiState {
  readonly phase: 'connecting' | 'ready'
  readonly extensionVersion: string
  readonly emptyStateHint: string
  readonly composerPlaceholder: string
  readonly settings: SettingsSnapshot | undefined
  readonly draft: string
  /** Incremented per host `focusInput`; the composer focuses when it changes. */
  readonly focusRequests: number
  /** Text waiting to be inserted at the composer caret, if any. */
  readonly pendingInsert: string | undefined
}

export type UiAction =
  | { readonly type: 'hostMessage'; readonly message: HostToWebviewMessage }
  | { readonly type: 'draftChanged'; readonly draft: string }
  | { readonly type: 'insertApplied' }

export const initialUiState: UiState = {
  phase: 'connecting',
  extensionVersion: '',
  emptyStateHint: '',
  composerPlaceholder: '',
  settings: undefined,
  draft: '',
  focusRequests: 0,
  pendingInsert: undefined,
}

function applyHostMessage(state: UiState, message: HostToWebviewMessage): UiState {
  switch (message.type) {
    case 'init': {
      return {
        ...state,
        phase: 'ready',
        extensionVersion: message.extensionVersion,
        emptyStateHint: message.emptyStateHint,
        composerPlaceholder: message.composerPlaceholder,
        settings: message.settings,
        // Opening the panel puts the caret in the composer, like Claude Code.
        focusRequests: state.focusRequests + 1,
      }
    }
    case 'settingsChanged': {
      return { ...state, settings: message.settings }
    }
    case 'focusInput': {
      return { ...state, focusRequests: state.focusRequests + 1 }
    }
    case 'insertText': {
      return {
        ...state,
        pendingInsert: (state.pendingInsert ?? '') + message.text,
        focusRequests: state.focusRequests + 1,
      }
    }
  }
}

export function uiReducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case 'hostMessage': {
      return applyHostMessage(state, action.message)
    }
    case 'draftChanged': {
      return { ...state, draft: action.draft }
    }
    case 'insertApplied': {
      return { ...state, pendingInsert: undefined }
    }
  }
}
