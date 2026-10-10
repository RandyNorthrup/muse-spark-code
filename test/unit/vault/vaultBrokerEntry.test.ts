import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import process from 'node:process'
import { runVaultBrokerEntry } from '../../../src/runtime/vault/vaultBrokerEntry'

// Entry-process shutdown: the signal handlers are armed before any startup
// await, so a signal that lands mid-startup still closes the broker. The
// signal source is a test emitter (emitting on the real process object would
// trip the runner's own handlers) and startup is a gated double, so neither
// test needs a socket.
describe('vault broker entry signal handling', () => {
  it('closes a starting broker when a signal arrives before startup resolves', async () => {
    const signals = new EventEmitter()
    const startup = Promise.withResolvers<undefined>()
    const closed = Promise.withResolvers<undefined>()
    const close = vi.fn(() => {
      closed.resolve(undefined)
      return Promise.resolve()
    })
    const start = vi.fn(async () => {
      await startup.promise
      return { close, closed: closed.promise }
    })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const running = runVaultBrokerEntry(start, signals)
      signals.emit('SIGTERM')
      expect(start).toHaveBeenCalledOnce()
      startup.resolve(undefined)
      await running
      expect(close).toHaveBeenCalledOnce()
      expect(write).not.toHaveBeenCalledWith('vault-broker-ready\n')
    } finally {
      write.mockRestore()
    }
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })
  it('announces readiness and stops on a later signal', async () => {
    const signals = new EventEmitter()
    const closed = Promise.withResolvers<undefined>()
    const close = vi.fn(() => {
      closed.resolve(undefined)
      return Promise.resolve()
    })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      const running = runVaultBrokerEntry(
        () => Promise.resolve({ close, closed: closed.promise }),
        signals,
      )
      await vi.waitFor(() => {
        expect(write).toHaveBeenCalledWith('vault-broker-ready\n')
      })
      signals.emit('SIGINT')
      await running
      expect(close).toHaveBeenCalledOnce()
    } finally {
      write.mockRestore()
    }
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })
})
