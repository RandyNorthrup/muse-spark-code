// A turn the CLI judged resubmittable says so in words (RLWINFIX2 item
// 3): our sentence, with the turn's own reason beside it, on the ACP
// answer and the panel's error row alike. The reason below is the
// recorded 2026-10-22 02:55 fleet failure (Muse Code 1.4.7, all five Mac
// mini lanes at once); the frame's shape (terminal, reason, an error
// object carrying retryable) is the CLI's own TurnCompletedParams
// (msp.schema.json, exported from CLI 1.4.11 on this machine, plus SDK
// msp.d.ts TurnError.retryable: "the server's judgment that resubmitting
// the same input may succeed"). The kind value is illustrative, from the
// contract's own TurnErrorKind vocabulary: only the retryable judgment
// and the reason's pass-through are asserted, never the kind.
import { describe, expect, it } from 'vitest'
import { agentEventSchema } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { transientTurnFailureText } from '../../src/shared/turnFailure'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'

const FLEET_REASON =
  'transport error [net-timeout]: timed out waiting for response data (meta stream)'

const start: UiState = { ...initialUiState, sessionId: 'session-1' }

function failedRow(event: Record<string, unknown>): string | undefined {
  const parsed = agentEventSchema.parse({ type: 'turnCompleted', turnId: 't1', ...event })
  if (parsed.type !== 'turnCompleted') throw new Error('not a turn event')
  const next = uiReducer(start, {
    type: 'hostMessage',
    message: { type: 'agentEvent', event: parsed },
    at: 1000,
  })
  const row = next.transcript.findLast((entry) => entry.kind === 'error')
  return row?.kind === 'error' ? row.text : undefined
}

describe('transientTurnFailureText', () => {
  it('names the transient failure with the turn’s own detail', () => {
    expect(transientTurnFailureText({ reason: FLEET_REASON, retryable: true })).toBe(
      `${UI_TEXT.turnTransientFailed} (${FLEET_REASON})`,
    )
  })

  it('says the sentence alone where the turn carried no reason', () => {
    expect(transientTurnFailureText({ retryable: true })).toBe(UI_TEXT.turnTransientFailed)
  })

  it('leaves anything not retryable to its existing words', () => {
    expect(transientTurnFailureText({ reason: FLEET_REASON, retryable: false })).toBeUndefined()
    expect(transientTurnFailureText({ reason: FLEET_REASON })).toBeUndefined()
    expect(transientTurnFailureText({})).toBeUndefined()
  })
})

describe('retryable failed turn over the real panel reducer', () => {
  it('shows the transient words, and keeps the turn’s settled rows', () => {
    const text = failedRow({ terminal: 'failed', reason: FLEET_REASON, retryable: true })
    expect(text).toBe(`${UI_TEXT.turnTransientFailed} (${FLEET_REASON})`)
  })

  it('keeps the bare reason where the CLI did not judge it retryable', () => {
    expect(failedRow({ terminal: 'failed', reason: FLEET_REASON, retryable: false })).toBe(
      FLEET_REASON,
    )
    expect(failedRow({ terminal: 'failed', reason: FLEET_REASON })).toBe(FLEET_REASON)
  })
})
