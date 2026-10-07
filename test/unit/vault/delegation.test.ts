import { afterEach, describe, expect, it, vi } from 'vitest'
import { vaultDelegationCardSchema, type VaultDelegationCard } from '../../../src/core/vault/fleet'
import { vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { type VaultAuthorizationResult } from '../../../src/shared/vaultProtocol'
import { fleetFixture, fleetProposal as proposal, holdFleetPipe } from './fleetFixture'
import { use } from '../helpers/vault/fixtures'

const fixtures: ReturnType<typeof fleetFixture>[] = []
function setup() {
  const fixture = fleetFixture()
  fixtures.push(fixture)
  return fixture
}
afterEach(async () => {
  vi.useRealTimers()
  for (const fixture of fixtures.splice(0)) await fixture.fleet.dispose()
})
const scopes = (maxUses = 2) => [
  {
    handle: 'secret://test-secret',
    maxUses,
    target: {
      kind: 'environment',
      commandDigest: vaultCommandDigest(use().command),
      names: use().names,
    },
  },
]
async function delegated() {
  const f = setup(),
    worker = await f.fleet.open(f.launch())
  await f.fleet.delegate(worker, scopes())
  return { f, worker }
}
describe('M109 R task-bound delegation', () => {
  it('V11: lowering count after two admissions retains only the covered reservation ordinal', async () => {
    const { f, worker } = await delegated()
    const route = f.routes[0]
    if (!route) throw new Error('missing route')
    const pipe = holdFleetPipe(route, 2)
    const pending = [f.fleet.request(worker, proposal()), f.fleet.request(worker, proposal())]
    await pipe.entered
    f.fleet.narrowDelegation(worker, scopes(1))
    expect(pipe.checks.map((canWrite) => canWrite())).toEqual([true, false])
    pipe.release()
    const results = await Promise.all(pending)
    expect(results.filter((result) => result.kind === 'ticket')).toHaveLength(1)
  })
  it('V1 V11: narrowing after admission prevents delayed private release', async () => {
    const { f, worker } = await delegated()
    const route = f.routes[0]
    if (!route) throw new Error('missing route')
    const pipe = holdFleetPipe(route)
    const pending = f.fleet.request(worker, proposal())
    await pipe.entered
    f.fleet.narrowDelegation(worker, [])
    expect(pipe.checks[0]?.()).toBe(false)
    pipe.release()
    expect(await pending).toEqual({ kind: 'denied', reason: 'peer' })
  })
  it('V1: an outside-task automatic ticket is refused even under an ordinary Always grant', async () => {
    const { f, worker } = await delegated()
    const changed = proposal()
    changed.use.command.argv.push('--outside')
    f.ports.delegation.requestOutside = vi.fn<typeof f.ports.delegation.requestOutside>(
      (who, input) => Promise.resolve(f.authorize(who, input.use)),
    )
    expect(await f.fleet.request(worker, changed)).toEqual({ kind: 'denied', reason: 'policy' })
    expect(f.routes[0]?.handoff).not.toHaveBeenCalled()
  })
  it('V1 V9: task scopes/cards reject claimed approvals, identities and value fields', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch()),
      scope = scopes()[0]
    if (!scope) throw new Error('missing scope')
    for (const field of ['value', 'requester', 'approval', 'decision'])
      await expect(f.fleet.delegate(worker, [{ ...scope, [field]: 'claimed' }])).rejects.toThrow()
    await f.fleet.delegate(worker, scopes())
    expect(vaultDelegationCardSchema.safeParse({ ...f.cards[0], value: 'forbidden' }).success).toBe(
      false,
    )
  })
  it('V11: task admission callback is single-use even with remaining count', async () => {
    const { f, worker } = await delegated()
    f.ports.delegation.request = vi.fn<typeof f.ports.delegation.request>(
      (who, input, _card, canAdmit) => {
        expect(canAdmit()).toBe(true)
        expect(canAdmit()).toBe(false)
        return Promise.resolve(f.authorize(who, input.use))
      },
    )
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'ticket' })
  })
  it('V1 V11: narrowing while admission waits invalidates original scope', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch()),
      entered = Promise.withResolvers<undefined>(),
      go = Promise.withResolvers<undefined>()
    await f.fleet.delegate(worker, scopes())
    f.ports.delegation.request = vi.fn<typeof f.ports.delegation.request>(
      async (who, input, _card, canAdmit) => {
        entered.resolve(undefined)
        await go.promise
        return canAdmit() ? f.authorize(who, input.use) : { kind: 'denied', reason: 'scope' }
      },
    )
    const pending = f.fleet.request(worker, proposal())
    await entered.promise
    f.fleet.narrowDelegation(worker, [])
    go.resolve(undefined)
    expect(await pending).toEqual({ kind: 'denied', reason: 'scope' })
    expect(f.routes[0]?.handoff).not.toHaveBeenCalled()
  })
  it('V11: unanswered UI card has a bounded wait even if adapter ignores cancellation', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    vi.useFakeTimers()
    f.ports.delegation.approve = vi.fn(
      () =>
        new Promise<never>(() => {
          /* Test-only nonresponsive UI. */
        }),
    )
    const pending = f.fleet.delegate(worker, scopes()),
      rejected = expect(pending).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'approval' })
  })
  it('V1 V10: non-UI peers, hooks and remote workers cannot acquire task consent', async () => {
    const f = setup()
    const launches = [
      {
        ...f.launch(),
        requester: { ...f.launch().requester, role: { kind: 'hook' as const, name: 'hook' } },
      },
      { ...f.launch(), requester: { ...f.launch().requester, deviceId: 'f'.repeat(32) } },
    ]
    for (const launch of launches)
      await expect(f.fleet.delegate(await f.fleet.open(launch), scopes())).rejects.toThrow()
    const worker = await f.fleet.open(f.launch())
    f.ports.peer = { ...f.ports.peer, ui: false }
    await expect(f.fleet.delegate(worker, scopes())).rejects.toThrow()
    expect(f.ports.delegation.approve).not.toHaveBeenCalled()
  })
  it('V1 V11: one user card binds role, task, targets/counts; approved uses stop at count', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    expect(await f.fleet.delegate(worker, scopes())).toBe(true)
    expect(f.cards[0]?.requester.taskId).toBe('task')
    expect(f.cards[0]?.requester.role).toEqual({ kind: 'role', name: 'engineer' })
    expect(f.cards[0]?.scopes).toEqual(scopes())
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'ticket' })
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'ticket' })
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'approval' })
    expect(f.ports.delegation.approve).toHaveBeenCalledOnce()
    expect(f.routes[0]?.handoff).toHaveBeenCalledTimes(2)
  })
  it('V1: out-of-task targets and tainted requests take ordinary broker approval', async () => {
    const { f, worker } = await delegated()
    const changed = proposal()
    changed.use.command.argv.push('--outside')
    expect(await f.fleet.request(worker, changed)).toMatchObject({ kind: 'approval' })
    f.ports.taint = () => ({ tainted: true, reasons: [{ source: 'agent', label: 'report' }] })
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'approval' })
    expect(f.ports.delegation.request).not.toHaveBeenCalled()
  })
  it.each(['digest', 'id', 'expiry', 'deny', 'always'] as const)(
    'V11: rejects %s answer without activating authority',
    async (change) => {
      const f = setup(),
        worker = await f.fleet.open(f.launch())
      f.ports.delegation.approve = vi.fn<typeof f.ports.delegation.approve>((card) => {
        if (change === 'expiry') f.clock.advance(120_000)
        let decision = 'allowOnce'
        if (change === 'deny') decision = 'deny'
        else if (change === 'always') decision = 'always'
        return Promise.resolve({
          id: change === 'id' ? 'f'.repeat(32) : card.id,
          digest: change === 'digest' ? 'f'.repeat(64) : card.digest,
          decision,
        })
      })
      if (change === 'deny') expect(await f.fleet.delegate(worker, scopes())).toBe(false)
      else await expect(f.fleet.delegate(worker, scopes())).rejects.toThrow()
      expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'approval' })
    },
  )
  it('V11 V13: a late card after task end cannot revive a task or transfer to another task', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    const waiting = Promise.withResolvers<unknown>(),
      entered = Promise.withResolvers<VaultDelegationCard>()
    f.ports.delegation.approve = vi.fn<typeof f.ports.delegation.approve>((card) => {
      entered.resolve(card)
      return waiting.promise
    })
    const pending = f.fleet.delegate(worker, scopes()),
      rejection = expect(pending).rejects.toThrow()
    const card = await entered.promise
    await f.fleet.end(worker)
    waiting.resolve({ id: card.id, digest: card.digest, decision: 'allowOnce' })
    await rejection
    const next = await f.fleet.open(f.launch())
    expect(await f.fleet.request(next, proposal())).toMatchObject({ kind: 'approval' })
  })
  it('V11: concurrent uses spend a single remaining slot only once', async () => {
    const f = setup(),
      worker = await f.fleet.open(f.launch())
    await f.fleet.delegate(worker, scopes(1))
    const callbacks: (() => VaultAuthorizationResult)[] = []
    const admissions: boolean[] = []
    const entered = Promise.withResolvers<undefined>(),
      go = Promise.withResolvers<undefined>()
    f.ports.delegation.request = vi.fn<typeof f.ports.delegation.request>(
      async (who, input, _card, canAdmit) => {
        const run = (): VaultAuthorizationResult => {
          const isAdmitted = canAdmit()
          admissions.push(isAdmitted)
          return isAdmitted ? f.authorize(who, input.use) : { kind: 'denied', reason: 'scope' }
        }
        callbacks.push(run)
        if (callbacks.length === 2) entered.resolve(undefined)
        await go.promise
        return run()
      },
    )
    const first = f.fleet.request(worker, proposal()),
      second = f.fleet.request(worker, proposal())
    await entered.promise
    go.resolve(undefined)
    const results = await Promise.all([first, second])
    expect(admissions).toEqual([true, false])
    expect(results.filter((result) => result.kind === 'ticket')).toHaveLength(1)
    expect(f.routes[0]?.handoff).toHaveBeenCalledOnce()
  })
  it('V1: narrowing may reduce counts/remove scopes; model cannot widen or renew authority', async () => {
    const { f, worker } = await delegated()
    await f.fleet.request(worker, proposal())
    f.fleet.narrowDelegation(worker, scopes(1))
    expect(await f.fleet.request(worker, proposal())).toMatchObject({ kind: 'approval' })
    expect(() => {
      f.fleet.narrowDelegation(worker, scopes(2))
    }).toThrow()
    const other = scopes(1)
    const first = other[0]
    if (!first) throw new Error('missing scope')
    first.target.names.push('OTHER')
    expect(() => {
      f.fleet.narrowDelegation(worker, other)
    }).toThrow()
    f.fleet.narrowDelegation(worker, [])
    expect(() => {
      f.fleet.narrowDelegation(worker, scopes(1))
    }).toThrow()
    await expect(f.fleet.delegate(worker, scopes())).rejects.toThrow()
  })
  it('V12: unattended, ceiling-none and sessionless tasks cannot acquire delegation approval', async () => {
    const f = setup()
    const launches = [
      { ...f.launch(), trigger: 'scheduler' as const },
      { ...f.launch(), secrets: 'none' },
      { ...f.launch(), requester: { ...f.launch().requester, sessionId: null } },
    ]
    for (const launch of launches) {
      const worker = await f.fleet.open(launch)
      await expect(f.fleet.delegate(worker, scopes())).rejects.toThrow()
    }
    expect(f.ports.delegation.approve).not.toHaveBeenCalled()
  })
})
