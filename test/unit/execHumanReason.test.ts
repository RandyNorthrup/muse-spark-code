// A failed headless run must print its reason in human output, not only the
// withheld placeholder. The envelope below is the packed product's real
// answer (2026-10-18, `muse-spark-code-acp exec --backend museCode --attach
// note.txt --output json` on this Mac, refused before dispatch): the attach
// refusal on Muse Code printed only "message withheld: the response did not
// complete" while the envelope carried the reason.
import { describe, expect, it } from 'vitest'
import { createExecSink } from '../../src/runtime/exec/execOutput'
import { validateResult, type ExecResult } from '../../src/runtime/exec/execProtocol'

const RECORDED_ATTACH_REFUSAL = {
  v: 2,
  status: 'backend_unavailable',
  exitCode: 3,
  signal: null,
  stopReason: null,
  terminal: null,
  incompleteReason: null,
  backend: 'museCode',
  mode: 'plan',
  model: null,
  sessionId: null,
  ephemeral: false,
  finalMessage: 'message withheld: the response did not complete',
  filesChanged: [],
  denials: [],
  questionsDeclined: 0,
  inputs: [],
  usage: {
    requests: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    costUsd: null,
    paid: {
      imageAttempts: 0,
      imagesReturned: 0,
      imagesRefunded: 0,
      imagesUncertain: 0,
      settledUsd: '0',
      uncertainUsd: '0',
    },
  },
  ledger: null,
  limits: { budgetUsd: null, maxRequests: null, timeoutSeconds: 1800 },
  durationMs: 438.7109375,
  error: {
    kind: 'backend_unavailable',
    message:
      'This session has no file upload service, so video and audio cannot be sent. Use the Model API backend with a Meta key.',
  },
} as const

async function humanLines(result: ExecResult): Promise<string[]> {
  const out: string[] = []
  const sink = createExecSink({
    format: 'text',
    out: {
      write: (chunk: string) => {
        out.push(chunk)
      },
      queuedBytes: 0,
      isClosed: false,
      flush: () => Promise.resolve(true),
    },
    now: () => 0,
    literals: () => [],
    summary: () => undefined,
    onStalled: () => undefined,
  })
  await sink.finish(result)
  return out
}

describe('exec human failure output', () => {
  it('prints the envelope reason instead of the withheld placeholder', async () => {
    const out = await humanLines(validateResult(RECORDED_ATTACH_REFUSAL))
    expect(out[0]).toBe(
      'This session has no file upload service, so video and audio cannot be sent. Use the Model API backend with a Meta key.\n',
    )
  })

  it('keeps the final message when the envelope reason is empty', async () => {
    const emptyReason = validateResult({
      ...RECORDED_ATTACH_REFUSAL,
      error: { kind: 'backend_unavailable', message: '' },
    })
    const out = await humanLines(emptyReason)
    expect(out[0]).toBe('message withheld: the response did not complete\n')
  })
})
