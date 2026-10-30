import type {
  TeamAttempt,
  TeamBoard,
  TeamBoardOwner,
  TeamBoardTask,
  TeamSchedulerFields,
  TeamUsage,
  TeamSharedFile,
  TeamWriteSetLease,
} from '../../shared/team'
import type { BoardSubmission, TaskBoard } from './scheduler/board'
import type { SchedulerEntry } from './scheduler/pick'
import type { RetirementEvidence } from './scheduler/retire'
import type { SlotLimits, TeamCapacityPort } from './scheduler/slots'
import type { Checkpoint, Handoff, HandoffEntry } from './scheduler/stalls'
import type { TeamStatePort } from './teamHostService'

/** One attempt of one task, as retirement and stall recovery name it. */
export interface TeamAttemptRef {
  readonly taskId: string
  readonly attempt: number
}

/**
The host's half of attempt retirement and stall recovery (M96c): everything
that needs the window's live workers, copies and paid consent. The window
scheduler owns the board, slots and leases; this port owns evidence and
effects on real runs. Absent, retirement actions refuse honestly.
*/
export interface TeamRetirementPort {
  /** What this window can prove about the attempt right now, from its own launches. */
  evidence(ref: TeamAttemptRef): RetirementEvidence
  /** Ask the attempt to stop (its run's cancellation). */
  cancel(ref: TeamAttemptRef): Promise<void>
  /** Resolve only on an observed change of this attempt's run. */
  changed(ref: TeamAttemptRef, signal: AbortSignal): Promise<void>
  /** End what can be ended: the run and its process tree. */
  escalate(ref: TeamAttemptRef): Promise<void>
  /** Set the attempt's copy aside so nothing reuses it. */
  quarantine(ref: TeamAttemptRef): Promise<void>
  canQuarantine(ref: TeamAttemptRef): boolean
  /** End every worker session this window's team host owns. */
  restartWorkers(): Promise<void>
  /** The stopped attempt's checkpoint: its commit, files and diff stat. */
  checkpoint(ref: TeamAttemptRef): Promise<Checkpoint>
  /** Settle the attempt's usage into the board's accounting. */
  settleUsage(ref: TeamAttemptRef): Promise<void>
  /** Whether starting this entry bills a key (consent names it first). */
  isKeyEntry(entryId: string): boolean
  /** D48 consent for a key-billed replacement entry, in the task's conversation. */
  consentEntry(ref: TeamAttemptRef, entry: HandoffEntry): Promise<boolean>
  /** The task's brief and last activity, for the handoff's untrusted data block. */
  stallBrief(ref: TeamAttemptRef): {
    readonly brief: string
    readonly lastMessage: string
    readonly toolCalls: readonly { readonly name: string; readonly outcome: string }[]
  }
  /** Pin the host's task record to the replacement entry with its handoff. */
  applyReassignment(ref: TeamAttemptRef, entry: HandoffEntry, handoff: Handoff): Promise<boolean>
  /** Point the host's task record at the fresh copy from the checkpoint. */
  applyReplacement(
    ref: TeamAttemptRef,
    replacementAttempt: number,
    checkpoint: Checkpoint,
  ): Promise<boolean>
}

/** This window's birth and process lease for the board ownership claim. */
export interface TeamSchedulingOwnerBirth {
  readonly windowStartedAt: number
  readonly pid?: number | undefined
  readonly processStart?: string | undefined
}

/** Prove a foreign board owner gone: true when live, false when proven gone. */
export type TeamSchedulingProbeOwner = (owner: TeamBoardOwner) => Promise<boolean | undefined>

/** A running attempt stopped emitting activity. */
export interface TeamStallReport {
  readonly taskId: string
  readonly attempt: number
}

/** Window ports are live reads; the scheduler never owns a model credential. */
export interface TeamSchedulingDeps {
  readonly workspaceId: string
  readonly windowInstanceId: string
  readonly state: TeamStatePort
  readonly now: () => number
  readonly limits: () => SlotLimits
  readonly entries: () => readonly SchedulerEntry[]
  readonly mode: (taskId: string) => BoardSubmission['workspaceMode']
  readonly report: (taskId: string) => string
  readonly canStart: (task: TeamBoardTask, entry: SchedulerEntry) => boolean
  readonly admit: (task: TeamBoardTask, entry: SchedulerEntry) => boolean
  readonly refund: (taskId: string) => void
  /** Done-parent reports travel with the launch; dropped by no adapter. */
  readonly launch: (
    task: TeamBoardTask,
    entry: SchedulerEntry,
    input: ReturnType<TaskBoard['dependencyInput']>,
  ) => Promise<void>
  readonly authorize: (task: TeamBoardTask, entry: SchedulerEntry) => Promise<boolean>
  readonly changed: () => void
  readonly failure: (error: unknown) => void
  readonly sharedFiles?: (() => readonly TeamSharedFile[]) | undefined
  readonly capacity?: TeamCapacityPort | undefined
  /** This window's birth and process lease for the board ownership claim. */
  readonly ownerBirth?: TeamSchedulingOwnerBirth | undefined
  /**
  Prove a foreign board owner gone: true when live, false when proven
  gone, undefined when unprovable. Absent means only same-window and
  released claims move; anything else fails closed and never takes over.
  */
  readonly probeOwner?: TeamSchedulingProbeOwner | undefined
  /** A running attempt stopped emitting activity; abort and retire it. */
  readonly onStallDetected?: ((ref: TeamStallReport) => Promise<void>) | undefined
  /** Attempt retirement and stall recovery over the host's live runs. */
  readonly retirement?: TeamRetirementPort | undefined
}

export interface TeamSchedulingPort {
  submit(
    tasks: readonly {
      id: string
      sessionId: string
      roleId: string
      fields: TeamSchedulerFields
    }[],
  ): Promise<void>
  wake(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  snapshot(): TeamBoard
  finish(
    taskId: string,
    state: 'done' | 'review' | 'failed' | 'cancelled' | 'blocked',
    retirement: NonNullable<TeamAttempt['retirement']>,
  ): Promise<void>
  usage(taskId: string, attempt: number, usage: TeamUsage): Promise<void>
  landed(taskId: string, state: 'merged' | 'discarded'): Promise<void>
  reschedule(input: unknown): Promise<void>
  retry(taskId: string): Promise<boolean>
  /** Drop a restored attempt that provably never ran, reopening its task. */
  reopenInterrupted(taskId: string): Promise<boolean>
  /** Real worker activity for the stall detector. */
  noteActivity(ref: { readonly taskId: string; readonly attempt: number }): void
  /**
  Take the board when its owner is this window, released, or proven gone.
  A live or unprovable foreign owner refuses: one owner per board.
  */
  takeoverBoard(): Promise<boolean>
  /** Release the board claim cleanly, so the next window claims without proof. */
  releaseOwnership(): Promise<void>
  configureSharedFiles(files: readonly TeamSharedFile[]): Promise<void>
  writeLeases(): TeamWriteSetLease[]
  /** Retire one attempt with proof, or leave it counted and uncertain. */
  retireAttempt(taskId: string, attempt: number): Promise<'retired' | 'uncertain'>
  /** The person's recorded decision where retirement cannot be proved. */
  continueAnyway(taskId: string, attempt: number): Promise<void>
  /** Start the replacement attempt from the checkpoint despite no proof. */
  handOffAnyway(taskId: string, attempt: number, entryId?: string): Promise<boolean>
  /** End every worker session, then retire what the end proves stopped. */
  restartTeamHost(): Promise<void>
  /** Retire, checkpoint and reassign a stalled or user-moved attempt. */
  reassignAttempt(
    taskId: string,
    attempt: number,
    entryId?: string,
  ): Promise<'reassigned' | 'blocked' | 'stale'>
  dispose(): void
}

export type TeamSchedulingFactory = (deps: TeamSchedulingDeps) => TeamSchedulingPort
