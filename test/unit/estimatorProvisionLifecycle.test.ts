// M117 server-lease lifecycle without a provider: track, activity and
// snapshots run against the real clock, and sweeps that need no port make
// no port calls — the bindings below fail loudly on contact. Notice,
// wipe and provider deletion need a live provider and stay unrun until the
// M109 broker and M110d/M110f bindings land; see
// docs/certification/m117-p-spin-it-up.md. Repository default timeout.
import { describe, expect, it } from 'vitest'
import {
  EstimateServerLifecycle,
  type EstimateLifecycleBindings,
} from '../../src/core/estimator/provision/lifecycle'
import type {
  EstimateNodePort,
  EstimateProviderPort,
  ProvisionedServer,
} from '../../src/shared/estimate'
import { tripwireNode, tripwireProvider, unreachablePort } from './helpers/provisionTripwires'

const PROVIDER_ID = 'tripwire'
const SERVER: ProvisionedServer = {
  id: 'server-1',
  sizeId: 'large',
  imageId: 'container',
  state: 'running',
}

function ports(): { provider: EstimateProviderPort; node: EstimateNodePort } {
  return { provider: tripwireProvider(), node: tripwireNode() }
}

function lifecycle(): {
  cycle: EstimateServerLifecycle
  provider: EstimateProviderPort
  node: EstimateNodePort
} {
  const { provider, node } = ports()
  const bindings: EstimateLifecycleBindings = {
    node,
    now: () => Date.now(),
    notice: () => {
      throw unreachablePort('notice')
    },
  }
  return { cycle: new EstimateServerLifecycle(bindings), provider, node }
}

const future = (): string => new Date(Date.now() + 3_600_000).toISOString()
const past = (): string => new Date(Date.now() - 1000).toISOString()

describe('M117 server-lease lifecycle without a provider', () => {
  it('tracks a running server and snapshots copies, not aliases', () => {
    const { cycle, provider } = lifecycle()
    cycle.track(provider, SERVER, future())
    const snapshots = cycle.snapshots()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      providerId: PROVIDER_ID,
      server: { ...SERVER },
      state: 'active',
      busy: true,
    })
    snapshots[0]!.server.id = 'mutated'
    expect(cycle.snapshots()[0]!.server.id).toBe(SERVER.id)
  })

  it('refuses unknown servers, duplicates and malformed input', () => {
    const { cycle, provider } = lifecycle()
    expect(() => {
      cycle.activity(PROVIDER_ID, 'missing', true)
    }).toThrow('inactive-server')
    expect(() => {
      cycle.track(provider, { ...SERVER, state: 'deleted' }, future())
    }).toThrow()
    expect(() => {
      cycle.track(provider, SERVER, 'not-an-instant')
    }).toThrow()
    cycle.track(provider, SERVER, future())
    expect(() => {
      cycle.track(provider, SERVER, future())
    }).toThrow('duplicate-server')
  })

  it('records activity and retires unknown servers without port contact', async () => {
    const { cycle, provider } = lifecycle()
    cycle.track(provider, SERVER, future())
    cycle.activity(PROVIDER_ID, SERVER.id, false)
    expect(cycle.snapshots()[0]).toMatchObject({ state: 'active', busy: false })
    await expect(cycle.retire(PROVIDER_ID, 'missing')).rejects.toThrow('unknown-server')
  })

  it('leaves busy and fresh leases alone on a sweep', async () => {
    const { cycle, provider } = lifecycle()
    cycle.track(provider, SERVER, future())
    await cycle.sweep()
    expect(cycle.snapshots()[0]).toMatchObject({ state: 'active' })
    cycle.activity(PROVIDER_ID, SERVER.id, true)
    await cycle.sweep()
    expect(cycle.snapshots()[0]).toMatchObject({ state: 'active', busy: true })
  })

  it('classifies an unreachable wipe as a wipe failure on expiry', async () => {
    const { cycle, provider } = lifecycle()
    cycle.track(provider, SERVER, past())
    await cycle.sweep()
    // The sweep destroys past-funded leases without asking; the tripwire
    // node fails the wipe, and the failure stays visible as a wipe failure.
    expect(cycle.snapshots()[0]).toMatchObject({ state: 'failed', failure: 'wipe' })
  })
})
