// Scan this computer's probes (src/host/providers/localProbe.ts): a refused
// loopback connection and our own timeout read as unanswered; a failure
// from the fetch itself is not an answer and rejects.
import { describe, expect, it } from 'vitest'
import { probeLocalServers } from '../../src/host/providers/localProbe'

const hanging: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    })
  })

const broken: typeof fetch = () => Promise.reject(new Error('custom fetch blew up'))

const ok: typeof fetch = () =>
  Promise.resolve(new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }))

describe('probeLocalServers', () => {
  it('reads a refused loopback connection as unanswered', async () => {
    const [result] = await probeLocalServers(
      [{ host: '127.0.0.1', port: 1, path: '/' }],
      fetch,
      5000,
    )
    expect(result?.answered).toBe(false)
    expect(result?.status).toBe(undefined)
    expect(result?.snippet).toBe('')
  })

  it('reads our own timeout as unanswered', async () => {
    const [result] = await probeLocalServers(
      [{ host: '127.0.0.1', port: 80, path: '/' }],
      hanging,
      50,
    )
    expect(result?.answered).toBe(false)
    expect(result?.status).toBe(undefined)
  })

  it('rejects a failure from the fetch itself', async () => {
    await expect(
      probeLocalServers([{ host: '127.0.0.1', port: 80, path: '/' }], broken, 5000),
    ).rejects.toThrow('custom fetch blew up')
  })

  it('reports a 2xx answer with its snippet', async () => {
    const [result] = await probeLocalServers([{ host: '127.0.0.1', port: 80, path: '/' }], ok, 5000)
    expect(result?.answered).toBe(true)
    expect(result?.status).toBe(200)
    expect(result?.snippet).toBe('hello')
  })
})
