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

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MuseCodeBackendManager } from '../../src/host/backend/museCodeBackendManager'
import { DEFAULT_MODEL_ID } from '../../src/shared/constants'
import { FakeLogOutputChannel } from '../unit/helpers/fakes'

const IS_ENABLED = process.env['MUSE_LIVE_E2E'] === '1'
const TURN_TIMEOUT_MS = 180_000
const TRACE_DIR = path.join(homedir(), '.local', 'share', 'muse', 'local-tracing', 'bootstrap')
/** One line per model attempt admitted; the two fields are not adjacent on the line. */
const ATTEMPT_LINE = /event="model.attempt.lifecycle".*phase="admission"/g
const ATTEMPT_BUDGET = 60
const LOG_WAIT_MS = 30_000
const LOG_POLL_MS = 250
const PROMPT = 'Reply with exactly the word OK and nothing else.'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** A running host holds its log locked; that read fails and the file is skipped for now. */
function tryRead(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** The trace log of the host that served the session, once it can be read. */
async function sessionLog(sessionId: string): Promise<string> {
  const mark = `session_id="${sessionId}"`
  const deadline = Date.now() + LOG_WAIT_MS
  for (;;) {
    const found = readdirSync(TRACE_DIR)
      .map((name) => tryRead(path.join(TRACE_DIR, name)))
      .find((text) => text?.includes(mark) === true)
    if (found !== undefined) {
      return found
    }
    if (Date.now() > deadline) {
      throw new Error(`no readable trace log mentions session ${sessionId}`)
    }
    await sleep(LOG_POLL_MS)
  }
}

function countAttempts(log: string): number {
  return log.match(ATTEMPT_LINE)?.length ?? 0
}

const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'muse-live-e2e-'))

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true })
})

/** One turn on the real CLI: the session id and the streamed reply text. */
async function runDrill(): Promise<{ sessionId: string; text: string }> {
  const backend = new MuseCodeBackendManager({
    log: new FakeLogOutputChannel(),
    extensionVersion: '0.0.0-live-e2e',
    getConfiguredBinaryPath: () => '',
    getEnvironmentVariables: () => [],
    workspaceRoot,
    getShellSandbox: () => 'off',
    userProfileDir: process.env['USERPROFILE'],
    isWorkspaceTrusted: () => true,
    getProxySettings: () => ({ proxy: '', noProxy: [] }),
  })
  const events: AgentEvent[] = []
  try {
    const host = await backend.ensureHost()
    const session = await host.startSession({
      workspaceRoot,
      modelId: DEFAULT_MODEL_ID,
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
  it(
    'runs one reply-only turn on the real CLI within the attempt budget',
    async () => {
      const { sessionId, text } = await runDrill()
      const attempts = countAttempts(await sessionLog(sessionId))
      // The count is the record the certification quotes; vitest shows stderr.
      console.warn(`live e2e: reply ${JSON.stringify(text)}; model attempts ${String(attempts)}`)
      expect(text).toContain('OK')
      expect(attempts).toBeGreaterThan(0)
      expect(attempts).toBeLessThanOrEqual(ATTEMPT_BUDGET)
    },
    TURN_TIMEOUT_MS,
  )
})
