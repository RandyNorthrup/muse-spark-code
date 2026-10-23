// M125 lane V (D107): the fake replay. A scripted Model API answers a
// real host turn on the injected-loop task — three failing checks, one
// passing summary, then the fix — on the packing baseline and the isolated
// triage arm. The armed turn packs the summary output early, so its later
// requests ride smaller than the baseline's own-schedule packs. The usage
// scales with the real request bytes, and the report's judge section
// carries the measured token saving. A scripted
// advisory proves the judge passes into the turn; scripted fence samples
// prove the recorder's samples reach the report; a real JudgeUse proves
// `onFence` emits. Fake replays certify wiring only: no live claim leaves this file.
import { describe, expect, it } from 'vitest'
import { runPairedEval } from '../../../src/core/eval/runner'
import { JUDGE_EVAL_TASKS } from '../../../src/core/eval/tasks'
import { JUDGE_PACK_OFF_ARM, JUDGE_TRIAGE_ARM } from '../../../src/core/eval/mechanisms'
import { JudgeFastReplayRecorder, JudgeReplayRecorder } from '../../../src/core/eval/judgeReplay'
import { evalReportSchema } from '../../../src/core/eval/report'
import { JudgeUse } from '../../../src/core/judge/use'
import type { JudgeFence, JudgeFenceSample } from '../../../src/core/judge/use'
import type { JudgeEntryParts } from '../../../src/core/judge/entries'
import { fileContextIo } from '../../../src/host/backend/contextIo'
import { EVAL_MODEL_ID, EVAL_TURN_TIMEOUT_MS } from '../../../src/shared/constants'
import { headlessToolIo } from '../helpers/headlessToolIo'

// A passing summary the triage packs: shell outputs always end with an
// exit line, so blank-success never fires for them; the strict
// pass-summary does. Repeated for a measurable packed saving.
const SUMMARY_CHECK = String.raw`printf 'Test Files  1 passed (1)\nTests  3 passed (3)\n%.0s' {1..300}`

interface ScriptedTurn {
  readonly bashCalls: number
  readonly editCalled: boolean
  readonly passed: boolean
  readonly outputs: number
}

const readTurn = (body: unknown): ScriptedTurn => {
  let bashCalls = 0
  let isEditCalled = false
  let outputs = 0
  // The stub fetch's own request body: input turns or nothing.
  const items = (body as { input?: readonly unknown[] }).input ?? []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    // Guarded non-null object above; the record shape reads the call fields.
    const record = item as Record<string, unknown>
    if (record['type'] === 'function_call') {
      if (record['name'] === 'bash') bashCalls += 1
      else if (record['name'] === 'edit_file') isEditCalled = true
    } else if (record['type'] === 'function_call_output') {
      outputs += 1
    }
  }
  const text = JSON.stringify(body)
  return { bashCalls, editCalled: isEditCalled, passed: text.includes('check passed'), outputs }
}

const frame = (id: string, output: readonly unknown[], requestBytes: number): string =>
  `data: ${JSON.stringify({
    type: 'response.completed',
    response: {
      id,
      status: 'completed',
      output,
      usage: { input_tokens: Math.ceil(requestBytes / 4), output_tokens: 60 },
    },
  })}\n\n`

const callItem = (id: string, callId: string, name: string, args: unknown): unknown => ({
  type: 'function_call',
  id,
  call_id: callId,
  name,
  arguments: JSON.stringify(args),
})

const textItem = (text: string): unknown => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
})

/**
The scripted model for the injected-loop task: the failing check three
times, one blank success, then the fix and the verifying check. Both
arms run this same script; the armed turn packs the blank output, so
its later requests are smaller. Usage scales with the real request
bytes, so the token saving is measured, not asserted.
*/
const scriptedFetch: typeof fetch = async (input: string | URL | Request) => {
  // The harness only sends Requests; the stub reads the turn's body back.
  const raw = await (input as Request).text()
  const turn = readTurn(JSON.parse(raw))
  const callId = `call_${String(turn.outputs + 1)}`
  const id = `resp_${String(turn.outputs + 1)}`
  const answer = (output: readonly unknown[]): Response =>
    new Response(frame(id, output, raw.length), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })
  if (turn.passed) return answer([textItem('Done, the check passes now.')])
  if (turn.bashCalls < 3) {
    return answer([callItem(`fc_${callId}`, callId, 'bash', { command: 'node check.mjs' })])
  }
  if (turn.bashCalls === 3) {
    return answer([callItem(`fc_${callId}`, callId, 'bash', { command: SUMMARY_CHECK })])
  }
  if (!turn.editCalled) {
    return answer([
      callItem(`fc_${callId}`, callId, 'edit_file', {
        path: 'config.json',
        find: '"retries": 1',
        replace: '"retries": 3',
      }),
    ])
  }
  return answer([callItem(`fc_${callId}`, callId, 'bash', { command: 'node check.mjs' })])
}

describe('judge wiring replay', () => {
  // A paired run turns two live host turns with real tools; the default
  // per-test budget cannot hold it.
  it('measures the isolated triage win end to end', async () => {
    const task = JUDGE_EVAL_TASKS[0]
    if (task === undefined) throw new Error('missing injected-loop task')
    const errors: string[] = []
    const starts: JudgeEntryParts[] = []
    const advisory = {
      start: (action: JudgeEntryParts): JudgeFence | undefined => {
        starts.push(action)
        return {
          read: () => undefined,
          card: () => undefined,
          discard: () => undefined,
          dropped: () => false,
        }
      },
      discardTurn: () => undefined,
      discardSession: () => undefined,
    }
    const recorder = new JudgeReplayRecorder()
    const fast = new JudgeFastReplayRecorder()
    let counter = 0
    const report = await runPairedEval([task], [JUDGE_PACK_OFF_ARM, JUDGE_TRIAGE_ARM], {
      fetch: scriptedFetch,
      client: {
        baseUrl: 'https://test.invalid',
        apiKey: () => Promise.resolve('synthetic-test-only'),
        now: Date.now,
        random: Math.random,
        log: {
          trace: () => undefined,
          info: () => undefined,
          warn: () => undefined,
          error: (message: string) => {
            errors.push(message)
          },
        },
      },
      toolIo: (workspace: string) => headlessToolIo(workspace),
      contextIo: fileContextIo,
      platform: 'linux',
      accountId: '0123456789abcdef',
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
      now: Date.now,
      newId: () => `id-${String((counter += 1))}`,
      generatedAt: '2026-10-22T00:00:00.000Z',
      maxTaskAttempts: 12,
      turnTimeoutMs: EVAL_TURN_TIMEOUT_MS,
      judge: {
        recorder,
        fast,
        advisory,
        labels: (taskId, decision) =>
          taskId === 'judge-injected-loop' && decision === 'triage.needFull' ? true : undefined,
      },
    })
    expect(errors).toEqual([])
    // The scripted judge saw the turn's shell actions.
    expect(starts.length).toBeGreaterThan(0)
    expect(starts.every((action) => action.backend === 'modelApi')).toBe(true)
    // Both arms pass the verifier; the armed turn skips a round trip.
    const parsed = evalReportSchema.safeParse(report)
    expect(parsed.success).toBe(true)
    if (report.version !== 2 || report.judge === undefined) throw new Error('missing judge section')
    const [triage] = report.judge.fast
    expect(triage).toMatchObject({
      backend: 'modelApi',
      model: EVAL_MODEL_ID,
      decision: 'triage.needFull',
      pairs: 1,
      appliedTurns: 1,
      winPass: 0,
      callsAvoidedP50: 0,
      outputTokensSavedP50: 0,
      labelled: 1,
      precision: 1,
      recall: 1,
    })
    expect(typeof triage?.wallP50DeltaMs).toBe('number')
    expect(triage?.inputTokensSavedP50).toBeGreaterThan(0)
  }, 120_000)

  it('carries fence samples from the recorder to the report', () => {
    const recorder = new JudgeReplayRecorder()
    recorder.record({ backend: 'modelApi', ready: true, caution: false }, false)
    recorder.record({ backend: 'modelApi', ready: true, caution: false }, false)
    recorder.record({ backend: 'modelApi', ready: true, caution: true }, true)
    expect(recorder.measurements()).toEqual([
      { backend: 'modelApi', fences: 3, readyRate: 1, precision: 1, cautions: 1 },
    ])
  })

  it('emits the fence sample the recorder reads', async () => {
    const samples: JudgeFenceSample[] = []
    const use = new JudgeUse({
      isOn: () => true,
      createRunner: (entries) => ({
        judge: (job) => {
          entries.settle(job.entryKey, 'caution')
        },
      }),
      prepare: () => Promise.resolve(true),
      question: () => ({ id: 'q', kind: 'noul', text: 'safe?' }),
      onError: () => undefined,
      onFence: (sample) => {
        samples.push(sample)
      },
    })
    const fence = use.start(
      { backend: 'modelApi', sessionId: 's', turnId: 't', tool: 'bash', args: {} },
      '{}',
    )
    for (let tick = 0; tick < 100 && samples.length === 0; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(fence?.read()).toBe('caution')
    expect(samples).toEqual([{ backend: 'modelApi', ready: true, caution: true }])
    use.discardSession('s')
  })
})
