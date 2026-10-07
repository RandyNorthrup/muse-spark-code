import { afterEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { createHash } from 'node:crypto'
import {
  publicReportTransport,
  ReportResponseCache,
  type ReportNetworkPolicy,
  type ReportNetworkTransport,
} from '../../src/core/reporting/sources/cache'
import {
  GITHUB_API_VERSION,
  GITHUB_MEDIA_TYPE,
  REPORT_SOURCE_TIMEOUT_MS,
  UI_TEXT,
} from '../../src/shared/constants'
import { networkContext, networkRig, pauseNetworkAdmission } from './helpers/reportNetwork'

const schema = z.strictObject({ value: z.string() })
const request = { url: 'https://api.github.com/repos/fixture/repo' }
function read(rig: ReturnType<typeof networkRig>, context = networkContext()) {
  return rig.reader.read(context, 'network', schema, async (query) => ({
    data: await query(request, schema),
    reason: null,
  }))
}
function rateFloorTransport(remaining = '10') {
  return vi.fn(() =>
    Promise.resolve(
      Response.json(
        { value: 'ok' },
        { headers: { 'x-ratelimit-remaining': remaining, 'x-ratelimit-reset': '1791288060' } },
      ),
    ),
  )
}
function ignoredCancellationTransport() {
  const entered = Promise.withResolvers<undefined>()
  const transport = vi
    .fn<ReportNetworkTransport>()
    .mockImplementationOnce(() => {
      entered.resolve(undefined)
      return new Promise<Response>(() => undefined)
    })
    .mockResolvedValue(Response.json({ value: 'recovered' }))
  return { transport, entered: entered.promise }
}
afterEach(() => {
  vi.useRealTimers()
})

describe('report network policy and cache', () => {
  it.each(['maxBytes', 'maxPages', 'maxEntries'])(
    'validates positive injected %s budgets',
    (name) => {
      if (name === 'maxEntries')
        expect(
          () =>
            new ReportResponseCache(
              { read: () => Promise.resolve(undefined), write: () => Promise.resolve() },
              0,
            ),
        ).toThrow()
      else expect(() => networkRig({ [name]: 0 })).toThrow()
    },
  )

  it('refuses oversized query bodies before dispatch', async () => {
    const rig = networkRig({ maxBytes: 1 })
    const result = await rig.reader.read(networkContext(), 'network', schema, async (query) => ({
      data: await query(
        {
          url: 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
          method: 'POST',
          body: '{}',
        },
        schema,
      ),
      reason: null,
    }))
    expect(result.record.reason).toContain('request-bound')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it.each([
    { key: 'bad-cache-key', etag: null, observedAt: networkContext().asOf, data: { value: 'ok' } },
    { key: 'a'.repeat(64), etag: null, observedAt: 'invalid-date', data: { value: 'ok' } },
  ])('validates persistent cache metadata before dispatch %#', async (entry) => {
    const rig = networkRig()
    rig.replaceEntries([entry])
    expect(await read(rig)).toMatchObject({ data: null, record: { status: 'unavailable' } })
    expect(rig.transport).not.toHaveBeenCalled()
  })
  it('refuses credential-shaped request values before dispatch', async () => {
    const rig = networkRig()
    const secret = `ghp_${'e'.repeat(36)}`
    const result = await rig.reader.read(networkContext(), 'network', schema, async (query) => ({
      data: await query({ url: `${request.url}?ref=${secret}` }, schema),
      reason: null,
    }))
    expect(result.record.reason).toContain('request-secret-refused')
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(rig.transport).not.toHaveBeenCalled()
  })
  it('isolates cached responses by workspace', async () => {
    const transport = vi
      .fn<ReportNetworkTransport>()
      .mockResolvedValueOnce(
        Response.json({ value: 'private' }, { headers: { etag: '"private"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const rig = networkRig({ transport })
    await read(rig)
    const result = await read(rig, { ...networkContext(), workspaceKey: 'other-workspace' })
    expect(result.data).toBeNull()
    expect(transport.mock.calls[1]?.[1]).toBeNull()
  })

  it('preserves concurrent cache updates', async () => {
    const rig = networkRig()
    await Promise.all(
      Array.from({ length: 4 }, (_value, index) =>
        rig.reader.read(networkContext(), 'network', schema, async (query) => ({
          data: await query({ url: `${request.url}?page=${String(index)}` }, schema),
          reason: null,
        })),
      ),
    )
    expect(rig.entries()).toHaveLength(4)
  })
  it.each([
    { surface: 'editor', mode: 'off', network: true },
    { surface: 'terminal', mode: 'always', network: false },
    { surface: 'terminal', mode: 'whenSignedIn', network: false },
  ] as const)(
    'does not dispatch for $surface $mode network=$network',
    async ({ surface, mode, network }) => {
      const rig = networkRig()
      const off = networkRig({ policy: { ...rig.deps.policy, surface, mode } })
      const result = await read(off, networkContext(network))
      expect(result).toMatchObject({
        data: null,
        record: { status: 'unavailable', reason: UI_TEXT.reportUi.networkOff },
      })
      expect(off.transport).not.toHaveBeenCalled()
      expect(off.storage.read).not.toHaveBeenCalled()
    },
  )

  it('permits an explicit terminal request and editor public stores', async () => {
    const rig = networkRig()
    const on = networkRig({ policy: { ...rig.deps.policy, surface: 'terminal' } })
    const observed1 = await read(on)
    expect(observed1.record.status).toBe('ok')
    expect(on.transport).toHaveBeenCalledOnce()
  })

  it('checks egress before cache or dispatch', async () => {
    const rig = networkRig()
    const denied = networkRig({
      policy: { ...rig.deps.policy, allowEgress: vi.fn(() => Promise.resolve(false)) },
    })
    const observed2 = await read(denied)
    expect(observed2.record.reason).toContain('egress-refused')
    expect(denied.transport).not.toHaveBeenCalled()
    expect(denied.storage.read).not.toHaveBeenCalled()
  })

  it.each(['cache', 'egress'] as const)(
    'rechecks network-off after an awaited %s admission',
    async (stage) => {
      let mode: ReportNetworkPolicy['mode'] = 'always'
      const base = networkRig()
      const rig = networkRig({
        policy: {
          ...base.deps.policy,
          get mode() {
            return mode
          },
        },
      })
      const admission = pauseNetworkAdmission(rig, stage)
      const pending = read(rig)
      await admission.entered
      mode = 'off'
      admission.release()
      expect(await pending).toMatchObject({
        data: null,
        record: {
          status: 'unavailable',
          reason: expect.stringContaining(UI_TEXT.reportUi.networkOff),
        },
      })
      expect(rig.transport).not.toHaveBeenCalled()
    },
  )

  it('rechecks network-off before every subsequent page', async () => {
    let mode: ReportNetworkPolicy['mode'] = 'always'
    const base = networkRig()
    const rig = networkRig({
      policy: {
        ...base.deps.policy,
        get mode() {
          return mode
        },
      },
    })
    const result = await rig.reader.read(networkContext(), 'network', schema, async (query) => {
      await query(request, schema)
      mode = 'off'
      return { data: await query(request, schema), reason: null }
    })
    expect(result.record.reason).toContain(UI_TEXT.reportUi.networkOff)
    expect(rig.transport).toHaveBeenCalledOnce()
  })

  it.each(['api.github.com', 'marketplace.visualstudio.com', 'open-vsx.org', 'registry.npmjs.org'])(
    'rechecks terminal consent before dispatch to %s',
    async (hostname) => {
      const entered = Promise.withResolvers<undefined>()
      const release = Promise.withResolvers<undefined>()
      let surface: ReportNetworkPolicy['surface'] = 'editor'
      const base = networkRig()
      const rig = networkRig({
        policy: {
          ...base.deps.policy,
          get surface() {
            return surface
          },
        },
      })
      rig.storage.read.mockImplementationOnce(async () => {
        entered.resolve(undefined)
        await release.promise
        return undefined
      })
      const pending = rig.reader.read(networkContext(false), 'network', schema, async (query) => ({
        data: await query({ url: `https://${hostname}/fixture` }, schema),
        reason: null,
      }))
      await entered.promise
      surface = 'terminal'
      release.resolve(undefined)
      const result = await pending
      expect(result.record.reason).toContain(UI_TEXT.reportUi.networkOff)
      expect(rig.transport).not.toHaveBeenCalled()
    },
  )

  it('reuses a 304 with the original observation and age', async () => {
    let observedAt = networkContext().asOf
    const transport = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ value: 'old' }, { headers: { etag: '"v1"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
    const rig = networkRig({ transport, now: () => observedAt })
    const observed3 = await read(rig)
    expect(observed3.data).toEqual({ value: 'old' })
    const later = { ...networkContext(), asOf: '2026-10-06T12:02:00Z' }
    observedAt = later.asOf
    expect(await read(rig, later)).toMatchObject({
      data: { value: 'old' },
      record: { observedAt: networkContext().asOf, freshness: { state: 'stale', ageMs: 120_000 } },
    })
    expect(transport.mock.calls[1]?.[1]).toBe('"v1"')
  })

  it('never fabricates a 304 cache hit', async () => {
    const rig = networkRig({
      transport: vi.fn(() => Promise.resolve(new Response(null, { status: 304 }))),
    })
    expect(await read(rig)).toMatchObject({ data: null, record: { status: 'unavailable' } })
    const observed1 = await read(rig)
    expect(observed1.record.reason).toContain('cache-missing')
  })

  it('scrubs cache content and identity before persisting or hashing', async () => {
    const secret = `ghp_${'a'.repeat(36)}`
    const rig = networkRig({
      transport: vi.fn(() =>
        Promise.resolve(Response.json({ value: secret }, { headers: { etag: secret } })),
      ),
    })
    const context = { ...networkContext(), workspaceKey: `workspace-${secret}` }
    const input = request
    const result = await rig.reader.read(context, 'network', schema, async (query) => ({
      data: await query(input, schema),
      reason: null,
    }))
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(rig.entries())).not.toContain(secret)
    expect(rig.entries()).toEqual([
      expect.objectContaining({
        key: createHash('sha256')
          .update(
            rig.deps.scrub(JSON.stringify({ workspaceKey: context.workspaceKey, request: input })),
          )
          .digest('hex'),
        etag: null,
      }),
    ])
  })

  it('rescrubs a tampered cache body and refuses its secret ETag', async () => {
    const secret = `ghp_${'b'.repeat(36)}`
    const transport = vi.fn<ReportNetworkTransport>(() =>
      Promise.resolve(new Response(null, { status: 304 })),
    )
    const rig = networkRig({ transport })
    rig.replaceEntries([
      {
        key: createHash('sha256')
          .update(JSON.stringify({ workspaceKey: networkContext().workspaceKey, request }))
          .digest('hex'),
        data: { value: secret },
        etag: secret,
        observedAt: networkContext().asOf,
      },
    ])
    expect(JSON.stringify(await read(rig))).not.toContain(secret)
    expect(transport.mock.calls[0]?.[1]).toBeNull()
  })

  it('validates cached records and refuses oversized indexes', async () => {
    const rig = networkRig()
    rig.replaceEntries(
      Array.from({ length: 5 }, () => ({
        key: 'a'.repeat(64),
        etag: null,
        data: {},
        observedAt: networkContext().asOf,
      })),
    )
    const observed4 = await read(rig)
    expect(observed4.record.status).toBe('unavailable')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('prunes the oldest cache entries with a stable tie break', async () => {
    let entries: unknown = undefined
    const cache = new ReportResponseCache(
      {
        read: () => Promise.resolve(entries),
        write: (value) => {
          entries = value
          return Promise.resolve()
        },
      },
      2,
    )
    const signal = new AbortController().signal
    for (const key of ['c', 'a', 'b'])
      await cache.set(
        { key: key.repeat(64), observedAt: networkContext().asOf, etag: null, data: {} },
        signal,
      )
    expect(entries).toEqual([
      expect.objectContaining({ key: 'b'.repeat(64) }),
      expect.objectContaining({ key: 'c'.repeat(64) }),
    ])
  })

  it.each([
    ['http:', '//api.github.com/repos/fixture/repo'].join(''),
    'https://api.github.com:8443/repos/fixture/repo',
    'https://someone:credential@api.github.com/repos/fixture/repo',
    'https://localhost/private',
    'https://api.github.com/repos/fixture/repo#fragment',
  ])('refuses an unpinned endpoint %s', async (url) => {
    const rig = networkRig()
    const observed5 = await rig.reader.read(networkContext(), 'network', schema, async (query) => ({
      data: await query({ url }, schema),
      reason: null,
    }))
    expect(observed5.record.reason).toContain('endpoint-refused')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('refuses a mutation hidden in a network reader', async () => {
    const rig = networkRig()
    const observed6 = await rig.reader.read(networkContext(), 'network', schema, async (query) => ({
      data: await query({ ...request, method: 'POST', body: '{}' }, schema),
      reason: null,
    }))
    expect(observed6.record.reason).toContain('read-method-refused')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('stops at the rate floor and names the reset without dispatching again', async () => {
    const transport = rateFloorTransport()
    const rig = networkRig({ transport })
    const observed7 = await read(rig)
    expect(observed7.record.status).toBe('ok')
    const observed8 = await read(rig)
    expect(observed8.record.reason).toContain('2026-10-06T12:01:00.000Z')
    expect(transport).toHaveBeenCalledOnce()
  })

  it('settles throwing rate refusals before the deadline and releases every same-host slot', async () => {
    vi.useFakeTimers()
    const transport = vi.fn(() =>
      Promise.resolve(
        Response.json(
          { value: 'ok' },
          {
            headers: {
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': '999999999999999999',
            },
          },
        ),
      ),
    )
    const rig = networkRig({ transport })
    const initial = await read(rig)
    expect(initial.record.status).toBe('ok')
    for (const count of [2, 1]) {
      const completed: Awaited<ReturnType<typeof read>>[] = []
      const pending = Promise.all(
        Array.from({ length: count }, async () => {
          completed.push(await read(rig))
        }),
      )
      await vi.advanceTimersByTimeAsync(0)
      expect(completed).toHaveLength(count)
      await pending
      for (const result of completed) {
        expect(result).toMatchObject({ data: null, record: { status: 'unavailable' } })
        expect(result.record.reason).toContain('source-failed')
        expect(result.record.reason).not.toContain('source-deadline')
      }
      expect(vi.getTimerCount()).toBe(0)
    }
    expect(transport).toHaveBeenCalledOnce()
    expect(rig.storage.write).toHaveBeenCalledOnce()
  })

  it('rechecks the rate floor after an awaited cache read', async () => {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const transport = rateFloorTransport('0')
    const rig = networkRig({ transport })
    rig.storage.read.mockImplementationOnce(async () => {
      entered.resolve(undefined)
      await release.promise
      return undefined
    })
    const waiting = read(rig)
    await entered.promise
    const initial = await read(rig)
    expect(initial.record.status).toBe('ok')
    release.resolve(undefined)
    const result = await waiting
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('2026-10-06T12:01:00.000Z')
    expect(transport).toHaveBeenCalledOnce()
  })

  it('serializes concurrent same-host dispatches until rate headers establish the floor', async () => {
    const transport = rateFloorTransport()
    const rig = networkRig({ transport })
    const results = await Promise.all([read(rig), read(rig)])
    expect(results.map((result) => result.record.status)).toEqual(['ok', 'unavailable'])
    expect(results[1].record.reason).toContain('2026-10-06T12:01:00.000Z')
    expect(transport).toHaveBeenCalledOnce()
  })

  it.each(['60', 'Tue, 06 Oct 2026 12:01:00 GMT'])(
    'honors Retry-After %s on a refused request',
    async (retry) => {
      const transport = vi.fn(() =>
        Promise.resolve(new Response(null, { status: 429, headers: { 'retry-after': retry } })),
      )
      const rig = networkRig({ transport })
      const observed9 = await read(rig)
      expect(observed9.record.reason).toContain('2026-10-06T12:01:00.000Z')
      await read(rig)
      expect(transport).toHaveBeenCalledOnce()
    },
  )

  it('does not leak a thrown transport error or a refused HTTP body', async () => {
    const secret = `ghp_${'c'.repeat(36)}`
    const transport = vi
      .fn<ReportNetworkTransport>()
      .mockRejectedValueOnce(new Error(secret))
      .mockResolvedValue(Response.json({ value: 'ok' }))
    const rig = networkRig({ transport })
    const [failed, recovered] = await Promise.all([read(rig), read(rig)])
    expect(JSON.stringify(failed)).not.toContain(secret)
    expect(recovered.record.status).toBe('ok')
    const refused = networkRig({
      transport: vi.fn(() => Promise.resolve(Response.json({ message: secret }, { status: 500 }))),
    })
    expect(JSON.stringify(await read(refused))).not.toContain(secret)
  })

  it.each(['succeeds', 'throws'] as const)(
    'cancels a body after dispatch throws and admits the next request when cleanup %s',
    async (cleanup) => {
      vi.useFakeTimers()
      const detail = 'private-transport-detail'
      const cancel = vi.fn(() => {
        if (cleanup === 'throws') throw new Error(detail)
      })
      const response = new Response(new ReadableStream<Uint8Array>({ cancel }))
      vi.spyOn(response.headers, 'get').mockImplementationOnce(() => {
        throw new Error(detail)
      })
      const transport = vi
        .fn<ReportNetworkTransport>()
        .mockResolvedValueOnce(response)
        .mockImplementation(() => Promise.resolve(Response.json({ value: 'recovered' })))
      const rig = networkRig({ transport })
      const failed = read(rig)
      const next = read(rig)
      await vi.advanceTimersByTimeAsync(0)
      expect(cancel).toHaveBeenCalledOnce()
      expect(transport).toHaveBeenCalledTimes(2)
      expect(await failed).toMatchObject({
        data: null,
        record: { status: 'unavailable', reason: expect.stringContaining('source-failed') },
      })
      expect(JSON.stringify(await failed)).not.toContain(detail)
      expect(await next).toMatchObject({
        data: { value: 'recovered' },
        record: { status: 'ok' },
      })
      expect(rig.storage.write).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('bounds response bytes and validates HTTP payloads', async () => {
    const large = networkRig({ maxBytes: 1 })
    const observed10 = await read(large)
    expect(observed10.record.reason).toContain('body-bound')
    const invalid = networkRig({
      transport: vi.fn(() => Promise.resolve(Response.json({ value: 1 }))),
    })
    const observed11 = await read(invalid)
    expect(observed11.record.status).toBe('unavailable')
  })

  it('bounds pages rather than following arbitrary pagination forever', async () => {
    const rig = networkRig({ maxPages: 1 })
    const result = await rig.reader.read(networkContext(), 'network', schema, async (query) => {
      await query(request, schema)
      return { data: await query(request, schema), reason: null }
    })
    expect(result.record.reason).toContain('page-bound')
    expect(rig.transport).toHaveBeenCalledOnce()
  })

  it('times out ignored cancellation within the repository timeout', async () => {
    vi.useFakeTimers()
    const rig = networkRig({ transport: vi.fn(() => new Promise<Response>(() => undefined)) })
    const pending = read(rig)
    await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
    const observed12 = await pending
    expect(observed12.record.reason).toContain('source-deadline')
  })

  it.each(['deadline', 'abort'] as const)(
    'releases same-host admission after %s when transport ignores cancellation',
    async (stop) => {
      vi.useFakeTimers()
      const { transport, entered } = ignoredCancellationTransport()
      const rig = networkRig({ transport })
      const controller = new AbortController()
      const pending = read(rig, { ...networkContext(), signal: controller.signal })
      await entered
      if (stop === 'abort') controller.abort()
      else await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
      const expired = await pending
      expect(expired.record.reason).toContain('source-deadline')
      const recovering = read(rig)
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
      expect(await recovering).toMatchObject({
        data: { value: 'recovered' },
        record: { status: 'ok' },
      })
      expect(transport).toHaveBeenCalledTimes(2)
    },
  )

  it('removes an aborted waiter without releasing the active host owner', async () => {
    vi.useFakeTimers()
    const { transport, entered } = ignoredCancellationTransport()
    const rig = networkRig({ transport })
    const ownerController = new AbortController()
    const owner = read(rig, { ...networkContext(), signal: ownerController.signal })
    await entered
    const waiterController = new AbortController()
    const finished = vi.fn()
    const waiter = rig.reader.read(
      { ...networkContext(), signal: waiterController.signal },
      'network',
      schema,
      async (query) => {
        try {
          return { data: await query(request, schema), reason: null }
        } finally {
          finished()
        }
      },
    )
    await vi.advanceTimersByTimeAsync(0)
    waiterController.abort()
    const canceledWaiter = await waiter
    expect(canceledWaiter.record.reason).toContain('source-deadline')
    await vi.advanceTimersByTimeAsync(0)
    expect(finished).toHaveBeenCalledOnce()
    const next = read(rig)
    await vi.advanceTimersByTimeAsync(0)
    expect(transport).toHaveBeenCalledOnce()
    ownerController.abort()
    const canceledOwner = await owner
    expect(canceledOwner.record.reason).toContain('source-deadline')
    await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
    const recovered = await next
    expect(recovered.record.status).toBe('ok')
    expect(transport).toHaveBeenCalledTimes(2)
  })

  it.each(['response', 'rejection'] as const)(
    'discards a late transport %s without changing the new host generation',
    async (completion) => {
      vi.useFakeTimers()
      const obsolete = Promise.withResolvers<Response>()
      const current = Promise.withResolvers<Response>()
      const transport = vi
        .fn<ReportNetworkTransport>()
        .mockReturnValueOnce(obsolete.promise)
        .mockReturnValueOnce(current.promise)
        .mockImplementation(() => Promise.resolve(Response.json({ value: 'recovered' })))
      const rig = networkRig({ transport })
      const expired = read(rig)
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
      const expiredResult = await expired
      expect(expiredResult.record.reason).toContain('source-deadline')
      const recovering = read(rig)
      await vi.advanceTimersByTimeAsync(0)
      expect(transport).toHaveBeenCalledTimes(2)
      const cancel = vi.fn()
      if (completion === 'response')
        obsolete.resolve(
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1791288060' },
          }),
        )
      else obsolete.reject(new Error('obsolete-transport'))
      await vi.advanceTimersByTimeAsync(0)
      if (completion === 'response') expect(cancel).toHaveBeenCalledOnce()
      expect(rig.storage.write).not.toHaveBeenCalled()
      const waiting = read(rig)
      await vi.advanceTimersByTimeAsync(0)
      expect(transport).toHaveBeenCalledTimes(2)
      current.resolve(Response.json({ value: 'current' }))
      await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
      const recovered = await recovering
      const waited = await waiting
      expect(recovered.record.status).toBe('ok')
      expect(waited.record.status).toBe('ok')
      expect(transport).toHaveBeenCalledTimes(3)
      expect(rig.storage.write).toHaveBeenCalledTimes(2)
    },
  )

  it('refuses an already aborted read', async () => {
    const rig = networkRig()
    const controller = new AbortController()
    controller.abort()
    const observed13 = await read(rig, { ...networkContext(), signal: controller.signal })
    expect(observed13.record.status).toBe('unavailable')
    expect(rig.transport).not.toHaveBeenCalled()
  })

  it('cancels a stalled response body on the source deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }))
    const rig = networkRig({ transport: vi.fn(() => Promise.resolve(response)) })
    const pending = read(rig)
    await vi.advanceTimersByTimeAsync(REPORT_SOURCE_TIMEOUT_MS)
    expect(await pending).toMatchObject({ data: null, record: { status: 'unavailable' } })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('does not manufacture an observation for an unbound source port', async () => {
    const rig = networkRig()
    const result = await rig.reader.read(networkContext(), 'network', schema, () =>
      Promise.resolve({ data: { value: 'fake-success' }, reason: null }),
    )
    expect(result.record.status).toBe('unavailable')
    expect(result.record.reason).toContain('no-observed-source')
    expect(result.data).toBeNull()
  })

  it('uses a credential-free, redirect-refusing public fetch', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})))
    await publicReportTransport(fetcher)(request, '"v1"', new AbortController().signal)
    expect(fetcher).toHaveBeenCalledWith(
      request.url,
      expect.objectContaining({
        redirect: 'error',
        credentials: 'omit',
        headers: {
          'If-None-Match': '"v1"',
          Accept: GITHUB_MEDIA_TYPE,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
      }),
    )
  })
})
