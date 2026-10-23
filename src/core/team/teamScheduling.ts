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
import type { SlotLimits, TeamCapacityPort } from './scheduler/slots'
import type { TeamStatePort } from './teamHostService'

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
  dispose(): void
}

export type TeamSchedulingFactory = (deps: TeamSchedulingDeps) => TeamSchedulingPort
