import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import type { ExecSignal } from '../../src/runtime/exec/execProtocol'

function harness(start = 0, timeout = 1000) {
  vi.useFakeTimers()
  vi.setSystemTime(start)
  const signals = new Map<ExecSignal, () => void>()
  const forceFinish = vi.fn()
  const exit = vi.fn((_code: number): never => {
    throw new Error('forced exit')
  })
  const life = createLifecycle({
    processStartMs: 0,
    timeoutMs: timeout,
    now: () => Date.now(),
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms)
      return () => {
        clearTimeout(t)
      }
    },
    onSignal: (signal, run) => {
      signals.set(signal, run)
      return () => {
        signals.delete(signal)
      }
    },
    forceFinish,
    exit,
  })
  return { life, forceFinish, exit, send: (signal: ExecSignal) => signals.get(signal)?.(), signals }
}
afterEach(() => {
  vi.useRealTimers()
})
describe('M80 bounded stop', () => {
  it('D9 deadline includes setup elapsed since process start; first cause wins', async () => {
    const h = harness(900)
    await vi.advanceTimersByTimeAsync(100)
    expect(h.life.cause).toEqual({ kind: 'timeout' })
    expect(h.life.signal.aborted).toBe(true)
    expect(h.life.latch({ kind: 'denied' })).toBe(false)
    expect(await h.life.stopped).toEqual({ kind: 'timeout' })
    h.life.dispose()
  })
  it.each(['SIGINT', 'SIGTERM'] as const)(
    'D10/D30 %s before session exists aborts setup',
    async (signal) => {
      const h = harness()
      let isRejected = false
      const waiting = (async () => {
        try {
          await h.life.race(new Promise<never>(() => undefined))
        } catch {
          isRejected = true
        }
      })()
      h.send(signal)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      expect(isRejected).toBe(true)
      void waiting
      expect(h.life.cause).toEqual({ kind: 'signal', signal })
      h.life.dispose()
    },
  )
  it('D10 deduplicates same signal within 500ms, then forces at 300ms', () => {
    const h = harness()
    h.send('SIGINT')
    vi.advanceTimersByTime(499)
    h.send('SIGINT')
    expect(h.forceFinish).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    h.send('SIGINT')
    expect(h.forceFinish).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(299)
    expect(h.exit).not.toHaveBeenCalled()
    expect(() => vi.advanceTimersByTime(1)).toThrow('forced exit')
    expect(h.exit).toHaveBeenCalledWith(130)
    h.life.dispose()
  })
  it('D10 distinct second signal forces immediately even inside dedup interval', () => {
    const h = harness()
    h.send('SIGINT')
    h.send('SIGTERM')
    expect(h.forceFinish).toHaveBeenCalledOnce()
    expect(h.life.cause).toEqual({ kind: 'signal', signal: 'SIGINT' })
    expect(() => vi.advanceTimersByTime(300)).toThrow()
    expect(h.exit).toHaveBeenCalledWith(130)
    h.life.dispose()
  })
  it('keeps a latched timeout exit 6 when repeated signals force scanner cleanup', () => {
    const h = harness()
    vi.advanceTimersByTime(1000)
    h.send('SIGINT')
    h.send('SIGTERM')
    expect(h.forceFinish).toHaveBeenCalledWith({ kind: 'timeout' })
    expect(() => vi.advanceTimersByTime(300)).toThrow('forced exit')
    expect(h.exit).toHaveBeenCalledWith(6)
    h.life.dispose()
  })

  it('D29/D30 stopped race cannot win on a later immediately-resolved setup', async () => {
    const h = harness()
    h.life.latch({ kind: 'budget' })
    await expect(h.life.race(Promise.resolve('late'))).rejects.toThrow()
    await expect(h.life.race(Promise.reject(new Error('late failure')))).rejects.toThrow()
    expect(h.life.remainingGraceMs()).toBe(5000)
    vi.advanceTimersByTime(5001)
    expect(h.life.remainingGraceMs()).toBe(0)
    h.life.dispose()
    expect(h.signals.size).toBe(0)
  })
})
