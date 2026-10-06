import { describe, expect, it } from 'vitest'
import {
  SessionOwner,
  type SessionEffect,
  type SessionToken,
} from '../../src/core/schedules/sessionOwner'
import { unattendedRun } from './helpers/schedules/unattended'

function permutations<T>(values: readonly T[]): T[][] {
  return values.length === 0
    ? [[]]
    : values.flatMap((value, index) =>
        permutations(values.filter((_, next) => next !== index)).map((tail) => [value, ...tail]),
      )
}

function applied(owner: SessionOwner, effect: SessionEffect | undefined) {
  if (effect === undefined) throw new Error('Expected owned effect')
  expect(owner.modeApplied(effect, true)).toBe(true)
}

function fire(owner: SessionOwner) {
  const { run } = unattendedRun()
  const token = owner.claim(owner.token(), run)
  if (token === undefined) throw new Error('Expected fire claim')
  return { run, token }
}

describe('native session serialized authority', () => {
  it('RVM115U3 P1-1: a pre-claim mode waiter cannot install Bypass after restoration', () => {
    const owner = new SessionOwner('promptUnmatched')
    const first = fire(owner)
    owner.admitted(first.token, 'fire-a')
    const restoration = owner.terminal('fire-a')
    const waiter = owner.token()
    applied(owner, restoration)
    const next = fire(owner)
    expect(owner.modeEffect(waiter, 'allowAll')).toBeUndefined()
    expect(owner.modeEffect(waiter, 'denyUnmatched', next.run)).toBeUndefined()
    expect(owner.run()).toBe(next.run)
  })

  it('RVM115U3 P2-5: unrelated terminal evidence cannot invalidate an ordinary start acknowledgment', () => {
    const owner = new SessionOwner('denyUnmatched')
    const token = owner.token()
    expect(owner.start(token)).toBe(true)
    owner.terminal('unrelated-queued')
    owner.startAcknowledged(token, 'ordinary-live', true)
    expect(owner.currentTurnId).toBe('ordinary-live')
    expect(owner.claim(owner.token(), unattendedRun().run)).toBeUndefined()
    expect(owner.modeEffect(token, 'allowAll')).toBeUndefined()
    expect(owner.modeEffect(owner.token(), 'allowAll')).toBeDefined()
  })

  it('permits ordinary work with an unknown resumed mode, but requires known mode for a fire', () => {
    const owner = new SessionOwner()
    const token = owner.token()
    expect(owner.start(token)).toBe(true)
    owner.startAcknowledged(token, 'ordinary', true)
    owner.terminal('ordinary')
    expect(owner.claim(owner.token(), unattendedRun().run)).toBeUndefined()
    applied(owner, owner.modeEffect(owner.token(), 'promptUnmatched'))
    expect(owner.claim(owner.token(), unattendedRun().run)).toBeDefined()
  })

  it('keeps early terminal proof turn-keyed, refuses stale steering/cancellation and quarantines failed modes', () => {
    const owner = new SessionOwner('promptUnmatched')
    const token = owner.token()
    expect(owner.start(token)).toBe(true)
    owner.terminal('finished-before-ack')
    owner.startAcknowledged(token, 'finished-before-ack', true)
    expect(owner.currentTurnId).toBeUndefined()
    const current = fire(owner)
    const effect = owner.modeEffect(current.token, 'promptUnmatched', current.run)
    if (effect === undefined) throw new Error('Expected mode effect')
    expect(owner.modeApplied(effect, false)).toBe(false)
    expect(owner.start(owner.token(), current.run)).toBe(false)
    owner.admissionFailed(current.token)
    expect(owner.isFailed(current.run)).toBe(true)
    expect(owner.canSteer(current.token, 'finished-before-ack', current.run)).toBe(false)
    expect(owner.modeApplied({ ...effect, token }, true)).toBe(false)
  })

  it.each(['child', 'follow-up', 'retry'])('binds each %s to its original fire token', () => {
    const owner = new SessionOwner('promptUnmatched')
    const first = fire(owner)
    applied(owner, owner.modeEffect(first.token, 'promptUnmatched', first.run))
    expect(owner.start(first.token, first.run)).toBe(true)
    owner.startAcknowledged(first.token, 'fire-a', true)
    owner.admitted(first.token, 'fire-a')
    const child = owner.token()
    expect(owner.canSteer(child, 'fire-a', first.run)).toBe(true)
    applied(owner, owner.terminal('fire-a'))
    const next = fire(owner)
    expect(owner.matches(child)).toBe(false)
    expect(owner.canSteer(child, 'fire-a', first.run)).toBe(false)
    expect(owner.modeEffect(child, 'allowAll', next.run)).toBeUndefined()
    expect(owner.start(child, first.run)).toBe(false)
  })

  it('model: every completion order preserves generation, mode, admission and turn evidence', () => {
    // Six independent completions: 720 orderings. The reference owns live
    // turn identity and mode waiters without consulting SessionOwner state.
    const orders = permutations([
      'mode',
      'claim',
      'stale',
      'terminal',
      'ordinary',
      'child',
    ] as const)
    for (const order of orders) {
      const owner = new SessionOwner('promptUnmatched')
      const waiter = owner.token()
      const { run } = unattendedRun()
      let generation = 0
      let isOrdinaryLive = false
      let isFireLive = false
      let fireToken: SessionToken | undefined
      for (const action of order) {
        const isStale = generation !== waiter.generation || isOrdinaryLive
        const complete = () => {
          switch (action) {
            case 'mode': {
              const effect = owner.modeEffect(waiter, 'allowAll')
              expect(effect !== undefined).toBe(!isStale && !isFireLive)
              if (effect !== undefined) applied(owner, effect)
              return
            }
            case 'claim': {
              fireToken = owner.claim(waiter, run)
              const isExpected = !isStale && !isOrdinaryLive && !isFireLive
              expect(fireToken !== undefined).toBe(isExpected)
              if (isExpected) {
                isFireLive = true
                generation += 1
              }
              return
            }
            case 'stale': {
              expect(owner.modeEffect(waiter, 'denyUnmatched') !== undefined).toBe(
                !isStale && !isFireLive,
              )
              // Finish the mode effect, keeping the independent reference idle.
              const mode = { type: 'mode', token: waiter, mode: 'promptUnmatched' } as const
              if (!isStale && !isFireLive) applied(owner, mode)
              return
            }
            case 'terminal': {
              owner.terminal('unrelated')
              return
            }
            case 'ordinary': {
              const token = owner.token()
              expect(owner.start(token)).toBe(!isFireLive)
              if (!isFireLive) {
                owner.startAcknowledged(token, 'ordinary-live', true)
                isOrdinaryLive = true
              }
              return
            }
            case 'child': {
              expect(owner.canSteer(waiter, 'other', run)).toBe(!isStale && !isFireLive)
              if (fireToken !== undefined) expect(owner.start(fireToken, run)).toBe(!isOrdinaryLive)
              // A child start stays pending: ordinary work must remain refused.
              return
            }
          }
        }
        complete()
        expect(owner.token().generation).toBe(generation)
        expect(owner.currentTurnId === 'ordinary-live').toBe(isOrdinaryLive)
        expect(owner.run() === run).toBe(isFireLive)
      }
    }
  })
})
