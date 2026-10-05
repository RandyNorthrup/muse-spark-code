// The session board's host side (M77, PLAN.md D49): sessions from the
// backend's list, this surface's running turn, the window's pending prompts,
// and git's worktrees with their change counts, assembled into board rows.
//
// Git never runs in Restricted Mode (D24): there the rows carry the
// sessions' own branch, without worktree folders or change counts. In a
// trusted workspace it runs as the prompt's metadata reads do (`metadataGit`):
// opening the board starts no fsmonitor, filter or other program the
// repository configures, and takes no index lock. A worktree whose status git
// cannot read keeps its row with an unknown count: the board shows every
// conversation either way.

import type { AgentHost, SessionRecord } from '../core/agent/agentBackend'
import {
  buildSessionBoard,
  type BoardSession,
  type BoardWorktree,
  type PendingPrompts,
} from '../core/sessionBoard'
import { parseWorktreeList } from '../core/worktrees'
import { redactSecrets } from '../core/redact'
import type { BoardRow } from '../shared/sessionBoard'
import type { BestOfNRun } from '../shared/bestOfN'
import {
  GIT_WORKTREE_TIMEOUT_MS,
  SESSION_LIST_LIMIT,
  SESSION_LIST_MAX_PAGES,
} from '../shared/constants'
import { metadataGit } from './git'
import type { Logger } from './logger'

export interface SessionBoardDeps {
  readonly ensureHost: () => Promise<AgentHost>
  readonly backendOf: (host: AgentHost) => BoardRow['backend']
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  /** git in `cwd`: its stdout, or a rejection with git's own words. */
  readonly runGit: (args: readonly string[], cwd: string, timeoutMs?: number) => Promise<string>
  readonly platform: NodeJS.Platform
  /** This surface's session and its open turn, when it has them. */
  readonly currentSessionId: string | undefined
  readonly currentTurnId: string | undefined
  readonly pendingPrompts: PendingPrompts
  readonly attemptRuns?: readonly BestOfNRun[]
  readonly liveSessions?: readonly BoardSession[] | undefined
  readonly log: Logger
}

const WORKTREE_LIST_ARGS = ['worktree', 'list', '--porcelain']
const STATUS_ARGS = ['status', '--porcelain=v1']
const LINE_BREAK = /\r?\n/

function recordSession(
  record: SessionRecord,
  backend: BoardRow['backend'],
  runningSessionIds: ReadonlySet<string>,
): BoardSession {
  return {
    sessionId: record.sessionId,
    ...(record.name !== undefined && { name: record.name }),
    ...(record.title !== undefined && { title: record.title }),
    ...(record.firstUserPrompt !== undefined && { firstUserPrompt: record.firstUserPrompt }),
    backend,
    status:
      runningSessionIds.has(record.sessionId) || record.status === 'running' ? 'running' : 'idle',
    ...(record.branch !== undefined && { branch: record.branch }),
    ...(record.workspaceRoot !== undefined &&
      record.workspaceRoot !== null && { workspaceRoot: record.workspaceRoot }),
  }
}

async function readWorktrees(deps: SessionBoardDeps): Promise<readonly BoardWorktree[]> {
  const { workspaceRoot } = deps
  if (workspaceRoot === undefined || !deps.isWorkspaceTrusted()) {
    return []
  }
  let porcelain: string
  try {
    const git = await metadataGit(deps.runGit, workspaceRoot)
    porcelain = await git(WORKTREE_LIST_ARGS, GIT_WORKTREE_TIMEOUT_MS)
  } catch (error: unknown) {
    const detail = redactSecrets(error instanceof Error ? error.message : String(error))
    deps.log.warn(`The session board could not list worktrees: ${detail}`)
    return []
  }
  const entries = parseWorktreeList(porcelain)
  const worktrees: BoardWorktree[] = []
  for (const entry of entries) {
    if (!deps.isWorkspaceTrusted()) {
      break
    }
    let changedFiles: number | undefined
    try {
      // Read in each worktree: its effective configuration names its filters.
      const git = await metadataGit(deps.runGit, entry.path)
      const status = await git(STATUS_ARGS, GIT_WORKTREE_TIMEOUT_MS)
      changedFiles = status.split(LINE_BREAK).filter((line) => line !== '').length
    } catch {
      deps.log.warn('The session board could not read a worktree’s changes')
    }
    worktrees.push({ entry, ...(changedFiles !== undefined && { changedFiles }) })
  }
  return worktrees
}

/** Every conversation in the window as one board row. */
export async function collectSessionBoard(deps: SessionBoardDeps): Promise<readonly BoardRow[]> {
  const host = await deps.ensureHost()
  const backend = deps.backendOf(host)
  const worktrees = await readWorktrees(deps)
  const records: SessionRecord[] = []
  const roots = new Set([deps.workspaceRoot, ...worktrees.map((worktree) => worktree.entry.path)])
  for (const root of roots) {
    if (root === undefined) {
      continue
    }
    let cursor: string | undefined
    for (
      let page = 0;
      page < SESSION_LIST_MAX_PAGES && (page === 0 || cursor !== undefined);
      page += 1
    ) {
      const result = await host.listSessions({
        workspaceRoot: root,
        limit: SESSION_LIST_LIMIT,
        ...(cursor !== undefined && { cursor }),
      })
      records.push(
        ...result.sessions.filter((record) =>
          records.every((seen) => seen.sessionId !== record.sessionId),
        ),
      )
      cursor = result.nextCursor
    }
  }
  const runningSessionIds = new Set<string>()
  if (deps.currentSessionId !== undefined && deps.currentTurnId !== undefined) {
    runningSessionIds.add(deps.currentSessionId)
  }
  const sessions = records.map((record) => recordSession(record, backend, runningSessionIds))
  const liveSessions = deps.liveSessions ?? []
  for (const live of liveSessions) {
    const index = sessions.findIndex(
      (session) => session.sessionId === live.sessionId && session.backend === live.backend,
    )
    const old = sessions[index]
    if (old === undefined) {
      sessions.push(live)
    } else {
      sessions[index] = { ...old, ...live }
    }
  }
  const attemptRuns = deps.attemptRuns ?? []
  for (const run of attemptRuns) {
    for (const attempt of run.runAttempts) {
      if (
        attempt.sessionId === undefined ||
        sessions.some(
          (session) => session.backend === 'modelApi' && session.sessionId === attempt.sessionId,
        )
      ) {
        continue
      }
      sessions.push({
        sessionId: attempt.sessionId,
        title: run.prompt,
        backend: 'modelApi',
        status: attempt.status === 'running' ? 'running' : 'idle',
        branch: attempt.branch,
        workspaceRoot: attempt.worktreePath,
      })
    }
  }
  const currentId = deps.currentSessionId
  const isCurrentListed =
    currentId !== undefined && sessions.some((session) => session.sessionId === currentId)
  if (!isCurrentListed && currentId !== undefined) {
    sessions.push({
      sessionId: currentId,
      backend,
      status: deps.currentTurnId === undefined ? 'idle' : 'running',
    })
  }
  return buildSessionBoard({
    sessions,
    worktrees,
    approvalsPending: deps.pendingPrompts.pendingSessionIds(),
    platform: deps.platform,
  })
}
