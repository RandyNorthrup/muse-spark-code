import { describe, expect, it, vi } from 'vitest'
import { EstimateProvisionRun } from '../../src/core/estimator/provision/run'
import { provisionRun, serverReceipt } from './helpers/estimatorRunFixtures'
import { pending } from './helpers/estimatorProvisionFixtures'
import { ESTIMATE_MAX_ITEMS } from '../../src/shared/constants'

describe('M117 exact confirmed run-budget provisioning', () => {
  it.each([undefined, -1, NaN, Infinity])(
    'requires an explicit valid budget %s before reading a provider',
    (budget) => {
      const fixture = provisionRun()
      expect(() => new EstimateProvisionRun(fixture.bindings, budget)).toThrow('Set a hard budget')
      expect(fixture.provider.requests).toEqual([])
    },
  )

  it('keeps missing node bindings advice-only and refuses unknown providers', async () => {
    const fixture = provisionRun()
    const { nodes: _nodes, ...bindings } = fixture.bindings
    const advice = new EstimateProvisionRun(bindings, 1)
    expect(advice.availability()).toBe('adviceOnly')
    await expect(advice.quote([fixture.request()])).rejects.toThrow('advice only')
    expect(fixture.provider.requests).toEqual([])
    const empty = new EstimateProvisionRun({ ...fixture.bindings, providers: [] }, 1)
    expect(empty.availability()).toBe('adviceOnly')
    await expect(empty.quote([fixture.request()])).rejects.toThrow('advice only')
    await expect(
      fixture.run.quote([{ ...fixture.request(), providerId: 'unconnected' }]),
    ).rejects.toThrow('provider-not-connected')
    expect(fixture.provider.requests).toEqual([])
  })

  it('shows each price and the whole total before separate server confirmations and ordered install/pair', async () => {
    const fixture = provisionRun()
    const create = vi.spyOn(fixture.provider, 'create')
    const install = vi.spyOn(fixture.node, 'install')
    const pair = vi.spyOn(fixture.node, 'pair')
    const quote = await fixture.run.quote([fixture.request('one'), fixture.request('two', 2)])
    expect(quote.servers.map((server) => server.priceUsd)).toEqual([0.02, 0.04])
    expect(quote.totalUsd).toBe(0.06)
    expect(quote.budgetUsd).toBe(1)
    expect(await fixture.run.execute(quote.id)).toMatchObject([
      { id: 'one', state: 'ready' },
      { id: 'two', state: 'ready' },
    ])
    expect(fixture.confirmServer).toHaveBeenCalledTimes(2)
    expect(fixture.showPrices.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.confirmServer.mock.invocationCallOrder[0] ?? 0,
    )
    for (let index = 0; index < 2; index++) {
      expect(fixture.confirmServer.mock.invocationCallOrder[index]).toBeLessThan(
        create.mock.invocationCallOrder[index] ?? 0,
      )
      expect(create.mock.invocationCallOrder[index]).toBeLessThan(
        install.mock.invocationCallOrder[index] ?? 0,
      )
      expect(install.mock.invocationCallOrder[index]).toBeLessThan(
        pair.mock.invocationCallOrder[index] ?? 0,
      )
    }
    expect(fixture.cloudInit.mock.calls.map((call) => call[2])).toEqual([
      '2026-10-06T13:00:00.000Z',
      '2026-10-06T14:00:00.000Z',
    ])
    expect(fixture.lifecycle.snapshots()).toHaveLength(2)
    expect(fixture.run.reservedUsd()).toBe(0.06)
  })

  it('denial creates nothing and cannot become a remembered grant for another server', async () => {
    const fixture = provisionRun()
    fixture.confirmServer.mockResolvedValueOnce(false)
    const quote = await fixture.run.quote([fixture.request('one'), fixture.request('two')])
    expect(await fixture.run.execute(quote.id)).toMatchObject([
      { state: 'denied' },
      { state: 'ready' },
    ])
    expect(fixture.confirmServer).toHaveBeenCalledTimes(2)
    expect(fixture.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(fixture.run.reservedUsd()).toBe(0.02)
  })

  it('refuses a run over its cap before any execution request or popup', async () => {
    const fixture = provisionRun(0.03)
    const quote = await fixture.run.quote([fixture.request('one'), fixture.request('two')])
    const reads = fixture.provider.requests.length
    await expect(fixture.run.execute(quote.id)).rejects.toThrow('exceed the run budget')
    expect(fixture.provider.requests).toHaveLength(reads)
    expect(fixture.showPrices).not.toHaveBeenCalled()
    expect(fixture.confirmServer).not.toHaveBeenCalled()
    expect(fixture.cloudInit).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'products', budget: 0.06, hours: [0.1, 0.2, 0.3] },
    { label: 'sums', budget: 0.3, hours: [1, 1, 1] },
  ])(
    'admits exact decimal equality without binary floating-point overrun ($label)',
    async ({ budget, hours }) => {
      const fixture = provisionRun(budget)
      fixture.provider.size.hourlyUsd = 0.1
      const quote = await fixture.run.quote(
        hours.map((hour, index) => fixture.request(String(index), hour)),
      )
      expect(quote.totalUsd).toBe(budget)
      const results = await fixture.run.execute(quote.id)
      expect(results.map((result) => result.state)).toEqual(['ready', 'ready', 'ready'])
      expect(fixture.run.reservedUsd()).toBe(budget)
    },
  )

  it('compares sub-nano liability before display rounding', async () => {
    const fixture = provisionRun(0.00000000005)
    fixture.provider.size.hourlyUsd = 0.0000000001
    const quote = await fixture.run.quote([fixture.request('one', 0.5)])
    expect(quote.totalUsd).toBe(0.000000001)
    expect(await fixture.run.execute(quote.id)).toMatchObject([{ state: 'ready' }])
  })

  it('serializes concurrent executions, reserves before create and refuses reuse of a consumed quote', async () => {
    const fixture = provisionRun(0.02)
    const quote = await fixture.run.quote([fixture.request()])
    const another = await fixture.run.quote([fixture.request('another')])
    const gate = pending<boolean>()
    fixture.confirmServer.mockImplementationOnce(() => gate.promise)
    const first = fixture.run.execute(quote.id)
    const second = fixture.run.execute(another.id)
    const rejected = expect(second).rejects.toThrow('exceed the run budget')
    await vi.waitFor(() => {
      expect(fixture.confirmServer).toHaveBeenCalledTimes(1)
    })
    const create = vi.spyOn(fixture.provider, 'create')
    create.mockImplementationOnce((size, image, cloudInit) => {
      expect(fixture.run.reservedUsd()).toBe(0.02)
      create.mockRestore()
      return fixture.provider.create(size, image, cloudInit)
    })
    gate.resolve(true)
    expect(await first).toMatchObject([{ state: 'ready' }])
    await rejected
    await expect(fixture.run.execute(quote.id)).rejects.toThrow('consumed-quote')
    expect(fixture.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it('retains an uncertain create reservation and never retries or spends past it', async () => {
    const fixture = provisionRun(0.02)
    vi.spyOn(fixture.provider, 'create').mockRejectedValueOnce(new Error('private provider detail'))
    const quote = await fixture.run.quote([fixture.request()])
    expect(await fixture.run.execute(quote.id)).toEqual([
      { id: 'first', providerId: fixture.provider.id, state: 'uncertain', failure: 'create' },
    ])
    expect(fixture.run.reservedUsd()).toBe(0.02)
    const another = await fixture.run.quote([fixture.request('another')])
    await expect(fixture.run.execute(another.id)).rejects.toThrow('exceed the run budget')
    expect(fixture.node.calls).toEqual([])
  })

  it('wipes and deletes failed installation/pairing, retaining admitted liability', async () => {
    for (const phase of ['install', 'pair'] as const) {
      const fixture = provisionRun()
      vi.spyOn(fixture.node, phase).mockRejectedValueOnce(new Error('private node detail'))
      const quote = await fixture.run.quote([fixture.request()])
      expect(await fixture.run.execute(quote.id)).toMatchObject([
        { state: 'failed', failure: phase },
      ])
      expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
      expect(fixture.run.reservedUsd()).toBe(0.02)
    }
  })

  it('reports unconfirmed cleanup and tracks it for reconciliation', async () => {
    const fixture = provisionRun()
    vi.spyOn(fixture.node, 'pair').mockRejectedValueOnce(new Error('pair failed'))
    vi.spyOn(fixture.node, 'teardownAndWipe').mockRejectedValueOnce(new Error('wipe failed'))
    const quote = await fixture.run.quote([fixture.request()])
    expect(await fixture.run.execute(quote.id)).toMatchObject([
      { state: 'failed', failure: 'cleanup' },
    ])
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'failed', failure: 'wipe' }])
    expect(fixture.provider.requests.filter((request) => request.method === 'DELETE')).toHaveLength(
      0,
    )
    await fixture.lifecycle.sweep()
    expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
  })

  it('clones quotes, prices and consent payloads so a popup cannot change the authorized spend', async () => {
    const fixture = provisionRun(0.02)
    const quote = await fixture.run.quote([fixture.request()])
    const first = quote.servers[0]
    if (!first) throw new Error('Missing fixture quote')
    first.size.hourlyUsd = 0
    first.image.id = 'other'
    vi.spyOn(fixture.bindings, 'showPrices').mockImplementationOnce((payload) => {
      const selected = payload.servers[0]
      if (!selected) throw new Error('Missing preview server')
      selected.size.id = 'unapproved'
      selected.size.hourlyUsd = 999
      return Promise.resolve()
    })
    vi.spyOn(fixture.bindings, 'confirmServer').mockImplementationOnce((selected) => {
      selected.image.id = 'unapproved'
      return Promise.resolve(true)
    })
    expect(await fixture.run.execute(quote.id)).toMatchObject([{ state: 'ready' }])
    expect(fixture.run.reservedUsd()).toBe(0.02)
    expect(fixture.run.snapshots()).toMatchObject([
      { state: 'ready', server: { imageId: 'container', sizeId: 'small' } },
    ])
  })

  it('refuses bad selections, duplicate requests and incompatible images', async () => {
    const fixture = provisionRun()
    await expect(fixture.run.quote([{ ...fixture.request(), sizeId: 'missing' }])).rejects.toThrow(
      'unknown-size-image',
    )
    expect(() => fixture.run.quote([fixture.request(), fixture.request()])).toThrow()
    fixture.provider.image.architecture = 'arm64'
    await expect(fixture.run.quote([fixture.request()])).rejects.toThrow('incompatible-image')
    expect(fixture.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
  })

  it.each(['preview', 'consent', 'cloudInit', 'expired'] as const)(
    'does not create when %s fails or outlives funding',
    async (phase) => {
      const fixture = provisionRun()
      switch (phase) {
        case 'preview': {
          fixture.showPrices.mockRejectedValueOnce(new Error('private preview detail'))
          break
        }
        case 'consent': {
          fixture.confirmServer.mockRejectedValueOnce(new Error('private consent detail'))
          break
        }
        case 'cloudInit': {
          fixture.cloudInit.mockRejectedValueOnce(new Error('private cloud-init detail'))
          break
        }
        case 'expired': {
          fixture.cloudInit.mockImplementationOnce(() => {
            fixture.advance(3_600_000)
            return Promise.resolve('cloud-init')
          })
          break
        }
      }
      const quote = await fixture.run.quote([fixture.request()])
      await expect(fixture.run.execute(quote.id)).rejects.toThrow()
      expect(fixture.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(
        0,
      )
      expect(fixture.run.reservedUsd()).toBe(0)
    },
  )

  it('funds decimal lifetimes exactly and floors fractional milliseconds without extending the charge', async () => {
    const fixture = provisionRun()
    const quote = await fixture.run.quote([
      fixture.request('decimal', 0.07),
      fixture.request('under-round', 0.29),
      fixture.request('fraction', 0.000001),
    ])
    expect(await fixture.run.execute(quote.id)).toMatchObject([
      { state: 'ready' },
      { state: 'ready' },
      { state: 'ready' },
    ])
    expect(fixture.cloudInit.mock.calls.map((call) => call[2])).toEqual([
      '2026-10-06T12:04:12.000Z',
      '2026-10-06T12:17:24.000Z',
      '2026-10-06T12:00:00.003Z',
    ])
    const invalid = provisionRun()
    await expect(
      invalid.run.quote([invalid.request('too-short', Number.MIN_VALUE)]),
    ).rejects.toThrow('invalid-funded-duration')
    expect(invalid.provider.requests).toEqual([])
  })

  it('refuses an unrepresentable price, total or lifetime rather than displaying an infinite quote', async () => {
    const price = provisionRun()
    price.provider.size.hourlyUsd = Number.MAX_VALUE
    await expect(price.run.quote([price.request('price', 2)])).rejects.toThrow(
      'unrepresentable-price',
    )
    const total = provisionRun()
    total.provider.size.hourlyUsd = 1e308
    await expect(total.run.quote([total.request('one'), total.request('two')])).rejects.toThrow(
      'unrepresentable-total',
    )
    const lifetime = provisionRun(0)
    lifetime.provider.size.hourlyUsd = 0
    const quote = await lifetime.run.quote([lifetime.request('far-future', 2_450_000_000)])
    await expect(lifetime.run.execute(quote.id)).rejects.toThrow('invalid-funded-lifetime')
    expect(lifetime.cloudInit).not.toHaveBeenCalled()
  })

  it('refuses duplicate providers and catalog selections before creation', async () => {
    const fixture = provisionRun()
    expect(
      () =>
        new EstimateProvisionRun(
          { ...fixture.bindings, providers: [fixture.provider, fixture.provider] },
          1,
        ),
    ).toThrow('duplicate-provider')
    vi.spyOn(fixture.provider, 'sizes').mockResolvedValueOnce([
      fixture.provider.size,
      fixture.provider.size,
    ])
    await expect(fixture.run.quote([fixture.request()])).rejects.toThrow('duplicate-selection')
    vi.spyOn(fixture.provider, 'images').mockResolvedValueOnce([
      fixture.provider.image,
      fixture.provider.image,
    ])
    await expect(fixture.run.quote([fixture.request()])).rejects.toThrow('duplicate-selection')
    expect(fixture.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
  })

  it('requires a valid captured projection, valid image, explicit boolean consent and nonempty cloud-init', async () => {
    const catalog = provisionRun()
    vi.spyOn(catalog.provider, 'sizes').mockResolvedValueOnce([
      { ...catalog.provider.size, hourlyUsd: -1 },
    ])
    await expect(catalog.run.quote([catalog.request()])).rejects.toThrow('provider-catalog')
    const selection = provisionRun()
    await expect(
      selection.run.quote([{ ...selection.request(), imageId: 'unknown' }]),
    ).rejects.toThrow('unknown-size-image')
    const consent = provisionRun()
    Object.defineProperty(consent.bindings, 'confirmServer', {
      value: () => Promise.resolve('always'),
    })
    const quote = await consent.run.quote([consent.request()])
    await expect(consent.run.execute(quote.id)).rejects.toThrow('server-confirmation')
    expect(consent.provider.requests.filter((request) => request.method === 'POST')).toHaveLength(0)
    for (const cloudInit of ['', ' ']) {
      const fixture = provisionRun()
      fixture.cloudInit.mockResolvedValueOnce(cloudInit)
      const prepared = await fixture.run.quote([fixture.request()])
      await expect(fixture.run.execute(prepared.id)).rejects.toThrow('cloud-init')
      expect(fixture.run.reservedUsd()).toBe(0)
    }
  })

  it('rejects malformed or mismatched created servers and retains their uncertain liability', async () => {
    for (const changes of [
      { sizeId: 'wrong' },
      { imageId: 'wrong' },
      { state: 'deleted' as const },
    ]) {
      const fixture = provisionRun()
      vi.spyOn(fixture.provider, 'create').mockResolvedValueOnce(serverReceipt(changes))
      const quote = await fixture.run.quote([fixture.request()])
      expect(await fixture.run.execute(quote.id)).toMatchObject([
        { state: 'uncertain', failure: 'create' },
      ])
      expect(fixture.run.reservedUsd()).toBe(0.02)
      expect(fixture.node.calls).toEqual([])
    }
  })

  it('does not pair a node until its status proves the created identity is running', async () => {
    for (const changes of [
      { id: 'wrong' },
      { sizeId: 'wrong' },
      { imageId: 'wrong' },
      { state: 'stopped' as const },
    ]) {
      const fixture = provisionRun()
      vi.spyOn(fixture.provider, 'status').mockResolvedValueOnce(serverReceipt(changes))
      const quote = await fixture.run.quote([fixture.request()])
      expect(await fixture.run.execute(quote.id)).toMatchObject([
        { state: 'failed', failure: 'install' },
      ])
      expect(fixture.node.calls.filter((call) => call.operation === 'pair')).toEqual([])
      expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
    }
  })

  it('cleans up when creation, installation or pairing outlives the funded deadline', async () => {
    for (const phase of ['create', 'install', 'pair'] as const) {
      const fixture = provisionRun()
      if (phase === 'create') {
        const create = fixture.provider.create.bind(fixture.provider)
        vi.spyOn(fixture.provider, 'create').mockImplementationOnce(async (...args) => {
          const server = await create(...args)
          fixture.advance(3_600_000)
          return server
        })
      } else {
        const perform = fixture.node[phase].bind(fixture.node)
        vi.spyOn(fixture.node, phase).mockImplementationOnce(async (server) => {
          await perform(server)
          fixture.advance(3_600_000)
        })
      }
      const quote = await fixture.run.quote([fixture.request()])
      expect(await fixture.run.execute(quote.id)).toMatchObject([{ state: 'failed' }])
      expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
      if (phase === 'create')
        expect(fixture.node.calls.filter((call) => call.operation === 'install')).toEqual([])
      else if (phase === 'install')
        expect(fixture.node.calls.filter((call) => call.operation === 'pair')).toEqual([])
    }
  })

  it('refuses backward or invalid injected time before a create request', async () => {
    const fixture = provisionRun()
    fixture.cloudInit.mockImplementationOnce(() => {
      fixture.setTime(fixture.now() - 1)
      return Promise.resolve('cloud-init')
    })
    const quote = await fixture.run.quote([fixture.request()])
    await expect(fixture.run.execute(quote.id)).rejects.toThrow('invalid-provision-clock')
    expect(fixture.run.reservedUsd()).toBe(0)
  })

  it('bounds quote requests and rejects empty or malformed inputs before catalog reads', () => {
    const fixture = provisionRun()
    expect(() => fixture.run.quote([])).toThrow()
    expect(() =>
      fixture.run.quote(
        Array.from({ length: ESTIMATE_MAX_ITEMS + 1 }, (_, index) =>
          fixture.request(String(index)),
        ),
      ),
    ).toThrow()
    const request = fixture.request()
    Object.defineProperty(request, 'billedHours', { value: -1 })
    expect(() => fixture.run.quote([request])).toThrow()
    expect(fixture.provider.requests).toEqual([])
  })

  it.each([NaN, 0.5, 8_900_000_000_000_000])(
    'refuses invalid injected epoch milliseconds %s before dispatch',
    async (time) => {
      const fixture = provisionRun()
      fixture.setTime(time)
      const quote = await fixture.run.quote([fixture.request()])
      await expect(fixture.run.execute(quote.id)).rejects.toThrow('invalid-provision-clock')
      expect(fixture.run.reservedUsd()).toBe(0)
    },
  )
})
