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
// M70 adds a review turn held in Plan mode: 37 model attempts on
// 2026-09-28 (Muse Code 1.4.0), within the same budget.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { PlanModeHold, type PlanModeRestore } from '../../src/core/review/planModeHold'
import { reviewTurnText } from '../../src/core/review/reviewPrompt'
import { REVIEW_FINDINGS_LANGUAGE } from '../../src/shared/constants'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'
import { countAttempts, LIVE_MODEL_ID, liveBackend, sessionLog, sleep } from './liveCli'

const IS_ENABLED = process.env['MUSE_LIVE_E2E'] === '1'
const TURN_TIMEOUT_MS = 180_000
const ATTEMPT_BUDGET = 60
// How long the review drill waits for the hold to report the mode set back.
const RESTORE_WAIT_MS = 30_000
const RESTORE_POLL_MS = 250
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

  // M70 (PLAN.md D49): `/review` on Muse Code is its own turn held in Plan
  // mode, the text Muse Code gets, and the session's mode set back after it.
  it(
    'runs a review turn in Plan mode on the real CLI and sets the mode back after it (M70)',
    async () => {
      writeFileSync(
        path.join(workspaceRoot, 'sum.ts'),
        'export function sum(a: number, b: number) {\n  return a + b + 1\n}\n',
      )
      const { sessionId, text, modes, restored } = await runReviewDrill(workspaceRoot)
      const attempts = countAttempts(await sessionLog(sessionId))
      process.stderr.write(
        `live e2e review: modes ${JSON.stringify(modes)}; restored ${JSON.stringify(restored)}; reply ${JSON.stringify(text.slice(0, REVIEW_REPLY_SHOWN_CHARS))}; model attempts ${String(attempts)}\n`,
      )
      expect(restored).toEqual([{ ok: true, isAfterTurn: true }])
      expect(text).toContain(REVIEW_FINDINGS_LANGUAGE)
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(ATTEMPT_BUDGET)
    },
    TURN_TIMEOUT_MS,
  )
})

const REVIEW_REPLY_SHOWN_CHARS = 400

/** One review turn in Plan mode on the real CLI (M70): the modes it went through, and the reply. */
async function runReviewDrill(workspaceRoot: string) {
  const backend = liveBackend(workspaceRoot, '0.0.0-live-e2e', new FakeLogOutputChannel())
  const events: AgentEvent[] = []
  const restored: PlanModeRestore[] = []
  try {
    const host = await backend.ensureHost()
    const session = await host.startSession({
      workspaceRoot,
      modelId: LIVE_MODEL_ID,
      approvalMode: 'promptUnmatched',
    })
    const hold = new PlanModeHold({
      planMode: 'denyUnmatched',
      restoreMode: () => 'promptUnmatched',
      onRestored: (outcome) => {
        restored.push(outcome)
      },
    })
    const done = new Promise<AgentEvent>((resolve) => {
      session.onEvent((event) => {
        events.push(event)
        if (event.type !== 'turnCompleted') {
          return
        }
        hold.turnEnded(event.turnId)
        resolve(event)
      })
    })
    const reviewText = reviewTurnText({
      request: { scope: 'custom', focus: 'general', instructions: 'the file sum.ts' },
      material: undefined,
      isRoleIncluded: true,
      newMarker: () => 'unused',
    })
    await hold.send(
      session,
      [{ type: 'text', text: reviewText }],
      '/review the file sum.ts',
      () => true,
    )
    expect(await done).toMatchObject({ type: 'turnCompleted', terminal: 'completed' })
    const deadline = Date.now() + RESTORE_WAIT_MS
    while (restored.length === 0 && Date.now() < deadline) {
      await sleep(RESTORE_POLL_MS)
    }
    return {
      sessionId: session.sessionId,
      text: events.flatMap((event) => (event.type === 'textDelta' ? [event.delta] : [])).join(''),
      modes: events.flatMap((event) => (event.type === 'approvalModeChanged' ? [event.mode] : [])),
      restored,
    }
  } finally {
    await backend.dispose()
  }
}
