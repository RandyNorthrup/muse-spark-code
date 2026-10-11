import { describe, expect, it, vi } from 'vitest'
import { keyringSecretStore, StoreUnavailableError } from '../../src/runtime/keyStore'
import { RequestTransport } from '../../src/core/backends/modelapi/transport'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

function store(read: () => Promise<string | null | undefined>) {
  return keyringSecretStore(() => ({
    getPassword: read,
    setPassword: () => Promise.resolve(),
    deletePassword: () => Promise.resolve(true),
  }))
}

describe('ACPDOG bounded credential reads', () => {
  it('retries busy reads, then reads again for the next request', async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('private native detail'))
      .mockResolvedValue('synthetic')
    const secrets = store(read)
    expect(await secrets.get('test')).toBe('synthetic')
    expect(await secrets.get('test')).toBe('synthetic')
    expect(read).toHaveBeenCalledTimes(3)
  })
  it('does not retry an answered absent entry', async () => {
    const read = vi.fn<() => Promise<null>>().mockResolvedValue(null)
    expect(await store(read).get('test')).toBeUndefined()
    expect(read).toHaveBeenCalledOnce()
  })
  it.each(['busy', 'no-answer'])(
    'bounds %s, discards native diagnostics, and recovers on the next request',
    async (kind) => {
      vi.useFakeTimers()
      try {
        const read = vi.fn<() => Promise<string>>()
        if (kind === 'busy') read.mockRejectedValue(new Error('native key/header detail'))
        else read.mockImplementation(() => new Promise(() => undefined))
        const secrets = store(read)
        const failure = expect(secrets.get('test')).rejects.toThrow(StoreUnavailableError)
        await vi.runAllTimersAsync()
        await failure
        expect(read).toHaveBeenCalledTimes(3)
        read.mockResolvedValue('replacement')
        expect(await secrets.get('test')).toBe('replacement')
      } finally {
        vi.useRealTimers()
      }
    },
  )
  it('refuses an unsent request with a localized typed cause and remains usable', async () => {
    let isUnavailable = true
    const sent = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }))
    const transport = new RequestTransport({
      baseUrl: 'https://provider.example.test',
      apiKey: () =>
        isUnavailable ? Promise.reject(new StoreUnavailableError()) : Promise.resolve('synthetic'),
      fetch: sent,
      sleep: () => Promise.resolve(),
      now: Date.now,
      random: () => 0,
      log: new FakeLogOutputChannel(),
    })
    await expect(
      transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined),
    ).rejects.toMatchObject({
      code: 'credential_store_unavailable',
      message: UI_TEXT.acpCredentialStoreNoAnswer,
      status: 0,
    })
    expect(sent).not.toHaveBeenCalled()
    isUnavailable = false
    await transport.request('/models', { method: 'GET', accept: 'application/json' }, undefined)
    expect(sent).toHaveBeenCalledOnce()
  })
})
