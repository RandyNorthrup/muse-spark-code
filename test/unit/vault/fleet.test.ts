import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VaultFleet,
  vaultRoleCeiling,
  vaultRoleSecretsSchema,
  type VaultWorkerRoute,
} from '../../../src/core/vault/fleet'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { type VaultRequester } from '../../../src/shared/vault'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { fleetFixture, fleetProposal, holdFleetPipe } from './fleetFixture'
import { brokerFixture } from './brokerFixture'
import { use } from '../helpers/vault/fixtures'

const fixtures: ReturnType<typeof fleetFixture>[] = []
function setup() {
  const fixture = fleetFixture()
  fixtures.push(fixture)
  return fixture
}
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.fleet.dispose()
})
describe('M109 R fleet identity and role ceilings', () => {
  it.each(['ended', 'registrationFailure'] as const)(
    'W-R1 %s frees a successfully closed socket reservation',
    async (boundary) => {
      const f = setup()
      const route = { socket: String.raw`\\.\pipe\reused`, handoff: vi.fn(), close: vi.fn() }
      f.ports.routes.open = vi.fn(() => Promise.resolve(route))
      if (boundary === 'ended') await f.fleet.end(await f.fleet.open(f.launch()))
      else {
        vi.mocked(f.ports.broker.register).mockRejectedValueOnce(new Error('registration refused'))
        await expect(f.fleet.open(f.launch())).rejects.toThrow()
      }
      await expect(f.fleet.open(f.launch())).resolves.toMatchObject({ socket: route.socket })
    },
  )
  it('W-R2 external parent invalidation ends descendant broker authority and retains failed-close ownership', async () => {
    const f = setup()
    const parent = await f.fleet.open(f.launch())
    const child = await f.fleet.open(f.launch('subagent'), parent)
    const route = f.routes[1]
    if (!route) throw new Error('missing child route')
    const close = vi.fn().mockImplementationOnce(() => {
      throw new Error('close refused')
    })
    route.close = close
    try {
      f.invalidate(parent.requester.id)
    } catch {
      /* Cleanup failure is surfaced but authority must still end. */
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(f.ended).toContain(child.requester.id)
    await expect(f.fleet.request(child, fleetProposal())).rejects.toThrow()
    await f.fleet.dispose()
    expect(close).toHaveBeenCalledTimes(2)
  })
  it('W-R3 successful handoff returns only a value-free sent receipt', async () => {
    const f = setup()
    const worker = await f.fleet.open(f.launch())
    f.ports.broker.request = vi.fn<typeof f.ports.broker.request>((who, _handle, actual) =>
      Promise.resolve(f.authorize(who, actual)),
    )
    const result = await f.fleet.request(worker, fleetProposal())
    expect(result).toEqual({ kind: 'sent' })
    expect(f.routes[0]?.handoff).toHaveBeenCalledOnce()
    expect(JSON.stringify(result)).not.toContain('nonce')
  })

  it.each(['digest', 'expiry'] as const)(
    'V11 V13: changed ticket %s never reaches inherited pipe',
    async (change) => {
      const f = setup(),
        worker = await f.fleet.open(f.launch())
      f.ports.broker.request = vi.fn<typeof f.ports.broker.request>((who, _handle, actual) => {
        const result = f.authorize(who, actual)
        if (result.kind === 'ticket') {
          if (change === 'digest') result.ticket.digest = 'f'.repeat(64)
          else f.clock.advance(120_000)
        }
        return Promise.resolve(result)
      })
      expect(await f.fleet.request(worker, fleetProposal())).toEqual({
        kind: 'denied',
        reason: 'digest',
      })
      expect(f.routes[0]?.handoff).not.toHaveBeenCalled()
    },
  )
  it('V13: another requester approval cannot be presented as this worker use', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch()),
      request = f.ports.broker.request
    f.ports.broker.request = vi.fn<typeof f.ports.broker.request>(async (...args) => {
      const result = await request(...args)
      if (result.kind === 'approval') result.request.requester.id = 'f'.repeat(32)
      return result
    })
    expect(await f.fleet.request(worker, fleetProposal())).toEqual({
      kind: 'denied',
      reason: 'digest',
    })
  })
  it('V12: every automatic trigger uses real broker unattended policy, never ordinary grants', async () => {
    const f = setup(),
      real = await brokerFixture()
    await f.fleet.dispose()
    f.ports.broker = real.broker
    f.fleet = new VaultFleet(f.ports)
    try {
      const grant = real.standing()
      grant.roles = [{ kind: 'role', name: 'engineer' }]
      await real.change({
        policy: { mode: 'alwaysAllow', unattendedAllowed: true, allowDisclosure: false },
      })
      for (const trigger of [
        'schedule',
        'timedSend',
        'goal',
        'scheduler',
        'relocation',
        'headless',
      ] as const) {
        const worker = await f.fleet.open({ ...f.launch(), trigger })
        const proposal = fleetProposal()
        expect(await f.fleet.request(worker, proposal)).toEqual({
          kind: 'denied',
          reason: 'unattended',
        })
        grant.unattendedAllowed = true
        expect(await f.fleet.request(worker, proposal)).toMatchObject({ kind: 'sent' })
        grant.uses = 0
        grant.unattendedAllowed = false
        f.ports.taint = () => ({ tainted: true, reasons: [{ source: 'web', label: 'page' }] })
        expect(await f.fleet.request(worker, proposal)).toEqual({
          kind: 'denied',
          reason: 'tainted',
        })
        f.ports.taint = () => ({ tainted: false, reasons: [] })
        await f.fleet.end(worker)
      }
      await real.change({
        requirePresence: true,
        policy: { mode: 'alwaysAllow', unattendedAllowed: false, allowDisclosure: false },
      })
      const worker = await f.fleet.open({ ...f.launch(), trigger: 'scheduler' })
      expect(await f.fleet.request(worker, fleetProposal())).toEqual({
        kind: 'denied',
        reason: 'presence',
      })
    } finally {
      await f.fleet.dispose()
      await real.broker.dispose()
    }
  })
  it('V1: research, design and marketing default to none; charters validate unique handles', () => {
    for (const name of ['research', 'design', 'marketing'])
      expect(vaultRoleCeiling({ kind: 'role', name })).toBe('none')
    expect(vaultRoleCeiling({ kind: 'orchestrator' })).toBe('ask')
    expect(vaultRoleCeiling({ kind: 'role', name: 'engineer' }, ['secret://test-secret'])).toEqual([
      'secret://test-secret',
    ])
    for (const value of [
      true,
      'always',
      ['secret://test-secret', 'secret://test-secret'],
      ['raw-value'],
      { secrets: 'ask' },
    ])
      expect(vaultRoleSecretsSchema.safeParse(value).success).toBe(false)
  })
  it('V13: every worker kind receives a distinct requester/socket and host-derived facts', async () => {
    const f = setup()
    const sources: VaultRequester['source'][] = [
      'conversation',
      'subagent',
      'candidate',
      'team',
      'hook',
      'mcp',
      'headless',
      'schedule',
      'timedSend',
      'goal',
      'relocated',
      'device',
    ]
    const workers = []
    for (const source of sources) workers.push(await f.fleet.open(f.launch(source)))
    expect(new Set(workers.map((worker) => worker.socket)).size).toBe(sources.length)
    expect(new Set(workers.map((worker) => worker.requester.id)).size).toBe(sources.length)
    expect(f.registrations.map((entry) => entry.requester.source)).toEqual(sources)
    for (const worker of workers) expect(worker.requester.hostId).toBe(f.ports.peer.hostId)
    const forged = f.launch()
    forged.requester.hostId = 'f'.repeat(32)
    await expect(f.fleet.open(forged)).rejects.toThrow()
  })
  it('V12: unattended marking cannot be cleared by scheduled/team/relocated launch facts', async () => {
    const f = setup()
    for (const trigger of [
      'schedule',
      'timedSend',
      'goal',
      'scheduler',
      'relocation',
      'headless',
      'userUnattended',
    ] as const) {
      const worker = await f.fleet.open({ ...f.launch(), trigger })
      expect(worker.requester.unattended).toBe(true)
    }
    const parent = await f.fleet.open({ ...f.launch(), trigger: 'scheduler' })
    const child = await f.fleet.open(f.launch('subagent'), parent)
    expect(child.requester.unattended).toBe(true)
    const headless = await f.fleet.open({
      ...f.launch(),
      requester: { ...f.launch().requester, role: { kind: 'headless' } },
    })
    expect(headless.requester.unattended).toBe(true)
  })
  it('V13 V16: disposed or saturated owners refuse new routes; invalid socket metadata cannot reach environment', async () => {
    const f = setup()
    f.ports.routes.open = vi.fn(() =>
      Promise.resolve({ socket: '/run/worker\n', handoff: vi.fn(), close: vi.fn() }),
    )
    await expect(f.fleet.open(f.launch())).rejects.toThrow()
    expect(f.ports.broker.register).not.toHaveBeenCalled()
    f.ports.routes.open = vi.fn(() =>
      Promise.resolve({ socket: '/run/healthy.sock', handoff: vi.fn(), close: vi.fn() }),
    )
    Object.defineProperty(f.fleet, 'sockets', {
      value: new Set(Array.from({ length: VAULT_LIMITS.items }, (_, index) => String(index))),
    })
    await expect(f.fleet.open(f.launch())).rejects.toThrow()
    expect(f.ports.routes.open).not.toHaveBeenCalled()
    await f.fleet.dispose()
    Object.defineProperty(f.fleet, 'sockets', { value: new Set<string>() })
    await expect(f.fleet.open(f.launch())).rejects.toThrow()
  })
  it('V13: a revoked worker cannot deliver a ticket after delayed pipe readiness', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch()),
      route = f.routes[0]
    if (!route) throw new Error('missing route')
    f.ports.broker.request = vi.fn<typeof f.ports.broker.request>((who, _handle, actual) =>
      Promise.resolve(f.authorize(who, actual)),
    )
    const pipe = holdFleetPipe(route)
    const pending = f.fleet.request(worker, fleetProposal())
    await pipe.entered
    f.invalidate(worker.requester.id)
    expect(pipe.checks[0]?.()).toBe(false)
    pipe.release()
    expect(await pending).toEqual({ kind: 'denied', reason: 'peer' })
  })
  it('V1: descendants inherit a ceiling intersection and cannot switch workspace/session', async () => {
    const f = setup()
    const parent = await f.fleet.open({ ...f.launch(), secrets: ['secret://test-secret'] })
    await f.fleet.open(
      { ...f.launch(), secrets: ['secret://test-secret', 'secret://other'] },
      parent,
    )
    expect(f.registrations[1]?.ceiling).toEqual(['secret://test-secret'])
    const child = await f.fleet.open({ ...f.launch(), secrets: 'none' }, parent)
    expect(await f.fleet.request(child, fleetProposal())).toMatchObject({ kind: 'denied' })
    const changed = f.launch()
    changed.requester.workspaceId = 'another'
    await expect(f.fleet.open(changed, parent)).rejects.toThrow()
    expect(f.ports.broker.request).not.toHaveBeenCalled()
  })
  it('V13: duplicate Windows pipe paths are refused after separator/case normalization', async () => {
    const f = setup()
    const close = vi.fn()
    f.ports.routes.open = vi.fn<typeof f.ports.routes.open>(() =>
      Promise.resolve({ socket: String.raw`\\.\pipe\worker`, handoff: vi.fn(), close }),
    )
    await f.fleet.open(f.launch())
    f.ports.routes.open = vi.fn<typeof f.ports.routes.open>(() =>
      Promise.resolve({ socket: '//./PIPE/WORKER', handoff: vi.fn(), close }),
    )
    await expect(f.fleet.open(f.launch())).rejects.toThrow()
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('V13 V16: lock during socket acquisition disposes late route and never registers it', async () => {
    const f = setup()
    const waiting = Promise.withResolvers<VaultWorkerRoute>()
    f.ports.routes.open = vi.fn<typeof f.ports.routes.open>(() => waiting.promise)
    const pending = f.fleet.open(f.launch())
    const rejected = expect(pending).rejects.toThrow()
    f.invalidate(null)
    const route = { socket: '/run/late.sock', handoff: vi.fn(), close: vi.fn() }
    waiting.resolve(route)
    await rejected
    expect(route.close).toHaveBeenCalledOnce()
    expect(f.ports.broker.register).not.toHaveBeenCalled()
  })
  it('V13: caller mutation and forged access cannot change registered requester or ceiling', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    worker.requester.role = { kind: 'orchestrator' }
    worker.requester.unattended = true
    await f.fleet.request(worker, fleetProposal())
    expect(vi.mocked(f.ports.broker.request).mock.calls[0]?.[0].role).toEqual({
      kind: 'role',
      name: 'engineer',
    })
    await expect(f.fleet.request({ ...worker }, fleetProposal())).rejects.toThrow()
    expect(f.ports.broker.request).toHaveBeenCalledOnce()
  })
  it('V1: host taint cannot be cleared by clean model proposal', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    f.ports.taint = () => ({ tainted: true, reasons: [{ source: 'web', label: 'page' }] })
    await f.fleet.request(worker, fleetProposal())
    expect(vi.mocked(f.ports.broker.request).mock.calls[0]?.[3].tainted).toBe(true)
  })
  it('V13: tickets bind requester and exact use and travel solely through private pipe', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    const actual = use(),
      proposal = {
        handle: 'secret://test-secret',
        use: actual,
        taint: { tainted: false, reasons: [] },
      }
    f.ports.broker.request = vi.fn<typeof f.ports.broker.request>((who, _handle, use) =>
      Promise.resolve(f.authorize(who, use)),
    )
    await f.fleet.request(worker, proposal)
    expect(f.routes[0]?.handoff).toHaveBeenCalledOnce()
    f.ports.broker.request = vi.fn<typeof f.ports.broker.request>((who, _handle, use) => {
      const result = f.authorize(who, use)
      if (result.kind === 'ticket') result.ticket.requesterId = 'f'.repeat(32)
      return Promise.resolve(result)
    })
    expect(await f.fleet.request(worker, proposal)).toEqual({ kind: 'denied', reason: 'digest' })
    expect(f.routes[0]?.handoff).toHaveBeenCalledOnce()
    expect(Object.keys(worker).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'requester',
      'socket',
    ])
    expect(vaultCommandDigest(actual.command)).toHaveLength(64)
  })
  it('V16: parent retirement closes descendants, cleanup failures do not leave other routes live', async () => {
    const f = setup(),
      parent = await f.fleet.open(f.launch())
    const child = await f.fleet.open(f.launch('subagent'), parent)
    const independent = await f.fleet.open(f.launch())
    const first = f.routes[0]
    if (!first) throw new Error('missing route')
    first.close = vi.fn().mockImplementationOnce(() => {
      throw new Error('close failed')
    })
    await expect(f.fleet.end(parent)).rejects.toThrow()
    await expect(f.fleet.request(child, {})).rejects.toThrow()
    expect(f.routes[1]?.close).toHaveBeenCalledOnce()
    expect(f.routes[2]?.close).not.toHaveBeenCalled()
    f.invalidate(independent.requester.id)
    expect(f.routes[2]?.close).toHaveBeenCalledOnce()
  })
})
