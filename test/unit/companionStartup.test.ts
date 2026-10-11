import { Server, type RequestListener } from 'node:http'
import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { startCompanionServer } from '../../src/runtime/companion/server'
import { settlesBeforeIdle } from './helpers/companion'

/**
 * Socket-free transport: a real Server whose bind never touches the network,
 * so the test can hold startup open and fire lifecycle events first.
 */
function noop(): void {
  // The fake transport emits nothing, so there is nothing to unsubscribe.
}

class FakeCompanionServer extends Server {
  private listenCallback?: () => void
  public listenCalled = false
  public closedCalls = 0
  public constructor(listener?: RequestListener) {
    super(listener ?? ((_request, response) => response.end()))
  }
  public override listen(...args: unknown[]): this {
    this.listenCalled = true
    const callback = args.find((arg): arg is () => void => typeof arg === 'function')
    if (callback !== undefined) this.listenCallback = callback
    return this
  }
  /** Complete the bind without opening a socket. */
  public release(): void {
    this.listenCallback?.()
  }
  public override address(): { address: string; family: string; port: number } {
    return { address: '127.0.0.1', family: 'IPv4', port: 64_191 }
  }
  public override close(callback?: (error?: Error) => void): this {
    this.closedCalls += 1
    if (callback !== undefined)
      queueMicrotask(() => {
        callback()
      })
    return this
  }
  public override closeAllConnections(): void {
    // The fake never binds, so there are no connections to close.
  }
}

function startHeld(signal?: AbortSignal) {
  const servers: FakeCompanionServer[] = []
  const started = startCompanionServer(
    {
      handler: {
        inputSchema: z.strictObject({ kind: z.literal('ping') }),
        outputSchema: z.strictObject({ kind: z.literal('event'), text: z.string() }),
        post: () => Promise.resolve(),
        subscribe: () => noop,
      },
      limits: {
        maxBodyBytes: 256,
        maxEventBytes: 256,
        requestTimeoutMs: 1000,
        idleTimeoutMs: 5000,
        launchCodeTtlMs: 2000,
        sessionTtlMs: 3000,
        maxSessions: 8,
      },
      assets: new Map(),
      renderPage: () => '<!doctype html>',
      ...(signal !== undefined && { signal }),
    },
    (listener?: RequestListener) => {
      const fake = new FakeCompanionServer(listener)
      servers.push(fake)
      return fake
    },
  )
  return { started, servers }
}

describe('companion startup races', () => {
  it('rejects with a listen error fired before startup resolves', async () => {
    const { started, servers } = startHeld()
    const failure = new Error('synthetic listen failure')
    servers[0]!.emit('error', failure)
    await expect(started).rejects.toBe(failure)
    expect(servers[0]!.closedCalls).toBe(1)
  })
  it('rejects instead of hanging when the transport closes before startup resolves', async () => {
    const { started, servers } = startHeld()
    servers[0]!.emit('close')
    await expect(started).rejects.toThrow('EPANEL_BIND')
    expect(servers[0]!.closedCalls).toBe(1)
  })
  it('observes a process signal before startup resolves and shuts down', async () => {
    const signalsBefore = process.listenerCount('SIGINT')
    const { started, servers } = startHeld()
    expect(servers[0]!.listenCalled).toBe(true)
    expect(process.emit('SIGINT')).toBe(true)
    servers[0]!.release()
    const panel = await started
    try {
      await settlesBeforeIdle(panel.closed)
      expect(() => panel.launchUrl()).toThrow('EPANEL_CLOSED')
      expect(servers[0]!.closedCalls).toBe(1)
    } finally {
      await panel.close()
    }
    expect(process.listenerCount('SIGINT')).toBe(signalsBefore)
  })
  it('shuts down on a transport error after startup instead of throwing uncaught', async () => {
    const { started, servers } = startHeld()
    servers[0]!.release()
    const panel = await started
    try {
      servers[0]!.emit('error', new Error('synthetic post-startup failure'))
      await settlesBeforeIdle(panel.closed)
      expect(() => panel.launchUrl()).toThrow('EPANEL_CLOSED')
      expect(servers[0]!.closedCalls).toBe(1)
    } finally {
      await panel.close()
    }
  })
  it('rejects at once when the caller aborts while the bind is in flight', async () => {
    const controller = new AbortController()
    const intBefore = process.listenerCount('SIGINT')
    const termBefore = process.listenerCount('SIGTERM')
    const { started, servers } = startHeld(controller.signal)
    controller.abort()
    // The bind is never released: only the pre-await abort path can settle
    // this, with the same reason the post-bind re-check would throw.
    await expect(started).rejects.toThrow('This operation was aborted')
    expect(servers[0]!.closedCalls).toBe(1)
    expect(process.listenerCount('SIGINT')).toBe(intBefore)
    expect(process.listenerCount('SIGTERM')).toBe(termBefore)
  })
})
