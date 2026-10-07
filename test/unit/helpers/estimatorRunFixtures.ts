import { vi, expect } from 'vitest'
import {
  EstimateProvisionRun,
  type EstimateServerRequest,
  type EstimateProvisionBindings,
} from '../../../src/core/estimator/provision/run'
import { EstimateServerLifecycle } from '../../../src/core/estimator/provision/lifecycle'
import { FakeEstimateProvider, FakeEstimateNode, ESTIMATOR_AS_OF } from './estimator/fakes'
import {
  type ProviderSize,
  type ProviderImage,
  type ProvisionedServer,
} from '../../../src/shared/estimate'
import { pending } from './estimatorProvisionFixtures'

export function provisionRun(budgetUsd: number | undefined = 1) {
  const provider = new FakeEstimateProvider()
  const node = new FakeEstimateNode()
  let now = Date.parse(ESTIMATOR_AS_OF)
  const notice = vi.fn((): Promise<'keep' | 'teardown'> => Promise.resolve('teardown'))
  const lifecycle = new EstimateServerLifecycle({ node, now: () => now, notice })
  const cloudInit = vi.fn((_size: ProviderSize, _image: ProviderImage, expiresAt: string) =>
    Promise.resolve(`#cloud-config\n# funded expiry ${expiresAt}`),
  )
  const showPrices = vi.fn(() => Promise.resolve())
  const confirmServer = vi.fn(() => Promise.resolve(true))
  const bindings: EstimateProvisionBindings = {
    providers: [provider],
    nodes: { node, lifecycle, cloudInit },
    now: () => now,
    showPrices,
    confirmServer,
  }
  const run = new EstimateProvisionRun(bindings, budgetUsd)
  const request = (id = 'first', billedHours = 1): EstimateServerRequest => ({
    id,
    providerId: provider.id,
    sizeId: provider.size.id,
    imageId: provider.image.id,
    billedHours,
  })
  return {
    provider,
    node,
    lifecycle,
    notice,
    cloudInit,
    showPrices,
    confirmServer,
    bindings,
    run,
    request,
    advance: (milliseconds: number) => {
      now += milliseconds
    },
    setTime: (timestamp: number) => {
      now = timestamp
    },
    now: () => now,
  }
}

export async function runningServer() {
  const fixture = provisionRun()
  const quote = await fixture.run.quote([fixture.request()])
  const outcomes = await fixture.run.execute(quote.id)
  const server = outcomes[0]?.server
  if (!server) throw new Error('Fixture did not create a server')
  return { ...fixture, server }
}

export function serverReceipt(changes: Partial<ProvisionedServer> = {}): ProvisionedServer {
  return { id: 'server-1', sizeId: 'small', imageId: 'container', state: 'running', ...changes }
}

export async function openIdleNotice() {
  const fixture = await runningServer()
  const answer = pending<'keep' | 'teardown'>()
  fixture.notice.mockImplementationOnce(() => answer.promise)
  fixture.advance(1_800_000)
  const sweep = fixture.lifecycle.sweep()
  await vi.waitFor(() => {
    expect(fixture.notice).toHaveBeenCalledTimes(1)
  })
  return { ...fixture, answer, sweep }
}

export async function idleSweep(fixture: Awaited<ReturnType<typeof runningServer>>): Promise<void> {
  fixture.advance(1_800_000)
  await fixture.lifecycle.sweep()
}

export function oneTeardown(fixture: Awaited<ReturnType<typeof runningServer>>): void {
  expect(fixture.node.calls.filter((call) => call.operation === 'teardownAndWipe')).toHaveLength(1)
  expect(fixture.provider.requests.filter((request) => request.method === 'DELETE')).toHaveLength(1)
}

export async function unconfirmedDeletion() {
  const fixture = await runningServer()
  vi.spyOn(fixture.provider, 'delete').mockResolvedValueOnce()
  return fixture
}

export async function reconcileDeletion(
  fixture: Awaited<ReturnType<typeof runningServer>>,
): Promise<void> {
  await fixture.lifecycle.sweep()
  expect(fixture.lifecycle.snapshots()).toMatchObject([{ state: 'deleted' }])
}
