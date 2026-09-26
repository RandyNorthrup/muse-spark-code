// Alt+K: insert an `@path#lines` reference for the active editor selection
// into the composer. Pure orchestration over injected dependencies.

import { formatMentionReference, type MentionSource } from '../../core/mention'
import { UI_TEXT } from '../../shared/constants'
import type { ChatSurface } from '../views/chatSurface'

export interface InsertMentionDeps {
  /** The active text editor's file and selection, or undefined when none. */
  readonly activeSelection: () => MentionSource | undefined
  readonly activeSurface: () => ChatSurface | undefined
  readonly openSidebar: () => Thenable<unknown>
  readonly showInformation: (message: string) => void
}

export async function insertMentionReference(deps: InsertMentionDeps): Promise<void> {
  const source = deps.activeSelection()
  if (source === undefined) {
    deps.showInformation(UI_TEXT.insertReferenceNoEditor)
    return
  }
  const surface = deps.activeSurface()
  if (surface === undefined) {
    await deps.openSidebar()
    deps.showInformation(UI_TEXT.insertReferencePanelOpened)
    return
  }
  surface.reveal()
  surface.post({ type: 'insertText', text: `${formatMentionReference(source)} ` })
}
