import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Socket } from 'node:net'
import { TLSSocket } from 'node:tls'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeDeviceFrame } from '../../src/core/devices/deviceFraming'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import { usdAmountSchema } from '../../src/shared/usdSchema'
import { DevicePairingError } from '../../src/core/devices/pairing'
import {
  deviceDispatchSchema,
  type DeviceDispatch,
  type DeviceFrame,
} from '../../src/shared/devices'
import { openDeviceChannel, type DeviceChannel } from '../../src/host/devices/deviceChannel'
import {
  useExecutionFixture,
  responseBody,
  signedDispatch,
  deferred,
} from './helpers/deviceExecutionFixtures'

const fixture = useExecutionFixture('lane')
const sockets = new Set<TLSSocket>()
afterEach(() => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
})
function otherDispatch(request: DeviceDispatch) {
  return signedDispatch({
    ...request,
    identity: { ...request.identity, attemptId: '0'.repeat(32) },
  })
}
function liveChannel() {
  const { receiver, request } = fixture()
  const socket = new TLSSocket(new Socket())
  sockets.add(socket)
  const report = vi.fn()
  const port = {
    connected: vi.fn(),
    receive: vi.fn(async (frame: DeviceFrame, transport: DeviceChannel) => {
      await receiver.receive(frame, transport)
    }),
    disconnected: vi.fn(
      (reason: Parameters<typeof receiver.disconnect>[0], transport: DeviceChannel) => {
        receiver.disconnect(reason, transport.pairId)
        report(reason)
      },
    ),
  }
  const transport = openDeviceChannel(
    socket,
    request.identity.pairId,
    request.identity.receiverIncarnationId,
    () => true,
    port,
  )
  const send = vi.spyOn(transport, 'send').mockImplementation(() => undefined)
  return { socket, port, send, report }
}
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
  dailyBudgetUsd: usdAmountSchema.parse('1'),
} as const

describe('receiver admission and local authority', () => {
  it.each(['separate', 'Stop-first-overflow', 'data-before-Stop-overflow'])(
    'RVM100E2-P2-1 reaches the live local cancellation port with saturated data (%s)',
    async (input) => {
      const { receiver, request, policy, lease, observeOutcome } = fixture()
      await receiver.dispatch(request)
      const uncertain = observeOutcome('uncertain')
      const second = otherDispatch(request)
      const approval = deferred<boolean>()
      policy.approve.mockReturnValueOnce(approval.promise)
      const { socket } = liveChannel()
      const data = encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: second }))
      socket.emit('data', data)
      await vi.waitFor(() => {
        expect(policy.approve).toHaveBeenLastCalledWith(second)
      })
      for (let index = 1; index < DEVICE_LIMITS.queuedFrames; index += 1) socket.emit('data', data)
      const stop = encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity }))
      socket.emit(
        'data',
        input === 'separate'
          ? stop
          : Buffer.concat(input === 'Stop-first-overflow' ? [stop, data, data] : [data, stop]),
      )
      expect(lease.cancel).toHaveBeenCalledOnce()
      expect(lease.release).not.toHaveBeenCalled()
      approval.resolve(false)
      await uncertain
      await receiver.reconcile([request.identity])
    },
  )
  it.each(['same-chunk', 'later-chunk'])(
    'RVM100E3-P2 corrupt framing before Stop resets and stops every live attempt (%s)',
    async (timing) => {
      const {
        receiver,
        request,
        execution,
        policy,
        lease,
        journal,
        observeOutcome,
        fixture: counts,
      } = fixture()
      await receiver.dispatch(request)
      const second = otherDispatch(request)
      const secondLease = {
        ...lease,
        usage: { ...lease.usage, settlementId: 'b'.repeat(32) },
        start: vi.fn(() => Promise.resolve()),
        cancel: vi.fn(() => Promise.resolve()),
        pause: vi.fn(() => Promise.resolve()),
        release: vi.fn(() => Promise.resolve()),
      }
      execution.admit.mockResolvedValueOnce(secondLease)
      await receiver.dispatch(second)
      const uncertain = Promise.all([
        observeOutcome('uncertain'),
        observeOutcome('uncertain', second.identity),
      ])
      const pending = signedDispatch({
        ...request,
        identity: { ...request.identity, attemptId: '1'.repeat(32) },
      })
      const approval = deferred<boolean>()
      policy.approve.mockReturnValueOnce(approval.promise)
      const { socket, port, report } = liveChannel()
      socket.emit('data', encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: pending })))
      await vi.waitFor(() => {
        expect(policy.approve).toHaveBeenLastCalledWith(pending)
      })
      const closed = new Promise<void>((resolve) => socket.once('close', resolve))
      const corrupt = Buffer.from('{broken framing}\n')
      const stop = encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity }))
      socket.emit('data', timing === 'same-chunk' ? Buffer.concat([corrupt, stop]) : corrupt)
      await closed
      expect(lease.cancel).toHaveBeenCalledOnce()
      expect(secondLease.cancel).toHaveBeenCalledOnce()
      expect(report).toHaveBeenCalledExactlyOnceWith('invalid-frame')
      expect(lease.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        report.mock.invocationCallOrder[0] ?? 0,
      )
      expect(secondLease.cancel.mock.invocationCallOrder[0]).toBeLessThan(
        report.mock.invocationCallOrder[0] ?? 0,
      )
      expect(lease.pause).not.toHaveBeenCalled()
      expect(secondLease.pause).not.toHaveBeenCalled()
      expect(lease.release).not.toHaveBeenCalled()
      expect(secondLease.release).not.toHaveBeenCalled()
      expect(counts.occupied).toBe(1)
      expect(receiver.paused).toBe(true)
      approval.resolve(true)
      if (timing === 'later-chunk') socket.emit('data', stop)
      expect(
        port.receive.mock.calls.filter(([frame]) => frame.body.kind === 'cancel'),
      ).toHaveLength(0)
      await uncertain
      await receiver.reconcile([request.identity, second.identity])
      expect(await journal.cancellations()).toEqual(
        expect.arrayContaining([request.identity, second.identity, pending.identity]),
      )
      expect(await responseBody(receiver.dispatch(pending))).toEqual({
        kind: 'failure',
        reason: 'grant',
      })
      expect(execution.admit).toHaveBeenCalledTimes(2)
      expect(counts.launches).toBe(1)
    },
  )
  it('RVM100E3-P2 resets only the channel pair and preserves the live identity over a changed queued retry', async () => {
    const { receiver, request, lease, policy, execution, journal, observeOutcome } = fixture()
    await receiver.dispatch(request)
    receiver.disconnect('invalid-frame', 'f'.repeat(32))
    expect(lease.cancel).not.toHaveBeenCalled()
    receiver.resumeQueue()
    const approval = deferred<boolean>()
    policy.approve.mockReturnValueOnce(approval.promise)
    const second = otherDispatch(request)
    const held = receiver.dispatch(second)
    await vi.waitFor(() => {
      expect(policy.approve).toHaveBeenLastCalledWith(second)
    })
    const retry = receiver.dispatch(
      signedDispatch({ ...request, identity: { ...request.identity, taskId: 'f'.repeat(32) } }),
    )
    const uncertain = observeOutcome('uncertain')
    receiver.disconnect('invalid-frame', request.identity.pairId)
    expect(lease.cancel).toHaveBeenCalledOnce()
    approval.resolve(true)
    await held
    await retry
    await uncertain
    await receiver.reconcile([request.identity])
    expect(await journal.cancellations()).toContainEqual(request.identity)
    expect(execution.admit).toHaveBeenCalledOnce()
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('RVM100E3-P2 reset starts Stop despite a stalled journal and held cancellation confirmation', async () => {
    const { receiver, request, lease, journal, observeOutcome } = fixture()
    await receiver.dispatch(request)
    const uncertain = observeOutcome('uncertain')
    const confirmation = deferred<undefined>()
    const persistence = deferred<undefined>()
    lease.cancel.mockReturnValueOnce(confirmation.promise)
    vi.spyOn(journal, 'recordCancellation').mockReturnValueOnce(persistence.promise)
    const { socket, report } = liveChannel()
    const closed = new Promise<void>((resolve) => socket.once('close', resolve))
    socket.emit('data', Buffer.from('{broken framing}\n'))
    await closed
    expect(lease.cancel).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledExactlyOnceWith('invalid-frame')
    expect(lease.release).not.toHaveBeenCalled()
    persistence.resolve(undefined)
    confirmation.resolve(undefined)
    await uncertain
    const reconciled = await receiver.reconcile([request.identity])
    expect(reconciled[0]?.body).toMatchObject({
      kind: 'reconciled',
      outcomes: [{ state: 'uncertain', occupied: request.caps }],
    })
  })
  it('RVM100E2-P2-2 remembers Stop overtaking dispatch B behind held approval A', async () => {
    const { request, policy, lease, journal } = fixture()
    const approval = deferred<boolean>()
    policy.approve.mockReturnValueOnce(approval.promise)
    const second = otherDispatch(request)
    const { socket, send } = liveChannel()
    socket.emit('data', encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: request })))
    await vi.waitFor(() => {
      expect(policy.approve).toHaveBeenCalledOnce()
    })
    socket.emit(
      'data',
      Buffer.concat([
        encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: second })),
        encodeDeviceFrame(incoming({ kind: 'cancel', identity: second.identity })),
      ]),
    )
    approval.resolve(false)
    await vi.waitFor(() => {
      expect(send.mock.calls.filter(([frame]) => frame.body.kind === 'failure')).toHaveLength(2)
    })
    expect(lease.start).not.toHaveBeenCalled()
    expect(policy.approve).toHaveBeenCalledOnce()
    expect(await journal.lookup(second.identity)).toBeUndefined()
  })
  it.each(['coalesced', 'later'])(
    'RVM100E2-P2-4 retains cancellation through an identical %s retry',
    async (timing) => {
      const { request, policy, lease, receiver, journal } = fixture()
      const { socket, send } = liveChannel()
      const dispatch = encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: request }))
      const cancel = encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity }))
      socket.emit(
        'data',
        Buffer.concat(timing === 'coalesced' ? [dispatch, cancel, dispatch] : [dispatch, cancel]),
      )
      if (timing === 'later') {
        await vi.waitFor(() => {
          expect(send).toHaveBeenCalled()
        })
        socket.emit('data', dispatch)
      }
      await vi.waitFor(() => {
        expect(send.mock.calls.filter(([frame]) => frame.body.kind === 'failure')).toHaveLength(2)
      })
      expect(await responseBody(receiver.dispatch(request))).toEqual({
        kind: 'failure',
        reason: 'grant',
      })
      expect(lease.start).not.toHaveBeenCalled()
      expect(policy.approve).not.toHaveBeenCalled()
      expect(await journal.cancellations()).toContainEqual(request.identity)
    },
  )
  it.each([
    ['approve', 'cancel', 'retire', 'confirm'],
    ['approve', 'cancel', 'confirm', 'retire'],
    ['cancel', 'approve', 'retire', 'confirm'],
    ['cancel', 'retire', 'approve', 'confirm'],
    ['retire', 'approve', 'cancel', 'confirm'],
    ['approve', 'retire', 'cancel', 'confirm'],
  ])(
    'RVM100E2 permutations preserve Stop and final retirement: %s → %s → %s → %s',
    async (...order) => {
      const {
        receiver,
        request,
        policy,
        lease,
        execution,
        journal,
        retirement,
        fixture: counts,
      } = fixture()
      const approval = deferred<boolean>()
      const confirmation = deferred<undefined>()
      policy.approve.mockReturnValueOnce(approval.promise)
      lease.cancel.mockReturnValue(confirmation.promise)
      const first = receiver.dispatch(request)
      await vi.waitFor(() => {
        expect(policy.approve).toHaveBeenCalledOnce()
      })
      const second = otherDispatch(request)
      const queued = receiver.dispatch(second)
      await receiver.cancel(second.identity)
      let cancel: Promise<void> | undefined
      let launchesAtStop = 0
      const complete = async (event: string) => {
        switch (event) {
          case 'approve': {
            approval.resolve(true)
            await first
            return
          }
          case 'cancel': {
            launchesAtStop = counts.launches
            cancel = receiver.cancel(request.identity)
            return
          }
          case 'retire': {
            retirement.resolve({ usage: lease.usage })
            if (execution.admit.mock.calls.length > 0)
              await vi.waitFor(() => {
                expect(lease.release).toHaveBeenCalledOnce()
              })
            return
          }
          case 'confirm': {
            confirmation.resolve(undefined)
            return
          }
        }
      }
      for (const event of order) await complete(event)
      await Promise.all([first, queued, cancel])
      expect(counts.launches).toBe(launchesAtStop)
      expect(execution.admit).not.toHaveBeenCalledWith(second)
      expect(await journal.cancellations()).toEqual(
        expect.arrayContaining([request.identity, second.identity]),
      )
      expect(await responseBody(receiver.dispatch(second))).toEqual({
        kind: 'failure',
        reason: 'grant',
      })
      if (execution.admit.mock.calls.length > 0) {
        await vi.waitFor(() => {
          expect(lease.release).toHaveBeenCalledOnce()
        })
        expect(await journal.lookup(request.identity)).toMatchObject({
          outcome: { state: 'retired' },
        })
        if (counts.boundary !== undefined)
          await expect(counts.boundary.beforeAction()).rejects.toThrow('grant')
      }
      expect(receiver.blockedReason).toBeUndefined()
      await receiver.reconcile([request.identity, second.identity])
      receiver.resumeQueue()
    },
  )
  it('RVM100E2-P2-4 refuses admission synchronously while cancellation persistence is stalled', async () => {
    const { receiver, request, journal, execution, policy } = fixture()
    const persistence = deferred<undefined>()
    vi.spyOn(journal, 'recordCancellation').mockReturnValueOnce(persistence.promise)
    const cancel = receiver.cancel(request.identity)
    try {
      expect(await responseBody(receiver.dispatch(request))).toEqual({
        kind: 'failure',
        reason: 'grant',
      })
      expect(execution.admit).not.toHaveBeenCalled()
      expect(policy.approve).not.toHaveBeenCalled()
    } finally {
      persistence.resolve(undefined)
      await cancel
    }
  })
  it('RVM100E2-P2-3 retires a late reservation without waiting for cancel confirmation', async () => {
    const { receiver, request, execution, lease, retirement } = fixture()
    const reservation = deferred<typeof lease>()
    const confirmation = deferred<undefined>()
    execution.admit.mockReturnValueOnce(reservation.promise)
    lease.cancel.mockReturnValueOnce(confirmation.promise)
    const dispatch = receiver.dispatch(request)
    await vi.waitFor(() => {
      expect(execution.admit).toHaveBeenCalledOnce()
    })
    await receiver.cancel(request.identity)
    reservation.resolve(lease)
    try {
      await vi.waitFor(() => {
        expect(lease.cancel).toHaveBeenCalledOnce()
      })
      retirement.resolve({ usage: lease.usage })
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledOnce()
      })
      expect(await responseBody(dispatch)).toEqual({ kind: 'failure', reason: 'uncertain' })
    } finally {
      confirmation.resolve(undefined)
      await dispatch
    }
    expect(receiver.blockedReason).toBeUndefined()
    await receiver.reconcile([request.identity])
    receiver.resumeQueue()
  })
  it.each(['approval', 'start-confirmation'])(
    'RVM100E-P2-2 delivers Stop while dispatch waits for %s on the same channel',
    async (wait) => {
      const { request, policy, lease, receiver, observeOutcome, fixture: counts } = fixture()
      const approval = deferred<boolean>()
      const confirmation = deferred<undefined>()
      if (wait === 'approval') policy.approve.mockReturnValueOnce(approval.promise)
      else
        lease.start.mockImplementationOnce(() => {
          counts.launches += 1
          return confirmation.promise
        })
      const { socket, port, send } = liveChannel()
      socket.emit('data', encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: request })))
      await vi.waitFor(() => {
        if (wait === 'approval') expect(policy.approve).toHaveBeenCalledOnce()
        else expect(counts.launches).toBe(1)
      })
      const uncertain = wait === 'start-confirmation' ? observeOutcome('uncertain') : undefined
      try {
        socket.emit(
          'data',
          encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity })),
        )
        await vi.waitFor(() => {
          expect(port.receive).toHaveBeenCalledTimes(2)
          expect(send).toHaveBeenCalledWith(
            expect.objectContaining({
              body: { kind: 'failure', reason: wait === 'approval' ? 'grant' : 'uncertain' },
            }),
          )
          if (wait === 'start-confirmation') expect(lease.cancel).toHaveBeenCalledOnce()
        })
        expect(counts.launches).toBe(wait === 'approval' ? 0 : 1)
        expect(lease.release).not.toHaveBeenCalled()
      } finally {
        approval.resolve(true)
        confirmation.resolve(undefined)
        await uncertain
      }
      if (wait !== 'approval') return
      await receiver.reconcile([request.identity])
      expect(lease.start).not.toHaveBeenCalled()
    },
  )
  it('RVM100E-P2-2 cancels a coalesced dispatch before approval or reservation', async () => {
    const { request, policy, lease, execution, journal } = fixture()
    const { socket, port, send } = liveChannel()
    socket.emit(
      'data',
      Buffer.concat([
        encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: request })),
        encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity })),
      ]),
    )
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({ body: { kind: 'failure', reason: 'grant' } }),
      )
    })
    expect(port.receive).toHaveBeenCalledTimes(2)
    expect(policy.approve).not.toHaveBeenCalled()
    expect(execution.admit).not.toHaveBeenCalled()
    expect(lease.start).not.toHaveBeenCalled()
    expect(await journal.cancellations()).toContainEqual(request.identity)
  })
  it('RVM100E-P2-2 cancels an existing lease while another dispatch waits for approval', async () => {
    const { receiver, request, policy, lease, observeOutcome } = fixture()
    await receiver.dispatch(request)
    const uncertain = observeOutcome('uncertain')
    const approval = deferred<boolean>()
    policy.approve.mockReturnValueOnce(approval.promise)
    const second = otherDispatch(request)
    const { socket, port } = liveChannel()
    socket.emit('data', encodeDeviceFrame(incoming({ kind: 'dispatch', dispatch: second })))
    await vi.waitFor(() => {
      expect(policy.approve).toHaveBeenLastCalledWith(second)
    })
    try {
      socket.emit(
        'data',
        encodeDeviceFrame(incoming({ kind: 'cancel', identity: request.identity })),
      )
      await vi.waitFor(() => {
        expect(lease.cancel).toHaveBeenCalledOnce()
      })
      expect(port.receive).toHaveBeenCalledTimes(2)
      expect(lease.release).not.toHaveBeenCalled()
    } finally {
      approval.resolve(false)
      await uncertain
      await receiver.reconcile([request.identity])
    }
  })
  it('RVM100E-P2-2 cancels a late reservation and persists it without starting', async () => {
    const { receiver, request, execution, lease, journal, fixture: counts } = fixture()
    const reserve = deferred<typeof lease>()
    execution.admit.mockImplementationOnce(() => {
      counts.occupied += 1
      return reserve.promise
    })
    const dispatch = receiver.dispatch(request)
    await vi.waitFor(() => {
      expect(execution.admit).toHaveBeenCalledOnce()
    })
    await receiver.cancel(request.identity)
    reserve.resolve(lease)
    expect(await responseBody(dispatch)).toEqual({ kind: 'failure', reason: 'uncertain' })
    expect(lease.cancel).toHaveBeenCalledOnce()
    expect(lease.start).not.toHaveBeenCalled()
    expect(lease.release).not.toHaveBeenCalled()
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { state: 'admitted', occupied: request.caps },
    })
  })
  it('RVM100E-P2-2 keeps cancelled live ordinary and paid boundaries closed', async () => {
    const { receiver, request, fixture: local } = fixture()
    await receiver.dispatch(request)
    await receiver.cancel(request.identity)
    if (local.boundary === undefined) throw new Error('missing boundary')
    await expect(local.boundary.beforeAction()).rejects.toThrow('grant')
    await expect(local.boundary.beforePaidUse(use)).rejects.toThrow('grant')
  })
  it('RVM100E-P2-2 prevents a charge after Stop during the final paid binding check', async () => {
    const { receiver, request, policy, fixture: local } = fixture()
    await receiver.dispatch(request)
    if (local.boundary === undefined) throw new Error('missing boundary')
    const binding = deferred<undefined>()
    policy.assertPaidBinding.mockResolvedValueOnce().mockReturnValueOnce(binding.promise)
    const charge = vi.fn()
    const boundary = local.boundary
    const action = (async () => {
      await boundary.beforePaidUse(use)
      charge()
    })()
    const refused = expect(action).rejects.toThrow('grant')
    await vi.waitFor(() => {
      expect(policy.assertPaidBinding).toHaveBeenCalledTimes(2)
    })
    await receiver.cancel(request.identity)
    binding.resolve(undefined)
    await refused
    expect(charge).not.toHaveBeenCalled()
  })
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
    const second = otherDispatch(request)
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
    const fresh = otherDispatch(request)
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
