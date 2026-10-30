// M100's receiver adapts the local M96 owner; it does not schedule or infer exit.
import { randomBytes } from 'node:crypto'
import type { Logger } from '../logger'
import { failureForLog } from '../../core/backends/musecode/logText'
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
import { DEVICE_LIMITS, UI_TEXT } from '../../shared/constants'
import {
  deviceDispatchSchema,
  isSameAttempt,
  deviceFrameSchema,
  type DeviceGrantRequest,
  type DeviceGrantRefusal,
  type DEVICE_FAILURES,
  type DeviceAttemptIdentity,
  type DeviceDispatch,
  type DeviceExecutionPort,
  type DeviceFrame,
  type DeviceJournalRecord,
} from '../../shared/devices'
import type { DeviceActionGrants } from '../../core/devices/actionGrants'
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
  /**
  Resolves only after requests AND all admitted tool/descendant processes settle. `refused`
  says the worker never ran and nothing remains allocated (never launched, or the driver
  proved its unactivated attempt reclaimed): journaled `refused`, never `retired` work. A
  start that fails while this is pending is journaled `uncertain` with its occupancy.
  A capacity result proves whole-membership exit, with usage and localized recovery prose.
  */
  readonly retirement: Promise<
    | { usage: DeviceOutcome['usage']; artifact?: DeviceOutcome['artifact'] }
    | { refused: true; usage: DeviceOutcome['usage'] }
    | {
        failure: 'capacity'
        wholeMembershipExited: true
        usage: DeviceOutcome['usage']
        message: string
      }
  >
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
  /** Spend a bound step-up after start succeeds, or on any terminal admission path. */
  finishAdmission?(request: DeviceDispatch): void
  readonly paidGate: Pick<PaidFeatureGate, 'isOn'>
  readonly paidConsent: Pick<PaidUseConsent, 'allows'>
  /** M95 binds current local model, tariff, key owner and reservation; no peer credentials. */
  assertPaidBinding(request: DeviceDispatch, use: PaidUseRequest): Promise<void>
}
/** W binds its authenticated owner/request resolver here after K's validity check. */
export function bindDeviceReceiverActionGrants(
  policy: DeviceReceiverPolicy,
  grants: Pick<DeviceActionGrants, 'admitAttempt' | 'finishAttempt'>,
  requestFor: (request: DeviceDispatch) => DeviceGrantRequest,
): DeviceReceiverPolicy {
  return {
    ...policy,
    async assertAllowed(request) {
      const result = await grants.admitAttempt(requestFor(request), request)
      if ('reason' in result) throw new DeviceActionGrantError(result)
      await policy.assertAllowed(request)
    },
    finishAdmission(request) {
      grants.finishAttempt(request)
      policy.finishAdmission?.(request)
    },
  }
}
function isTypedDeviceFailure(error: unknown): error is DeviceJournalError | DevicePairingError {
  return error instanceof DeviceJournalError || error instanceof DevicePairingError
}

export class DeviceActionGrantError extends DevicePairingError {
  public constructor(
    public readonly refusal: DeviceGrantRefusal,
    options?: { cause?: unknown },
  ) {
    super('grant', options)
  }
}
interface PendingAttempt {
  readonly identity: DeviceAttemptIdentity
  readonly control: AbortController
}
interface LiveAttempt extends PendingAttempt {
  readonly lease: DeviceLocalAttempt
  phase: 'reserved' | 'active' | 'retiring'
}
type ReceiverEvent =
  | { kind: 'dispatch'; pending: PendingAttempt }
  | { kind: 'dispatch-finished'; pending: PendingAttempt }
  | { kind: 'reserved' | 'admitted'; live: LiveAttempt }
  | { kind: 'cancel'; identity: DeviceAttemptIdentity }
  | { kind: 'cancel-confirmed'; live: LiveAttempt }
  | { kind: 'cancel-failed'; live: LiveAttempt; error: unknown }
  | {
      kind: 'retirement-observed'
      live: LiveAttempt
      result: Awaited<DeviceLocalAttempt['retirement']>
    }
  | { kind: 'retired'; live: LiveAttempt }
  | { kind: 'failed'; reason: Failure; live?: LiveAttempt }
type ReceiverEffect =
  | { kind: 'abort'; control: AbortController }
  | { kind: 'cancel' | 'record-uncertain'; live: LiveAttempt }
  | { kind: 'remember-cancel'; identity: DeviceAttemptIdentity; live?: LiveAttempt }
  | { kind: 'retire'; live: LiveAttempt; result: Awaited<DeviceLocalAttempt['retirement']> }
  | { kind: 'report'; error: unknown }

export class DeviceReceiver implements DeviceExecutionPort {
  public static async open(
    incarnationId: string,
    journal: AttemptJournal,
    execution: DeviceReceiverExecution,
    policy: DeviceReceiverPolicy,
    log: Logger,
  ): Promise<DeviceReceiver> {
    if (!/^[a-f0-9]{32}$(?![\s\S])/.test(incarnationId)) throw new DeviceJournalError('storage')
    const receiver = new DeviceReceiver(incarnationId, journal, execution, policy, log)
    const cancellations = await journal.cancellations()
    for (const identity of cancellations)
      receiver.cancelled.set(identity.attemptId, Object.freeze(identity))
    const records = await journal.records()
    // Retention restores recorded occupancy, write sets and liabilities. An
    // empty journal has none, so it never asks the execution owner: a host
    // whose execution is not bound yet (lane K) still opens, pairs and
    // refuses each execution use on its own.
    if (records.length > 0) await execution.retain(records)
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
  private readonly live = new Map<string, LiveAttempt>()
  private readonly pending = new Set<PendingAttempt>()
  // M100-E-CANCEL-RETENTION: receiver lifetime in memory, permanent in its journal.
  private readonly cancelled = new Map<string, DeviceAttemptIdentity>()
  private readonly pendingReconciliation = new Set<string>()
  private constructor(
    private readonly incarnationId: string,
    private readonly journal: AttemptJournal,
    private readonly execution: DeviceReceiverExecution,
    private readonly policy: DeviceReceiverPolicy,
    private readonly log: Logger,
  ) {}
  private owns(live: LiveAttempt): boolean {
    return this.live.get(live.identity.attemptId) === live && live.phase !== 'retiring'
  }
  /** One synchronous owner changes state; awaited effects return tagged generation events. */
  private transition(event: ReceiverEvent): ReceiverEffect[] {
    switch (event.kind) {
      case 'dispatch': {
        const stopped = this.cancelled.get(event.pending.identity.attemptId)
        if (stopped !== undefined) {
          if (!isSameAttempt(stopped, event.pending.identity))
            throw new DeviceJournalError('payload-changed')
          if (this.failure === 'storage') throw new DeviceJournalError('storage')
          throw new DevicePairingError('grant')
        }
        this.pending.add(event.pending)
        return []
      }
      case 'dispatch-finished': {
        this.pending.delete(event.pending)
        return []
      }
      case 'reserved': {
        this.live.set(event.live.identity.attemptId, event.live)
        return event.live.control.signal.aborted ? [{ kind: 'cancel', live: event.live }] : []
      }
      case 'admitted': {
        if (this.owns(event.live)) event.live.phase = 'active'
        return []
      }
      case 'cancel': {
        const live = this.live.get(event.identity.attemptId)
        const pending = [...this.pending].filter(
          (row) => row.identity.attemptId === event.identity.attemptId,
        )
        const original =
          live?.identity ?? pending[0]?.identity ?? this.cancelled.get(event.identity.attemptId)
        if (original !== undefined && !isSameAttempt(original, event.identity))
          throw new DeviceJournalError('payload-changed')
        const effects: ReceiverEffect[] = []
        // Identity is remembered before aborts, local cancellation or journal effects.
        this.cancelled.set(event.identity.attemptId, Object.freeze(event.identity))
        for (const row of pending) effects.push({ kind: 'abort', control: row.control })
        if (live !== undefined) {
          effects.push({ kind: 'abort', control: live.control }, { kind: 'cancel', live })
        }
        effects.push({
          kind: 'remember-cancel',
          identity: event.identity,
          ...(live !== undefined && { live }),
        })
        return effects
      }
      case 'cancel-failed': {
        if (!this.owns(event.live)) return []
        this.transition({
          kind: 'failed',
          reason: event.error instanceof DeviceJournalError ? event.error.reason : 'uncertain',
          live: event.live,
        })
        return [{ kind: 'report', error: event.error }]
      }
      case 'cancel-confirmed': {
        if (!this.owns(event.live)) return []
        return event.live.phase === 'reserved'
          ? []
          : [{ kind: 'record-uncertain', live: event.live }]
      }
      case 'retirement-observed': {
        if (this.live.get(event.live.identity.attemptId) !== event.live) return []
        event.live.phase = 'retiring'
        return [
          { kind: 'abort', control: event.live.control },
          { kind: 'retire', live: event.live, result: event.result },
        ]
      }
      case 'retired': {
        if (this.live.get(event.live.identity.attemptId) !== event.live) return []
        this.live.delete(event.live.identity.attemptId)
        if (this.failure === 'uncertain' && this.live.size === 0) this.failure = undefined
        return []
      }
      case 'failed': {
        if (event.live !== undefined && this.live.get(event.live.identity.attemptId) !== event.live)
          return []
        this.isPaused = true
        // Exhausted cancellation evidence and failed storage remain latched.
        if (
          event.reason === 'storage' ||
          (this.failure !== 'storage' && this.failure !== 'capacity')
        )
          this.failure = event.reason
        if (event.live !== undefined) this.pendingReconciliation.add(event.live.identity.attemptId)
        return []
      }
    }
  }
  private async effects(effects: readonly ReceiverEffect[]): Promise<void> {
    // Start all effects synchronously: neither persistence nor confirmation gates Stop.
    await Promise.all(
      effects.map(async (effect) => {
        switch (effect.kind) {
          case 'abort': {
            effect.control.abort()
            return
          }
          case 'report': {
            throw effect.error
          }
          case 'cancel': {
            let confirmation: ReceiverEvent
            try {
              await effect.live.lease.cancel()
              confirmation = { kind: 'cancel-confirmed', live: effect.live }
            } catch (error) {
              this.log.warn(`Devices cancel failed: ${failureForLog(error)}`)
              confirmation = { kind: 'cancel-failed', live: effect.live, error }
            }
            await this.effects(this.transition(confirmation))
            return
          }
          case 'remember-cancel': {
            try {
              await this.journal.recordCancellation(effect.identity)
            } catch (error) {
              if (effect.live !== undefined && !this.owns(effect.live)) {
                this.log.warn(`Devices stale effect failed: ${failureForLog(error)}`)
                return
              }
              if (error instanceof DeviceJournalError && error.reason !== 'payload-changed')
                this.transition({
                  kind: 'failed',
                  reason: error.reason,
                  ...(effect.live !== undefined && { live: effect.live }),
                })
              throw error
            }
            return
          }
          case 'retire': {
            await this.ordered(async () => {
              if (this.live.get(effect.live.identity.attemptId) !== effect.live) return
              try {
                const { result } = effect
                await this.journal.advance(
                  effect.live.identity,
                  (previous) => ({
                    ...previous,
                    revision: previous.revision + 1,
                    // Work that never started is released as not-run, never as completed.
                    state: 'refused' in result ? 'refused' : 'retired',
                    occupied: {
                      workers: 0,
                      processes: 0,
                      heavyChecks: 0,
                      tokens: 0,
                      spendUsd: 0,
                      artifactBytes: 0,
                    },
                    usage: result.usage,
                    ...('failure' in result && { failure: result.failure }),
                    ...('artifact' in result &&
                      result.artifact !== undefined && { artifact: result.artifact }),
                  }),
                  Date.now(),
                )
                await effect.live.lease.release()
                this.transition({ kind: 'retired', live: effect.live })
              } catch (error) {
                this.transition({ kind: 'failed', reason: 'storage', live: effect.live })
                throw error
              }
            })
            return
          }
          case 'record-uncertain': {
            await this.ordered(async () => {
              if (!this.owns(effect.live)) return
              try {
                await this.journal.advance(
                  effect.live.identity,
                  (previous) => ({
                    ...previous,
                    revision: previous.revision + 1,
                    state: 'uncertain',
                  }),
                  Date.now(),
                )
              } catch (error) {
                this.transition({
                  kind: 'failed',
                  reason: error instanceof DeviceJournalError ? error.reason : 'uncertain',
                  live: effect.live,
                })
                throw error
              }
            })
            return
          }
        }
      }),
    )
  }
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
  private async waitForControl<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted) throw new DevicePairingError('grant')
    return await new Promise<T>((resolve, reject) => {
      const stop = () => {
        reject(new DevicePairingError('grant'))
      }
      signal.addEventListener('abort', stop, { once: true })
      void (async () => {
        try {
          resolve(await work())
        } catch (error) {
          if (error instanceof DevicePairingError) {
            reject(error)
            return
          }
          this.log.error(`Devices control wait failed: ${failureForLog(error)}`)
          reject(new DevicePairingError('uncertain', { cause: error }))
        } finally {
          signal.removeEventListener('abort', stop)
        }
      })()
    })
  }
  private boundary(request: DeviceDispatch, signal: AbortSignal): DeviceExecutionBoundary {
    const check = () => this.waitForControl(signal, () => this.checkPolicy(request))
    return {
      beforeAction: async () => {
        await check()
        if (!(await this.waitForControl(signal, () => this.policy.approve(request))))
          throw new DevicePairingError('approval-required')
        await check()
      },
      beforePaidUse: async (use) => {
        await check()
        await this.policy.assertPaidBinding(request, use)
        if (
          !this.policy.paidGate.isOn(use.feature) ||
          !(await this.waitForControl(signal, () => this.policy.paidConsent.allows(use)))
        )
          throw new DevicePairingError('paid-consent-required')
        // A popup can yield while trust, price, model or credential ownership changes.
        await check()
        await this.policy.assertPaidBinding(request, use)
        if (signal.aborted) throw new DevicePairingError('grant')
        if (!this.policy.paidGate.isOn(use.feature))
          throw new DevicePairingError('paid-consent-required')
      },
    }
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
  public disconnect(reason: Failure = 'blocked-or-unreachable', pairId?: string): void {
    this.isPaused = true
    if (reason === 'invalid-frame' || reason === 'incompatible') {
      // A framing reset cannot prove a trailing Stop was parseable. Start every
      // local Stop synchronously, independent of persistence and confirmation.
      const identities = new Map<string, DeviceAttemptIdentity>()
      for (const attempt of [...this.live.values(), ...this.pending]) {
        if (
          (pairId === undefined || attempt.identity.pairId === pairId) &&
          !identities.has(attempt.identity.attemptId)
        )
          identities.set(attempt.identity.attemptId, attempt.identity)
      }
      for (const identity of identities.values()) {
        if (this.live.has(identity.attemptId)) this.pendingReconciliation.add(identity.attemptId)
        void this.cancel(identity).catch((error: unknown) => {
          this.log.warn(`Devices reconcile cancel failed: ${failureForLog(error)}`)
          this.transition({
            kind: 'failed',
            reason: error instanceof DeviceJournalError ? error.reason : 'uncertain',
          })
        })
      }
      return
    }
    for (const [attemptId, live] of this.live) {
      if (pairId !== undefined && live.identity.pairId !== pairId) continue
      this.pendingReconciliation.add(attemptId)
      void live.lease.pause().catch((error: unknown) => {
        this.log.warn(`Devices pause failed: ${failureForLog(error)}`)
        this.transition({ kind: 'failed', reason: 'uncertain', live })
      })
    }
  }
  public async dispatch(input: DeviceDispatch): Promise<DeviceFrame> {
    const request = deviceDispatchSchema.parse(input)
    const pending = { identity: Object.freeze(request.identity), control: new AbortController() }
    try {
      this.transition({ kind: 'dispatch', pending })
      return await this.ordered(async () => {
        let hasReserved = false
        let started: LiveAttempt | undefined
        try {
          if (deviceDispatchDigest(request) !== request.payloadDigest)
            throw new DeviceJournalError('payload-changed')
          const prior = await this.waitForControl(pending.control.signal, () =>
            this.journal.lookup(request.identity),
          )
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
          const boundary = this.boundary(request, pending.control.signal)
          await boundary.beforeAction()
          const lease = await this.execution.admit(request)
          hasReserved = true
          const live: LiveAttempt = { ...pending, lease, phase: 'reserved' }
          const reservationEffects = this.transition({ kind: 'reserved', live })
          // Attach the local retirement observer before the only start operation.
          void (async () => {
            let result: Awaited<DeviceLocalAttempt['retirement']>
            try {
              result = await lease.retirement
            } catch (error) {
              this.log.error(`Devices retirement failed: ${failureForLog(error)}`)
              this.transition({ kind: 'failed', reason: 'uncertain', live })
              await this.effects([{ kind: 'record-uncertain', live }])
              return
            }
            await this.effects(this.transition({ kind: 'retirement-observed', live, result }))
          })().catch((error: unknown) => {
            this.log.error(`Devices retirement observation failed: ${failureForLog(error)}`)
            this.transition({ kind: 'failed', reason: 'storage', live })
          })
          // Journal the late reservation without waiting for Stop confirmation.
          void this.effects(reservationEffects).catch((error: unknown) => {
            this.log.error(`Devices reservation failed: ${failureForLog(error)}`)
            this.transition({
              kind: 'failed',
              reason: error instanceof DeviceJournalError ? error.reason : 'uncertain',
              live,
            })
          })
          // Capacity belongs to M96. Neither durable write can be bypassed by a retry.
          await this.journal.admit(request, lease.usage, Date.now())
          this.transition({ kind: 'admitted', live })
          await boundary.beforeAction()
          await this.journal.advance(
            request.identity,
            (previous) => ({
              ...previous,
              revision: previous.revision + 1,
              state: 'launch-intent',
            }),
            Date.now(),
          )
          await boundary.beforeAction()
          await this.waitForControl(pending.control.signal, async () => {
            try {
              await lease.start(boundary)
            } catch (error) {
              started = live
              throw error
            }
          })
          // Start owns a final policy boundary; keep this attempt attested through it.
          this.policy.finishAdmission?.(request)
          const outcome = await this.journal.advance(
            request.identity,
            (previous) => ({ ...previous, revision: previous.revision + 1, state: 'running' }),
            Date.now(),
          )
          return this.frame(request.identity.pairId, { kind: 'outcome', outcome })
        } catch (error) {
          let reportedReason: DeviceJournalError['reason'] | DevicePairingError['reason']
          if (isTypedDeviceFailure(error)) reportedReason = error.reason
          else throw error
          // A late refusal cannot claim that no admission/reservation happened.
          const reason = hasReserved && reportedReason !== 'storage' ? 'uncertain' : reportedReason
          if (reason === 'storage' || reason === 'uncertain') {
            this.transition({ kind: 'failed', reason })
            if (hasReserved) this.pendingReconciliation.add(request.identity.attemptId)
          }
          // A failed start proves nothing; occupancy stays until retirement settles it. Queued
          // after this dispatch: an already observed retirement is journaled first and wins.
          if (started !== undefined)
            void this.effects([{ kind: 'record-uncertain', live: started }]).catch(
              (effectError: unknown) => {
                this.log.error(`Devices record-uncertain failed: ${failureForLog(effectError)}`)
              },
            )
          return this.frame(request.identity.pairId, { kind: 'failure', reason })
        } finally {
          this.policy.finishAdmission?.(request)
        }
      })
    } catch (error) {
      if (isTypedDeviceFailure(error))
        return this.frame(request.identity.pairId, { kind: 'failure', reason: error.reason })
      throw error
    } finally {
      this.transition({ kind: 'dispatch-finished', pending })
    }
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
    await this.effects(this.transition({ kind: 'cancel', identity }))
    // A cancellation acknowledgement never retires or releases occupancy.
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
        try {
          await this.cancel(frame.body.identity)
        } catch (error) {
          if (isTypedDeviceFailure(error))
            reply(this.frame(frame.pairId, { kind: 'failure', reason: error.reason }))
          else {
            this.log.error(`Devices cancel failed: ${failureForLog(error)}`)
            reply(this.frame(frame.pairId, { kind: 'failure', reason: 'uncertain' }))
          }
        }
        return
      }
      default: {
        reply(this.frame(frame.pairId, { kind: 'failure', reason: 'invalid-frame' }))
      }
    }
  }
}

// M108 D's receiver admission is shared by native bridges and runtime hosts.
// No vscode import or transport implementation belongs in this fragment.
import {
  AccountPoolStoppedError,
  type AccountPool,
  type AccountPoolRequest,
} from '../../core/accounts/pool'
import type { AccountPolicyDecision } from '../../core/accounts/policyGate'
import {
  deviceAccountRequestSchema,
  type DeviceAccountRequest,
  type DeviceAccountClaim,
} from '../../core/team/remotePool'
import { accountHeadroomSchema, deviceAccountHeadroomSchema } from '../../shared/devices'
import type { Usd } from '../../shared/accountUsd'

export class DeviceAccountAdmissionError extends Error {
  public readonly code: 'recovery' | 'cancel' | 'ownCapsOnly' | 'routeUnavailable'
  public constructor(public readonly decision?: AccountPolicyDecision) {
    let code: DeviceAccountAdmissionError['code'] = 'routeUnavailable'
    if (decision?.kind === 'recovery') code = 'recovery'
    else if (
      decision?.kind === 'stop' &&
      (decision.reason === 'cancel' || decision.reason === 'ownCapsOnly')
    )
      code = decision.reason
    let message = UI_TEXT.accounts.routeUnavailable
    if (decision?.kind === 'recovery')
      message =
        decision.recovery === 'chatgptPlan'
          ? UI_TEXT.accounts.chatgptRecovery
          : UI_TEXT.accounts.museCodeRecovery
    else if (code === 'cancel' || code === 'ownCapsOnly') message = UI_TEXT.accounts[code]
    super(message)
    this.code = code
    this.name = 'DeviceAccountAdmissionError'
  }
}

export interface DeviceAccountReceiverDeps {
  readonly providers: () => readonly string[]
  /** The existing local provider owner; admission and journal are shared with local sends. */
  readonly pool: (provider: string) => AccountPool | undefined
  /** Receiver's selected model and projection for its provider offer. */
  readonly offerRequest: (provider: string) => AccountPoolRequest
  readonly isPinnedHere: (provider: string, account: string) => boolean
  /** Capture the local placement owner's generation, including away/back changes. */
  readonly placementFence: () => Promise<() => void>
  /** Authoritative per-account/model capacity, including reservations and Retry-After. */
  readonly headroom: (provider: string, account: string) => unknown
  /** Receiver consent, permissions, lease and governor; never sender approvals. */
  readonly admit: (request: DeviceAccountRequest) => Promise<DeviceAccountClaim | undefined>
  /** Build from the receiver's local session, mode, flags, verified tariff/model
  and budgets. No sender account, interaction flag or price is accepted. */
  readonly request: (request: DeviceAccountRequest) => AccountPoolRequest
}

export class DeviceAccountReceiver {
  public constructor(private readonly deps: DeviceAccountReceiverDeps) {}

  private bucket(
    provider: string,
    pool: AccountPool | undefined,
    request: AccountPoolRequest,
  ): 'ample' | 'some' | 'none' {
    const source = pool?.deps
    const policy = source?.policy()
    let bucket: 'ample' | 'some' | 'none' = 'none'
    if (
      source !== undefined &&
      policy?.isCredentialHeld === true &&
      policy.pooling !== 'notOffered'
    ) {
      for (const account of source.accounts()) {
        if (
          !this.deps.isPinnedHere(provider, account.id) ||
          pool?.hasRoom(account, request) !== true
        )
          continue
        const headroom = accountHeadroomSchema.parse(this.deps.headroom(provider, account.id))
        if (headroom === 'ample' || (headroom === 'some' && bucket === 'none')) bucket = headroom
      }
    }
    return bucket
  }

  public offer(): Readonly<Record<string, 'ample' | 'some' | 'none'>> {
    const buckets = this.deps
      .providers()
      .map((provider) => [
        provider,
        this.bucket(provider, this.deps.pool(provider), this.deps.offerRequest(provider)),
      ])
    return deviceAccountHeadroomSchema.parse(Object.fromEntries(buckets))
  }

  public async receive<T>(
    raw: unknown,
    dispatch: (admission: {
      readonly account: string
      readonly estimate: AccountPoolRequest['estimate']
      readonly check: () => void
      readonly beforeSend: () => void
    }) => Promise<{ readonly value: T; readonly actualUsd: Usd | null }>,
  ): Promise<T> {
    const fragment = Object.freeze(deviceAccountRequestSchema.parse(raw))
    if (fragment.trigger !== undefined) Object.freeze(fragment.trigger)
    const checkPlacement = await this.deps.placementFence()
    const pool = this.deps.pool(fragment.provider)
    if (pool?.deps.provider !== fragment.provider) throw new DeviceAccountAdmissionError()
    const source = pool.deps
    const local = this.deps.request(fragment)
    const request = Object.freeze({ ...local, estimate: Object.freeze({ ...local.estimate }) })
    if (request.modelId !== fragment.modelId) throw new DeviceAccountAdmissionError()
    const claim = await this.deps.admit(fragment)
    if (claim === undefined) throw new DeviceAccountAdmissionError()
    let outcome: 'notSent' | 'returned' | 'uncertain' = 'notSent'
    const hasSent = () => outcome !== 'notSent'
    try {
      // Routing at a sender's vendor limit still needs THIS machine's decision,
      // even when the receiver's current account itself has ample room.
      const decision = await source.gate.authorize({
        policy: source.policy,
        ...(fragment.trigger !== undefined && { trigger: fragment.trigger }),
        isInteractive: request.isInteractive,
        hasOfferedRecovery: request.hasOfferedRecovery === true,
      })
      if (decision.kind !== 'allow') throw new DeviceAccountAdmissionError(decision)
      const check = () => {
        checkPlacement()
        if (this.deps.pool(fragment.provider) !== pool || !decision.isCurrent(source.policy()))
          throw new DeviceAccountAdmissionError()
        claim.check()
      }
      check()
      const result = await pool.run(
        request,
        async (admission) => {
          const beforeSend = () => {
            check()
            admission.beforeSend()
            outcome = 'uncertain'
          }
          return await dispatch({
            ...admission,
            check: () => {
              check()
              admission.check()
            },
            beforeSend,
          })
        },
        (account) => {
          // Both sides recompute every call: the reservation between select
          // and check legitimately moves headroom, so a cached provider
          // bucket would refuse an admission whose own reservation crossed
          // the ample/some cut. With one account the two always agree; with
          // several, an account that genuinely left the best bucket refuses
          // loudly instead of sneaking in for another (no G4).
          const bucket = this.bucket(fragment.provider, pool, request)
          return (
            bucket !== 'none' &&
            this.deps.isPinnedHere(fragment.provider, account.id) &&
            source.canUseModel(account, request) &&
            accountHeadroomSchema.parse(this.deps.headroom(fragment.provider, account.id)) ===
              bucket
          )
        },
      )
      if (!hasSent()) throw new DeviceAccountAdmissionError()
      outcome = 'returned'
      return result
    } catch (error) {
      if (error instanceof AccountPoolStoppedError && error.decision !== undefined)
        throw new DeviceAccountAdmissionError(error.decision)
      throw error
    } finally {
      await claim.finish(outcome)
    }
  }
}
