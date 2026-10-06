import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DevicePairingError } from '../../src/core/devices/pairing'
import { deviceDispatchSchema, type DeviceFrame } from '../../src/shared/devices'
import type { DeviceChannel } from '../../src/host/devices/deviceChannel'
import {
  useExecutionFixture,
  responseBody,
  signedDispatch,
  deferred,
} from './helpers/deviceExecutionFixtures'

const fixture = useExecutionFixture('lane')
function channel(pairId: string, incarnation: string) {
  return {
    pairId,
    receiverIncarnationId: incarnation,
    isReceiver: true,
    send: vi.fn<DeviceChannel['send']>(),
    close: vi.fn(),
  }
}
function incoming(body: DeviceFrame['body']): DeviceFrame {
  const { request } = fixture()
  return {
    version: 1,
    pairId: request.identity.pairId,
    receiverIncarnationId: request.identity.receiverIncarnationId,
    requestId: 'f'.repeat(32),
    body,
  }
}

const use = {
  feature: 'hookModels',
  kind: 'prompt',
  event: 'PreToolUse',
  modelId: 'muse-spark-1.3',
  dailyBudgetUsd: 1,
} as const

describe('receiver admission and local authority', () => {
  it('journals admission and launch intent before a single start despite concurrent lost replies', async () => {
    const { receiver, journal, request, lease, fixture: counts, directory } = fixture()
    lease.start.mockImplementation(async (boundary) => {
      await boundary.beforeAction()
      const row = await journal.lookup(request.identity)
      expect(row).toMatchObject({ kind: 'receiver-record', outcome: { state: 'launch-intent' } })
      expect(await readFile(path.join(directory, 'attempts.json'), 'utf8')).toContain(
        'launch-intent',
      )
      counts.launches += 1
    })
    const responses = await Promise.all([
      receiver.dispatch(request),
      receiver.dispatch(request),
      receiver.dispatch(request),
    ])
    expect(responses.map((response) => response.body.kind)).toEqual([
      'outcome',
      'reconciled',
      'reconciled',
    ])
    expect(counts.launches).toBe(1)
    expect(lease.start).toHaveBeenCalledTimes(1)
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { state: 'running', revision: 3, occupied: request.caps },
    })
  })
  it('rejects changed dispatch data with unchanged or recomputed digest and no second launch', async () => {
    const { receiver, request, fixture: counts } = fixture()
    await receiver.dispatch(request)
    const changed = { ...request, mode: 'auto' as const }
    expect(await responseBody(receiver.dispatch(changed))).toEqual({
      kind: 'failure',
      reason: 'payload-changed',
    })
    expect(await responseBody(receiver.dispatch(signedDispatch(changed)))).toEqual({
      kind: 'failure',
      reason: 'payload-changed',
    })
    expect(counts.launches).toBe(1)
  })
  it('uses M96 atomic capacity for the final slot, including local work and child capacity', async () => {
    const { receiver, request, execution, fixture: counts } = fixture()
    const second = signedDispatch({
      ...request,
      identity: { ...request.identity, attemptId: '0'.repeat(32) },
    })
    const responses = await Promise.all([receiver.dispatch(request), receiver.dispatch(second)])
    expect(responses[0].body.kind).toBe('outcome')
    expect(responses[1].body).toEqual({ kind: 'failure', reason: 'capacity' })
    expect(counts.launches).toBe(1)
    execution.admit.mockRejectedValueOnce(new DevicePairingError('capacity'))
    expect(
      await responseBody(
        receiver.dispatch(
          signedDispatch({
            ...second,
            identity: { ...second.identity, attemptId: '1'.repeat(32) },
          }),
        ),
      ),
    ).toEqual({ kind: 'failure', reason: 'capacity' })
  })
  it.each([
    'trust',
    'protected-path',
    'role-tools',
    'receiver-plan',
    'receiver-manual',
    'confidential-policy',
  ])('honors the local %s policy refusal before admission', async () => {
    const { receiver, request, policy, execution, lease } = fixture()
    policy.assertAllowed.mockRejectedValueOnce(new DevicePairingError('grant'))
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    expect(execution.admit).not.toHaveBeenCalled()
    expect(lease.start).not.toHaveBeenCalled()
  })
  it('cannot express Bypass, arbitrary commands, remote paid consent or protected absolute paths', () => {
    const { request } = fixture()
    for (const extra of [
      { mode: 'bypass' },
      { command: 'peer shell' },
      { paidConsent: true },
      { plannedWrites: [String.raw`C:\private`] },
    ]) {
      expect(deviceDispatchSchema.safeParse({ ...request, ...extra }).success).toBe(false)
    }
  })
  it('checks the current grant and receiver-local approval instead of trusting a pairing', async () => {
    const { receiver, request, grant, policy, lease } = fixture()
    policy.currentGrant.mockResolvedValueOnce({
      ...grant,
      offer: { ...grant.offer, grantRevision: grant.offer.grantRevision + 1 },
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    policy.approve.mockResolvedValueOnce(false)
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'approval-required',
    })
    expect(lease.start).not.toHaveBeenCalled()
  })
  it('refuses grant narrowing, trust loss and disconnect after the approval await', async () => {
    const { receiver, request, policy, grant, lease, fixture: counts } = fixture()
    policy.approve.mockImplementationOnce(() => {
      policy.currentGrant.mockResolvedValue({
        ...grant,
        offer: { ...grant.offer, lanes: false, entries: [], checks: true },
      })
      return Promise.resolve(true)
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    expect(counts.launches).toBe(0)
    policy.currentGrant.mockResolvedValue(grant)
    policy.approve.mockImplementationOnce(() => {
      receiver.disconnect()
      return Promise.resolve(true)
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    expect(lease.start).not.toHaveBeenCalled()
  })
  it('checks policy again after capacity admission and preserves its reservation on refusal', async () => {
    const { receiver, request, execution, lease, policy, journal, fixture: counts } = fixture()
    execution.admit.mockImplementationOnce(() => {
      counts.occupied += 1
      policy.assertAllowed.mockRejectedValueOnce(new DevicePairingError('grant'))
      return Promise.resolve(lease)
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'uncertain',
    })
    expect(lease.start).not.toHaveBeenCalled()
    expect(lease.release).not.toHaveBeenCalled()
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { occupied: request.caps },
    })
  })
  it.each(['off', 'deny', 'missing-key', 'changed-model', 'changed-price', 'changed-credential'])(
    'keeps the receiver paid %s boundary before the forbidden charge',
    async (caseName) => {
      const { receiver, request, fixture: local, policy } = fixture()
      await receiver.dispatch(request)
      if (local.boundary === undefined) throw new Error('missing boundary')
      const charge = vi.fn()
      if (caseName === 'off') policy.paidGate.isOn.mockReturnValue(false)
      else if (caseName === 'deny') policy.paidConsent.allows.mockResolvedValue(false)
      else
        policy.assertPaidBinding.mockRejectedValue(new DevicePairingError('paid-consent-required'))
      await expect(
        (async () => {
          await local.boundary?.beforePaidUse(use)
          charge()
        })(),
      ).rejects.toThrow('paid-consent-required')
      expect(charge).not.toHaveBeenCalled()
      if (caseName === 'off') expect(policy.paidConsent.allows).not.toHaveBeenCalled()
    },
  )
  it('asks the local paid consent with current pricing and rechecks binding after its answer', async () => {
    const { receiver, request, fixture: local, policy } = fixture()
    await receiver.dispatch(request)
    if (local.boundary === undefined) throw new Error('missing boundary')
    await local.boundary.beforePaidUse(use)
    expect(policy.paidConsent.allows).toHaveBeenCalledWith(use)
    expect(policy.assertPaidBinding).toHaveBeenCalledTimes(2)
    policy.paidConsent.allows.mockImplementationOnce(() => {
      policy.paidGate.isOn.mockReturnValue(false)
      return Promise.resolve(true)
    })
    await expect(local.boundary.beforePaidUse(use)).rejects.toThrow('paid-consent-required')
    policy.paidGate.isOn.mockReturnValue(true)
    policy.assertPaidBinding
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new DevicePairingError('paid-consent-required'))
    await expect(local.boundary.beforePaidUse(use)).rejects.toThrow('paid-consent-required')
  })
  it('pauses at the next controlled boundary and requires explicit resume after disconnect', async () => {
    const { receiver, request, fixture: local, lease } = fixture()
    await receiver.dispatch(request)
    receiver.disconnect()
    expect(receiver.paused).toBe(true)
    expect(lease.pause).toHaveBeenCalledOnce()
    if (local.boundary === undefined) throw new Error('missing boundary')
    await expect(local.boundary.beforeAction()).rejects.toThrow('grant')
    const fresh = signedDispatch({
      ...request,
      identity: { ...request.identity, attemptId: '0'.repeat(32) },
    })
    expect(await responseBody(receiver.dispatch(fresh))).toEqual({
      kind: 'failure',
      reason: 'reconcile-required',
    })
    expect(lease.release).not.toHaveBeenCalled()
    expect(() => {
      receiver.resumeQueue()
    }).toThrow('uncertain')
    await receiver.reconcile([request.identity])
    receiver.resumeQueue()
    await local.boundary.beforeAction()
  })
  it('returns uncertain for unknown reconciliation and refuses forged terminal/check/settlement frames', async () => {
    const { receiver, request, journal } = fixture()
    const transport = channel(request.identity.pairId, request.identity.receiverIncarnationId)
    await receiver.receive(
      incoming({ kind: 'reconcile', identities: [request.identity] }),
      transport,
    )
    expect(transport.send).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'f'.repeat(32),
        body: { kind: 'failure', reason: 'uncertain' },
      }),
    )
    await receiver.dispatch(request)
    const record = await journal.lookup(request.identity)
    if (record?.kind !== 'receiver-record') throw new Error('missing record')
    await receiver.receive(
      incoming({
        kind: 'outcome',
        outcome: {
          ...record.outcome,
          state: 'retired',
          occupied: { ...request.caps, workers: 0, processes: 0, heavyChecks: 0 },
        },
      }),
      transport,
    )
    expect(transport.send).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: { kind: 'failure', reason: 'invalid-frame' } }),
    )
    await expect(
      receiver.receive(
        incoming({
          kind: 'acknowledge',
          identity: request.identity,
          settlementId: record.outcome.usage.settlementId,
          payloadDigest: request.payloadDigest,
        }),
        transport,
      ),
    ).rejects.toThrow('uncertain')
    expect(await journal.lookup(request.identity)).toEqual(record)
    await expect(
      receiver.receive(
        incoming({ kind: 'cancel', identity: request.identity }),
        channel('0'.repeat(32), request.identity.receiverIncarnationId),
      ),
    ).rejects.toThrow('invalid-frame')
  })
  it('detects disconnect while a local approval is pending without launching', async () => {
    const { receiver, request, policy, lease } = fixture()
    const answer = deferred<boolean>()
    policy.approve.mockReturnValueOnce(answer.promise)
    const dispatch = receiver.dispatch(request)
    await vi.waitFor(() => {
      expect(policy.approve).toHaveBeenCalled()
    })
    receiver.disconnect()
    answer.resolve(true)
    expect(await responseBody(dispatch)).toEqual({ kind: 'failure', reason: 'grant' })
    expect(lease.start).not.toHaveBeenCalled()
  })
  it('refuses dispatch to an unoffered incarnation and validates reconciliation pages', async () => {
    const { receiver, request, lease } = fixture()
    const stale = signedDispatch({
      ...request,
      identity: { ...request.identity, receiverIncarnationId: 'f'.repeat(32) },
      ...(request.kind === 'lane' && {
        route: { ...request.route, receiverIncarnationId: 'f'.repeat(32) },
      }),
    })
    expect(await responseBody(receiver.dispatch(stale))).toEqual({
      kind: 'failure',
      reason: 'reconcile-required',
    })
    await expect(receiver.reconcile([])).rejects.toThrow('invalid-frame')
    await expect(
      receiver.reconcile([request.identity, { ...request.identity, pairId: '0'.repeat(32) }]),
    ).rejects.toThrow()
    expect(lease.start).not.toHaveBeenCalled()
  })
})
