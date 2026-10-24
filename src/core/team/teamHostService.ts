// The team host service (M96 lane X, C-M96-3, PLAN.md D75): one service per
// window and workspace that every surface binds to. The Model API host takes
// its seams (`TeamHostSeams`); the VS Code chat panel takes its tree and its
// actions; M96b's ACP agent, headless runs and the other editors' panels bind
// to the same interface over their own ports. No `vscode` here: every editor
// supplies the ports below, and nothing in this file runs on its own.
//
// Types only: the implementation (`createTeamHostService`, teamHost.ts) loads
// with the team bundle (dist/team.js), and only for a workspace that stores a
// team. A workspace without one never loads it (acceptance 1 and 47).

import type { UsdAmount } from '../../shared/usd'
import type { TeamWorkerConfirmation } from '../../shared/paid'
import type {
  TeamAgentRef,
  TeamPoolEntry,
  TeamReport,
  TeamRoleConfig,
  TeamSnapshot,
  TeamUsage,
} from '../../shared/team'
import type { TeamTreeData } from '../../shared/teamView'
import type {
  TeamDecisionSource,
  TeamRosterLive,
  TeamStableRole,
  TeamToolContext,
  TeamToolRunner,
} from './teamSeams'
import type { PlaybookWhyNote } from '../../shared/playbook'
import type { BoardSubmission } from './scheduler/board'
import type { TeamPlaybookStart } from './teamPlaybookBoard'

/**
What a conversation engine takes from the service: the Model API host
today (`ModelApiHostDeps`' `team*` fields, PLAN.md M96 lane T), the ACP
engine and headless `exec` in M96b. Each is read when it is needed and
never probes: the decision reads the latest probe results already known.
*/
export interface TeamHostSeams {
  /** The conversation passes its own model: the orchestrator it compares entries with. */
  readonly teamDecisionSource: (orchestratorModelId?: string) => TeamDecisionSource | undefined
  readonly teamRosterData: () =>
    { readonly stable: readonly TeamStableRole[]; readonly live?: TeamRosterLive } | undefined
  readonly teamRunner: TeamToolRunner
  readonly isTeamInPlaceActive: () => boolean
}

/** The "waiting for you" card's four answers (D75's `ask` policy). */
export type TeamWaitingChoice = 'queue' | 'self' | 'raise' | 'cancel'

/** The merge card's two answers. */
export type TeamMergeDecision = 'merge' | 'discard'

/**
The service every surface binds to. The tree is the Agent map's live view
(undefined while the workspace is single-model: today's map, acceptance
47); the actions are the tree's and the cards' buttons, the same from any
editor. A refused action throws an `Error` whose message is the user's
sentence; the surface shows it.
*/
export interface TeamHostService extends TeamHostSeams {
  /** The Agent map's tree, or undefined when the workspace runs no team. */
  readonly tree: () => TeamTreeData | undefined
  /** Called after every change the tree shows; returns the unsubscribe. */
  readonly onTreeChange: (listener: (tree: TeamTreeData | undefined) => void) => () => void
  /** Stops one task and its process tree (acceptance 13's `cancel`, from the tree). */
  readonly stopTask: (taskId: string) => Promise<void>
  /** Stops every running and queued task; returns how many stopped. */
  readonly stopAllTasks: () => Promise<number>
  /** Answers a "waiting for you" card. */
  readonly answerWaiting: (waitingId: string, choice: TeamWaitingChoice) => Promise<void>
  /** Answers a merge card, or merges or discards a finished task from the tree. */
  readonly decideMerge: (taskId: string, decision: TeamMergeDecision) => Promise<void>
  /** A finished task's branch against its base, as a unified diff (the tree's Review diff). */
  readonly taskDiff: (taskId: string) => Promise<string>
  /** Clears one entry's meters; the ledger keeps the record (acceptance 11). */
  readonly resetEntry: (entryId: string) => Promise<void>
  /**
  The declared setup probes: each distinct custom entry is checked once for
  its model observably loaded. Called when a surface that shows the team
  opens, never on a conversation's path (acceptance 47's zero traffic).
  */
  readonly probeEntries: () => Promise<void>
  /** Re-reads the stored team after the Roles section (lane U1) saves it. */
  readonly reload: () => void
  /** Stops every task and releases every port. */
  /** Run-owned storage waits for each worker's final durable handoff before removal. */
  readonly dispose: (options?: { readonly waitForWorkers: boolean }) => Promise<void>
}

// --- Ports: what each editor supplies ---

/** The workspace's state, where the team is stored (D75: not in settings). */
export interface TeamStatePort {
  get(key: string): unknown
  update(key: string, value: unknown): Promise<void>
}

/** The machine-scoped settings that run or bill (D15), read at each use. */
export interface TeamSettingsPort {
  /** `museSpark.team`: off, no team loads anywhere. */
  readonly isTeamOn: () => boolean
  /** `museSpark.modelApiTeamWorkers`: the paid feature `teamWorkers`. */
  readonly isTeamWorkersOn: () => boolean
  /** `museSpark.teamMaxWorkers`: workers at once in this window. */
  readonly maxWorkers: () => number
  /** Restricted Mode: an untrusted workspace starts no worker (acceptance 29). */
  readonly isTrusted: () => boolean
  /**
  `museSpark.hooksMaxStopContinuations` (M127, D121): the person's own Stop
  continuation bound, 0 (unlimited) unless set. Absent reads as unset.
  */
  readonly maxStopContinuations?: (() => number) | undefined
}

/** The orchestrator slot: the composer's picker unless the workspace overrides it. */
export interface TeamOrchestratorPort {
  readonly modelId: () => string
  /** The backend the orchestrator runs on, as the tree names it. */
  readonly backend: () => string
  /**
  What a pool's Default entry runs on: the slot's model on the slot's
  backend, or undefined where this editor runs no worker on it.
  */
  readonly defaultAgent?: ((orchestratorModelId: string) => TeamAgentRef | undefined) | undefined
  /**
  The conversation's wire approval mode now (`denyUnmatched` is Plan), or
  undefined when no open surface holds that conversation. A merge asked
  from the tree uses it as the model's `merge` uses its call context.
  */
  readonly approvalMode?: ((sessionId: string) => string | undefined) | undefined
}

/** Where a task's own copy is, written down before any work so recovery can remove it. */
export interface TeamTaskWorkspace {
  readonly folder: string
  readonly baseCommit: string
  readonly branch?: string | undefined
  readonly agentsRef?: string | undefined
}

/**
The service's hold on one running task, which the worker port calls at its
own boundaries. `admitRequest` runs before every model request and throws
the refusal (trust withdrawn, the paid switch off, a cap met, a stop); the
request is then not sent. `noteUsage` reports the task's usage so far after
each response; `noteWorkspace` records the copy as soon as it exists.
*/
export interface TeamTaskMeter {
  readonly noteSession?: (sessionId: string) => void
  readonly admitRequest: (hasReservation?: boolean) => void
  /** Maximum liability for one transport attempt, durably held before dispatch. */
  readonly reserveRequest: (maximum: TeamUsage) => Promise<number>
  /** Settlement belongs to this exact attempt; a final outcome closes even uncertain liability. */
  readonly settleRequest: (
    requestOrdinal: number,
    usage: TeamUsage,
    isFinal?: boolean,
  ) => Promise<void>
  readonly noteUsage: (usage: TeamUsage) => Promise<void>
  readonly noteWorkspace: (workspace: TeamTaskWorkspace | undefined) => Promise<void>
}

/** One task as the service hands it to the editor's worker port. */
export interface TeamTaskSpec {
  readonly taskId: string
  readonly role: TeamRoleConfig
  readonly entry: TeamPoolEntry & { readonly agent: TeamAgentRef }
  readonly brief: string
  readonly files: readonly string[]
  /** The orchestrator's session, for the worker's own cards (D75). */
  readonly parentSessionId: string
  /** `continue`: the finished task this one reopens, on its own copy and branch. */
  readonly continueFrom?: TeamWorkerOutcome | undefined
  /** A review: the finished branch this read-only task reviews at its head. */
  readonly reviewOf?: TeamWorkerOutcome | undefined
  readonly meter: TeamTaskMeter
}

/** What a finished worker hands back. */
export interface TeamWorkerOutcome {
  readonly isCeilingReached?: boolean | undefined
  readonly report: TeamReport
  readonly usage: TeamUsage
  /** `own-branch` only: the task branch, the base it started from and its head. */
  readonly branch?: string | undefined
  readonly baseCommit?: string | undefined
  readonly head?: string | undefined
  /** Files the branch changed against its base; empty when nothing changed. */
  readonly changedFiles?: readonly string[] | undefined
  /** `own-branch` only: the task's own copy and the extension's ref in the user's repository. */
  readonly folder?: string | undefined
  readonly agentsRef?: string | undefined
}

/**
Starts workers (lanes W and I): the working copy, the worker on its agent,
the end-of-task commit. `canRun` answers without any traffic whether this
editor has a worker for the agent's kind at all; an agent it cannot run is
unavailable, never a silent fallback.
*/
export interface TeamWorkerPort {
  readonly rates?: ((agent: TeamAgentRef) => TeamWorkerConfirmation['rates']) | undefined
  readonly canRun: (agent: TeamAgentRef) => boolean
  /** The declared setup probe: the agent's model observably loaded. */
  readonly probe: (agent: TeamAgentRef) => Promise<boolean>
  readonly run: (spec: TeamTaskSpec, signal: AbortSignal) => Promise<TeamWorkerOutcome>
  /** A rate or usage limit marked the agent until its time (acceptance 8); absent marks nothing. */
  readonly isLimited?: ((agent: TeamAgentRef) => boolean) | undefined
}

/**
A card in the orchestrator's transcript (M96 lane U2's cards): the
"waiting for you" card and the merge card, then the same item again with
the user's answer in `teamDecision`. Shown only on the surface whose
conversation is `sessionId`.
*/
export type TeamCardItem =
  | {
      readonly itemId: string
      readonly kind: 'teamSwitch'
      readonly status: 'completed'
      readonly teamSwitch: {
        readonly roleId: string
        readonly fromEntry: string
        readonly toEntry: string
        readonly reason: string
      }
    }
  | {
      readonly itemId: string
      readonly kind: 'teamWaiting'
      readonly status: 'inProgress' | 'completed'
      readonly teamWaiting: {
        readonly waitingId: string
        readonly roleId: string
        readonly brief?: string | undefined
        readonly reasonText?: string | undefined
      }
      readonly teamDecision?: string | undefined
    }
  | {
      readonly itemId: string
      readonly kind: 'teamMerge'
      readonly status: 'inProgress' | 'completed'
      readonly teamMerge: {
        readonly taskId: string
        readonly roleId: string
        readonly brief: string
        readonly branch: string
        readonly filesChanged?: number | undefined
        readonly affectedFiles?: readonly string[] | undefined
        readonly protectedPaths?: readonly string[] | undefined
        readonly review: 'reviewed' | 'same-model' | 'not-reviewed'
        readonly reviewVerdict?: string | undefined
        readonly reviewerFindings?: readonly string[] | undefined
      }
      readonly teamDecision?: string | undefined
    }

/** Where the cards go: the editor's chat surface for that conversation. */
export interface TeamCardPort {
  readonly show: (sessionId: string, item: TeamCardItem) => void
}

/** What a merge did, in the words the model and the user read. */
export interface TeamMergeOutcome {
  readonly status: 'merged' | 'rework'
  readonly written: readonly string[]
  readonly conflicts: readonly string[]
}

/** Lane I's integration: the three-way merge into the working tree, and discard. */
export interface TeamMergePort {
  readonly merge: (
    task: {
      readonly taskId: string
      readonly role: TeamRoleConfig
      readonly outcome: TeamWorkerOutcome
    },
    signal: AbortSignal,
    /** The user approved the protected paths the merge card listed. */
    options: { readonly allowProtected: boolean },
  ) => Promise<TeamMergeOutcome>
  readonly discard: (task: {
    readonly taskId: string
    readonly role: TeamRoleConfig
    readonly outcome: TeamWorkerOutcome | undefined
  }) => Promise<void>
  /** The task branch against its base, as a unified diff (Review diff). */
  readonly diff: (outcome: TeamWorkerOutcome) => Promise<string>
}

/**
The team runner's playbook binding (M116, PLAN.md D218): the window's own
playbook starts and releases each task's round on its worker thread, where
the synchronous policy and its git reads run (on Windows inside the
worker's contained job), never on the extension host. The head is the
team's own governed git read of the dispatch base. Absent, the team runs
exactly as before.
*/
export interface TeamPlaybookPort {
  /**
  Start the task's round once every other admission passed, with the board
  facts read for this start. A refusal carries the policy's why-note, and a
  brief the policy cannot record (an unfilled template marker) says so; the
  task then does not start. Anything else thrown is the caller's.
  */
  readonly start: (
    start: TeamPlaybookStart,
  ) => Promise<
    | { readonly started: true }
    | { readonly refused: PlaybookWhyNote }
    | { readonly briefInvalid: true }
  >
  /** Release the task's round when the task ends; it is never completed here. */
  readonly release: (taskId: string) => Promise<void>
  /**
  The dispatch base: the orchestrator's HEAD for an in-place task, else
  the base commit the task's copy branches from, with the branch ref when
  the checkout has one. A refusal says so and the task does not start.
  */
  readonly head: (mode: BoardSubmission['workspaceMode']) => Promise<TeamPlaybookHead>
}

/** The dispatch base, or why it could not be read. */
export type TeamPlaybookHead =
  { readonly ref: string | undefined; readonly commit: string } | { readonly refused: string }

/** Paid use (rule 12): one D48 popup per `delegate` call that starts key tasks. */
export interface TeamPaidPort {
  readonly allowKeyTasks: (
    tasks: readonly TeamWorkerConfirmation[],
    dailyBudgetUsd: UsdAmount | undefined,
    context: TeamToolContext,
  ) => Promise<boolean>
}

/** Everything `createTeamHostService` takes. */
export interface TeamHostServiceDeps {
  readonly hooks?:
    | {
        readonly relativePath: (folder: string) => string | undefined
        readonly fire: (
          sessionId: string,
          event: 'TeamAgentSwitch' | 'SubagentStart' | 'SubagentStop' | 'TeammateIdle',
          fields: Readonly<Record<string, unknown>>,
          matcher: string,
          signal: AbortSignal | undefined,
        ) => Promise<{ readonly refusedReason?: string | undefined; readonly keepWorking: boolean }>
      }
    | undefined
  readonly state: TeamStatePort
  readonly settings: TeamSettingsPort
  readonly orchestrator: TeamOrchestratorPort
  readonly workers: TeamWorkerPort
  readonly merges: TeamMergePort
  readonly paid: TeamPaidPort
  readonly cards: TeamCardPort
  /** The team runner's playbook (D218); absent, dispatches run as before. */
  readonly playbook?: TeamPlaybookPort | undefined
  readonly newId: () => string
  readonly now: () => number
  readonly log: {
    readonly info: (message: string) => void
    readonly warn: (message: string) => void
  }
}

/** @unwired M96 stored-team reader; undefined when none is stored or it does not parse. */
export type TeamSnapshotReader = (state: TeamStatePort) => TeamSnapshot | undefined
