import { type TeamAttempt } from '../../../shared/team'
import { type SlotRequest } from './slots'

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
