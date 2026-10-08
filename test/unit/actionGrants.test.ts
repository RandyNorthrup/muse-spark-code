import { describe, expect, it, vi } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceGrantRefusalSchema,
  deviceStepUpSchema,
  type DeviceCaps,
} from '../../src/shared/devices'
import { deviceActionDigest } from '../../src/core/devices/actionGrants'
import {
  bindDeviceReceiverActionGrants,
  DeviceActionGrantError,
  DeviceReceiver,
} from '../../src/host/devices/deviceReceiver'
import { actionGrantFixture } from './helpers/actionGrantFixtures'
import {
  deferred,
  responseBody,
  signedDispatch,
  useExecutionFixture,
} from './helpers/deviceExecutionFixtures'

const receiverFixture = useExecutionFixture('lane')
const fields: (keyof DeviceCaps)[] = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
]

async function expectProtectedWrite(path: string) {
  const f = actionGrantFixture()
  f.state.action = { ...f.state.action, paths: [path] }
  expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
}
async function boundReceiverFixture(f: ReturnType<typeof actionGrantFixture>) {
  const local = receiverFixture()
  const bound = bindDeviceReceiverActionGrants(local.policy, f.grants, () => f.request)
  const receiver = await DeviceReceiver.open(
    local.request.identity.receiverIncarnationId,
    local.journal,
    local.execution,
    bound,
  )
  receiver.resumeQueue()
  return { ...local, bound, receiver }
}

async function confirmedReceiverFixture(operation: 'connect' | 'program' | 'actuate' = 'actuate') {
  const f = actionGrantFixture()
  f.state.action = { ...f.state.action, operation }
  const local = await boundReceiverFixture(f)
  deviceStepUpSchema.parse(await f.grants.requestStepUp(f.request, 'local-confirm'))
  return { ...local, action: f }
}

async function expectSingleLaunch(local: Awaited<ReturnType<typeof confirmedReceiverFixture>>) {
  expect(await responseBody(local.receiver.dispatch(local.request))).toMatchObject({
    kind: 'outcome',
    outcome: { state: 'running' },
  })
  expect(local.lease.start).toHaveBeenCalledOnce()
  expect(local.fixture.launches).toBe(1)
}

describe('receiver intersection', () => {
  it('refuses admission past the receiver intersection', async () => {
    const { grants, request, state } = actionGrantFixture()
    state.trusted = false
    const { policy, receiver, request: dispatch, lease } = receiverFixture()
    const bound = bindDeviceReceiverActionGrants(
      { ...policy, assertAllowed: () => Promise.resolve() },
      grants,
      () => request,
    )
    policy.assertAllowed.mockImplementation(() => bound.assertAllowed(dispatch))
    await receiver.dispatch(dispatch)
    expect(lease.start).not.toHaveBeenCalled()
    await expect(bound.assertAllowed(dispatch)).rejects.toBeInstanceOf(DeviceActionGrantError)
    expect(await grants.admit(request)).toMatchObject({ reason: 'scope-denied' })
  })
  it('calls the sender ceiling before looking at the receiver', async () => {
    const f = actionGrantFixture()
    const result = await f.grants.admit({ ...f.request, mode: 'auto' })
    expect(deviceGrantRefusalSchema.parse(result).reason).toBe('scope-denied')
    expect(f.current).not.toHaveBeenCalled()
  })
  it.each(['manual', 'plan'] as const)('refuses sender auto against receiver %s', async (mode) => {
    const f = actionGrantFixture()
    f.senderCeiling.mockReturnValue({ mode: 'auto', quota: f.request.quota })
    f.state.grant.mode = mode
    expect(await f.grants.admit({ ...f.request, mode: 'auto' })).toMatchObject({
      reason: 'scope-denied',
    })
  })
  it.each(['grant', 'repository', 'role', 'approval'] as const)(
    'uses the narrowest %s mode',
    async (limit) => {
      const f = actionGrantFixture()
      f.state[limit].mode = 'plan'
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
    },
  )
  it.each(['.git/config', String.raw`.git\config`, 'src/../.git/config', '.env'])(
    'refuses protected-path write %s',
    expectProtectedWrite,
  )
  it.each([
    'pkg/.git/hooks/pre-commit',
    'pkg/.git/config',
    'dir/.env',
    '../.git/config',
    'foo/../../.git/config',
    '/repo/.git/config',
    '.git/config',
    String.raw`.git\config`,
    'src/../.git/config',
    '.env',
    String.raw`pkg\.GiT\hooks\pre-commit`,
    String.raw`dir\.EnV`,
    String.raw`..\.git\config`,
    String.raw`foo\..\..\.git\config`,
    String.raw`C:\repo\.git\config`,
    'C:relative.txt',
    String.raw`\\server\repo\file.txt`,
    '../ordinary.txt',
    '/repo/ordinary.txt',
    'pkg/.vscode/tasks.json',
    'pkg/AGENTS.md',
  ])('RVM100P2A-P1 refuses protected or outside write %s', expectProtectedWrite)
  it('RVM100P2A-P1 matches receiver protected runs at segment boundaries', async () => {
    const f = actionGrantFixture()
    f.state.protectedPaths = ['Private/Secrets', '.env']
    for (const path of ['pkg/PRIVATE/secrets/key', String.raw`pkg\private\SECRETS`]) {
      f.state.action = { ...f.state.action, paths: [path] }
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
    }
    for (const path of ['src/../main.ts', 'pkg/private/secrets-backup/key', 'pkg/.environment']) {
      f.state.action = { ...f.state.action, paths: [path] }
      expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
    }
    f.state.protectedPaths = []
    f.state.action = { ...f.state.action, paths: ['pkg/.GiT/config'] }
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
  })
  it('checks trust again after ordinary local approval', async () => {
    const f = actionGrantFixture()
    const { policy, receiver, request, lease } = receiverFixture()
    const bound = bindDeviceReceiverActionGrants(
      { ...policy, assertAllowed: () => Promise.resolve() },
      f.grants,
      () => f.request,
    )
    policy.assertAllowed.mockImplementation(() => bound.assertAllowed(request))
    policy.approve.mockImplementation(() => {
      f.state.trusted = false
      return Promise.resolve(true)
    })
    await receiver.dispatch(request)
    expect(lease.start).not.toHaveBeenCalled()
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
  })
  it.each(['repository', 'role', 'offer', 'tool', 'approval', 'revoked', 'expired'])(
    'refuses a changed %s',
    async (dimension) => {
      const f = actionGrantFixture()
      switch (dimension) {
        case 'repository': {
          f.state.repository.repositoryId = 'a'.repeat(DEVICE_LIMITS.idChars)
          break
        }
        case 'role': {
          f.state.role.roleId = 'a'.repeat(DEVICE_LIMITS.idChars)
          break
        }
        case 'offer': {
          f.state.repository.lanes = false
          break
        }
        case 'tool': {
          f.state.role.tools = []
          break
        }
        case 'approval': {
          f.state.approval.allowed = false
          break
        }
        case 'revoked': {
          f.state.revoked = true
          break
        }
        case 'expired': {
          f.setNow(f.state.grant.expiresAt)
          break
        }
      }
      const reasons: Record<string, string> = { revoked: 'grant-revoked', expired: 'grant-expired' }
      expect(await f.grants.admit(f.request)).toMatchObject({
        reason: reasons[dimension] ?? 'scope-denied',
      })
    },
  )
  it.each(fields)('checks sender %s at its cap and one past', async (field) => {
    const f = actionGrantFixture()
    expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
    const request = {
      ...f.request,
      quota: { ...f.request.quota, [field]: f.request.quota[field] + 1 },
    }
    expect(await f.grants.admit(request)).toMatchObject({ reason: 'scope-denied' })
  })
  it.each(fields)('checks receiver %s at its cap and one past', async (field) => {
    for (const limit of ['grant', 'repository', 'role', 'approval'] as const) {
      const f = actionGrantFixture()
      expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
      f.state[limit].quota = { ...f.state[limit].quota, [field]: f.request.quota[field] - 1 }
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'quota-exceeded' })
    }
  })
  it('returns a grant narrowed to the admitted request', async () => {
    const f = actionGrantFixture()
    f.state.grant.mode = 'auto'
    f.state.grant.quota = { ...f.state.grant.quota, tokens: f.request.quota.tokens + 1 }
    expect(await f.grants.admit(f.request)).toMatchObject({
      mode: f.request.mode,
      quota: f.request.quota,
    })
  })
  it('retains receiver usage despite a peer assertion of settlement', async () => {
    const f = actionGrantFixture()
    f.state.used.spendUsd = 1
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'quota-exceeded' })
    expect(
      deviceGrantRefusalSchema.safeParse({ ...f.request, kind: 'settlement', used: 0 }).success,
    ).toBe(false)
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'quota-exceeded' })
  })
})

describe('receiver step-up', () => {
  it.each(['connect', 'program', 'actuate'] as const)(
    'requires device presence for %s, once',
    async (operation) => {
      const f = actionGrantFixture()
      f.state.action = { ...f.state.action, operation }
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
      const approval = deviceStepUpSchema.parse(
        await f.grants.requestStepUp(f.request, 'local-confirm'),
      )
      expect(f.presence.confirm).toHaveBeenCalledOnce()
      expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
      await expect(f.grants.attestStepUp(approval)).rejects.toThrow('presence-unverified')
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
    },
  )
  it.each(['connect', 'program', 'actuate'] as const)(
    'RVM100P2A-P2 confirms exactly one %s dispatch through the real binding',
    async (operation) => {
      const local = await confirmedReceiverFixture(operation)
      const { request, lease, bound, receiver, fixture } = local
      await expectSingleLaunch(local)
      await expect(bound.assertAllowed(request)).rejects.toMatchObject({
        refusal: { reason: 'step-up-required' },
      })
      if (fixture.boundary === undefined) throw new Error('missing boundary')
      await expect(fixture.boundary.beforeAction()).rejects.toMatchObject({
        refusal: { reason: 'step-up-required' },
      })
      const second = signedDispatch({
        ...request,
        identity: { ...request.identity, attemptId: '0'.repeat(DEVICE_LIMITS.idChars) },
      })
      expect(await responseBody(receiver.dispatch(second))).toEqual({
        kind: 'failure',
        reason: 'grant',
      })
      await expect(bound.assertAllowed(second)).rejects.toMatchObject({
        refusal: { reason: 'step-up-required' },
      })
      expect(lease.start).toHaveBeenCalledOnce()
      expect(fixture.launches).toBe(1)
    },
  )
  it.each(['identity', 'dispatch-payload'])(
    'RVM100P2A-P2 binds the in-flight attestation to its %s',
    async (change) => {
      const local = await confirmedReceiverFixture()
      const { policy, request, bound } = local
      const other = signedDispatch(
        change === 'identity'
          ? {
              ...request,
              identity: { ...request.identity, attemptId: '0'.repeat(DEVICE_LIMITS.idChars) },
            }
          : {
              ...request,
              payloadDigest: 'a'.repeat(DEVICE_LIMITS.digestChars),
              ...(request.kind === 'lane' && { brief: 'Different fake dispatch' }),
            },
      )
      policy.approve.mockImplementation(async () => {
        await expect(bound.assertAllowed(other)).rejects.toMatchObject({
          refusal: { reason: 'step-up-required' },
        })
        return true
      })
      await expectSingleLaunch(local)
    },
  )
  it('RVM100P2A-P2 spends a bound attestation when ordinary approval ends the attempt', async () => {
    const { policy, request, lease, bound, receiver } = await confirmedReceiverFixture()
    policy.approve.mockResolvedValue(false)
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'approval-required',
    })
    expect(lease.start).not.toHaveBeenCalled()
    await expect(bound.assertAllowed(request)).rejects.toMatchObject({
      refusal: { reason: 'step-up-required' },
    })
  })
  it('RVM100P2AB-P2 spends a bound attestation when the real start boundary denies approval', async () => {
    const { policy, request, lease, bound, receiver, fixture } = await confirmedReceiverFixture()
    policy.approve.mockImplementation(() => Promise.resolve(policy.approve.mock.calls.length <= 3))
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'uncertain',
    })
    expect(policy.approve).toHaveBeenCalledTimes(4)
    expect(lease.start).toHaveBeenCalledOnce()
    expect(fixture.launches).toBe(0)
    await expect(bound.assertAllowed(request)).rejects.toMatchObject({
      refusal: { reason: 'step-up-required' },
    })
  })
  it('RVM100P2A-P2 refuses changed payload during the same attested dispatch', async () => {
    const { policy, request, lease, bound, receiver, action: f } = await confirmedReceiverFixture()
    policy.approve.mockImplementation(() => {
      f.state.action = { ...f.state.action, payload: new TextEncoder().encode('other action') }
      return Promise.resolve(true)
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    expect(lease.start).not.toHaveBeenCalled()
    f.state.action = { ...f.state.action, payload: new TextEncoder().encode('exact fake action') }
    await expect(bound.assertAllowed(request)).rejects.toMatchObject({
      refusal: { reason: 'step-up-required' },
    })
  })
  it('refuses an approval supplied by the orchestrator', async () => {
    const f = actionGrantFixture()
    await expect(
      f.grants.attestStepUp({
        version: 1,
        grantId: f.state.grant.grantId,
        actionDigest: 'a'.repeat(DEVICE_LIMITS.digestChars),
        presence: 'local-confirm',
        approvedAt: DEVICE_LIMITS.stepUpValidityMs,
        expiresAt: DEVICE_LIMITS.stepUpValidityMs * 2,
      }),
    ).rejects.toThrow('presence-unverified')
  })
  it('binds step-up to the exact payload digest', async () => {
    const f = actionGrantFixture()
    f.state.action = { ...f.state.action, operation: 'program' }
    await f.grants.requestStepUp(f.request, 'local-confirm')
    f.state.action = { ...f.state.action, payload: new TextEncoder().encode('other payload') }
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it('keeps the local attestation private when its returned receipt is mutated', async () => {
    const f = actionGrantFixture()
    f.state.action = { ...f.state.action, operation: 'program' }
    const result = await f.grants.requestStepUp(f.request, 'local-confirm')
    if ('reason' in result) throw new Error('fixture')
    f.state.action = { ...f.state.action, payload: new TextEncoder().encode('forged replacement') }
    result.actionDigest = deviceActionDigest(f.request, f.state.action)
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it('expires a step-up at five minutes', async () => {
    const f = actionGrantFixture()
    f.state.grant.requiresStepUp = true
    const approval = deviceStepUpSchema.parse(
      await f.grants.requestStepUp(f.request, 'local-confirm'),
    )
    f.setNow(approval.expiresAt)
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it.each(['trust', 'role', 'payload', 'revision'])(
    'rechecks %s while the device prompt is open',
    async (change) => {
      const f = actionGrantFixture()
      const answer = deferred<boolean>()
      f.presence.confirm.mockReturnValue(answer.promise)
      const pending = f.grants.requestStepUp(f.request, 'local-confirm')
      switch (change) {
        case 'trust': {
          f.state.trusted = false
          break
        }
        case 'role': {
          f.state.role.tools = []
          break
        }
        case 'payload': {
          f.state.action = { ...f.state.action, payload: new Uint8Array([1]) }
          break
        }
        case 'revision': {
          f.state.grant.grantRevision += 1
          break
        }
      }
      answer.resolve(true)
      expect(await pending).toMatchObject({
        reason: change === 'trust' || change === 'role' ? 'scope-denied' : 'presence-unverified',
      })
    },
  )
  it('never lets Auto or an ordinary approval substitute for a step-up', async () => {
    const f = actionGrantFixture()
    f.request.mode = 'auto'
    f.senderCeiling.mockReturnValue({ mode: 'auto', quota: f.request.quota })
    for (const limit of ['grant', 'repository', 'role', 'approval'] as const)
      f.state[limit].mode = 'auto'
    f.state.action = { ...f.state.action, operation: 'actuate' }
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it('refuses a changed grant revision after confirmation', async () => {
    const f = actionGrantFixture()
    f.state.grant.requiresStepUp = true
    await f.grants.requestStepUp(f.request, 'local-confirm')
    f.state.grant.grantRevision += 1
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'step-up-required' })
  })
  it('bounds pending prompts and attestation records', async () => {
    const f = actionGrantFixture()
    for (let index = 0; index < DEVICE_LIMITS.grantsPerOwner; index += 1) {
      f.state.action = { ...f.state.action, payload: new TextEncoder().encode(String(index)) }
      expect(
        deviceStepUpSchema.safeParse(await f.grants.requestStepUp(f.request, 'local-confirm'))
          .success,
      ).toBe(true)
    }
    f.state.action = { ...f.state.action, payload: new TextEncoder().encode('one past') }
    expect(await f.grants.requestStepUp(f.request, 'local-confirm')).toMatchObject({
      reason: 'presence-unverified',
    })
    expect(f.presence.confirm).toHaveBeenCalledTimes(DEVICE_LIMITS.grantsPerOwner)
    f.setNow(DEVICE_LIMITS.stepUpValidityMs * 2)
    expect(
      deviceStepUpSchema.safeParse(await f.grants.requestStepUp(f.request, 'local-confirm'))
        .success,
    ).toBe(true)
  })
  it('allows offline and observe without physical step-up, and refuses forbidden operations', async () => {
    const f = actionGrantFixture()
    for (const operation of ['offline', 'observe'] as const) {
      f.state.action = { ...f.state.action, operation }
      expect(await f.grants.admit(f.request)).toEqual(f.state.grant)
    }
    f.state.action = { ...f.state.action, operation: 'refused' }
    expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
    expect(f.presence.confirm).not.toHaveBeenCalled()
  })
  it('rejects a denied, failed or timed-out device prompt', async () => {
    vi.useFakeTimers()
    try {
      const f = actionGrantFixture()
      f.presence.confirm
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('local failure'))
        .mockReturnValueOnce(new Promise<boolean>(() => undefined))
      expect(await f.grants.requestStepUp(f.request, 'local-confirm')).toMatchObject({
        reason: 'presence-unverified',
      })
      expect(await f.grants.requestStepUp(f.request, 'local-confirm')).toMatchObject({
        reason: 'presence-unverified',
      })
      const pending = f.grants.requestStepUp(f.request, 'local-confirm')
      await vi.advanceTimersByTimeAsync(DEVICE_LIMITS.stepUpValidityMs)
      expect(await pending).toMatchObject({ reason: 'presence-unverified' })
    } finally {
      vi.useRealTimers()
    }
  })
})
