import type { StoredSession } from '../../../src/core/backends/modelapi/sessionStore'
import { STORED_SESSION_VERSION } from '../../../src/shared/constants'

/** A valid saved parent session seeding the voice budget journal in tests. */
export function fakeParentSession(sessionId: string, accountId: string): StoredSession {
  return {
    version: STORED_SESSION_VERSION,
    sessionId,
    accountId,
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
    effort: 'high',
    createdAt: '2026-09-29T00:00:00Z',
    lastActivityAt: '2026-09-29T00:00:00Z',
    turnIds: [],
    todos: [],
    replay: [],
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}
