import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { waitForAnswer } from '../../src/core/timeouts'

const stopError = () => new Error('stopped by the test')

function waiting(isStopAskedFirst = false) {
  const controller = new AbortController()
  if (isStopAskedFirst) controller.abort()
  const answer = Promise.withResolvers<string>()
  const told: number[] = []
  const toldTwice = Promise.withResolvers<boolean>()
  const waited = waitForAnswer(
    answer.promise,
    controller.signal,
    stopError,
    (elapsedMs) => {
      told.push(elapsedMs)
      if (told.length === 2) toldTwice.resolve(true)
    },
    10,
  )
  return { controller, answer, told, toldTwice: toldTwice.promise, waited }
}

describe('handshake waits without an invented deadline (NOLIMITS2 C12)', () => {
  it('resolves with the answer and says so while waiting', async () => {
    const { answer, told, toldTwice, waited } = waiting()
    // The answer comes after the second notice, not after a time: 35 ms held one 10 ms notice on a
    // loaded Windows runner (run 41738951665), whose timers are also coarser than that.
    await toldTwice
    answer.resolve('connected')
    await expect(waited).resolves.toBe('connected')
    // Notices on the way, minutes out: the wait said so instead of hanging silently.
    expect(told.length).toBeGreaterThanOrEqual(2)
    expect(told.at(-1)).toBeGreaterThan(told[0] ?? 0)
    const count = told.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(told).toHaveLength(count)
  })

  it('a stop already asked ends the wait at once', async () => {
    const { controller, told, waited } = waiting()
    controller.abort()
    await expect(waited).rejects.toThrow('stopped by the test')
    expect(told).toEqual([])
  })

  it('a stop asked before the wait still reads an answer that fails later', async () => {
    // RLF-SHUTDOWN: a process that died after its stop was an unhandled
    // rejection that crashed the agent in the middle of its shutdown.
    const unhandled: unknown[] = []
    const record = (reason: unknown) => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', record)
    try {
      const { answer, told, waited } = waiting(true)
      await expect(waited).rejects.toThrow('stopped by the test')
      answer.reject(new Error('the process died after its stop'))
      // An unhandled rejection surfaces on a later turn of the loop.
      await delay(20)
      expect(unhandled).toEqual([])
      expect(told).toEqual([])
    } finally {
      process.off('unhandledRejection', record)
    }
  })

  it('a stop mid-wait ends it and a late answer changes nothing', async () => {
    const { controller, answer, waited } = waiting()
    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()
    await expect(waited).rejects.toThrow('stopped by the test')
    answer.resolve('too late')
    await expect(answer.promise).resolves.toBe('too late')
  })

  it('an answer that fails on its own still fails the wait', async () => {
    const { answer, waited } = waiting()
    answer.reject(new Error('the process exited'))
    await expect(waited).rejects.toThrow('the process exited')
  })
})
