// Alt+K: insert an `@path#lines` reference for the active editor selection
// into the composer. Pure orchestration over injected dependencies.

import { formatMentionReference, type MentionSource } from '../../core/mention'
import type { ChatSurface } from '../views/webviewSetup'

export interface InsertMentionDeps {
  /** The active text editor's file and selection, or undefined when none. */
  readonly activeSelection: () => MentionSource | undefined
  readonly activeSurface: () => ChatSurface | undefined
  readonly openSidebar: () => Thenable<unknown>
  readonly showInformation: (message: string) => void
}

export const NO_EDITOR_MESSAGE = 'Open a file in an editor to insert a reference to it.'
export const NO_SURFACE_MESSAGE =
  'Opened the Muse Spark panel. Press Alt+K again to insert the reference.'

export async function insertMentionReference(deps: InsertMentionDeps): Promise<void> {
  const source = deps.activeSelection()
  if (source === undefined) {
    deps.showInformation(NO_EDITOR_MESSAGE)
    return
  }
  const surface = deps.activeSurface()
  if (surface === undefined) {
    await deps.openSidebar()
    deps.showInformation(NO_SURFACE_MESSAGE)
    return
  }
  surface.reveal()
  surface.post({ type: 'insertText', text: `${formatMentionReference(source)} ` })
}
