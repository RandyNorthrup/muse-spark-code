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
import { closeLiveHosts, startLiveHost, type Answer, type WireFrame } from './helpers/museReplay'
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

function recordedResult(id: number): Record<string, unknown> {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.id === id && row.frame.result !== undefined,
  )?.frame
  if (frame?.result === undefined)
    throw new Error(`the capture serves no result for id ${String(id)}`)
  return frame.result
}

function recordedNotification(method: string): WireFrame {
  const frame = capture.frames.find(
    (row) => row.direction === 'received' && row.frame.method === method,
  )?.frame
  if (frame === undefined) throw new Error(`the capture serves no ${method}`)
  return frame
}

const startResult = recordedResult(2)
const sessionRecord = isRecord(startResult['session']) ? startResult['session'] : {}
const requested = recordedNotification('approval/requested')
const updated = recordedNotification('approval/updated')
const decideErrorFrame = capture.frames.find(
  (row) => row.direction === 'received' && row.frame.error !== undefined,
)?.frame
if (decideErrorFrame?.error === undefined) throw new Error('the capture serves no decide error')
const decideError = decideErrorFrame.error
const accepted = recordedResult(23)
const pendingStage0 = recordedResult(20)
const pendingStage1 = recordedResult(21)

const approvalId = String(isRecord(requested.params) ? requested.params['approvalId'] : undefined)
function stage(sourceIndex: number): { approvalId: string; sourceIndex: number } {
  return { approvalId, sourceIndex }
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
    let decisions = 0
    let pendingReads = 0
    const stageUpdate = { release: (): void => undefined }
    const live = startLiveHost(
      (method): Answer | Promise<Answer> => {
        if (method === 'session/start') return { result: startResult }
        if (method === 'approval/decide') {
          decisions += 1
          return decisions === 1 ? { error: decideError } : { result: accepted }
        }
        if (method === 'approval/listPending') {
          // The capture's immediate answer (stage 0), then its stage update.
          pendingReads += 1
          if (pendingReads === 1) {
            setTimeout(() => {
              stageUpdate.release()
            }, 25)
            return { result: pendingStage0 }
          }
          return { result: pendingStage1 }
        }
        if (method === 'task/stopAll') return { result: {} }
        throw new Error(`unexpected ${method}`)
      },
      undefined,
      { approvalPersistenceSettleMs: 2000 },
    )
    stageUpdate.release = () => {
      live.wire.release(updated)
    }
    const session = await live.host.startSession({
      workspaceRoot: '<capture-workspace>',
      modelId: String(sessionRecord['modelId']),
      approvalMode: 'promptUnmatched',
    })
    live.wire.release(requested)

    const failure = await failureOf(
      session.decideApproval({ approvalId, choiceId: 'allow_once', requirementId: stage(0) }),
    )
    expect(isDecisionNotAppliedError(failure)).toBe(false)
    expect(isMuseCodeFaultError(failure)).toBe(true)
    if (isMuseCodeFaultError(failure)) expect(failure.fault).toBe('approvalPersistence')

    // The stage stays decided: asking again sends nothing to the host.
    await session.decideApproval({ approvalId, choiceId: 'allow_once', requirementId: stage(0) })
    expect(live.wire.sentCount('approval/decide')).toBe(1)

    // The stage the host moved to decides normally.
    await session.decideApproval({ approvalId, choiceId: 'allow_once', requirementId: stage(1) })
    expect(live.wire.sentCount('approval/decide')).toBe(2)
  })

  it('offers the stage again only when it is still waiting after the settle window', async () => {
    let decisions = 0
    const live = startLiveHost(
      (method): Answer => {
        if (method === 'session/start') return { result: startResult }
        if (method === 'approval/decide') {
          decisions += 1
          return decisions === 1 ? { error: decideError } : { result: accepted }
        }
        if (method === 'approval/listPending') return { result: pendingStage0 }
        if (method === 'task/stopAll') return { result: {} }
        throw new Error(`unexpected ${method}`)
      },
      undefined,
      { approvalPersistenceSettleMs: 60 },
    )
    const session = await live.host.startSession({
      workspaceRoot: '<capture-workspace>',
      modelId: String(sessionRecord['modelId']),
      approvalMode: 'promptUnmatched',
    })
    live.wire.release(requested)

    const failure = await failureOf(
      session.decideApproval({ approvalId, choiceId: 'allow_once', requirementId: stage(0) }),
    )
    expect(isDecisionNotAppliedError(failure)).toBe(true)
    expect(isMuseCodeFaultError(failure)).toBe(false)

    // Unmarked: the choice may be made again, and is sent again.
    await session.decideApproval({ approvalId, choiceId: 'allow_once', requirementId: stage(0) })
    expect(live.wire.sentCount('approval/decide')).toBe(2)
  })
})
