// The two bounded lifetimes of a browser check (M81 A1, design spec v4
// §§4.1, 6.3): the first end wins, every step waiting then is rejected at
// once, a late answer is closed and counts for nothing, nothing starts after
// the end, and the cleanups run once, newest first, within their bound.
import { describe, expect, it, vi } from 'vitest'
import { createLifetime, LifetimeEndedError } from '../../src/core/browser/workLifetime'

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined)
}

describe('a bounded lifetime (M81 A1)', () => {
  it('ends at its deadline, rejecting the step waiting then, and records why', async () => {
    const lifetime = createLifetime(30, [], 1000)
    await expect(lifetime.step(never)).rejects.toBeInstanceOf(LifetimeEndedError)
    expect(lifetime.endedBy).toBe('deadline')
    expect(lifetime.signal.aborted).toBe(true)
    // A step asked after the end never starts its work.
    const late = vi.fn(() => Promise.resolve(1))
    await expect(lifetime.step(late)).rejects.toThrow('the work has ended (deadline)')
    expect(late).not.toHaveBeenCalled()
  })

  it('ends when any joined signal aborts, already aborted or later', async () => {
    const early = new AbortController()
    early.abort()
    expect(createLifetime(10_000, [early.signal], 1000).endedBy).toBe('aborted')

    const later = new AbortController()
    const lifetime = createLifetime(10_000, [new AbortController().signal, later.signal], 1000)
    const waiting = lifetime.step(never)
    later.abort()
    await expect(waiting).rejects.toBeInstanceOf(LifetimeEndedError)
    expect(lifetime.endedBy).toBe('aborted')
  })

  it('passes its own signal to each step and returns what the step answered while it lasts', async () => {
    const lifetime = createLifetime(10_000, [], 1000)
    const seen: AbortSignal[] = []
    await expect(
      lifetime.step((signal) => {
        seen.push(signal)
        return Promise.resolve('answer')
      }),
    ).resolves.toBe('answer')
    expect(seen[0]).toBe(lifetime.signal)
    lifetime.end()
  })

  it('closes what a late step returns, so a late download or consent starts nothing', async () => {
    const lifetime = createLifetime(10_000, [], 1000)
    const close = vi.fn()
    const late = Promise.withResolvers<{ close: () => void }>()
    const step = lifetime.step(async () => await late.promise)
    lifetime.end()
    await expect(step).rejects.toThrow('the work has ended (ended)')
    late.resolve({ close })
    await vi.waitFor(() => {
      expect(close).toHaveBeenCalledTimes(1)
    })
  })

  it('disposes a late step’s value with its disposer instead of closing it', async () => {
    const lifetime = createLifetime(10_000, [], 1000)
    const close = vi.fn()
    const dispose = vi.fn(() => Promise.resolve())
    const late = Promise.withResolvers<{ close: () => void }>()
    const step = lifetime.step(async () => await late.promise, dispose)
    lifetime.end()
    await expect(step).rejects.toThrow('the work has ended (ended)')
    late.resolve({ close })
    await vi.waitFor(() => {
      expect(dispose).toHaveBeenCalledTimes(1)
    })
    expect(close).not.toHaveBeenCalled()
  })

  it('passes a step’s own failure through while it lasts', async () => {
    const lifetime = createLifetime(10_000, [], 1000)
    await expect(lifetime.step(() => Promise.reject(new Error('download failed')))).rejects.toThrow(
      'download failed',
    )
    lifetime.end()
  })

  it('runs its cleanups once, newest first, at the end, and one added afterwards at once', async () => {
    const lifetime = createLifetime(10_000, [], 1000)
    const order: string[] = []
    lifetime.onEnd(async () => {
      order.push('folder')
      await Promise.resolve()
    })
    lifetime.onEnd(async () => {
      order.push('browser')
      await Promise.reject(new Error('already gone'))
    })
    lifetime.end()
    lifetime.end()
    await lifetime.cleaned
    expect(order).toEqual(['browser', 'folder'])
    lifetime.onEnd(async () => {
      order.push('late')
      await Promise.resolve()
    })
    await vi.waitFor(() => {
      expect(order).toEqual(['browser', 'folder', 'late'])
    })
  })

  it('stops waiting for cleanups at their own bound', async () => {
    const lifetime = createLifetime(10_000, [], 40)
    lifetime.onEnd(never)
    const started = Date.now()
    lifetime.end()
    await lifetime.cleaned
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it('states a monotonic deadline', () => {
    const lifetime = createLifetime(5000, [], 1000, () => 100)
    expect(lifetime.deadlineAt).toBe(5100)
    lifetime.end()
  })
})
