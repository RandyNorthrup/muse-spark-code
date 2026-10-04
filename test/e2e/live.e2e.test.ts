// The one live conversation drill (PLAN.md D16): the real Muse Code CLI, the
// owner's own sign-in, one short turn, counted. Opt-in only, never in CI:
// it bills the owner's subscription, so it runs when MUSE_LIVE_E2E=1 and in
// an empty temporary workspace (no rules files). The cost is read from the
// CLI's own trace log for the session: one log per `muse serve` process,
// readable once that process has exited. Measured 2026-09-22 (Muse Code
// 1.3.0): a reply-only turn is 25 to 45 model attempts across three runs on
// 2026-09-22/23 (31, then 45, then 25 for a turn with two denied spawns): one
// for the answer and the rest for the CLI's three bundled reminder agents
// (goal, skill, verify) that run after it, whose loops vary from turn to turn.
// The budget below is that reality with headroom, so a regression past it
// fails the drill rather than the owner's plan.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { countAttempts, LIVE_MODEL_ID, liveBackend, sessionLog } from './liveCli'

const IS_ENABLED = process.env['MUSE_LIVE_E2E'] === '1'
const TURN_TIMEOUT_MS = 180_000
const ATTEMPT_BUDGET = 60
const PROMPT = 'Reply with exactly the word OK and nothing else.'

/** One turn on the real CLI: the session id and the streamed reply text. */
async function runDrill(workspaceRoot: string): Promise<{ sessionId: string; text: string }> {
  const backend = liveBackend(workspaceRoot, '0.0.0-live-e2e', new FakeLogOutputChannel())
  const events: AgentEvent[] = []
  try {
    const host = await backend.ensureHost()
    const session = await host.startSession({
      workspaceRoot,
      modelId: LIVE_MODEL_ID,
      approvalMode: 'denyUnmatched',
    })
    const done = new Promise<AgentEvent>((resolve) => {
      session.onEvent((event) => {
        events.push(event)
        if (event.type === 'turnCompleted') {
          resolve(event)
        }
      })
    })
    await session.sendTurn([{ type: 'text', text: PROMPT }])
    expect(await done).toMatchObject({ type: 'turnCompleted', terminal: 'completed' })
    return {
      sessionId: session.sessionId,
      text: events.flatMap((event) => (event.type === 'textDelta' ? [event.delta] : [])).join(''),
    }
  } finally {
    await backend.dispose()
  }
}

describe.skipIf(!IS_ENABLED)('live Muse Code conversation (MUSE_LIVE_E2E=1)', () => {
  // Made here, not at import, so a skipped drill leaves no empty folder.
  let workspaceRoot = ''
  beforeAll(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'muse-live-e2e-'))
  })
  afterAll(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it(
    'runs one reply-only turn on the real CLI within the attempt budget',
    async () => {
      const { sessionId, text } = await runDrill(workspaceRoot)
      const attempts = countAttempts(await sessionLog(sessionId))
      // The count is the record the certification quotes. Vitest 5 hides a
      // passing test's console output but not a direct stderr write.
      process.stderr.write(
        `live e2e: reply ${JSON.stringify(text)}; model attempts ${String(attempts)}\n`,
      )
      expect(text).toContain('OK')
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(ATTEMPT_BUDGET)
    },
    TURN_TIMEOUT_MS,
  )
})
