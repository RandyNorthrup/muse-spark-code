import { TEAM_RETIRE_WAIT_MS, UI_TEXT } from '../../../shared/constants'
import { type TeamAttempt } from '../../../shared/team'
import { fill } from '../../../shared/l10n/text'
import { type SlotRequest, type SchedulerSlots } from './slots'

interface AttemptRef {
  taskId: string
  attempt: number
}
export interface RetirementEvidence {
  windowInstanceId: string
  ref: AttemptRef
  kind: TeamAttempt['kind']
  loopStopped: boolean
  turnTerminal: boolean
  itemsTerminal: boolean
  promptAnswered: boolean
  isReadOnlyMuse: boolean
  hostExited: boolean
  /** Each entry comes from a launch owned by this window, never PID polling. */
  processes: readonly {
    childExited: boolean
    descendantsEnded: boolean
    method: 'windowsJob' | 'linuxCgroup' | 'unproved'
  }[]
  containerMethod: 'windowsJob' | 'linuxCgroup' | 'unproved'
}
export type RetirementOutcome =
  | { state: 'retired'; endedAt: number; retirement: NonNullable<TeamAttempt['retirement']> }
  | { state: 'uncertain'; reason: string }
export interface RetirementDependencies {
  windowInstanceId: string
  now(): number
  evidence(ref: AttemptRef): RetirementEvidence
  cancel(ref: AttemptRef): Promise<void>
  /** Must resolve only on an observed change of this window's child/worker. */
  changed(ref: AttemptRef, signal: AbortSignal): Promise<void>
  escalate(ref: AttemptRef): Promise<void>
  delay(ms: number, signal: AbortSignal): Promise<void>
  markUncertain(ref: AttemptRef): void
  quarantine(ref: AttemptRef): Promise<void>
  canQuarantine(ref: AttemptRef): boolean
  /** Immutable checkpoint snapshot, fresh copy, then same-task lease transfer. */
  prepareReplacement(ref: AttemptRef, replacement: SlotRequest): Promise<boolean>
  exclusiveResourcesFree(replacement: SlotRequest): boolean
  teamHostWorkers(): readonly AttemptRef[]
  restartTeamHost(): Promise<void>
  recordDecision(ref: AttemptRef, decision: 'continueAnyway' | 'handOffAnyway'): Promise<void>
}

/** Cancellation acknowledgements, direct exits and process groups prove nothing. */
export class AttemptRetirement {
  constructor(
    private readonly deps: RetirementDependencies,
    private readonly slots: SchedulerSlots,
  ) {}

  private evidence(ref: AttemptRef): RetirementEvidence {
    const evidence = this.deps.evidence(ref)
    if (
      evidence.windowInstanceId !== this.deps.windowInstanceId ||
      evidence.ref.taskId !== ref.taskId ||
      evidence.ref.attempt !== ref.attempt
    )
      throw new Error('team:foreignRetirement')
    return evidence
  }

  private outcome(ref: AttemptRef): RetirementOutcome | undefined {
    const evidence = this.evidence(ref)
    const hasProof =
      evidence.containerMethod !== 'unproved' &&
      evidence.processes.every(
        (process) =>
          process.childExited && process.descendantsEnded && process.method !== 'unproved',
      )
    let isTerminal: boolean
    if (evidence.kind === 'engine') isTerminal = evidence.loopStopped
    else if (evidence.kind === 'museCode')
      isTerminal =
        ((evidence.turnTerminal && evidence.itemsTerminal) || evidence.hostExited) &&
        (!evidence.isReadOnlyMuse || evidence.hostExited)
    else isTerminal = evidence.promptAnswered && evidence.processes.length > 0
    if (!hasProof || !isTerminal) return undefined
    return {
      state: 'retired',
      endedAt: this.deps.now(),
      retirement: {
        kind: 'proved',
        method: evidence.containerMethod === 'windowsJob' ? 'windowsJob' : 'linuxCgroup',
      },
    }
  }

  private async bounded(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController()
    try {
      await Promise.race([
        action(controller.signal),
        this.deps.delay(TEAM_RETIRE_WAIT_MS, controller.signal),
      ])
    } catch {
      // A failed cancel/escalation is never evidence of retirement.
      return
    } finally {
      controller.abort()
    }
  }

  async retire(ref: AttemptRef): Promise<RetirementOutcome> {
    // Mark counted before awaiting; a racing admission cannot take this lane.
    this.slots.mark(ref, 'uncertain')
    await this.bounded(async (signal) => {
      await this.deps.cancel(ref)
      while (!signal.aborted && !this.outcome(ref)) await this.deps.changed(ref, signal)
    })
    let outcome = this.outcome(ref)
    if (!outcome) {
      await this.bounded(async (signal) => {
        await this.deps.escalate(ref)
        while (!signal.aborted && !this.outcome(ref)) await this.deps.changed(ref, signal)
      })
      outcome = this.outcome(ref)
    }
    if (outcome) {
      this.slots.release(ref, 'retired')
      return outcome
    }
    this.deps.markUncertain(ref)
    await this.deps.quarantine(ref)
    return { state: 'uncertain', reason: UI_TEXT.teamTrafficNotices.uncertainAttempt }
  }

  async continueAnyway(ref: AttemptRef): Promise<RetirementOutcome> {
    if (this.evidence(ref).containerMethod !== 'unproved')
      throw new Error('team:continueNotAvailable')
    if (
      this.slots
        .snapshot()
        .every(
          (slot) =>
            !(
              slot.request.taskId === ref.taskId &&
              slot.request.attempt === ref.attempt &&
              slot.state === 'uncertain'
            ),
        )
    )
      throw new Error('team:notUncertain')
    await this.deps.quarantine(ref)
    await this.deps.recordDecision(ref, 'continueAnyway')
    this.slots.release(ref, 'retired')
    return { state: 'retired', endedAt: this.deps.now(), retirement: { kind: 'userDecision' } }
  }

  handoffRefusal(replacement: SlotRequest): string | undefined {
    if (!this.deps.canQuarantine({ taskId: replacement.taskId, attempt: replacement.attempt - 1 }))
      return UI_TEXT.teamTrafficNotices.uncertainAttempt
    const reason = this.slots.refusal(replacement)
    if (reason) return fill(UI_TEXT.teamTrafficNotices.handoffUnavailable, { reason })
    if (!this.deps.exclusiveResourcesFree(replacement))
      return fill(UI_TEXT.teamTrafficNotices.handoffUnavailable, {
        reason: UI_TEXT.teamTraffic.resources,
      })
    return undefined
  }

  async handOffAnyway(ref: AttemptRef, replacement: SlotRequest): Promise<boolean> {
    this.evidence(ref)
    if (
      this.slots
        .snapshot()
        .every(
          (slot) =>
            !(
              slot.request.taskId === ref.taskId &&
              slot.request.attempt === ref.attempt &&
              slot.state === 'uncertain'
            ),
        ) ||
      ref.taskId !== replacement.taskId ||
      replacement.attempt !== ref.attempt + 1 ||
      this.handoffRefusal(replacement) ||
      !this.slots.reserve(replacement).ok
    )
      return false
    try {
      await this.deps.quarantine(ref)
      await this.deps.recordDecision(ref, 'handOffAnyway')
      // Recheck after the awaited quarantine; resources may have been taken.
      if (!this.deps.exclusiveResourcesFree(replacement)) {
        this.slots.release(replacement, 'notStarted')
        return false
      }
      if (!(await this.deps.prepareReplacement(ref, replacement))) {
        this.slots.release(replacement, 'notStarted')
        return false
      }
      return true
    } catch (error) {
      this.slots.release(replacement, 'notStarted')
      throw error
    }
  }

  async restartTeamHost(
    confirmed: readonly AttemptRef[],
  ): Promise<readonly { ref: AttemptRef; outcome: RetirementOutcome }[]> {
    const workers = this.deps.teamHostWorkers()
    if (
      confirmed.length !== workers.length ||
      workers.some((ref) =>
        confirmed.every((item) => !(item.taskId === ref.taskId && item.attempt === ref.attempt)),
      )
    )
      throw new Error('team:hostConfirmationChanged')
    await this.bounded(async (_signal) => {
      await this.deps.restartTeamHost()
    })
    const results: { ref: AttemptRef; outcome: RetirementOutcome }[] = []
    for (const ref of workers) {
      const outcome = this.outcome(ref) ?? {
        state: 'uncertain',
        reason: UI_TEXT.teamTrafficNotices.uncertainAttempt,
      }
      if (outcome.state === 'retired') this.slots.release(ref, 'retired')
      else {
        this.slots.mark(ref, 'uncertain')
        this.deps.markUncertain(ref)
        await this.deps.quarantine(ref)
      }
      results.push({ ref, outcome })
    }
    return results
  }
}
