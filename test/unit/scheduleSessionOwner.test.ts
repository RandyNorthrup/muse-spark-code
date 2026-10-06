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
  it('RVM115U5 P1-1: idle cannot erase an in-flight ordinary start', () => {
    for (const order of permutations(['idle', 'ack', 'unrelated'] as const)) {
      const owner = new SessionOwner('denyUnmatched')
      const token = owner.token()
      expect(owner.start(token)).toBe(true)
      let isPending = true
      let isLive = false
      for (const action of order) {
        if (action === 'idle') {
          owner.stopped()
          isLive = false
        } else if (action === 'ack') {
          owner.startAcknowledged(token, 'ordinary', true)
          isPending = false
          isLive = true
        } else owner.terminal('unrelated')
        expect(owner.currentTurnId === 'ordinary').toBe(isLive)
        const claim = owner.claim(owner.token(), unattendedRun().run)
        expect(claim === undefined).toBe(isPending || isLive)
        if (claim !== undefined) applied(owner, owner.admissionFailed(claim))
      }
    }
  })

  it('RVM115U5 P1-1: a successful fire ack supersedes earlier idle evidence', () => {
    const owner = new SessionOwner('denyUnmatched')
    const { token, run } = fire(owner)
    owner.start(token, run)
    owner.stopped()
    owner.startAcknowledged(token, 'fire', true)
    expect(owner.admitted(token, 'fire')).toBeUndefined()
    expect(owner.run()).toBe(run)
    applied(owner, owner.terminal('fire'))
  })

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
    const restore = owner.admissionFailed(current.token)
    expect(owner.isFailed(current.run)).toBe(false)
    expect(owner.start(owner.token())).toBe(false)
    applied(owner, restore)
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

  it('RVM115U4 P2-1: stale and duplicate acknowledgements clear only their own mode record', () => {
    const owner = new SessionOwner('promptUnmatched')
    const token = owner.token()
    owner.start(token)
    owner.startAcknowledged(token, 'ordinary', true)
    const stale = owner.modeEffect(owner.token(), 'allowAll')
    if (stale === undefined) throw new Error('Expected pending mode')
    owner.terminal('ordinary')
    expect(owner.modeApplied(stale, true)).toBe(false)
    const current = owner.modeEffect(owner.token(), 'denyUnmatched')
    expect(current).toBeDefined()
    expect(owner.modeApplied(stale, false)).toBe(false)
    expect(owner.start(owner.token())).toBe(false)
    applied(owner, current)
    expect(owner.start(owner.token())).toBe(true)
  })

  it.each([false, true])(
    'RVM115U4 P2-2 model: admission failure and idle evidence interleave (dispatch=%s)',
    (didDispatch) => {
      for (const order of permutations(['failure', 'idle', 'unrelated'] as const)) {
        const owner = new SessionOwner('denyUnmatched')
        const { token, run } = fire(owner)
        if (didDispatch) expect(owner.start(token, run)).toBe(true)
        let hasFailed = false
        let hasStopped = false
        let isReleased = false
        for (const action of order) {
          let effect: SessionEffect | undefined
          if (action === 'failure') effect = owner.admissionFailed(token)
          else if (action === 'idle') effect = owner.stopped()
          else effect = owner.terminal('unrelated')
          hasFailed ||= action === 'failure'
          hasStopped ||= action === 'idle'
          const shouldRelease = hasFailed && (!didDispatch || hasStopped)
          expect(effect !== undefined).toBe(shouldRelease && !isReleased)
          if (effect !== undefined) {
            applied(owner, effect)
            isReleased = true
          }
          expect(owner.run() === run).toBe(!isReleased)
          const next = owner.token()
          expect(owner.start(next)).toBe(isReleased)
          if (isReleased) owner.startFailed(next)
        }
      }
    },
  )

  it('RVM115U4 P2-4 model: withdrawing a local steer preserves ordinary turn evidence in every terminal order', () => {
    for (const order of permutations(['withdraw', 'terminal', 'unrelated'] as const)) {
      const owner = new SessionOwner('promptUnmatched')
      const ordinary = owner.token()
      owner.start(ordinary)
      owner.startAcknowledged(ordinary, 'ordinary', true)
      const { run } = unattendedRun()
      expect(owner.claim(owner.token(), run, 'ordinary')).toBeDefined()
      let isWithdrawn = false
      let hasEnded = false
      for (const action of order) {
        const effect =
          action === 'withdraw'
            ? owner.withdraw(run)
            : owner.terminal(action === 'terminal' ? 'ordinary' : 'unrelated')
        if (effect !== undefined) applied(owner, effect)
        isWithdrawn ||= action === 'withdraw'
        hasEnded ||= action === 'terminal'
        expect(owner.run() === run).toBe(!isWithdrawn)
        expect(owner.currentTurnId === 'ordinary').toBe(!hasEnded)
        const next = owner.token()
        expect(owner.start(next)).toBe(isWithdrawn)
        if (isWithdrawn) owner.startFailed(next)
      }
    }
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
              const mode = owner.modeEffect(waiter, 'denyUnmatched')
              expect(mode !== undefined).toBe(!isStale && !isFireLive)
              if (mode !== undefined) applied(owner, mode)
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
