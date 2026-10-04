// The session board's rows (M77, PLAN.md D49): every conversation in the
// window joined with its worktree, on either backend. Pure: the host
// collects sessions, worktrees, pending approvals and change counts.
//
// A conversation with no worktree still gets a row: the board shows every
// conversation, not only ones in a worktree.

import { sessionTitle } from '../shared/sessions'
import type { BoardRow } from '../shared/sessionBoard'
import { isSameFolder, type WorktreeEntry } from './worktrees'

/** One conversation the window knows, on either backend. */
export interface BoardSession {
  readonly sessionId: string
  readonly name?: string | undefined
  readonly title?: string | undefined
  readonly firstUserPrompt?: string | undefined
  readonly backend: BoardRow['backend']
  readonly status: BoardRow['status']
  /** The git branch the backend names for the conversation, when it does. */
  readonly branch?: string | undefined
  /**
   * Where the conversation runs: an attempt's worktree, or the window's own
   * checkout. Matches a worktree entry by folder first, then by branch.
   */
  readonly workspaceRoot?: string | undefined
}

/** One worktree with its change count, when git could say it. */
export interface BoardWorktree {
  readonly entry: WorktreeEntry
  readonly changedFiles?: number | undefined
}

export interface SessionBoardInput {
  readonly sessions: readonly BoardSession[]
  readonly worktrees: readonly BoardWorktree[]
  /** Conversations with an approval card or question waiting on the user. */
  readonly approvalsPending: ReadonlySet<string>
  readonly platform: NodeJS.Platform
}

function worktreeOf(
  session: BoardSession,
  worktrees: readonly BoardWorktree[],
  platform: NodeJS.Platform,
): BoardWorktree | undefined {
  const root = session.workspaceRoot
  if (root !== undefined) {
    const byFolder = worktrees.find((candidate) =>
      isSameFolder(candidate.entry.path, root, platform),
    )
    if (byFolder !== undefined) {
      return byFolder
    }
  }
  return session.branch === undefined
    ? undefined
    : worktrees.find(
        (candidate) => candidate.entry.branch === session.branch && !candidate.entry.isDetached,
      )
}

/**
 * Approvals and questions waiting on the user, window-wide (M77): every
 * surface's controller tracks its own session's prompts here, so the board
 * marks a conversation awaiting approval whatever surface raised its card.
 * Entries are prompt ids, so a replayed card never counts twice; a closed
 * session drops its entry, and a dropped host clears them all.
 */
export class PendingPrompts {
  private readonly pending = new Map<string, Set<string>>()

  /** An approval card or question now waits in this conversation. */
  public track(sessionId: string, promptId: string): void {
    let ids = this.pending.get(sessionId)
    if (ids === undefined) {
      ids = new Set()
      this.pending.set(sessionId, ids)
    }
    ids.add(promptId)
  }

  /** The prompt settled or its card went away. */
  public resolve(sessionId: string, promptId: string): void {
    const ids = this.pending.get(sessionId)
    if (ids === undefined) {
      return
    }
    ids.delete(promptId)
    if (ids.size === 0) {
      this.pending.delete(sessionId)
    }
  }

  /** The session closed: nothing in it can pend any more. */
  public drop(sessionId: string): void {
    this.pending.delete(sessionId)
  }

  /** The host went away: no tracked card can still wait on it. */
  public clear(): void {
    this.pending.clear()
  }

  /** Every conversation with a prompt waiting, for the board. */
  public pendingSessionIds(): ReadonlySet<string> {
    return new Set(this.pending.keys())
  }
}

function rankOf(status: BoardRow['status'], isAwaitingApproval: boolean): number {
  if (status === 'running') {
    return 0
  }
  return isAwaitingApproval ? 1 : 2
}

/** Every conversation as one board row: running first, then waiting, then the rest. */
export function buildSessionBoard(input: SessionBoardInput): readonly BoardRow[] {
  const rows = input.sessions.map((session): BoardRow => {
    const worktree = worktreeOf(session, input.worktrees, input.platform)
    return {
      sessionId: session.sessionId,
      title: sessionTitle(session),
      backend: session.backend,
      status: session.status,
      ...(session.branch !== undefined && { branch: session.branch }),
      ...(worktree !== undefined && { worktreePath: worktree.entry.path }),
      ...(worktree?.changedFiles !== undefined && { changedFiles: worktree.changedFiles }),
      awaitingApproval: input.approvalsPending.has(session.sessionId),
    }
  })
  return rows.toSorted((a, b) => {
    const rank = rankOf(a.status, a.awaitingApproval) - rankOf(b.status, b.awaitingApproval)
    if (rank !== 0) {
      return rank
    }
    if (a.title !== b.title) {
      return a.title < b.title ? -1 : 1
    }
    if (a.sessionId === b.sessionId) {
      return 0
    }
    return a.sessionId < b.sessionId ? -1 : 1
  })
}
