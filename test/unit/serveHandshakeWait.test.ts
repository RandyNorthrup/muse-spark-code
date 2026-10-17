import { describe, expect, it } from 'vitest'
import { waitForAnswer } from '../../src/core/timeouts'

const stopError = () => new Error('stopped by the test')

describe('handshake waits without an invented deadline (NOLIMITS2 C12)', () => {
  it('resolves with the answer and says so while waiting', async () => {
    const controller = new AbortController()
    const answer = Promise.withResolvers<string>()
    const told: number[] = []
    const waited = waitForAnswer(
      answer.promise,
      controller.signal,
      stopError,
      (elapsedMs) => {
        told.push(elapsedMs)
      },
      10,
    )
    await new Promise((resolve) => setTimeout(resolve, 35))
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
    const controller = new AbortController()
    controller.abort()
    const told: number[] = []
    const never = Promise.withResolvers<string>()
    await expect(
      waitForAnswer(
        never.promise,
        controller.signal,
        stopError,
        (elapsedMs) => {
          told.push(elapsedMs)
        },
        10,
      ),
    ).rejects.toThrow('stopped by the test')
    expect(told).toEqual([])
  })

  it('a stop mid-wait ends it and a late answer changes nothing', async () => {
    const controller = new AbortController()
    const answer = Promise.withResolvers<string>()
    const told: number[] = []
    const waited = waitForAnswer(
      answer.promise,
      controller.signal,
      stopError,
      (elapsedMs) => {
        told.push(elapsedMs)
      },
      10,
    )
    await new Promise((resolve) => setTimeout(resolve, 15))
    controller.abort()
    await expect(waited).rejects.toThrow('stopped by the test')
    answer.resolve('too late')
    await expect(answer.promise).resolves.toBe('too late')
  })

  it('an answer that fails on its own still fails the wait', async () => {
    const controller = new AbortController()
    const answer = Promise.withResolvers<string>()
    const told: number[] = []
    const waited = waitForAnswer(
      answer.promise,
      controller.signal,
      stopError,
      (elapsedMs) => {
        told.push(elapsedMs)
      },
      10,
    )
    answer.reject(new Error('the process exited'))
    await expect(waited).rejects.toThrow('the process exited')
  })
})
