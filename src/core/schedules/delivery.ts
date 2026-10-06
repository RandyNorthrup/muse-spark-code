import { isSteerRefusedError } from '../agent/agentBackend'
import { UI_TEXT } from '../../shared/constants'
import type { ScheduleEvent } from '../../shared/scheduleEvents'
import {
  scheduleFireRecordSchema,
  scheduleRunContextSchema,
  scheduleV2Schema,
  type ScheduleDeliveryResult,
  type ScheduleHostPort,
  type ScheduleRunContext,
  type ScheduleSessionPort,
  type ScheduleV2,
} from '../../shared/scheduleV2'

export interface ScheduleDeliverySession extends ScheduleSessionPort {
  /** False if the target closes. Abort only withdraws a scheduler-held fire. */
  waitUntilIdle(signal: AbortSignal): Promise<boolean>
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

/** Shared by editors and runtime. S owns claims, catch-up selection and ordering. */
export class ScheduleDelivery implements ScheduleHostPort {
  private readonly held = new Map<string, AbortController>()
  private readonly queued = new Map<string, { session: ScheduleSessionPort; messageId: string }>()

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
        cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
      }),
    )
  }

  /** A held fire can be skipped without stopping the user's running turn. */
  skip(runId: string): boolean {
    const held = this.held.get(runId)
    if (held === undefined) return false
    held.abort()
    return true
  }

  /** The composer can withdraw the same backend message, by this run's id. */
  async withdraw(runId: string): Promise<boolean> {
    const queued = this.queued.get(runId)
    return queued !== undefined && (await queued.session.withdraw(queued.messageId))
  }

  async deliver(
    schedule: ScheduleV2,
    context: ScheduleRunContext,
    occurrenceMs: number,
    event?: ScheduleEvent,
  ): Promise<ScheduleDeliveryResult> {
    schedule = scheduleV2Schema.parse(schedule)
    context = scheduleRunContextSchema.parse(context)
    this.validate(schedule, context)
    // Validate occurrence and event before a target is opened or a prompt is built.
    const notSent: ScheduleRunSettlement = {
      outcome: 'missed',
      reason: UI_TEXT.scheduleV2.messages.targetClosed,
      refusedActions: [],
      cost: { usd: 0, certainty: 'exact', retainedLiabilityUsd: 0 },
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
        JSON.stringify({ ...result, observedAtMs: expected.observedAtMs }) !==
        JSON.stringify(expected)
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
      if (schedule.delivery === 'whenIdle' && session.isRunning()) {
        if (this.held.has(context.runId)) throw new Error(UI_TEXT.scheduleAlreadyRun)
        const held = new AbortController()
        this.held.set(context.runId, held)
        try {
          if (!(await session.waitUntilIdle(held.signal)) || held.signal.aborted) {
            return this.record(schedule, context, occurrenceMs, event, notSent)
          }
        } finally {
          this.held.delete(context.runId)
        }
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
          case 'whenIdle':
          case 'newConversation': {
            await session.send(prompt, context)
            return
          }
        }
      })
      return this.record(schedule, context, occurrenceMs, event, settlement)
    } finally {
      this.queued.delete(context.runId)
      await lease.release()
    }
  }
}
