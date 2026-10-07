import { vi } from 'vitest'
import {
  VaultFleet,
  type VaultFleetPorts,
  type VaultWorkerLaunch,
  type VaultWorkerRoute,
  type VaultDelegationCard,
} from '../../../src/core/vault/fleet'
import { type VaultRequester, type VaultUse } from '../../../src/shared/vault'
import { type VaultAuthorizationResult } from '../../../src/shared/vaultProtocol'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { FakeVaultClock } from '../helpers/vault/core'
import { approval, requester, ticket, use } from '../helpers/vault/fixtures'

export function fleetProposal() {
  return { handle: 'secret://test-secret', use: use(), taint: { tainted: false, reasons: [] } }
}
export function holdFleetPipe(route: VaultWorkerRoute, expected = 1) {
  const entered = Promise.withResolvers<undefined>(),
    go = Promise.withResolvers<undefined>()
  const checks: (() => boolean)[] = []
  route.handoff = vi.fn<typeof route.handoff>(async (_ticket, _use, canWrite) => {
    checks.push(canWrite)
    if (checks.length === expected) entered.resolve(undefined)
    await go.promise
  })
  return {
    entered: entered.promise,
    checks,
    release: () => {
      go.resolve(undefined)
    },
  }
}

export function fleetFixture() {
  const clock = new FakeVaultClock()
  const invalidations = new Set<(id: string | null) => void>()
  const routes: VaultWorkerRoute[] = []
  const cards: VaultDelegationCard[] = []
  const registrations: { requester: VaultRequester; ceiling: unknown }[] = []
  const ended: string[] = []
  const who = requester()
  const authorize = (worker: VaultRequester, use: VaultUse): VaultAuthorizationResult => ({
    kind: 'ticket',
    authority: { kind: 'user' },
    ticket: {
      ...ticket(),
      requesterId: worker.id,
      digest: vaultUseDigest(use),
      issuedAt: clock.now(),
      expiresAt: clock.now() + 120_000,
    },
  })
  const ports: VaultFleetPorts = {
    peer: { hostId: who.hostId, processId: 100, userId: 'test-user', ui: true },
    broker: {
      clock,
      register: vi.fn<VaultFleetPorts['broker']['register']>((_peer, worker, ceiling) => {
        registrations.push({
          requester: structuredClone(worker),
          ceiling: structuredClone(ceiling),
        })
        return Promise.resolve()
      }),
      request: vi.fn<VaultFleetPorts['broker']['request']>((worker, handle, use, taint) =>
        Promise.resolve({
          kind: 'approval',
          request: {
            ...approval(),
            requester: structuredClone(worker),
            use: structuredClone(use),
            item: { ...approval().item, name: handle.slice('secret://'.length), handle },
            digest: vaultUseDigest(use),
            taint: structuredClone(taint),
          },
        }),
      ),
      endRequester: vi.fn<VaultFleetPorts['broker']['endRequester']>((id) => {
        ended.push(id)
        return Promise.resolve()
      }),
      subscribeInvalidation: (listener) => {
        invalidations.add(listener)
        return () => {
          invalidations.delete(listener)
        }
      },
    },
    routes: {
      open: vi.fn<VaultFleetPorts['routes']['open']>((worker) => {
        const route: VaultWorkerRoute = {
          socket: `/run/vault/${worker.id}.sock`,
          handoff: vi.fn<VaultWorkerRoute['handoff']>((_ticket, _use, canSend) => {
            if (!canSend()) throw new Error('private pipe refused')
            return Promise.resolve()
          }),
          close: vi.fn(),
        }
        routes.push(route)
        return Promise.resolve(route)
      }),
    },
    delegation: {
      requestOutside: vi.fn<VaultFleetPorts['delegation']['requestOutside']>((worker, proposal) =>
        ports.broker.request(worker, proposal.handle, proposal.use, proposal.taint),
      ),
      approve: vi.fn<VaultFleetPorts['delegation']['approve']>((card) => {
        cards.push(structuredClone(card))
        return Promise.resolve({ id: card.id, digest: card.digest, decision: 'allowOnce' })
      }),
      request: vi.fn<VaultFleetPorts['delegation']['request']>(
        (worker, proposal, _card, canAdmit) =>
          Promise.resolve(
            canAdmit() ? authorize(worker, proposal.use) : { kind: 'denied', reason: 'scope' },
          ),
      ),
    },
    taint: vi.fn(() => ({ tainted: false, reasons: [] })),
  }
  const fleet = new VaultFleet(ports)
  const launch = (source: VaultRequester['source'] = 'team'): VaultWorkerLaunch => {
    const { id: _id, unattended: _unattended, ...facts } = requester()
    return {
      requester: { ...facts, source, role: { kind: 'role', name: 'engineer' }, taskId: 'task' },
      trigger: 'interactive',
    }
  }
  return {
    fleet,
    ports,
    clock,
    routes,
    cards,
    registrations,
    ended,
    launch,
    authorize,
    invalidate: (id: string | null) => {
      for (const listener of invalidations) listener(id)
    },
  }
}
