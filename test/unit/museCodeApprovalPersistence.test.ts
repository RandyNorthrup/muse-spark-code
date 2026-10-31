// A decision Muse Code answers with its approval-persistence timeout
// (RLF-HARVEST H1, captured live 2026-10-30 on CLI 1.4.7-R6101.1,
// test/fixtures/rlf-approvals/approval-decide-persistence-1.4.7.json):
// the reply is -32603 `internal`, an immediate `approval/listPending`
// still names the decided stage, and the host's own stage update lands
// 16 ms later showing the decision applied. The stage must not be
// offered again as not applied; only a decision still waiting after the
// host's stage news (or the settle window) may be made again. The host
// and session are the product's own over the SDK's real Connection (see
// helpers/museReplay.ts); every answer is a frame of the capture.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { isDecisionNotAppliedError, isMuseCodeFaultError } from '../../src/core/agent/agentBackend'
import {
  closeLiveHosts,
  startLiveHost,
  type Answer,
  type LiveHost,
  type WireFrame,
} from './helpers/museReplay'
import { captureFrameRow } from './helpers/wireCapture'

const captureSchema = z.object({
  provenance: z.object({ model: z.string() }),
  frames: z.array(captureFrameRow),
})
const capture = captureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../fixtures/rlf-approvals/approval-decide-persistence-1.4.7.json', import.meta.url),
      'utf8',
    ),
  ),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Every recorded reply of the capture, by its wire id. */
const resultsById = new Map<number, Record<string, unknown>>(
  capture.frames.flatMap((row) =>
    row.direction === 'received' && row.frame.id !== undefined && row.frame.result !== undefined
      ? [[row.frame.id, row.frame.result]]
      : [],
  ),
)
function recordedNotification(method: string): WireFrame {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.method === method,
  )?.frame
  if (frame === undefined) throw new Error(`the capture serves no ${method}`)
  return frame
}

const startResult = resultsById.get(2) ?? {}
const sessionRecord = isRecord(startResult['session']) ? startResult['session'] : {}
const requested = recordedNotification('approval/requested')
const updated = recordedNotification('approval/updated')
const decideErrorFrame = capture.frames.find(
  (row) => row.direction === 'received' && row.frame.error !== undefined,
)?.frame
if (decideErrorFrame?.error === undefined) throw new Error('the capture serves no decide error')
const decideError = decideErrorFrame.error
const accepted = resultsById.get(23) ?? {}
const pendingStage0 = resultsById.get(20) ?? {}
const pendingStage1 = resultsById.get(21) ?? {}

const approvalId = String(isRecord(requested.params) ? requested.params['approvalId'] : undefined)
function stage(sourceIndex: number): { approvalId: string; sourceIndex: number } {
  return { approvalId, sourceIndex }
}

type AnswerScript = (method: string, params: Record<string, unknown>) => Answer | Promise<Answer>

/** A live host and its started capture session, card shown at stage 0. */
async function startCaptureSession(
  answer: AnswerScript,
  settleMs: number,
): Promise<{ live: LiveHost; decide: (sourceIndex: number) => Promise<void> }> {
  const live = startLiveHost(answer, undefined, undefined, {
    approvalPersistenceSettleMs: settleMs,
  })
  const session = await live.host.startSession({
    workspaceRoot: '<capture-workspace>',
    modelId: String(sessionRecord['modelId']),
    approvalMode: 'promptUnmatched',
  })
  live.wire.release(requested)
  return {
    live,
    decide: async (sourceIndex) => {
      await session.decideApproval({
        approvalId,
        choiceId: 'allow_once',
        requirementId: stage(sourceIndex),
      })
    },
  }
}

/**
The capture's scripts: the first decision answers with the recorded
persistence error, later ones with the recorded acceptance; only the
pending reads differ between the two cases.
*/
function captureScript(pending: () => Answer): AnswerScript {
  let decisions = 0
  return (method): Answer => {
    if (method === 'session/start') return { result: startResult }
    if (method === 'approval/decide') {
      decisions += 1
      return decisions === 1 ? { error: decideError } : { result: accepted }
    }
    if (method === 'approval/listPending') return pending()
    if (method === 'task/stopAll') return { result: {} }
    throw new Error(`unexpected ${method}`)
  }
}

/** The rejection a decision ends with, or the word 'resolved'. */
async function failureOf(decision: Promise<void>): Promise<unknown> {
  try {
    await decision
    return 'resolved'
  } catch (error: unknown) {
    return error
  }
}

afterEach(async () => {
  await closeLiveHosts()
})

describe('approval/decide persistence timeout (captured 2026-10-30)', () => {
  it('keeps a stage decided when the host stage update shows it applied after the error', async () => {
    let pendingReads = 0
    const stageUpdate = { release: (): void => undefined }
    const { live, decide } = await startCaptureSession(
      captureScript(() => {
        // The capture's immediate answer (stage 0), then its stage update.
        pendingReads += 1
        if (pendingReads === 1) {
          setTimeout(() => {
            stageUpdate.release()
          }, 25)
          return { result: pendingStage0 }
        }
        return { result: pendingStage1 }
      }),
      2000,
    )
    stageUpdate.release = () => {
      live.wire.release(updated)
    }

    const failure = await failureOf(decide(0))
    expect(isDecisionNotAppliedError(failure)).toBe(false)
    expect(isMuseCodeFaultError(failure)).toBe(true)
    if (isMuseCodeFaultError(failure)) expect(failure.fault).toBe('approvalPersistence')

    // The stage stays decided: asking again sends nothing to the host.
    await decide(0)
    expect(live.wire.sentCount('approval/decide')).toBe(1)

    // The stage the host moved to decides normally.
    await decide(1)
    expect(live.wire.sentCount('approval/decide')).toBe(2)
  })

  it('offers the stage again only when it is still waiting after the settle window', async () => {
    const { live, decide } = await startCaptureSession(
      captureScript(() => ({ result: pendingStage0 })),
      60,
    )

    const failure = await failureOf(decide(0))
    expect(isDecisionNotAppliedError(failure)).toBe(true)
    expect(isMuseCodeFaultError(failure)).toBe(false)

    // Unmarked: the choice may be made again, and is sent again.
    await decide(0)
    expect(live.wire.sentCount('approval/decide')).toBe(2)
  })
})
