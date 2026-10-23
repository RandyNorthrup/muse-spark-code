// M110r Y1: a dropped model connection pauses the turn, never fails it.
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import {
  classifyTurnInterruption,
  linkResumeAttempt,
  shouldReaskConsent,
  pausedTurnText,
  pauseTurn,
  isIncompleteTransportError,
} from '../../src/core/agent/turnResilience'

function coded(message: string, code: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause })
  ;(error as unknown as { code: string }).code = code
  return error
}

describe('turn interruption classification', () => {
  it.each([
    ['ENOTFOUND', true],
    ['EAI_AGAIN', true],
    ['ECONNREFUSED', true],
    ['SELF_SIGNED_CERT_IN_CHAIN', true],
    ['ERR_TLS_CERT_ALTNAME_INVALID', true],
  ])('pauses on %s, proved before the send', (code, proved) => {
    const interruption = classifyTurnInterruption(
      new Error('fetch failed', { cause: coded(`getaddrinfo ${code}`, code) }),
    )
    expect(interruption.class).toBe('network')
    expect(interruption.isProvedBeforeSend).toBe(proved)
    expect(shouldReaskConsent(interruption)).toBe(!proved)
  })
  it.each([['ECONNRESET'], ['ETIMEDOUT'], ['UND_ERR_SOCKET']])(
    'pauses on mid-stream %s with the send unknown, so consent asks again',
    (code) => {
      const interruption = classifyTurnInterruption(
        new Error('fetch failed', { cause: coded(`socket ${code}`, code) }),
      )
      expect(interruption.class).toBe('network')
      expect(interruption.isProvedBeforeSend).toBe(false)
      expect(shouldReaskConsent(interruption)).toBe(true)
    },
  )
  it('a reset after a refused address stays unknown: one mid-stream code taints the chain', () => {
    const interruption = classifyTurnInterruption(
      new Error('fetch failed', {
        cause: coded(
          'connect ECONNREFUSED',
          'ECONNREFUSED',
          coded('read ECONNRESET', 'ECONNRESET'),
        ),
      }),
    )
    expect(interruption.class).toBe('network')
    expect(interruption.isProvedBeforeSend).toBe(false)
  })
  it.each([[coded('spawn ENOENT', 'ENOENT')], [new Error('budget stop')], ['plain string']])(
    'a non-network failure is fatal to the turn: %s',
    (error) => {
      const interruption = classifyTurnInterruption(error)
      expect(interruption.class).toBe('fatal')
      expect(pauseTurn('a1', interruption, 0)).toBeUndefined()
    },
  )
  it('codes name codes only, never a message that could carry a secret', () => {
    const interruption = classifyTurnInterruption(
      new Error('fetch failed with sk-ant-123', {
        cause: coded('getaddrinfo ENOTFOUND hunter2.example', 'ENOTFOUND'),
      }),
    )
    expect(interruption.codes).toBe('Error: ENOTFOUND')
  })
})

describe('pause, link and resume text', () => {
  const network = classifyTurnInterruption(coded('read ECONNRESET', 'ECONNRESET'))
  it('pauses with the send unknown and links the resume attempt', () => {
    const pause = pauseTurn('attempt-1', network, 1_791_987_200_000, undefined)
    expect(pause).toMatchObject({ attemptId: 'attempt-1', sentUnknown: true })
    expect(linkResumeAttempt(pause!, 'attempt-2')).toEqual({
      previousAttemptId: 'attempt-1',
      nextAttemptId: 'attempt-2',
      reason: 'network-resume',
    })
  })
  it('the row names the time and attempt, and the cap only when one exists', () => {
    const pause = pauseTurn('attempt-1', network, 1_791_987_200_000, undefined)!
    expect(pausedTurnText(pause, 2)).toBe(
      fill(UI_TEXT.turnPausedNetwork, {
        time: formatDateTime(1_791_987_200_000),
        attempt: '2',
      }),
    )
    expect(pausedTurnText(pause, 2, 6)).toBe(
      fill(UI_TEXT.turnPausedNetworkCapped, {
        time: formatDateTime(1_791_987_200_000),
        attempt: '2',
        cap: '6',
      }),
    )
    expect(pausedTurnText(pause, 2)).not.toContain('of ')
  })
})

describe('headless transport outcomes', () => {
  it.each([['error', true]])('transport %s ends incomplete: %s', (why, incomplete) => {
    expect(isIncompleteTransportError(why)).toBe(incomplete)
  })
  it.each([['aborted'], ['tooLarge'], ['malformed'], [null], [undefined]])(
    'transport %s stays failed',
    (why) => {
      expect(isIncompleteTransportError(why)).toBe(false)
    },
  )
})
