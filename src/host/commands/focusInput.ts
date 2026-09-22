// Ctrl+Esc: toggle keyboard focus between the editor and the chat composer.
// Pure orchestration over injected dependencies so it is unit-tested without
// VS Code.

import type { ChatSurface } from '../views/webviewSetup'

export interface FocusInputDeps {
  /** Current value of the `museSpark.inputFocused` context key. */
  readonly isInputFocused: () => boolean
  readonly activeSurface: () => ChatSurface | undefined
  readonly focusEditor: () => Thenable<unknown>
  /** Opens (and focuses) the sidebar view when no surface exists yet. */
  readonly openSidebar: () => Thenable<unknown>
}

export async function toggleInputFocus(deps: FocusInputDeps): Promise<void> {
  if (deps.isInputFocused()) {
    await deps.focusEditor()
    return
  }
  const surface = deps.activeSurface()
  if (surface === undefined) {
    // The view resolves asynchronously; the composer focuses itself on init.
    await deps.openSidebar()
    return
  }
  surface.reveal()
  surface.post({ type: 'focusInput' })
}
