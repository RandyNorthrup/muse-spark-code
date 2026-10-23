// F94: the loud failure for a turn refused for a sign-in its restarted
// backend lost. Pure decision and message composition through the real
// modules, values passed in as data.
import { describe, expect, it } from 'vitest'
import { signInLossFailure } from '../../src/acp/signInLoss'
import { signInLossText } from '../../src/core/backends/musecode/signInLoss'

const CAUSE = 'Muse Code failed with an unhandled error (exit code 1)'
const REASON = 'missing meta credentials: run muse login or set META_API_KEY'

describe('signInLossText', () => {
  it('names the restart, the turn reason and the remedy', () => {
    const text = signInLossText({ errorKind: 'authRequired', reason: REASON, restartCause: CAUSE })
    expect(text).toContain(CAUSE)
    expect(text).toContain(REASON)
    expect(text).toContain('muse login')
    expect(text).toContain('META_API_KEY')
    // The cause already names Muse Code (`describeExit`): the sentence
    // around it must not name it again.
    expect(text).not.toContain('Muse Code Muse Code')
    expect(text?.startsWith(CAUSE)).toBe(true)
  })

  it('is undefined with no restart behind the failure, or another failure kind', () => {
    expect(
      signInLossText({ errorKind: 'authRequired', reason: REASON, restartCause: undefined }),
    ).toBeUndefined()
    expect(
      signInLossText({ errorKind: 'internal', reason: REASON, restartCause: CAUSE }),
    ).toBeUndefined()
    expect(
      signInLossText({ errorKind: undefined, reason: REASON, restartCause: CAUSE }),
    ).toBeUndefined()
  })

  it('still names the restart when the turn carried no reason', () => {
    const text = signInLossText({
      errorKind: 'authRequired',
      reason: undefined,
      restartCause: CAUSE,
    })
    expect(text).toContain(CAUSE)
    expect(text).toContain('authRequired')
  })
})

describe('signInLossFailure', () => {
  it('answers the loud turn as an authRequired error', () => {
    const failure = signInLossFailure({
      errorKind: 'authRequired',
      reason: REASON,
      restartCause: CAUSE,
    })
    expect(failure?.code).toBe(-32_000)
    expect(failure?.message).toContain(CAUSE)
    expect(failure?.message).toContain(REASON)
    // RLF-ACPTURNS: a lost sign-in is never cleared by resubmitting.
    expect(failure?.data).toEqual({ retryable: false })
  })

  it('leaves any other turn to the caller', () => {
    expect(
      signInLossFailure({ errorKind: 'authRequired', reason: REASON, restartCause: undefined }),
    ).toBeUndefined()
    expect(
      signInLossFailure({ errorKind: 'internal', reason: REASON, restartCause: CAUSE }),
    ).toBeUndefined()
  })
})
