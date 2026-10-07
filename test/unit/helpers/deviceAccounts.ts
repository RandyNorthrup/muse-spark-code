import { vi } from 'vitest'
import {
  AccountPlacements,
  RemoteAccountPool,
  type AccountPlacement,
  type AccountPlacementStore,
  type AccountRouteRequest,
  type DeviceAccountClaim,
  type RemoteAccountPoolDeps,
} from '../../../src/core/team/remotePool'
import {
  DeviceAccountReceiver,
  type DeviceAccountReceiverDeps,
} from '../../../src/host/devices/deviceReceiver'
import { poolRig, poolRequest } from './accounts/pool'

export function deviceClaim() {
  return {
    check: vi.fn(() => undefined),
    finish: vi.fn<DeviceAccountClaim['finish']>(() => Promise.resolve()),
  }
}

export function placementRig() {
  const state = {
    rows: ['a', 'b', 'c'].map((account, index): AccountPlacement => ({
      provider: 'anthropic',
      account,
      device: `device-${String(index)}`,
    })),
    isRuleOn: true,
    unknown: new Set<string>(),
  }
  const store: AccountPlacementStore = {
    read: vi.fn(() => Promise.resolve(structuredClone(state.rows))),
    write: vi.fn<AccountPlacementStore['write']>((rows, check) => {
      check()
      state.rows = structuredClone([...rows])
      return Promise.resolve()
    }),
  }
  const deps = {
    store,
    isKnown: (row: AccountPlacement) =>
      !state.unknown.has(row.account) && !state.unknown.has(row.device),
    onePerDevicePerProvider: () => state.isRuleOn,
  }
  return { state, store, deps, placements: new AccountPlacements(deps) }
}

export function routeRequest(patch: Partial<AccountRouteRequest> = {}): AccountRouteRequest {
  return {
    provider: 'anthropic',
    account: 'a',
    owner: 'main',
    kind: 'conversation',
    modelId: 'fake-model',
    budgetOwner: 'parent',
    ...patch,
  }
}

export function remoteDeviceRig() {
  const placement = placementRig()
  const accounts = poolRig()
  const state = {
    offers: [
      { device: 'device-0', headroom: { anthropic: 'some' } },
      { device: 'device-1', headroom: { anthropic: 'ample' } },
      { device: 'device-2', headroom: { anthropic: 'some' } },
    ],
    isAllowed: true,
  }
  const claims: ReturnType<typeof deviceClaim>[] = []
  const deps: { -readonly [K in keyof RemoteAccountPoolDeps]: RemoteAccountPoolDeps[K] } = {
    placements: placement.placements,
    accounts: () => accounts.rows,
    offers: () => state.offers,
    canRoute: vi.fn(() => state.isAllowed),
    admit: vi.fn(() => {
      const claim = deviceClaim()
      claims.push(claim)
      return Promise.resolve(claim)
    }),
  }
  const pool = new RemoteAccountPool(deps)
  const dispatch = vi.fn(async (route: Parameters<Parameters<RemoteAccountPool['run']>[1]>[0]) => {
    route.beforeSend()
    await Promise.resolve()
    return route.device
  })
  const run = (patch: Partial<AccountRouteRequest> = {}) => pool.run(routeRequest(patch), dispatch)
  return {
    ...placement,
    accounts,
    state: { placement: placement.state, remote: state },
    deps,
    claims,
    pool,
    dispatch,
    run,
  }
}

export function receiverRig(provider = 'meta', product = 'model-api') {
  const accounts = poolRig(provider, product)
  const here = new Set(['a', 'b'])
  const headroom = new Map([
    ['a', 'some'],
    ['b', 'ample'],
    ['c', 'none'],
  ])
  const claim = deviceClaim()
  const mode = { isInteractive: true }
  const placement = { generation: 0 }
  const deps: { -readonly [K in keyof DeviceAccountReceiverDeps]: DeviceAccountReceiverDeps[K] } = {
    providers: () => [provider],
    pool: (id) => (id === provider ? accounts.deps : undefined),
    isPinnedHere: (_provider, account) => here.has(account),
    placementFence: () => {
      const generation = placement.generation
      return Promise.resolve(() => {
        if (generation !== placement.generation) throw new Error('Placement changed')
      })
    },
    headroom: (_provider, account) => headroom.get(account),
    admit: vi.fn(() => Promise.resolve(claim)),
    request: (fragment) =>
      poolRequest({ modelId: fragment.modelId, isInteractive: mode.isInteractive }),
  }
  const receiver = new DeviceAccountReceiver(deps)
  const run = (trigger?: AccountRouteRequest['trigger']) =>
    receiver.receive(
      { provider, modelId: 'fake-model', ...(trigger !== undefined && { trigger }) },
      accounts.dispatch,
    )
  return {
    ...accounts,
    here,
    headroom,
    claim,
    mode,
    placement,
    receiverDeps: deps,
    receiver,
    receive: run,
  }
}
