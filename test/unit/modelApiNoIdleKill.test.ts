import { describe, expect, it } from 'vitest'
import { RequestTransport, type TransportDeps } from '../../src/core/backends/modelapi/transport'
import { hangingBody, transportTestDeps } from './helpers/modelApiTransport'

function deps(
  overrides: Partial<TransportDeps> & { fetch: TransportDeps['fetch'] },
): TransportDeps {
  return transportTestDeps({
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    random: () => 0.5,
    ...overrides,
  })
}

describe('model API waits without invented kills (NOLIMITS2 C1)', () => {
  it('a provider-named idle still ends a silent read', async () => {
    const transport = new RequestTransport(
      deps({
        streamIdleMs: 50,
        fetch: () =>
          Promise.resolve(
            new Response(hangingBody(), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
      }),
    )
    // Headers arrive at once; the idle kill fires on the silent body read.
    const response = await transport.fetchWithIdleDeadline('https://model.test/x', {})
    await expect(response.text()).rejects.toThrow('sent nothing')
  })

  it('an unnamed wait ends at Stop, not at an invented kill', async () => {
    const controller = new AbortController()
    const transport = new RequestTransport(
      deps({
        // A black-hole socket: never answers, never fails. Only the wait's
        // own abort ends it, with the wait's own 'cancelled' sentence.
        fetch: () => new Promise<Response>(() => undefined),
      }),
    )
    const waited = transport.fetchWithIdleDeadline('https://model.test/x', {
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await expect(waited).rejects.toThrow('cancelled')
  })

  it('an unnamed wait for the first bytes says so while it lasts', async () => {
    const infos: string[] = []
    const transport = new RequestTransport(
      deps({
        noticeMs: 10,
        log: {
          trace: (_message: string) => undefined,
          info: (message: string) => {
            infos.push(message)
          },
          warn: (_message: string) => undefined,
          error: (_message: string) => undefined,
        },
        fetch: () => new Promise<Response>(() => undefined),
      }),
    )
    const controller = new AbortController()
    const waited = transport.fetchWithIdleDeadline('https://model.test/x', {
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 35))
    controller.abort()
    await expect(waited).rejects.toThrow('cancelled')
    expect(infos.some((message) => message.includes('Still waiting'))).toBe(true)
    expect(infos.some((message) => message.includes('provider answer'))).toBe(true)
  })
})
