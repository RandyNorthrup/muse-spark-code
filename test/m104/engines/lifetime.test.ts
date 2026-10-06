import { describe, expect, it, vi } from 'vitest'
import { runtimeFeatureLifetime } from '../../../src/runtime/features/lifetime'

describe('portable feature release', () => {
  it('drains accepted work even when native prompt cancellation fails', async () => {
    const pending = Promise.withResolvers<undefined>()
    const cancel = vi.fn(() => {
      throw new Error('native cancel failed')
    })
    const owner = runtimeFeatureLifetime(() => undefined, cancel)
    const work = owner.track(() => pending.promise)
    const closing = owner.dispose()
    expect(owner.dispose()).toBe(closing)
    expect(cancel).toHaveBeenCalledOnce()
    let isSettled = false
    const watched = (async () => {
      try {
        await closing
      } finally {
        isSettled = true
      }
    })()
    const result = expect(watched).rejects.toThrow('native cancel failed')
    await Promise.resolve()
    await Promise.resolve()
    expect(isSettled).toBe(false)
    pending.resolve(undefined)
    await expect(work).rejects.toThrow()
    await result
    expect(isSettled).toBe(true)
  })
  it('checks ownership before and after admitted work and retains its original failure', async () => {
    let isCurrent = true
    const owner = runtimeFeatureLifetime(() => {
      if (!isCurrent) throw new Error('replaced')
    })
    const pending = Promise.withResolvers<undefined>()
    const work = owner.track(() => pending.promise)
    isCurrent = false
    pending.resolve(undefined)
    await expect(work).rejects.toThrow('replaced')
    const refused = vi.fn(() => Promise.resolve())
    await expect(owner.track(refused)).rejects.toThrow('replaced')
    expect(refused).not.toHaveBeenCalled()
    isCurrent = true
    await expect(owner.track(() => Promise.reject(new Error('native failed')))).rejects.toThrow(
      'native failed',
    )
    await owner.dispose()
  })
})
