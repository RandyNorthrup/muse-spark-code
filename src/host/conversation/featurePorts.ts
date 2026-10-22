// The conversation controller's M88 ports (PLAN.md D67, lane P): the
// bookmark store and the sequence store behind them. The controller answers
// the panels' bookmark and sequence messages through these, and refuses
// with an explicit error while one is missing.

import type { BackendKind, BookmarkRecord } from '../../shared/protocol'
import type { SavedSequence, SequenceScope } from '../../shared/sequences'
import { UI_TEXT } from '../../shared/constants'

/** A workspace's bookmarks, as the store keeps them. */
export interface BookmarkPort {
  /** Every record filed under this workspace, oldest first. */
  list(): Promise<readonly BookmarkRecord[]>
  /**
  Set or remove one bookmark; answers the workspace's records after. A
  window without a folder refuses with `bookmarkNoWorkspace`.
  */
  set(input: {
    readonly backend: BackendKind
    readonly sessionId: string
    readonly title: string
    readonly isBookmarked: boolean
  }): Promise<readonly BookmarkRecord[]>
  /** Whether the session is bookmarked in this workspace. */
  has(backend: BackendKind, sessionId: string): Promise<boolean>
  /**
  Refresh stored titles from listed rows; answers the records after. A
  session the list no longer names keeps its stored title.
  */
  refreshTitles(
    rows: readonly { readonly sessionId: string; readonly title: string }[],
  ): Promise<readonly BookmarkRecord[]>
}

/** The prompt sequence library both scopes keep. */
export interface SequencePort {
  /** False without a folder: the workspace scope is then unavailable. */
  readonly hasWorkspace: boolean
  /** User first, then workspace, in library order. */
  library(): Promise<readonly SavedSequence[]>
  /**
  Save a new or edited sequence; answers the saved row. A blank name, no
  steps, or a blank step refuses in words; a workspace sequence without a
  folder refuses too.
  */
  save(sequence: SavedSequence): Promise<SavedSequence>
  /** Remove one sequence; an id that is already gone resolves. */
  remove(scope: SequenceScope, id: string): Promise<void>
}

/**
The bookmark failure the person may read (as `safePromptFailure`): a
message from the known fixed list, or the fixed unavailable words. The
boundary discards the original cause by design — it may hold a path —
so only this function's answer ever crosses it.
*/
export function safeBookmarkFailure(error: unknown): Error {
  const safeMessages = [UI_TEXT.bookmarkNoWorkspace, UI_TEXT.bookmarksUnavailable]
  return new Error(
    error instanceof Error && safeMessages.includes(error.message)
      ? error.message
      : UI_TEXT.bookmarksUnavailable,
  )
}

/**
The sequence failure the person may read: a message from the known fixed
list, or the fixed unavailable words. Same boundary as above.
*/
export function safeSequenceFailure(error: unknown): Error {
  const safeMessages = [
    UI_TEXT.promptTitleRequired,
    UI_TEXT.sequenceStepRequired,
    UI_TEXT.sequenceNeedsStep,
    UI_TEXT.promptWorkspaceRequired,
    UI_TEXT.promptStoreDamaged,
    UI_TEXT.promptStoreBusy,
    UI_TEXT.sequencesUnavailable,
  ]
  return new Error(
    error instanceof Error && safeMessages.includes(error.message)
      ? error.message
      : UI_TEXT.sequencesUnavailable,
  )
}
