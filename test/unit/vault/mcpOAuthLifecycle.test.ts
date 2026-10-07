import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { isWiped, oauthFixture } from './mcpOAuthFixture'

describe('M109 O rotation and generation', () => {
  it('W-O1 cancellation before token dispatch leaves the refresh usable for a later call', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    f.advance()
    const controller = new AbortController()
    let tokenAdmissions = 0
    f.allowEndpoint.mockImplementation((url) => {
      if (url === f.metadata.token_endpoint && ++tokenAdmissions === 2) controller.abort()
      return Promise.resolve(true)
    })
    await expect(
      f.client.fetch(f.binding, f.binding.resource, { ...f.init, signal: controller.signal }),
    ).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.invalidate).not.toHaveBeenCalled()
    f.allowEndpoint.mockResolvedValue(true)
    await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).resolves.toBeInstanceOf(
      Response,
    )
  })
  it('W-O2 a queued refresh checks quarantine after the failed leader settles', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    f.advance()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    // Simulate a quarantine writer that cannot remove the stale stored token.
    vi.mocked(f.vault.invalidate).mockImplementation(() => Promise.resolve())
    const actual = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async (url, init) => {
      if (url === f.metadata.token_endpoint) {
        entered.resolve(undefined)
        await release.promise
        throw new Error('uncertain refresh dispatch')
      }
      return await actual(url, init)
    })
    const first = f.client.fetch(f.binding, f.binding.resource, f.init)
    const second = f.client.fetch(f.binding, f.binding.resource, f.init)
    const rejected = [
      expect(first).rejects.toThrow(UI_TEXT.vault.noAccess),
      expect(second).rejects.toThrow(UI_TEXT.vault.noAccess),
    ]
    await entered.promise
    release.resolve(undefined)
    await Promise.all(rejected)
    expect(f.fetcher.mock.calls.filter(([url]) => url === f.metadata.token_endpoint)).toHaveLength(
      2,
    ) // sign-in + one refresh
  })
  it('W-O3 loopback close failure precedes the sign-in commit, allowing retry', async () => {
    const f = oauthFixture()
    f.close.mockImplementationOnce(() => {
      throw new Error('loopback close failed')
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.vault.create).not.toHaveBeenCalled()
    await expect(f.client.signIn(f.binding, f.signal)).resolves.toBeUndefined()
    expect(f.saved.every(isWiped)).toBe(true)
  })

  it('scoped revocation aborts its handle while leaving another queued sign-in live', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    f.authorize.mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      return { assertCurrent: () => undefined, finish: f.finish }
    })
    vi.mocked(f.vault.create).mockImplementationOnce((item, authorize) => {
      authorize()
      f.saved.push(item)
      return Promise.resolve()
    })
    const first = f.client.fetch(f.binding, f.binding.resource, f.init)
    const refused = expect(first).rejects.toThrow(UI_TEXT.vault.noAccess)
    const second = f.client.signIn({ ...f.binding, handle: 'secret://mcp-two' }, f.signal)
    await entered.promise
    f.client.invalidate(f.binding.handle)
    release.resolve(undefined)
    await refused
    await expect(second).resolves.toBeUndefined()
    expect(f.saved.every(isWiped)).toBe(true)
  })

  it('settles every acquired permit, including denied I/O, after private buffers are erased', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    expect(f.finish).toHaveBeenCalledWith(true)
    f.finish.mockClear()
    vi.mocked(f.vault.read).mockRejectedValueOnce(new Error(f.access))
    await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(f.finish).toHaveBeenCalledWith(false)
    expect(f.saved.every(isWiped)).toBe(true)
  })

  it('new sign-in cannot overwrite an existing item or reset its policy', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    f.item().metadata.policy.mode = 'never'
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.item().metadata.policy.mode).toBe('never')
    expect(f.saved.every(isWiped)).toBe(true)
  })

  it('lock synchronously erases owned material and in-flight Authorization, even with stalled transport', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    let headers: Headers | undefined
    f.fetcher.mockImplementationOnce(async (_url, init) => {
      headers = init?.headers instanceof Headers ? init.headers : undefined
      entered.resolve(undefined)
      await finish.promise
      return Response.json({ ok: true })
    })
    const request = f.client.fetch(f.binding, f.binding.resource, f.init)
    const refused = expect(request).rejects.toThrow(UI_TEXT.vault.noAccess)
    await entered.promise
    expect(f.borrowed.every(isWiped)).toBe(false)
    expect(headers?.has('authorization')).toBe(true)
    f.client.invalidate()
    expect(f.borrowed.every(isWiped)).toBe(true)
    expect(headers?.has('authorization')).toBe(false)
    finish.resolve(undefined)
    await refused
  })

  it('listener cleanup failure cannot bypass token erasure', async () => {
    const f = oauthFixture()
    f.close.mockImplementationOnce(() => {
      throw new Error('fixture cleanup failed')
    })
    await expect(f.client.signIn(f.binding, f.signal)).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect(f.saved.every(isWiped)).toBe(true)
  })

  it('serializes concurrent refreshes, commits rotation before use, wipes every borrowed/new buffer', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    f.advance()
    const before = f.fetcher.mock.calls.length
    await Promise.all([
      f.client.fetch(f.binding, f.binding.resource, f.init),
      f.client.fetch(f.binding, f.binding.resource, f.init),
    ])
    const refreshes = f.fetcher.mock.calls
      .slice(before)
      .filter(([url]) => url === f.metadata.token_endpoint)
    expect(refreshes).toHaveLength(1)
    const body = new URLSearchParams(
      typeof refreshes[0]?.[1]?.body === 'string' ? refreshes[0][1].body : '',
    )
    expect(body.get('resource')).toBe(f.binding.resource)
    expect(body.get('refresh_token')).toBe(f.refresh)
    const material = f.item().material
    expect(material.kind).toBe('oauth')
    if (material.kind === 'oauth')
      expect(new TextDecoder().decode(material.refreshToken!)).toBe(f.nextRefresh)
    expect(f.saved.every(isWiped)).toBe(true)
    expect(f.borrowed.every(isWiped)).toBe(true)
    expect(f.vault.invalidate).not.toHaveBeenCalled()
  })

  it.each(['missingRotation', 'sameRotation', 'persistFailure'])(
    'quarantines %s; never retries stale refresh',
    async (fault) => {
      const f = oauthFixture()
      await f.client.signIn(f.binding, f.signal)
      f.advance()
      if (fault === 'persistFailure')
        vi.mocked(f.vault.save).mockRejectedValueOnce(new Error(f.nextAccess))
      else {
        const original = f.dispatch.getMockImplementation()!
        f.dispatch.mockImplementation((url, init) =>
          url === f.metadata.token_endpoint
            ? Response.json({
                access_token: f.nextAccess,
                token_type: 'Bearer',
                expires_in: 3600,
                ...(fault === 'sameRotation' && { refresh_token: f.refresh }),
              })
            : original(url, init),
        )
      }
      await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(f.vault.invalidate).toHaveBeenCalledWith(f.binding.handle, expect.any(String))
      const calls = f.fetcher.mock.calls.length
      await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).rejects.toThrow(
        UI_TEXT.vault.noAccess,
      )
      expect(f.fetcher).toHaveBeenCalledTimes(calls)
      expect(f.borrowed.every(isWiped)).toBe(true)
    },
  )

  it('checks generation at physical commit; lock refuses late sign-in bytes', async () => {
    const f = oauthFixture()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<undefined>()
    let hasCommitted = false
    vi.mocked(f.vault.create).mockImplementationOnce(async (item, authorize) => {
      f.saved.push(item)
      entered.resolve(undefined)
      await finish.promise
      authorize()
      hasCommitted = true
    })
    const attempt = f.client.signIn(f.binding, f.signal)
    const denied = expect(attempt).rejects.toThrow(UI_TEXT.vault.noAccess)
    await entered.promise
    f.client.invalidate()
    finish.resolve(undefined)
    await denied
    expect(hasCommitted).toBe(false)
    expect(f.saved.every(isWiped)).toBe(true)
    expect(f.close).toHaveBeenCalledOnce()
  })

  it('refuses queued old generation after lock and never dispatches its token', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    vi.mocked(f.vault.read).mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      const item = structuredClone(f.item())
      f.borrowed.push(item)
      return item
    })
    const first = f.client.fetch(f.binding, f.binding.resource, f.init)
    const second = f.client.fetch(f.binding, f.binding.resource, f.init)
    const assertions = [
      expect(first).rejects.toThrow(UI_TEXT.vault.noAccess),
      expect(second).rejects.toThrow(UI_TEXT.vault.noAccess),
    ]
    await entered.promise
    f.client.invalidate()
    release.resolve(undefined)
    await Promise.all(assertions)
    expect(f.vault.read).toHaveBeenCalledOnce()
    expect(f.fetcher.mock.calls.filter(([url]) => url === f.binding.resource)).toHaveLength(0)
    expect(f.borrowed.every(isWiped)).toBe(true)
  })

  it('checks active policy again after network admission and before token release', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    let isAllowed = true
    f.authorize.mockResolvedValue({
      assertCurrent: () => {
        if (!isAllowed) throw new Error('revoked')
      },
      finish: f.finish,
    })
    f.allowEndpoint.mockImplementationOnce(() => {
      isAllowed = false
      return Promise.resolve(true)
    })
    const request = f.client.fetch(f.binding, f.binding.resource, f.init)
    await expect(request).rejects.toThrow(UI_TEXT.vault.noAccess)
    expect({
      calls: f.fetcher.mock.calls.filter(([url]) => url === f.binding.resource).length,
      wiped: f.borrowed.every(isWiped),
    }).toEqual({ calls: 0, wiped: true })
  })

  it('never returns an unscrubbed echo when lock occurs during response scrubbing', async () => {
    const f = oauthFixture()
    await f.client.signIn(f.binding, f.signal)
    f.scrub.mockImplementationOnce(() => {
      f.client.invalidate()
      return Promise.resolve(Response.json({ echo: f.access }))
    })
    await expect(f.client.fetch(f.binding, f.binding.resource, f.init)).rejects.toThrow(
      UI_TEXT.vault.noAccess,
    )
    expect(f.borrowed.every(isWiped)).toBe(true)
  })
})
