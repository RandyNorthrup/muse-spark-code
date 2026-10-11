import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { compareUsdNanos, usdNanos, type UsdNanos } from '../../src/shared/usd'
import type {
  EstimateNodePort,
  ProviderImage,
  ProviderSize,
  ProvisionedServer,
} from '../../src/shared/estimate'
import {
  EstimateProvisioner,
  quoteProvisioning,
  type ProvisionQuote,
  type ProvisionRequest,
} from '../../src/core/estimator/provision/lifecycle'
import { provisionProvider } from './helpers/estimatorProvisionFixtures'
import { FakeEstimateProvider } from './helpers/estimator/fakes'

const CLOUD_INIT = '#cloud-config\nruncmd: [echo installed]'
const BUDGET = '1'

type ProvisionFixture = ReturnType<typeof provisionProvider>

function setup(budget: string = BUDGET) {
  const fixture = provisionProvider()
  const messages: string[] = []
  const confirm = vi.fn((message: string, _quote: ProvisionQuote): Promise<boolean> => {
    messages.push(message)
    return Promise.resolve(true)
  })
  const provisioner = new EstimateProvisioner(fixture.fake, fixture.node, confirm, budget)
  return { fixture, confirm, messages, provisioner }
}

function requestOf(
  fixture: ProvisionFixture,
  overrides: Partial<ProvisionRequest> = {},
): ProvisionRequest {
  return {
    size: fixture.fake.size,
    image: fixture.fake.image,
    cloudInit: CLOUD_INIT,
    maxBilledHours: 3,
    ...overrides,
  }
}

function freshProvisioner() {
  return setup().provisioner
}

/** A provider whose deletion never lands: every status still reports live. */
class LingeringProvider extends FakeEstimateProvider {
  override async status(id: string): Promise<ProvisionedServer> {
    const server = await super.status(id)
    return { ...server, state: 'running' }
  }
}

function isNanos(value: unknown): value is UsdNanos {
  return (
    value !== null && typeof value === 'object' && typeof (value as UsdNanos).numerator === 'bigint'
  )
}

describe('M117 provisioning lifecycle on fakes', () => {
  it('quotes exact nano-USD fractions per server with the batch total', () => {
    const size: ProviderSize = { id: 'large', classId: 'linux-x64-large', hourlyUsd: 0.07 }
    const image: ProviderImage = { id: 'container', os: 'linux', architecture: 'x64' }
    const preview = quoteProvisioning([
      { size, image, cloudInit: CLOUD_INIT, maxBilledHours: 3 },
      { size, image, cloudInit: CLOUD_INIT, maxBilledHours: 0.5 },
    ])
    expect(preview.quotes).toHaveLength(2)
    // Decimal fractions stay exact: no binary hourly arithmetic.
    expect(compareUsdNanos(preview.quotes[0]!.cost, usdNanos(0.21))).toBe(0)
    expect(compareUsdNanos(preview.quotes[1]!.cost, usdNanos(0.035))).toBe(0)
    expect(compareUsdNanos(preview.total, usdNanos(0.245))).toBe(0)
    expect(preview.totalUsd).toBe(0.245)
    for (const quote of preview.quotes) {
      expect(isNanos(quote.cost)).toBe(true)
      expect(quote.costUsd).toBeGreaterThan(0)
    }
  })

  it('shows every price and the total before any confirmation', async () => {
    const { fixture, confirm, messages, provisioner } = setup()
    const order: string[] = []
    confirm.mockImplementation((message: string) => {
      order.push(`confirm:${String(messages.length)}`)
      messages.push(message)
      return Promise.resolve(true)
    })
    const created = fixture.fake.create.bind(fixture.fake)
    fixture.fake.create = async (size, image, cloudInit) => {
      order.push('create')
      return await created(size, image, cloudInit)
    }
    const servers = await provisioner.provision([requestOf(fixture), requestOf(fixture)])
    expect(servers).toHaveLength(2)
    expect(confirm).toHaveBeenCalledTimes(2)
    // The whole total (0.12 USD) is named in the first question, before the
    // second server is confirmed or created.
    expect(messages[0]).toContain('0.12')
    expect(messages[0]).toContain('0.06')
    expect(messages[0]).toContain(BUDGET)
    expect(order).toEqual(['confirm:0', 'create', 'confirm:1', 'create'])
  })

  it('confirms each spend separately and denies without confirmation', async () => {
    const { fixture, confirm, provisioner } = setup()
    confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    await expect(provisioner.provision([requestOf(fixture), requestOf(fixture)])).rejects.toThrow(
      UI_TEXT.estimateDenied,
    )
    expect(fixture.fake.requests.filter((entry) => entry.method === 'POST')).toHaveLength(1)
    expect(fixture.node.calls.filter((call) => call.operation === 'install')).toHaveLength(1)
  })

  it('refuses a server past the cap before any request or confirmation', async () => {
    const { fixture, confirm, provisioner } = setup('0.05')
    await expect(provisioner.provision([requestOf(fixture)])).rejects.toThrow(
      UI_TEXT.estimateCapExceeded,
    )
    expect(confirm).not.toHaveBeenCalled()
    expect(fixture.fake.requests).toEqual([])
  })

  it('accumulates liability across the servers of one run', async () => {
    const { fixture, provisioner } = setup('0.1')
    await expect(provisioner.provision([requestOf(fixture), requestOf(fixture)])).rejects.toThrow(
      UI_TEXT.estimateCapExceeded,
    )
    expect(provisioner.liabilityUsd()).toBe(0.06)
    expect(fixture.fake.requests.filter((entry) => entry.method === 'POST')).toHaveLength(1)
  })

  it('retains liability on an uncertain create', async () => {
    const fixture = provisionProvider()
    fixture.fake.create = () => Promise.reject(new Error('socket reset'))
    const provisioner = new EstimateProvisioner(
      fixture.fake,
      fixture.node,
      (): Promise<boolean> => Promise.resolve(true),
      '0.06',
    )
    await expect(provisioner.provision([requestOf(fixture)])).rejects.toThrow('socket reset')
    // The failed create is never assumed free: the reservation stays, so an
    // immediate retry is refused by the cap before any new request.
    expect(provisioner.liabilityUsd()).toBe(0.06)
    await expect(provisioner.provision([requestOf(fixture)])).rejects.toThrow(
      UI_TEXT.estimateCapExceeded,
    )
  })

  it('installs before pairing through the node bindings', async () => {
    const { fixture, provisioner } = setup()
    const [server] = await provisioner.provision([requestOf(fixture)])
    expect(server?.server.state).toBe('running')
    expect(fixture.node.calls).toEqual([
      { operation: 'install', serverId: server?.server.id },
      { operation: 'pair', serverId: server?.server.id },
    ])
  })

  it('wipes before provider deletion and requires the deleted receipt', async () => {
    const { fixture, provisioner } = setup()
    const [server] = await provisioner.provision([requestOf(fixture)])
    const serverId = server?.server.id ?? ''
    const order: string[] = []
    const wipe = fixture.node.teardownAndWipe.bind(fixture.node)
    fixture.node.teardownAndWipe = async (target) => {
      order.push('wipe')
      await wipe(target)
    }
    const remove = fixture.fake.delete.bind(fixture.fake)
    fixture.fake.delete = async (id) => {
      order.push('delete')
      await remove(id)
    }
    await provisioner.decommission(serverId)
    expect(order).toEqual(['wipe', 'delete'])
    expect(provisioner.servers()).toEqual([])
    expect(provisioner.liabilityUsd()).toBe(0)
  })

  it('keeps the server and its liability when the wipe fails', async () => {
    const { fixture, provisioner } = setup()
    const [server] = await provisioner.provision([requestOf(fixture)])
    const serverId = server?.server.id ?? ''
    fixture.node.teardownAndWipe = () => Promise.reject(new Error('wipe failed'))
    await expect(provisioner.decommission(serverId)).rejects.toThrow('wipe failed')
    expect(fixture.fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false)
    expect(provisioner.servers().map((record) => record.server.id)).toEqual([serverId])
    expect(provisioner.liabilityUsd()).toBe(0.06)
  })

  it('keeps liability when the status receipt never shows deleted', async () => {
    const node: EstimateNodePort = {
      install: () => Promise.resolve(),
      pair: () => Promise.resolve(),
      teardownAndWipe: () => Promise.resolve(),
    }
    const provisioner = new EstimateProvisioner(
      new LingeringProvider(),
      node,
      (): Promise<boolean> => Promise.resolve(true),
      BUDGET,
    )
    const [server] = await provisioner.provision([
      {
        size: { id: 'small', classId: 'linux-x64-small', hourlyUsd: 0.02 },
        image: { id: 'container', os: 'linux', architecture: 'x64' },
        cloudInit: CLOUD_INIT,
        maxBilledHours: 3,
      },
    ])
    await expect(provisioner.decommission(server?.server.id ?? '')).rejects.toThrow(
      'deletion-unconfirmed',
    )
    expect(provisioner.liabilityUsd()).toBe(0.06)
  })

  it('keeps an idle server on Keep without extending its funded lifetime', async () => {
    const { fixture, provisioner } = setup()
    const [server] = await provisioner.provision([requestOf(fixture)])
    const serverId = server?.server.id ?? ''
    expect(provisioner.describeIdle(serverId, '30 minutes')).toContain(serverId)
    expect(await provisioner.settleIdle(serverId, 'keep', () => true)).toBe('kept')
    expect(fixture.fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false)
    expect(provisioner.servers()[0]?.maxBilledHours).toBe(3)
    expect(provisioner.liabilityUsd()).toBe(0.06)
  })

  it('rechecks activity after a teardown answer and keeps a live server', async () => {
    const { fixture, provisioner } = setup()
    const [server] = await provisioner.provision([requestOf(fixture)])
    const serverId = server?.server.id ?? ''
    expect(await provisioner.settleIdle(serverId, 'teardown', () => false)).toBe('kept')
    expect(fixture.fake.requests.some((entry) => entry.method === 'DELETE')).toBe(false)
    expect(await provisioner.settleIdle(serverId, 'teardown', () => true)).toBe('torn-down')
    expect(provisioner.servers()).toEqual([])
  })

  it('refuses unknown servers without touching the provider', async () => {
    const { fixture, provisioner } = setup()
    await expect(provisioner.settleIdle('server-9', 'teardown', () => true)).rejects.toThrow(
      'unknown-server',
    )
    await expect(provisioner.decommission('server-9')).rejects.toThrow('unknown-server')
    expect(() => provisioner.describeIdle('server-9', '30 minutes')).toThrow('unknown-server')
    expect(fixture.fake.requests).toEqual([])
  })

  it('requires an explicit non-negative run budget', () => {
    const fixture = provisionProvider()
    for (const budget of ['', '-1', 'not-a-budget']) {
      expect(
        () =>
          new EstimateProvisioner(
            fixture.fake,
            fixture.node,
            (): Promise<boolean> => Promise.resolve(true),
            budget,
          ),
      ).toThrow(UI_TEXT.estimateBudgetRequired)
    }
    expect(freshProvisioner().liabilityUsd()).toBe(0)
  })

  it('refuses empty batches and invalid hours before any confirmation', () => {
    const { fixture, confirm, provisioner } = setup()
    // Batch validation throws synchronously, like the wave starter: no
    // confirmation and no provider request can follow.
    expect(() => provisioner.provision([])).toThrow()
    for (const maxBilledHours of [0, -3, NaN, Infinity]) {
      expect(() => provisioner.provision([requestOf(fixture, { maxBilledHours })])).toThrow()
    }
    expect(confirm).not.toHaveBeenCalled()
    expect(fixture.fake.requests).toEqual([])
  })

  it('provisions through the allow-listed broker without payment fields', async () => {
    const fixture = provisionProvider()
    const bodies: unknown[] = []
    const inner = fixture.broker.request.getMockImplementation()
    fixture.broker.request.mockImplementation(async (input) => {
      const receipt = (await inner!(input)) as { url: string; status: number }
      bodies.push(input.body)
      const path = new URL(input.url).pathname
      if (path === '/servers' && input.method === 'POST')
        return {
          ...receipt,
          status: 201,
          body: { id: 'server-7', sizeId: 'small', imageId: 'container', state: 'running' },
        }
      if (input.method === 'DELETE') return { ...receipt, body: { accepted: true } }
      if (path !== '/sizes' && path !== '/images' && input.method === 'GET')
        return {
          ...receipt,
          body: { id: 'server-7', sizeId: 'small', imageId: 'container', state: 'deleted' },
        }
      return receipt
    })
    const provisioner = new EstimateProvisioner(
      fixture.provider,
      fixture.node,
      (): Promise<boolean> => Promise.resolve(true),
      BUDGET,
    )
    const [server] = await provisioner.provision([requestOf(fixture)])
    expect(server?.server.id).toBe('server-7')
    expect(fixture.node.calls).toEqual([
      { operation: 'install', serverId: 'server-7' },
      { operation: 'pair', serverId: 'server-7' },
    ])
    await provisioner.decommission('server-7')
    expect(provisioner.liabilityUsd()).toBe(0)
    expect(JSON.stringify(bodies)).not.toContain('payment')
  })
})
