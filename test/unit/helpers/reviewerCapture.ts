// One review turn of the Auto reviewer's side session (M90, PLAN.md D69), as
// Muse Code 1.4.2-R4684.1 sent it live on 2026-10-03 (docs/certification/
// m90.md, scratchpad m90-live/probe-reviewer.jsonl): `muse serve` in an empty
// temporary workspace, the side session started in an empty folder of its
// own, `denyUnmatched`, `reasoningEffort: none`, muse-spark-1.3-contributor;
// four model attempts (the reply and three reminder children). Ids,
// cursors and times are the captured ones unless a test names its own.

/** The reply the captured review gave. */
export const CAPTURED_REPLY = 'ALLOW: reads workspace file to fulfill line-count request'

/** `session/start`'s answer for a side session in `workspaceRoot`. */
export function sideSessionStarted(
  sessionId: string,
  workspaceRoot: unknown,
  modelId: unknown,
): Record<string, unknown> {
  return {
    session: {
      sessionId,
      status: 'idle',
      activeTurnId: null,
      createdAt: '2026-10-04T02:42:02.041559Z',
      updatedAt: '2026-10-04T02:42:02.041563Z',
      workspaceRoot,
      providerId: 'meta',
      modelId,
      turnCount: 0,
      forkedFrom: null,
      approvalMode: { mode: 'denyUnmatched', source: 'startup' },
    },
  }
}

/** `turn/start`'s answer (the captured turn id is the command id). */
export function reviewTurnStarted(commandId: unknown, turnId: string): Record<string, unknown> {
  return {
    commandId,
    status: 'accepted',
    turnId,
    startedNewTurn: true,
    disposition: 'started',
  }
}

/** The reply as it streamed: the agent message started, two deltas, completed. */
export function reviewReplyFrames(
  sessionId: string,
  turnId: string,
  text: string,
): readonly { readonly method: string; readonly params: Record<string, unknown> }[] {
  const itemId = `${turnId}-reply`
  const half = Math.ceil(text.length / 2)
  return [
    {
      method: 'item/started',
      params: {
        sessionId,
        viewCursor: `v:${sessionId}:6.1`,
        item: { itemId, kind: 'agentMessage', turnId, revision: 1, status: 'inProgress', text: '' },
      },
    },
    {
      method: 'item/delta',
      params: { sessionId, itemId, field: 'text', delta: text.slice(0, half) },
    },
    {
      method: 'item/delta',
      params: { sessionId, itemId, field: 'text', delta: text.slice(half) },
    },
    {
      method: 'item/completed',
      params: {
        sessionId,
        viewCursor: `v:${sessionId}:7`,
        item: {
          itemId,
          kind: 'agentMessage',
          turnId,
          revision: 2,
          status: 'completed',
          recordedAt: '2026-10-04T02:42:12.246457Z',
          text,
        },
      },
    },
  ]
}

/** A reminder child (`skill-reminder`), which finishes after the reply. */
export function reminderChildFrame(sessionId: string, turnId: string): Record<string, unknown> {
  return {
    sessionId,
    viewCursor: `v:${sessionId}:10`,
    item: {
      itemId: `${turnId}-reminder`,
      kind: 'reminderChild',
      turnId,
      revision: 2,
      status: 'completed',
      recordedAt: '2026-10-04T02:42:12.958931Z',
      fallbackText: 'Reminder child session',
      childSessionId: 'c71a0801-90e6-49c1-8bfa-c0b91ab14fda',
      reminderAgentId: 'skill-reminder',
      generationId: 1,
    },
  }
}

/** `turn/completed` for the review turn. */
export function reviewTurnCompleted(
  sessionId: string,
  turnId: string,
  terminal = 'completed',
): Record<string, unknown> {
  return {
    sessionId,
    viewCursor: `v:${sessionId}:15`,
    turnId,
    terminal,
    durationMs: 9617,
    timeToFirstTokenMs: 5449,
  }
}
