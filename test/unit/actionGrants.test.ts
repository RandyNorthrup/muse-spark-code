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
} from '../../src/host/devices/deviceReceiver'
import { actionGrantFixture } from './helpers/actionGrantFixtures'
import { deferred, useExecutionFixture } from './helpers/deviceExecutionFixtures'

const receiverFixture = useExecutionFixture('lane')
const fields: (keyof DeviceCaps)[] = [
  'workers',
  'processes',
  'heavyChecks',
  'tokens',
  'spendUsd',
  'artifactBytes',
]

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
    async (path) => {
      const f = actionGrantFixture()
      f.state.action = { ...f.state.action, paths: [path] }
      expect(await f.grants.admit(f.request)).toMatchObject({ reason: 'scope-denied' })
    },
  )
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
