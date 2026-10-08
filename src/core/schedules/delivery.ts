import { Usd } from '../../shared/usd'
import { isSteerRefusedError } from '../agent/agentBackend'
import { UI_TEXT } from '../../shared/constants'
import { scheduleEventSchema, type ScheduleEvent } from '../../shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
  scheduleRunContextSchema,
  scheduleV2Schema,
  type ScheduleDeliveryResult,
  type ScheduleDeliveryState,
  type ScheduleHostPort,
  type ScheduleRunContext,
  type ScheduleSessionPort,
  type ScheduleV2,
} from '../../shared/scheduleV2'

export interface ScheduleDeliverySession extends ScheduleSessionPort {
  /** False if the target closes. Abort only withdraws a scheduler-held fire. */
  waitUntilIdle(signal: AbortSignal): Promise<boolean>
  /** Atomically enqueue after existing user turns. Undefined proves Skip won
   * before backend dispatch; the signal also fences asynchronous admission. */
  queueWhenIdle(
    prompt: string,
    context: ScheduleRunContext,
    signal: AbortSignal,
  ): Promise<string | undefined>
}

export interface ScheduleTargetLease {
  readonly session: ScheduleDeliverySession
  /** Release background ownership after final settlement; never closes a panel. */
  release(): Promise<void>
}

export interface ScheduleConversationTargets {
  find(schedule: ScheduleV2): Promise<ScheduleTargetLease | undefined>
  open(schedule: ScheduleV2): Promise<ScheduleTargetLease>
  fresh(schedule: ScheduleV2, occurrenceMs: number): Promise<ScheduleTargetLease>
}

export type ScheduleRunSettlement = Pick<
  ScheduleDeliveryResult,
  'outcome' | 'reason' | 'refusedActions' | 'cost'
>

/** U binds context before dispatch and retains facts by run id, including
 * withdrawal and failures after admission. An admission ack is not settlement.
 * No implementation may infer a free success from turnCompleted alone. */
export interface ScheduleDeliveryRuns {
  run(
    session: ScheduleSessionPort,
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    dispatch: () => Promise<void>,
  ): Promise<ScheduleRunSettlement>
}

/** M96c admits role/team tasks under the charter; G/M110 bind workers/nodes.
 * RA binds reports. All return complete final settlements, never task admission. */
export interface ScheduleExternalDelivery {
  deliver: ScheduleHostPort['deliver']
}

export interface ScheduleDeliveryDeps {
  now(): number
  monotonicNow(): number
  holds(workspaceKey: string): boolean
  readonly targets: ScheduleConversationTargets
  readonly runs: ScheduleDeliveryRuns
  /** E's fenced event data and U's unattended note belong in the user message. */
  prompt(schedule: ScheduleV2, event?: ScheduleEvent): string
  readonly board?: ScheduleExternalDelivery
  readonly reports?: ScheduleExternalDelivery
}

/** Parsed records contain JSON values; sort every object's keys, preserving arrays. */
function canonicalRecord(record: ScheduleDeliveryResult): string {
  return JSON.stringify(record, (_key: string, value: unknown): unknown => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const fields: Record<string, unknown> = { ...value }
      return Object.fromEntries(
        Object.keys(fields)
          .toSorted((left, right) => (left < right ? -1 : Number(left > right)))
          .map((key) => [key, fields[key]]),
      )
    }
    return value
  })
}

/** Shared by editors and runtime. S owns claims, catch-up selection and ordering. */
export class ScheduleDelivery implements ScheduleHostPort {
  private readonly held = new Map<
    string,
    {
      readonly abort: AbortController
      withdrawal?: Promise<boolean | { readonly error: unknown }>
    }
  >()
  private readonly queued = new Map<string, { session: ScheduleSessionPort; messageId: string }>()
  /** In-memory run ledger for S's scheduler: admitted at dispatch, settled at
   * final settlement. S's store owns durability across processes; a throw
   * keeps the admitted marker (like the fake host) so a concurrent duplicate
   * refuses instead of refiring while the target still owns recovery. This
   * host never reports uncertain: lost-response ambiguity is settled by S's
   * outbox reconciliation, never guessed here. */
  private readonly ledger = new Map<string, ScheduleDeliveryState>()

  constructor(private readonly deps: ScheduleDeliveryDeps) {}

  private validate(schedule: ScheduleV2, context: ScheduleRunContext): void {
    scheduleV2Schema.parse(schedule)
    const parsed = scheduleRunContextSchema.parse(context)
    const expected = scheduleRunContextSchema.parse({
      unattended: true,
      scheduleId: schedule.id,
      runId: context.runId,
      grant: schedule.grant,
      creator: schedule.creator,
      mode: schedule.mode,
      depth: schedule.depth,
      allowAgentReschedule: schedule.allowAgentReschedule,
    })
    if (JSON.stringify(parsed) !== JSON.stringify(expected))
      throw new Error(UI_TEXT.scheduleInvalid)
  }

  private record(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event: ScheduleEvent | undefined,
    settlement: ScheduleRunSettlement,
  ): ScheduleDeliveryResult {
    return scheduleFireRecordSchema.parse({
      ...settlement,
      runId: context.runId,
      scheduleId: schedule.id,
      workspaceKey: schedule.workspaceKey,
      occurrenceMs,
      observedAtMs: this.now(),
      target: schedule.target,
      delivery: schedule.delivery,
      ...(event !== undefined && { event }),
    })
  }
  private async dispatch(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event: ScheduleEvent | undefined,
  ): Promise<ScheduleDeliveryResult> {
    // Validate occurrence and event before a target is opened or a prompt is built.
    const notSent: ScheduleRunSettlement = {
      outcome: 'missed',
      reason: UI_TEXT.scheduleV2.messages.targetClosed,
      refusedActions: [],
      cost: {
        usd: Usd.from(0).toAmount(),
        certainty: 'exact',
        retainedLiabilityUsd: Usd.from(0).toAmount(),
      },
    }
    this.record(schedule, context, occurrenceMs, event, notSent)
    if (!this.holds(schedule.workspaceKey)) {
      return this.record(schedule, context, occurrenceMs, event, notSent)
    }
    if (
      schedule.action.kind === 'report' ||
      (schedule.target.kind !== 'conversation' && schedule.target.kind !== 'newConversation')
    ) {
      const external = schedule.action.kind === 'report' ? this.deps.reports : this.deps.board
      if (external === undefined) {
        return this.record(schedule, context, occurrenceMs, event, {
          ...notSent,
          outcome: 'refused',
          reason: UI_TEXT.scheduleV2.messages.targetUnavailable,
        })
      }
      const result = scheduleFireRecordSchema.parse(
        await external.deliver(schedule, context, occurrenceMs, event),
      )
      const expected = this.record(schedule, context, occurrenceMs, event, {
        outcome: result.outcome,
        reason: result.reason,
        refusedActions: result.refusedActions,
        cost: result.cost,
      })
      if (
        canonicalRecord({ ...result, observedAtMs: expected.observedAtMs }) !==
        canonicalRecord(expected)
      ) {
        throw new Error(UI_TEXT.scheduleInvalid)
      }
      return result
    }
    let lease: ScheduleTargetLease | undefined
    try {
      if (schedule.delivery === 'newConversation') {
        lease = await this.deps.targets.fresh(schedule, occurrenceMs)
      } else {
        lease = await this.deps.targets.find(schedule)
        if (lease?.session.isOpen() !== true) {
          await lease?.release()
          lease = undefined
          if (schedule.whenClosed === 'skip') {
            return this.record(schedule, context, occurrenceMs, event, notSent)
          }
          lease = await this.deps.targets.open(schedule)
        }
      }
    } catch {
      return this.record(schedule, context, occurrenceMs, event, {
        ...notSent,
        outcome: 'failed',
        reason: UI_TEXT.scheduleCommandFailed,
      })
    }
    const { session } = lease
    const held = schedule.delivery === 'whenIdle' ? { abort: new AbortController() } : undefined
    try {
      if (
        session.backend !== schedule.target.backend ||
        (schedule.delivery !== 'newConversation' &&
          schedule.target.kind === 'conversation' &&
          session.sessionId !== schedule.target.sessionId)
      ) {
        throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
      }
      if (!session.isOpen()) return this.record(schedule, context, occurrenceMs, event, notSent)
      if (held !== undefined) {
        if (this.held.has(context.runId)) throw new Error(UI_TEXT.scheduleAlreadyRun)
        this.held.set(context.runId, held)
      }
      if (!this.holds(schedule.workspaceKey) || !session.isOpen()) {
        return this.record(schedule, context, occurrenceMs, event, notSent)
      }
      const prompt = this.deps.prompt(schedule, event)
      const settlement = await this.deps.runs.run(session, schedule, context, async () => {
        if (!this.holds(schedule.workspaceKey) || !session.isOpen()) {
          throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
        }
        switch (schedule.delivery) {
          case 'steer': {
            if (session.isRunning()) {
              try {
                await session.steer(prompt, context)
                return
              } catch (error: unknown) {
                // Only a definite no-input refusal permits a new submission.
                if (!isSteerRefusedError(error)) throw error
                if (!this.holds(schedule.workspaceKey) || !session.isOpen()) {
                  throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable, { cause: error })
                }
              }
            }
            await session.send(prompt, context)
            return
          }
          case 'interrupt': {
            if (session.isRunning()) await session.cancel()
            // Stop acknowledges before the aborted turn has always unwound.
            if (!(await session.waitUntilIdle(new AbortController().signal))) {
              throw new Error(UI_TEXT.scheduleV2.messages.targetClosed)
            }
            if (!this.holds(schedule.workspaceKey)) {
              throw new Error(UI_TEXT.scheduleV2.messages.targetUnavailable)
            }
            await session.send(prompt, context)
            return
          }
          case 'queue': {
            const messageId = await session.queue(prompt, context)
            this.queued.set(context.runId, { session, messageId })
            return
          }
          case 'whenIdle': {
            const held = this.held.get(context.runId)
            if (held === undefined) throw new Error(UI_TEXT.scheduleInvalid)
            if (held.abort.signal.aborted) return
            const messageId = await session.queueWhenIdle(prompt, context, held.abort.signal)
            if (messageId === undefined) return
            this.queued.set(context.runId, { session, messageId })
            // Skip may have won while the backend's admission ack was pending.
            if (this.held.get(context.runId)?.abort.signal.aborted === true)
              this.skip(context.runId)
            return
          }
          case 'newConversation': {
            await session.send(prompt, context)
            return
          }
        }
      })
      const withdrawal = await this.held.get(context.runId)?.withdrawal
      if (typeof withdrawal === 'object') throw withdrawal.error
      return this.record(
        schedule,
        context,
        occurrenceMs,
        event,
        held?.abort.signal.aborted === true && !this.queued.has(context.runId)
          ? { ...settlement, outcome: 'missed', reason: notSent.reason }
          : settlement,
      )
    } finally {
      if (held === undefined || this.held.get(context.runId) === held) {
        this.held.delete(context.runId)
        this.queued.delete(context.runId)
      }
      await lease.release()
    }
  }

  now(): number {
    return this.deps.now()
  }
  monotonicNow(): number {
    return this.deps.monotonicNow()
  }
  holds(workspaceKey: string): boolean {
    return this.deps.holds(workspaceKey)
  }

  /** S supplies only the most recent missed occurrence, never a backlog. */
  deliverMissed(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    if (schedule.catchUp === 'runOnce') return this.deliver(schedule, context, occurrenceMs, event)
    this.validate(schedule, context)
    return Promise.resolve(
      this.record(schedule, context, occurrenceMs, event, {
        outcome: 'missed',
        reason: UI_TEXT.scheduleV2.messages.catchUpSkipped,
        refusedActions: [],
        cost: {
          usd: Usd.from(0).toAmount(),
          certainty: 'exact',
          retainedLiabilityUsd: Usd.from(0).toAmount(),
        },
      }),
    )
  }

  /** A held fire can be skipped without stopping the user's running turn. */
  skip(runId: string): boolean {
    const held = this.held.get(runId)
    if (held === undefined) return false
    held.abort.abort()
    const queued = this.queued.get(runId)
    if (queued !== undefined && held.withdrawal === undefined) {
      held.withdrawal = (async () => {
        try {
          return await queued.session.withdraw(queued.messageId)
        } catch (error: unknown) {
          return { error }
        }
      })()
    }
    return true
  }

  /** The composer can withdraw the same backend message, by this run's id. */
  async withdraw(runId: string): Promise<boolean> {
    const queued = this.queued.get(runId)
    return queued !== undefined && (await queued.session.withdraw(queued.messageId))
  }

  lookupRun(runId: string): Promise<ScheduleDeliveryState> {
    return Promise.resolve(this.ledger.get(runId) ?? { status: 'absent' })
  }

  async deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    if (event !== undefined) {
      event = scheduleEventSchema.parse(event)
      // The schema's only nested object is a dictionary of primitive values.
      Object.freeze(event.fields)
      Object.freeze(event)
    }
    schedule = scheduleV2Schema.parse(schedule)
    context = scheduleRunContextSchema.parse(context)
    this.validate(schedule, context)
    const previous = this.ledger.get(context.runId)
    if (previous?.status === 'settled' || previous?.status === 'uncertain') return previous.fire
    if (previous?.status === 'admitted') throw new Error(UI_TEXT.scheduleAlreadyRun)
    this.ledger.set(context.runId, { status: 'admitted' })
    const result = await this.dispatch(schedule, context, occurrenceMs, event)
    this.ledger.set(context.runId, { status: 'settled', fire: result })
    return result
  }
}
