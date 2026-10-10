export { selectTeamEntry } from './selection'
import type {
  TeamPreferenceList,
  TeamAvailabilityProbe,
  TeamTaskConditions,
  TeamSkip,
  TeamHandoffRecord,
  TeamCandidate,
} from '../../shared/teamPreference'
import { type UsdAmount } from '../../shared/usd'
import { UI_TEXT, TEAM_SCHED_TICK_MS } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { type TeamAttempt, type TeamBoard, type TeamBoardTask } from '../../shared/team'
import { type TaskBoard } from './scheduler/board'
import { TaskPicker, type PickContext, type SchedulerEntry } from './scheduler/pick'
import { type SchedulerSlots, type SlotRequest } from './scheduler/slots'
import { SchedulerBorrowing, type SchedulerBorrowPort } from './scheduler/borrowing'
// Team pools and selection (M96 lane A, PLAN.md D75): entries, caps and
// windows, Default's live resolution, headroom, the first entry with
// headroom, the rate-limit and usage-limit marks per agent, switches and
// their rows, `continue on next` and its handoff brief, the exhausted policy
// and the queue.
//
// Pure: every live input (the slot's resolution, meter readings, running
// counts, probes) arrives in the selection snapshot, so tests drive the five
// switching cases the owner named with fake agents. Running work never moves:
// selection returns the resolved agent, and the task pins it (lane W stores
// it in the ledger row). No `vscode` here.

/** D75's cap measures: `tokens` is input plus output. */
export type TeamMeasure = 'tokens' | 'inputTokens' | 'outputTokens' | 'spendUsd' | 'tasks'

/** D75's cap windows: one task, the local day, or the workspace's lifetime. */
export type TeamWindow = 'task' | 'day' | 'lifetime'

/** One cap on an entry: a measure, an amount and a window. */
export interface TeamCap {
  readonly measure: TeamMeasure
  readonly window: TeamWindow
  readonly amount: number
}

/** The map key for a cap: `tokens/day`. */
export function teamCapKey(cap: Pick<TeamCap, 'measure' | 'window'>): string {
  return `${cap.measure}/${cap.window}`
}

/** Whether the cap is well formed: a finite positive amount. */
export function isTeamCapValid(cap: TeamCap): boolean {
  return Number.isFinite(cap.amount) && cap.amount > 0
}

/** What runs the tools: the extension, a `muse serve` session, or an ACP agent. */
export type TeamAgentKind = 'engine' | 'museCode' | 'external'

/** Who pays: a key (a paid use), a subscription's plan limits, or nothing. */
export type TeamBilling = 'key' | 'subscription' | 'local'

/** One agent an entry can send work to. */
export interface TeamAgentProfile {
  /** Stable per agent (a plan, a key, a CLI): marks, ceilings and per-agent caps share it. */
  readonly key: string
  readonly kind: TeamAgentKind
  readonly billing: TeamBilling
  readonly modelId: string
  /** Display only, e.g. "Opus 5.5 (Anthropic key)". */
  readonly label: string
}

/** Default as an entry: whatever the orchestrator slot resolves to right now. */
export interface TeamDefaultMarker {
  readonly defaultEntry: true
}

export const TEAM_DEFAULT_ENTRY: TeamDefaultMarker = { defaultEntry: true }

/** One pool entry: an agent (or Default) with its own limits. */
export interface TeamPoolEntry {
  readonly id: string
  readonly agent: TeamAgentProfile | TeamDefaultMarker
  /** Running at once on this entry (D75's `concurrent`). */
  readonly concurrent: number
  readonly caps: readonly TeamCap[]
}

export function isDefaultEntry(agent: TeamPoolEntry['agent']): agent is TeamDefaultMarker {
  return 'defaultEntry' in agent
}

/**
 * The orchestrator slot (lane T owns the picker and the override): Default
 * resolves through it when each task starts, never from a snapshot, so a
 * picker change applies to the next delegation and a running task keeps
 * what it started on.
 */
export interface TeamOrchestratorSlot {
  resolve(): TeamAgentProfile
}

/** Why selection moved: D75's `TeamAgentSwitch` reasons. */
export type TeamSwitchReason =
  'cap' | 'concurrency' | 'rateLimited' | 'usageLimit' | 'unavailable' | 'reset'

/** One recorded switch: the transcript row's data and the hook's payload. */
export interface TeamSwitch {
  readonly roleId: string
  readonly fromEntryId: string
  readonly toEntryId: string
  readonly reason: TeamSwitchReason
  readonly measure?: TeamMeasure
  readonly window?: TeamWindow
  readonly amount?: number
  readonly used?: number
  readonly taskId: string
}

/** D75's `TeamAgentSwitch` payload fields (lane H fires it; a hook's refusal exhausts the role). */
export interface TeamAgentSwitchPayload {
  readonly role_id: string
  readonly from_entry_id: string
  readonly to_entry_id: string
  readonly from_model: string
  readonly to_model: string
  readonly reason: TeamSwitchReason
  readonly measure: TeamMeasure | undefined
  readonly window: TeamWindow | undefined
  readonly amount: number | undefined
  readonly used: number | undefined
  readonly task_id: string
}

/** The payload for a switch, with both agent profiles' models. */
export function switchHookPayload(
  change: TeamSwitch,
  fromAgent: TeamAgentProfile,
  toAgent: TeamAgentProfile,
): TeamAgentSwitchPayload {
  return {
    role_id: change.roleId,
    from_entry_id: change.fromEntryId,
    to_entry_id: change.toEntryId,
    from_model: fromAgent.modelId,
    to_model: toAgent.modelId,
    reason: change.reason,
    measure: change.measure,
    window: change.window,
    amount: change.amount,
    used: change.used,
    task_id: change.taskId,
  }
}

/** The switch row's reason in the display language. */
export function switchReasonText(
  change: Pick<TeamSwitch, 'reason' | 'measure' | 'window' | 'amount' | 'used'>,
): string {
  switch (change.reason) {
    case 'cap': {
      const measure = change.measure ?? 'tokens'
      return fill(UI_TEXT.teamSwitchReasonCap, {
        measure,
        window: change.window ?? 'day',
        used: formatTeamAmount(measure, change.used ?? 0),
        amount: formatTeamAmount(measure, change.amount ?? 0),
      })
    }
    case 'concurrency': {
      return UI_TEXT.teamSwitchReasonConcurrency
    }
    case 'rateLimited': {
      return UI_TEXT.teamSwitchReasonRateLimited
    }
    case 'usageLimit': {
      return UI_TEXT.teamSwitchReasonUsageLimit
    }
    case 'unavailable': {
      return UI_TEXT.teamSwitchReasonUnavailable
    }
    case 'reset': {
      return UI_TEXT.teamSwitchReasonReset
    }
  }
}

/** The transcript's one row for a switch: "research: a → b, daily token cap met". */
export function formatSwitchRow(change: TeamSwitch, fromLabel: string, toLabel: string): string {
  return fill(UI_TEXT.teamSwitchRow, {
    role: change.roleId,
    from: fromLabel,
    to: toLabel,
    reason: switchReasonText(change),
  })
}

/** A limit mark on an agent: every entry on that agent is skipped until its time. */
export interface TeamAgentMark {
  readonly kind: 'rateLimited' | 'usageLimit'
  readonly untilMs: number
}

/**
 * The rate-limit and usage-limit marks, per agent (a plan or a key is shared
 * by all its entries, so the mark is too). Expired marks read as absent.
 */
export class TeamAgentMarks {
  private readonly marks = new Map<string, TeamAgentMark>()

  public markRateLimited(agentKey: string, untilMs: number): void {
    if (untilMs > (this.marks.get(agentKey)?.untilMs ?? -Infinity)) {
      this.marks.set(agentKey, { kind: 'rateLimited', untilMs })
    }
  }

  public markUsageLimit(agentKey: string, untilMs: number): void {
    if (untilMs > (this.marks.get(agentKey)?.untilMs ?? -Infinity)) {
      this.marks.set(agentKey, { kind: 'usageLimit', untilMs })
    }
  }

  public clear(agentKey: string): void {
    this.marks.delete(agentKey)
  }

  /** The agent's live mark, if any; an expired mark is forgotten on read. */
  public at(agentKey: string, nowMs: number): TeamAgentMark | undefined {
    const mark = this.marks.get(agentKey)
    if (mark === undefined || mark.untilMs <= nowMs) {
      if (mark !== undefined) {
        this.marks.delete(agentKey)
      }
      return undefined
    }
    return mark
  }
}

/**
 * A worker failure classified by the wire shapes lane P captures (AGENTS
 * rule 13): a 429 with `Retry-After`, or a subscription's usage-limit
 * refusal. A shape that has not been captured is a plain failure, never a
 * switch, so the classifier answers undefined for it.
 */
export type TeamLimitClassification =
  | { readonly kind: 'rateLimit'; readonly retryAfterMs: number }
  | { readonly kind: 'usageLimit'; readonly resetMs: number | undefined }

export interface TeamLimitClassifier {
  classify(error: unknown): TeamLimitClassification | undefined
}

/**
 * Records a worker failure on the agent's marks (lane W calls this with the
 * limit errors it sees). Returns the switch reason when the failure was a
 * limit, so the next task skips every entry on that agent until its time.
 */
export function noteTeamFailure(
  marks: TeamAgentMarks,
  classifier: TeamLimitClassifier,
  agentKey: string,
  error: unknown,
  nowMs: number,
  usageLimitCooldownMs: number,
): TeamSwitchReason | undefined {
  const found = classifier.classify(error)
  if (found === undefined) {
    return undefined
  }
  if (found.kind === 'rateLimit') {
    marks.markRateLimited(agentKey, nowMs + Math.max(0, found.retryAfterMs))
    return 'rateLimited'
  }
  // The provider names an absolute reset time; without one, the cooldown applies.
  marks.markUsageLimit(agentKey, found.resetMs ?? nowMs + Math.max(0, usageLimitCooldownMs))
  return 'usageLimit'
}

/** What a role does when every entry is exhausted (D75; `ask` is the default). */
export type TeamExhaustedPolicy = 'ask' | 'queue' | 'self'

/** One role's pool: the ordered entries and how exhaustion answers. */
export interface TeamRolePool {
  readonly roleId: string
  readonly entries: readonly TeamPoolEntry[]
  readonly policy: TeamExhaustedPolicy
  /** Caps met move the task here, on the same branch, as a new task. */
  readonly continueOnNext: boolean
  /** Tasks per orchestrator turn; defaults to TEAM_TASKS_PER_TURN_DEFAULT. */
  readonly tasksPerTurn?: number
  /** Minutes per task; a task past its minutes is stopped. Defaults to TEAM_TASK_MINUTES_DEFAULT. */
  readonly minutesPerTask?: number
}

/** Why one entry has no headroom: each limit refuses with its own reason. */
export type TeamExhaustionReason =
  | 'concurrent'
  | 'cap'
  | 'agent'
  | 'rateLimited'
  | 'usageLimit'
  | 'unavailable'
  | 'turn'
  | 'global'
  | 'process'
  | 'budget'

/** One entry's refusal, with the cap that refused where one did. */
export interface TeamEntryExhaustion {
  readonly entryId: string
  readonly reason: TeamExhaustionReason
  readonly cap?: TeamCap
  readonly used?: number
  /** Live-probe refusal; one queue classification serves pools and reviewers. */
  readonly skip?: TeamSkip
}

/**
 * Everything selection reads, resolved for this delegation: Default live
 * from the slot, meters from the ledger plus open reservations, running
 * counts from admission, availability from lane R/T's probes. Production
 * wires it from teamMeter, teamAdmission and the marks; tests fake it.
 */
export interface TeamSelectionSnapshot {
  /** Absent preserves D75's selection and result bytes. */
  readonly preference?: TeamPreferenceList
  readonly availability?: TeamAvailabilityProbe
  /** Captured engine identity where it differs from the reported model identity. */
  readonly engine?: (candidate: TeamCandidate) => string
  readonly conditions?: TeamTaskConditions
  /** All writers, including handoffs and borrowed coding attempts. */
  readonly authorship?: {
    readonly startedOn: string
    readonly record: TeamHandoffRecord
    readonly engines: ReadonlyMap<string, string>
  }
  readonly nowMs: number
  /** What Default resolves to right now: the picker's model or the override. */
  readonly defaultAgent: TeamAgentProfile
  /** Tasks started this orchestrator turn (the per-role `turn` limit). */
  readonly startedThisTurn: number
  /** Running tasks per entry id. */
  readonly runningByEntry: ReadonlyMap<string, number>
  /** Running tasks per agent key, across every role and conversation. */
  readonly runningByAgent: ReadonlyMap<string, number>
  /** Used amount for an entry's cap: ledger rows in the window plus open reservations. */
  readonly usedByEntryCap: (entryId: string, cap: TeamCap) => number | UsdAmount
  /** The task's first request, reserved before it is sent (tokens and spend). */
  readonly firstRequest: {
    readonly tokens: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly spendUsd: UsdAmount
  }
  /** Per-agent running limits: each agent's ceiling, lowered where the user did. */
  readonly agentLimit: (agentKey: string) => number
  /** Installed, signed in, key present, provider reachable. */
  readonly isAgentAvailable: (agent: TeamAgentProfile) => boolean
  /** This window's global and process running counts and limits. */
  readonly global: { readonly running: number; readonly limit: number }
  readonly process: { readonly running: number; readonly limit: number }
  /** The team's spent day budget, where one binds key and token use. */
  readonly teamBudget:
    | {
        readonly spendUsedUsd: UsdAmount
        readonly spendCapUsd: UsdAmount
        readonly tokensUsed: number
        readonly tokensCap: number
      }
    | undefined
  readonly marks: TeamAgentMarks
  /** The id the new task will carry, for the switch row. */
  readonly taskId: string
}

export type TeamSelection =
  | {
      readonly kind: 'selected'
      readonly entry: TeamPoolEntry
      /** The agent that sends it: the entry's, or Default live resolved. */
      readonly agent: TeamAgentProfile
      readonly skips?: readonly TeamSkip[]
    }
  | { readonly kind: 'notStaffed'; readonly roleId: string }
  | {
      readonly kind: 'exhausted'
      readonly roleId: string
      readonly policy: TeamExhaustedPolicy
      readonly reasons: readonly TeamEntryExhaustion[]
      readonly skips?: readonly TeamSkip[]
    }

/**
 * Records the move from the role's last entry to the selected one: the
 * transcript row's data. Returning to an entry after a reset or a new day
 * is a switch too. Callers pass the last entry's refusal so the row names
 * why the role moved.
 */
export function recordTeamSwitch(
  pool: TeamRolePool,
  fromEntryId: string,
  selection: Extract<TeamSelection, { kind: 'selected' }>,
  lastRefusal: TeamEntryExhaustion | undefined,
  taskId: string,
): TeamSwitch | undefined {
  if (fromEntryId === selection.entry.id) {
    return undefined
  }
  const reason = reasonFromRefusal(lastRefusal)
  return {
    roleId: pool.roleId,
    fromEntryId,
    toEntryId: selection.entry.id,
    reason: reason.kind,
    ...(reason.cap !== undefined && {
      measure: reason.cap.measure,
      window: reason.cap.window,
      amount: reason.cap.amount,
      used: reason.used,
    }),
    taskId,
  }
}

function reasonFromRefusal(refusal: TeamEntryExhaustion | undefined): {
  readonly kind: TeamSwitchReason
  readonly cap?: TeamCap
  readonly used?: number
} {
  if (refusal === undefined) {
    return { kind: 'reset' }
  }
  switch (refusal.reason) {
    case 'cap': {
      return {
        kind: 'cap',
        ...(refusal.cap !== undefined && { cap: refusal.cap, used: refusal.used }),
      }
    }
    case 'concurrent':
    case 'agent':
    case 'turn':
    case 'global':
    case 'process':
    case 'budget': {
      return { kind: 'concurrency' }
    }
    case 'rateLimited': {
      return { kind: 'rateLimited' }
    }
    case 'usageLimit': {
      return { kind: 'usageLimit' }
    }
    case 'unavailable': {
      return { kind: 'unavailable' }
    }
  }
}

/** What the exhausted policy answers for a role whose every entry refused. */
export type TeamExhaustedAnswer =
  | {
      readonly decision: 'ask'
      /** D75's four choices: Queue it, Main agent does it, Raise a limit…, Cancel. */
      readonly choices: readonly ['queue', 'self', 'raise', 'cancel']
    }
  | { readonly decision: 'queue'; readonly untilMs: number }
  | { readonly decision: 'self'; readonly reasons: readonly TeamEntryExhaustion[] }

/**
 * Applies the role's policy. `queue` waits only for a reason that recovers
 * (room under `concurrent`, a rate limit, a usage-limit cooldown, or a day
 * cap at midnight); a spent `lifetime` cap never recovers, so it asks. An
 * empty pool answers "not staffed" before any policy.
 */
export function answerExhausted(
  pool: TeamRolePool,
  reasons: readonly TeamEntryExhaustion[],
  nowMs: number,
  queueMaxWaitMs: number,
): TeamExhaustedAnswer {
  if (pool.policy === 'self') {
    return { decision: 'self', reasons }
  }
  if (pool.policy === 'queue') {
    const untilMs = queueUntilMs(reasons, nowMs)
    if (untilMs !== undefined) {
      return { decision: 'queue', untilMs: Math.min(untilMs, nowMs + queueMaxWaitMs) }
    }
  }
  return { decision: 'ask', choices: ['queue', 'self', 'raise', 'cancel'] }
}

/** Refusals the queue waits out: work ends or marks lapse, so it rechecks. */
const recoverableExhaustionReasons: ReadonlySet<TeamExhaustionReason> = new Set([
  'concurrent',
  'rateLimited',
  'usageLimit',
  'agent',
  'turn',
  'global',
  'process',
])

/** When a queued task may start: the earliest recoverable reason's time, if any. */
function queueUntilMs(reasons: readonly TeamEntryExhaustion[], nowMs: number): number | undefined {
  let earliest: number | undefined
  for (const refusal of reasons) {
    if (refusal.skip !== undefined) {
      const skip = refusal.skip
      const isRecoverable =
        [
          'busy',
          'notAdmitted',
          'coolingDown',
          'rateLimited',
          'borrowCooldown',
          'mainWorkDue',
        ].includes(skip.reason) ||
        (skip.reason === 'capped' && skip.untilMs !== undefined)
      if (isRecoverable) earliest = Math.min(earliest ?? Infinity, skip.untilMs ?? nowMs)
      continue
    }
    if (refusal.reason === 'cap' && refusal.cap !== undefined) {
      // Only a `day` cap recovers (at midnight); `task` and `lifetime` never do.
      if (refusal.cap.window === 'day') {
        earliest = Math.min(earliest ?? Infinity, nextLocalMidnightMs(nowMs))
      }
      continue
    }
    if (recoverableExhaustionReasons.has(refusal.reason)) {
      // These recover when work ends or marks lapse; the queue rechecks
      // rather than sleeping to a time.
      return nowMs
    }
  }
  return earliest
}

/** Midnight starting the next local day: when a spent `day` cap recovers. */
export function nextLocalMidnightMs(nowMs: number): number {
  const day = new Date(nowMs)
  day.setDate(day.getDate() + 1)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** One task waiting for headroom under the `queue` policy. */
export interface QueuedTeamTask {
  readonly taskId: string
  readonly roleId: string
  readonly enqueuedMs: number
}

/**
 * One role's queue: at most TEAM_QUEUE_MAX tasks, each waiting at most
 * TEAM_QUEUE_MAX_WAIT_MS, then it asks. Starting a task when headroom frees
 * is the scheduler's (M96c); the queue holds the wait and its deadline.
 */
export class TeamTaskQueue {
  private readonly tasks: QueuedTeamTask[] = []

  public constructor(
    private readonly maxTasks: number,
    private readonly maxWaitMs: number,
  ) {}

  public get size(): number {
    return this.tasks.length
  }

  /** Enqueues; a full queue refuses, so the role asks at once. */
  public enqueue(task: QueuedTeamTask): { readonly queued: true } | { readonly refused: 'full' } {
    if (this.tasks.length >= this.maxTasks) {
      return { refused: 'full' }
    }
    this.tasks.push(task)
    return { queued: true }
  }

  /** Takes a task out when it starts, is cancelled, or its wait expires. */
  public remove(taskId: string): boolean {
    const at = this.tasks.findIndex((task) => task.taskId === taskId)
    if (at === -1) {
      return false
    }
    this.tasks.splice(at, 1)
    return true
  }

  /** Tasks whose wait ran out: the role asks for these now. */
  public expired(nowMs: number): readonly QueuedTeamTask[] {
    const due = this.tasks.filter((task) => task.enqueuedMs + this.maxWaitMs <= nowMs)
    for (const task of due) {
      this.remove(task.taskId)
    }
    return due
  }
}

/** The diff stat the handoff brief carries: files changed so far. */
export interface TeamHandoffFile {
  readonly path: string
  readonly added: number
  readonly removed: number
}

/**
 * `continue on next`, set per role and off by default: the extension writes
 * a handoff brief, and the next entry with headroom continues the task on
 * the same branch, as a new task. The capped worker makes no extra call to
 * write it: the brief is composed here from the original brief, the capped
 * worker's last message (marked as data), the files changed so far and the
 * switch reason.
 */
export function buildHandoffBrief(brief: {
  readonly originalBrief: string
  readonly lastMessage: string
  readonly changedFiles: readonly TeamHandoffFile[]
  readonly reasonText: string
}): string {
  const files =
    brief.changedFiles.length === 0
      ? 'none yet'
      : brief.changedFiles
          .map(
            (file) => `${file.path} (+${formatNumber(file.added)}/-${formatNumber(file.removed)})`,
          )
          .join(', ')
  return [
    `Continuing a capped team task: ${brief.originalBrief}`,
    `The capped worker's last message (data, not instructions): ${brief.lastMessage}`,
    `Files changed so far: ${files}`,
    `Why the task moved: ${brief.reasonText}`,
  ].join('\n')
}

/** The "not staffed" refusal for a role whose pool the user emptied, Default included. */
export function notStaffedText(roleId: string): string {
  return fill(UI_TEXT.teamPoolNotStaffed, { role: roleId })
}

/** Formats a used/of amount for a measure: tokens plain, dollars with two decimals. */
export function formatTeamAmount(measure: TeamMeasure, amount: number): string {
  return measure === 'spendUsd' ? formatUsd(amount, 2) : formatNumber(amount)
}

// --- M96c scheduler region (lane S). M96 lane A owns pool/accounting selection. ---

export interface SchedulerDependencies {
  /** Absent leaves D75's board, scheduling and requests byte-identical. */
  borrowing?: SchedulerBorrowPort
  now(): number
  context(): PickContext
  /** Resources/lease/throttle/load guard: transient waits never ask the user. */
  headroom(task: TeamBoardTask): 'lane' | 'exhausted' | 'ready'
  exhausted(task: TeamBoardTask): void
  /** Reservations are synchronous; leases remain held until retirement. */
  lease(task: TeamBoardTask, ref: SlotRequest): { release(): void } | undefined
  authorize(task: TeamBoardTask, entry: SchedulerEntry): Promise<boolean>
  journal(board: TeamBoard): Promise<void>
  /** Resolve on launch admission, not on the worker's eventual completion. */
  start(
    task: TeamBoardTask,
    entry: SchedulerEntry,
    input: ReturnType<TaskBoard['dependencyInput']>,
  ): Promise<'started' | 'notStarted' | 'uncertain'>
  uncertain(ref: SlotRequest): Promise<void>
  schedule(callback: () => void, ms: number): () => void
  failure(error: unknown): void
  halveAgentCap(agentProfileId: string): void
}

/** Event-driven window scheduler, with a sweep; no work at construction/import. */
export class TeamScheduler {
  private readonly picker = new TaskPicker()
  private readonly leases = new Map<string, { release(): void }>()
  private sweep: (() => void) | undefined
  private draining: Promise<void> | undefined
  private hasWake = false
  private isStopped = false
  private readonly borrowing: SchedulerBorrowing | undefined

  constructor(
    private readonly board: TaskBoard,
    private readonly slots: SchedulerSlots,
    private readonly deps: SchedulerDependencies,
  ) {
    this.borrowing =
      deps.borrowing === undefined
        ? undefined
        : new SchedulerBorrowing(board, deps.borrowing, this.picker)
  }

  private request(task: TeamBoardTask, entry: SchedulerEntry): SlotRequest {
    return {
      taskId: task.id,
      attempt: task.currentAttempt + 1,
      workspaceId: task.workspaceId,
      roleId: task.roleId,
      entryId: entry.id,
      agentProfileId: entry.agentProfileId,
      kind: entry.kind,
    }
  }

  private key(ref: Pick<SlotRequest, 'taskId' | 'attempt'>): string {
    return JSON.stringify([ref.taskId, ref.attempt])
  }

  private hasSlot(task: TeamBoardTask, entry: SchedulerEntry, replacing?: SlotRequest): boolean {
    const ref = this.request(task, entry)
    return this.slots.isReserved(ref) || this.slots.refusal(ref, replacing) === undefined
  }

  private canDispatch(): boolean {
    return !this.isStopped && !this.board.paused
  }

  private canLaunch(ref: SlotRequest): boolean {
    const task = this.board.task(ref.taskId)
    return (
      this.canDispatch() &&
      task.state === 'running' &&
      task.currentAttempt === ref.attempt &&
      task.attempts.at(-1)?.state === 'running'
    )
  }

  private isActive(ref: SlotRequest): boolean {
    const task = this.board.task(ref.taskId)
    const state = task.attempts.at(-1)?.state
    return task.currentAttempt === ref.attempt && (state === 'running' || state === 'retiring')
  }

  private async drain(): Promise<void> {
    do {
      await this.drainPass()
    } while (this.hasWake && this.canDispatch())
  }

  private async drainPass(): Promise<void> {
    const considered = new Set<string>()
    let didBorrow = false
    while (this.hasWake && this.canDispatch()) {
      this.hasWake = false
      this.board.refresh(this.deps.now())
      const supplied = this.deps.context()
      let context: PickContext = {
        ...supplied,
        now: this.deps.now(),
        canStart: (task, entry) => supplied.canStart(task, entry) && this.hasSlot(task, entry),
      }
      if (this.borrowing !== undefined) {
        if (didBorrow) context = this.borrowing.apply(context)
        else {
          didBorrow = true
          context = await this.borrowing.tick(context, () =>
            this.deps.journal(this.board.snapshot()),
          )
        }
      }
      const projected = context
      context = {
        ...projected,
        canStart: (task, entry) => !considered.has(task.id) && projected.canStart(task, entry),
      }
      const tasks = this.board.snapshot().tasks
      const pick = this.picker.pick(tasks, context)
      if (!pick) {
        for (const task of tasks)
          if (task.state === 'ready' && !task.held && this.deps.headroom(task) === 'exhausted')
            this.deps.exhausted(task)
        break
      }
      considered.add(pick.task.id)
      const ref = this.request(pick.task, pick.entry)
      if (!this.slots.isReserved(ref) && !this.slots.reserve(ref).ok) {
        this.hasWake = true
        continue
      }
      const lease = this.deps.lease(pick.task, ref)
      if (!lease) {
        this.slots.release(ref, 'notStarted')
        this.hasWake = true
        continue
      }
      let hasAttempt = false
      let canRelease = true
      try {
        if (!(await this.deps.authorize(pick.task, pick.entry))) continue
        const current = this.board.task(pick.task.id)
        if (
          !this.canDispatch() ||
          current.state !== 'ready' ||
          current.currentAttempt !== pick.task.currentAttempt
        )
          continue
        if (context.selection?.(current).preference !== undefined) {
          const live = this.deps.context()
          let checked: PickContext = {
            ...live,
            now: this.deps.now(),
            canStart: (task, entry) =>
              live.canStart(task, entry) &&
              this.hasSlot(task, entry, task.id === current.id ? ref : undefined),
          }
          if (this.borrowing !== undefined) checked = this.borrowing.apply(checked)
          const refreshed = this.picker.rank([current], checked)[0]?.entry
          if (
            refreshed?.id !== pick.entry.id ||
            refreshed.agentProfileId !== pick.entry.agentProfileId ||
            refreshed.modelId !== pick.entry.modelId ||
            refreshed.kind !== pick.entry.kind
          )
            continue
        }
        const input = this.board.dependencyInput(current.id)
        const attempt: TeamAttempt = {
          number: ref.attempt,
          entryId: ref.entryId,
          agentProfileId: ref.agentProfileId,
          modelId: pick.entry.modelId,
          kind: ref.kind,
          state: 'running',
          startedAt: this.deps.now(),
          usage: {
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            modelCalls: 0,
            costUsd: 0,
            accuracy: 'reported',
          },
        }
        if (!this.board.begin(current.id, attempt)) continue
        this.borrowing?.started(current, pick.entry, attempt.startedAt)
        hasAttempt = true
        await this.deps.journal(this.board.snapshot())
        // Pause or Stop while journalling must still prevent a launch.
        if (!this.canLaunch(ref)) {
          if (this.board.task(current.id).attempts.at(-1)?.state === 'running') {
            canRelease = false
            this.slots.mark(ref, 'uncertain')
            this.leases.set(this.key(ref), lease)
            this.board.finishAttempt(current.id, ref.attempt, { state: 'uncertain' })
            this.board.transition(
              current.id,
              ref.attempt,
              'blocked',
              this.deps.now(),
              UI_TEXT.teamTrafficNotices.queuePaused,
            )
            await this.deps.uncertain(ref)
          }
          await this.deps.journal(this.board.snapshot())
          continue
        }
        if (current.loan !== undefined && this.borrowing !== undefined) {
          const live = this.deps.context()
          if (
            !this.borrowing.canLaunch(
              {
                ...live,
                now: this.deps.now(),
                canStart: (task, entry) =>
                  live.canStart(task, entry) && this.hasSlot(task, entry, ref),
              },
              this.board.task(current.id),
            )
          ) {
            this.board.cancelUnstarted(current.id, ref.attempt)
            hasAttempt = false
            await this.deps.journal(this.board.snapshot())
            continue
          }
        }
        this.slots.mark(ref, 'running')
        canRelease = false
        this.leases.set(this.key(ref), lease)
        const outcome = await this.deps.start(this.board.task(current.id), pick.entry, input)
        this.picker.started(pick.entry, this.deps.now())
        if (outcome !== 'started' && this.isActive(ref)) {
          this.slots.mark(ref, 'uncertain')
          this.board.finishAttempt(current.id, ref.attempt, { state: 'uncertain' })
          this.board.transition(
            current.id,
            ref.attempt,
            'blocked',
            this.deps.now(),
            UI_TEXT.teamTrafficNotices.uncertainAttempt,
          )
          // Even a not-created launch is journalled; caller explicitly resolves it.
          await this.deps.uncertain(ref)
          await this.deps.journal(this.board.snapshot())
        }
      } catch (error) {
        if (hasAttempt && this.isActive(ref)) {
          canRelease = false
          this.leases.set(this.key(ref), lease)
          this.slots.mark(ref, 'uncertain')
          this.board.finishAttempt(ref.taskId, ref.attempt, { state: 'uncertain' })
          this.board.transition(
            ref.taskId,
            ref.attempt,
            'blocked',
            this.deps.now(),
            UI_TEXT.teamTrafficNotices.uncertainAttempt,
          )
          await this.deps.uncertain(ref)
        }
        throw error
      } finally {
        if (canRelease) {
          this.slots.release(ref, 'notStarted')
          lease.release()
        }
        this.hasWake = true
      }
    }
    if (this.borrowing !== undefined) {
      await this.deps.journal(this.board.snapshot())
    }
  }

  startSweep(): void {
    if (this.sweep || this.isStopped) return
    const tick = (): void => {
      this.sweep = undefined
      void this.wake().catch((error: unknown) => {
        this.deps.failure(error)
      })
      if (!this.isStopped) this.sweep = this.deps.schedule(tick, TEAM_SCHED_TICK_MS)
    }
    this.sweep = this.deps.schedule(tick, TEAM_SCHED_TICK_MS)
  }

  /** Called for readiness, a free lane, lease release or recovered limit. */
  async wake(): Promise<void> {
    this.hasWake = true
    if (this.draining) {
      await this.draining
      return
    }
    this.draining = this.drain()
    try {
      await this.draining
    } finally {
      this.draining = undefined
    }
    await this.borrowing?.deliver()
  }

  async retired(ref: Pick<SlotRequest, 'taskId' | 'attempt'>): Promise<void> {
    const attempt = this.board.task(ref.taskId).attempts.find((item) => item.number === ref.attempt)
    if (attempt?.state !== 'retired') throw new Error('team:notRetired')
    this.borrowing?.retired(this.board.task(ref.taskId), ref.attempt)
    this.slots.release(ref, 'retired')
    this.leases.get(this.key(ref))?.release()
    this.leases.delete(this.key(ref))
    await this.deps.journal(this.board.snapshot())
    await this.wake()
  }

  providerOverloaded(agentProfileId: string): void {
    this.deps.halveAgentCap(agentProfileId)
  }

  stopSweep(): void {
    this.isStopped = true
    this.sweep?.()
    this.sweep = undefined
    // Active workers retain their slots and leases; stopping goes through retirement.
  }
}
// --- End M96c scheduler region. ---
