// M100's receiver adapts the local M96 owner; it does not schedule or infer exit.
import { randomBytes } from 'node:crypto'
import {
  type AttemptJournal,
  DeviceJournalError,
  settleDeviceOperation,
  deviceDispatchDigest,
  deviceRecordPayload,
  type DeviceOutcome,
} from '../../core/devices/attemptJournal'
import { assertDeviceGrant, type DeviceGrant } from '../../core/devices/grants'
import { DevicePairingError } from '../../core/devices/pairing'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceDispatchSchema,
  deviceFrameSchema,
  type DEVICE_FAILURES,
  type DeviceAttemptIdentity,
  type DeviceDispatch,
  type DeviceExecutionPort,
  type DeviceFrame,
  type DeviceJournalRecord,
} from '../../shared/devices'
import type { PaidUseRequest } from '../../shared/paid'
import type { PaidFeatureGate } from '../../core/paid/paidFeatures'
import type { PaidUseConsent } from '../../core/paid/paidConsent'
import type { DeviceChannel } from './deviceChannel'

type Failure = (typeof DEVICE_FAILURES)[number]
export interface DeviceExecutionBoundary {
  /** Local policy at each controlled tool/model boundary, including after a pause. */
  beforeAction(): Promise<void>
  /** Only the local owner constructs this use; peer input cannot supply a price/grant. */
  beforePaidUse(use: PaidUseRequest): Promise<void>
}
export interface DeviceLocalAttempt {
  readonly usage: DeviceOutcome['usage']
  /** Reserves only; start is the sole launch operation. */
  start(boundary: DeviceExecutionBoundary): Promise<void>
  pause(): Promise<void>
  cancel(): Promise<void>
  /** Resolves only after requests AND all admitted tool/descendant processes settle. */
  readonly retirement: Promise<{
    usage: DeviceOutcome['usage']
    artifact?: DeviceOutcome['artifact']
  }>
  /** Releases execution occupancy after durable retirement; retained paid liability stays local. */
  release(): Promise<void>
}
export interface DeviceReceiverExecution {
  /** M96 restores unresolved occupancy, write sets, copies and liabilities before offers. */
  retain(records: readonly DeviceJournalRecord[]): Promise<void>
  /** M96 atomically meets local load, worker/check/process/child and resource caps. No spawn. */
  admit(request: DeviceDispatch): Promise<DeviceLocalAttempt>
}
export interface DeviceReceiverPolicy {
  currentGrant(request: DeviceDispatch): Promise<DeviceGrant>
  /** Meet sender mode ceiling with LOCAL mode, trust, role/tools, paths and workspace policy. */
  assertAllowed(request: DeviceDispatch): Promise<void>
  /** Local ordinary approval; pairing/remote approval never substitutes for this. */
  approve(request: DeviceDispatch): Promise<boolean>
  readonly paidGate: Pick<PaidFeatureGate, 'isOn'>
  readonly paidConsent: Pick<PaidUseConsent, 'allows'>
  /** M95 binds current local model, tariff, key owner and reservation; no peer credentials. */
  assertPaidBinding(request: DeviceDispatch, use: PaidUseRequest): Promise<void>
}
export class DeviceReceiver implements DeviceExecutionPort {
  public static async open(
    incarnationId: string,
    journal: AttemptJournal,
    execution: DeviceReceiverExecution,
    policy: DeviceReceiverPolicy,
  ): Promise<DeviceReceiver> {
    if (!/^[a-f0-9]{32}$(?![\s\S])/.test(incarnationId)) throw new DeviceJournalError('storage')
    const receiver = new DeviceReceiver(incarnationId, journal, execution, policy)
    const records = await journal.records()
    await execution.retain(records)
    for (const row of records) {
      if (
        row.kind !== 'receiver-record' ||
        row.outcome.state === 'retired' ||
        row.outcome.state === 'refused'
      )
        continue
      receiver.pendingReconciliation.add(row.outcome.identity.attemptId)
      // Restart reports uncertainty under the original owner; never adopts old work.
      await journal.advance(
        row.outcome.identity,
        (previous) => ({ ...previous, revision: previous.revision + 1, state: 'uncertain' }),
        Date.now(),
      )
    }
    return receiver
  }
  private queue: Promise<void> = Promise.resolve()
  private isPaused = true
  private failure: Failure | undefined
  private readonly live = new Map<
    string,
    { readonly identity: DeviceAttemptIdentity; readonly lease: DeviceLocalAttempt }
  >()
  private readonly pendingReconciliation = new Set<string>()
  private constructor(
    private readonly incarnationId: string,
    private readonly journal: AttemptJournal,
    private readonly execution: DeviceReceiverExecution,
    private readonly policy: DeviceReceiverPolicy,
  ) {}
  private async ordered<T>(work: () => Promise<T>): Promise<T> {
    const predecessor = this.queue
    const operation = (async () => {
      await predecessor
      return await work()
    })()
    this.queue = settleDeviceOperation(operation)
    return await operation
  }
  private frame(pairId: string, body: DeviceFrame['body']): DeviceFrame {
    return deviceFrameSchema.parse({
      version: DEVICE_LIMITS.protocolVersion,
      pairId,
      receiverIncarnationId: this.incarnationId,
      requestId: randomBytes(DEVICE_LIMITS.idChars / 2).toString('hex'),
      body,
    })
  }
  private response(row: DeviceJournalRecord): DeviceFrame {
    if (row.kind === 'source-intent')
      return this.frame(row.dispatch.identity.pairId, { kind: 'failure', reason: 'uncertain' })
    if (row.kind === 'tombstone') {
      const { kind: _kind, ...record } = row
      return this.frame(row.identity.pairId, { kind: 'tombstone', record })
    }
    // Reconciliation also carries historical outcomes through a current envelope.
    return this.frame(row.outcome.identity.pairId, { kind: 'reconciled', outcomes: [row.outcome] })
  }
  private assertResumed(): void {
    if (this.isPaused) throw new DevicePairingError('grant')
  }
  private async checkPolicy(request: DeviceDispatch): Promise<void> {
    this.assertResumed()
    assertDeviceGrant(await this.policy.currentGrant(request), request)
    await this.policy.assertAllowed(request)
    this.assertResumed()
  }
  private boundary(request: DeviceDispatch): DeviceExecutionBoundary {
    return {
      beforeAction: async () => {
        await this.checkPolicy(request)
        if (!(await this.policy.approve(request))) throw new DevicePairingError('approval-required')
        await this.checkPolicy(request)
      },
      beforePaidUse: async (use) => {
        await this.checkPolicy(request)
        await this.policy.assertPaidBinding(request, use)
        if (!this.policy.paidGate.isOn(use.feature) || !(await this.policy.paidConsent.allows(use)))
          throw new DevicePairingError('paid-consent-required')
        // A popup can yield while trust, price, model or credential ownership changes.
        await this.checkPolicy(request)
        await this.policy.assertPaidBinding(request, use)
        if (!this.policy.paidGate.isOn(use.feature))
          throw new DevicePairingError('paid-consent-required')
      },
    }
  }
  private async markUncertain(identity: DeviceAttemptIdentity): Promise<void> {
    this.isPaused = true
    this.failure = 'uncertain'
    await this.ordered(async () => {
      await this.journal.advance(
        identity,
        (previous) => ({ ...previous, revision: previous.revision + 1, state: 'uncertain' }),
        Date.now(),
      )
    })
  }
  public get paused(): boolean {
    return this.isPaused
  }
  public get blockedReason(): Failure | undefined {
    return this.failure
  }
  /** Explicit local Resume queue, after reconciliation; never a connect callback. */
  public resumeQueue(): void {
    if (this.failure !== undefined || this.pendingReconciliation.size > 0)
      throw new DeviceJournalError('uncertain')
    this.isPaused = false
  }
  public disconnect(): void {
    this.isPaused = true
    for (const [attemptId, live] of this.live) {
      this.pendingReconciliation.add(attemptId)
      void live.lease.pause().catch(() => {
        if (this.live.get(attemptId) === live) this.failure = 'uncertain'
      })
    }
  }
  public async dispatch(input: DeviceDispatch): Promise<DeviceFrame> {
    return await this.ordered(async () => {
      const request = deviceDispatchSchema.parse(input)
      let hasReserved = false
      try {
        if (deviceDispatchDigest(request) !== request.payloadDigest)
          throw new DeviceJournalError('payload-changed')
        const prior = await this.journal.lookup(request.identity)
        if (prior !== undefined) {
          const payload = deviceRecordPayload(prior)
          if (payload !== request.payloadDigest) throw new DeviceJournalError('payload-changed')
          return this.response(prior)
        }
        if (request.identity.receiverIncarnationId !== this.incarnationId || this.isPaused)
          return this.frame(request.identity.pairId, {
            kind: 'failure',
            reason: 'reconcile-required',
          })
        const boundary = this.boundary(request)
        await boundary.beforeAction()
        const lease = await this.execution.admit(request)
        hasReserved = true
        this.live.set(request.identity.attemptId, {
          identity: Object.freeze(request.identity),
          lease,
        })
        // Capacity belongs to M96. Neither durable write can be bypassed by a retry.
        await this.journal.admit(request, lease.usage, Date.now())
        // Attach the local retirement observer before the only start operation.
        void (async () => {
          let result: Awaited<DeviceLocalAttempt['retirement']>
          try {
            result = await lease.retirement
          } catch {
            await this.markUncertain(request.identity)
            return
          }
          await this.ordered(async () => {
            await this.journal.advance(
              request.identity,
              (previous) => ({
                ...previous,
                revision: previous.revision + 1,
                state: 'retired',
                occupied: {
                  workers: 0,
                  processes: 0,
                  heavyChecks: 0,
                  tokens: 0,
                  spendUsd: 0,
                  artifactBytes: 0,
                },
                usage: result.usage,
                ...(result.artifact !== undefined && { artifact: result.artifact }),
              }),
              Date.now(),
            )
            await lease.release()
            this.live.delete(request.identity.attemptId)
            if (this.failure === 'uncertain' && this.live.size === 0) this.failure = undefined
          })
        })().catch(() => {
          this.isPaused = true
          this.failure = 'storage'
        })
        await boundary.beforeAction()
        await this.journal.advance(
          request.identity,
          (previous) => ({ ...previous, revision: previous.revision + 1, state: 'launch-intent' }),
          Date.now(),
        )
        await boundary.beforeAction()
        await lease.start(boundary)
        const outcome = await this.journal.advance(
          request.identity,
          (previous) => ({ ...previous, revision: previous.revision + 1, state: 'running' }),
          Date.now(),
        )
        return this.frame(request.identity.pairId, { kind: 'outcome', outcome })
      } catch (error) {
        const reportedReason =
          error instanceof DeviceJournalError || error instanceof DevicePairingError
            ? error.reason
            : 'uncertain'
        // A late refusal cannot claim that no admission/reservation happened.
        const reason = hasReserved && reportedReason !== 'storage' ? 'uncertain' : reportedReason
        if (reason === 'storage' || reason === 'uncertain') {
          this.isPaused = true
          this.failure = reason
          if (hasReserved) this.pendingReconciliation.add(request.identity.attemptId)
        }
        return this.frame(request.identity.pairId, { kind: 'failure', reason })
      }
    })
  }
  public async reconcile(
    identities: readonly DeviceAttemptIdentity[],
  ): Promise<readonly DeviceFrame[]> {
    // Parse even injected callers; frame schema binds pair and bounds each page.
    const first = identities[0]
    if (first === undefined) throw new DevicePairingError('invalid-frame')
    this.frame(first.pairId, { kind: 'reconcile', identities: [...identities] })
    return await this.ordered(async () => {
      const frames: DeviceFrame[] = []
      for (const identity of identities) {
        const record = await this.journal.lookup(identity)
        frames.push(
          record === undefined
            ? this.frame(identity.pairId, { kind: 'failure', reason: 'uncertain' })
            : this.response(record),
        )
        this.pendingReconciliation.delete(identity.attemptId)
      }
      return frames
    })
  }
  public async cancel(identity: DeviceAttemptIdentity): Promise<void> {
    if (identity.receiverIncarnationId !== this.incarnationId)
      throw new DeviceJournalError('uncertain')
    this.frame(identity.pairId, { kind: 'cancel', identity })
    const live = this.live.get(identity.attemptId)
    if (live === undefined) {
      const row = await this.journal.lookup(identity)
      if (row?.kind !== 'receiver-record') throw new DeviceJournalError('uncertain')
      return
    }
    if (
      live.identity.pairId !== identity.pairId ||
      live.identity.receiverIncarnationId !== identity.receiverIncarnationId ||
      live.identity.boardId !== identity.boardId ||
      live.identity.taskId !== identity.taskId ||
      live.identity.attemptId !== identity.attemptId
    )
      throw new DeviceJournalError('payload-changed')
    // Stop reaches the local owner even when persistence is broken or stalled.
    await live.lease.cancel()
    try {
      await this.journal.advance(
        live.identity,
        (previous) => ({ ...previous, revision: previous.revision + 1, state: 'uncertain' }),
        Date.now(),
      )
    } catch (error) {
      this.isPaused = true
      this.failure = error instanceof DeviceJournalError ? error.reason : 'uncertain'
      this.pendingReconciliation.add(identity.attemptId)
      throw error
    }
    // A cancellation acknowledgement never writes terminal state or releases capacity.
  }
  /** Called only by T after pinned mutual authentication/current-pair validation. */
  public async receive(input: DeviceFrame, channel: DeviceChannel): Promise<void> {
    const frame = deviceFrameSchema.parse(input)
    if (
      !channel.isReceiver ||
      frame.pairId !== channel.pairId ||
      frame.receiverIncarnationId !== this.incarnationId ||
      channel.receiverIncarnationId !== this.incarnationId
    )
      throw new DevicePairingError('invalid-frame')
    const reply = (response: DeviceFrame) => {
      channel.send({ ...response, requestId: frame.requestId })
    }
    switch (frame.body.kind) {
      case 'dispatch': {
        reply(await this.dispatch(frame.body.dispatch))
        return
      }
      case 'reconcile': {
        const responses = await this.reconcile(frame.body.identities)
        for (const response of responses) reply(response)
        return
      }
      case 'acknowledge': {
        const body = frame.body
        await this.journal.acknowledge(body.identity, body.payloadDigest, body.settlementId)
        const responses = await this.reconcile([body.identity])
        for (const response of responses) reply(response)
        return
      }
      case 'cancel': {
        await this.cancel(frame.body.identity)
        return
      }
      default: {
        reply(this.frame(frame.pairId, { kind: 'failure', reason: 'invalid-frame' }))
      }
    }
  }
}
