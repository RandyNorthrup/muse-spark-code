// The team in the ACP agent's own sessions (M96b, RLF-ACPTEAM):
// dist/acpTeam.js, loaded only when the agent starts with `--team`. One
// TeamHostBinding per workspace folder over the same ports the panel
// supplies, with the ACP surface in place of the webview: the stored
// team from the agent data folder (read through the one reader headless
// runs share), workers' progress as task tool calls and the running
// tasks as a `plan`, the waiting and merge cards as the editor's
// permission requests, and the paid popup as D62's per-delegate
// question. A Model API orchestrator takes the binding's seams; a
// Muse Code orchestrator takes its `team` MCP endpoint, exactly as the
// panel's Muse Code orchestrator does (RLF-TEAMWIRE).
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import type {
  PermissionOption,
  RequestPermissionRequest,
  ToolCallContent,
} from '@agentclientprotocol/sdk/unstable'
import type { SessionMcpHttpServer } from '../core/agent/agentBackend'
import { failureForLog } from '../core/backends/musecode/logText'
import { isErrno } from '../core/fs/errno'
import type { CoreLogger } from '../core/logging'
import { isSameTeamModel } from '../core/team/sameModel'
import type { TeamCardItem, TeamHostSeams } from '../core/team/teamHostService'
import { TeamHostBinding } from '../host/teamHostBinding'
import type { EngineTeamPortsDeps } from '../host/team/teamEnginePorts'
import { workspaceKey } from '../runtime/dataFolder'
import { runtimeDailyBudgetUsd } from '../runtime/dailyBudgetSetting'
import { readStoredTeamSnapshot, type StoredTeamSnapshotDeps } from '../runtime/teamSnapshotFile'
import {
  ACP_SESSIONS_SUBFOLDER,
  ACP_TEAM_BOARD_FILE,
  ACP_TEAM_STORAGE_FOLDER,
  EXEC_TEAM_FILE_MODE,
  TEAM_MCP_SERVER_NAME,
  UI_TEXT,
  type AcpBackendKind,
} from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import { fill, setUiText } from '../shared/l10n/text'
import { approvalModeFor } from '../shared/permissionModes'
import type { TeamSnapshot } from '../shared/team'
import {
  TEAM_WORKSPACE_KEYS,
  decideTeamConversationMode,
  type TeamConversationMode,
} from '../shared/teamConversation'
import type { TeamTreeData, TeamWorker } from '../shared/teamView'
import { Usd, type UsdAmount } from '../shared/usd'
import type { AcpPaidUse } from './paid'
import { teamSessionAdmission } from './teamAdmission'
import {
  formatTeamPermissionTitle,
  teamDiff,
  teamMergeCompletedCall,
  teamMergeRequest,
  teamMergeToolCallId,
  teamPlanEntries,
  teamReportContent,
  teamTaskReportUpdate,
  teamTaskToolCall,
  teamTaskToolCallId,
  TEAM_TASK_TOOL_KIND,
  TEAM_TOOL_CALL_PREFIX,
} from './teamContracts'
import {
  ACP_TEAM_REFUSAL_NAME,
  type AcpTeamPort,
  type AcpTeamPrepared,
  type AcpTeamSessionHandler,
} from './teamPort'

export { setUiText } from '../shared/l10n/text'

/** What the runtime lends the ACP team (its worker starter and its paid gate). */
export interface AcpTeamDeps {
  readonly dataFolder: string
  readonly platform: NodeJS.Platform
  readonly log: CoreLogger
  /** The backend the agent was started on: the orchestrator's own. */
  readonly backendKind: AcpBackendKind
  /** `--trust-workspace`: an untrusted folder starts no worker. */
  readonly isTrusted: () => boolean
  /** The engine's model list for a folder: the declared setup probe reads it. */
  readonly listWorkerModels: (cwd: string) => Promise<readonly string[]>
  /** One engine worker conversation in the task's copy (the runtime's starter). */
  readonly startWorker: (
    cwd: string,
    input: Parameters<EngineTeamPortsDeps['startWorker']>[0],
  ) => ReturnType<EngineTeamPortsDeps['startWorker']>
  /** The runtime's paid gate, read when a delegate asks (the runtime lands first). */
  readonly paid: () => AcpPaidUse | undefined
  /** The stored files' reader; the filesystem's own when the caller has none. */
  readonly readFile?: StoredTeamSnapshotDeps['readFile'] | undefined
  readonly now?: (() => number) | undefined
}

/** An admission refusal in the product's own words, branded for the agent. */
class TeamRefusalError extends Error {
  public override readonly name = ACP_TEAM_REFUSAL_NAME
}

function teamRefusal(message: string): Error {
  return new TeamRefusalError(message)
}

/** The stored-team sentences a prepare may refuse with, templates by their heads. */
const REFUSAL_TEMPLATES = [
  'teamNeedsSecondModel',
  'teamSwitchedOff',
  'execTeamStateUnreadable',
  'execTeamConfigNotJson',
  'execTeamConfigNotObject',
  'execTeamConfigInvalid',
  'execTeamConfigBadEntry',
  'execTeamConfigLowersOnly',
  'execTeamReviewerUnsupported',
  'teamRunnerUnavailable',
] as const

/** Brands a known stored-team sentence as a refusal; anything else keeps its kind. */
function asTeamRefusal(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const isKnown = REFUSAL_TEMPLATES.some((key) => {
    const template = UI_TEXT[key]
    return (
      error.message === template || error.message.startsWith(template.split('{', 1)[0] ?? template)
    )
  })
  return isKnown ? teamRefusal(error.message) : error
}

const WAITING_SEGMENT = 'waiting/'
const MERGE_OPTION = 'merge'
const DISCARD_OPTION = 'discard'

/** The team state file's folder for one workspace, in the agent data folder. */
function teamFolder(deps: AcpTeamDeps, cwd: string): string {
  return path.join(deps.dataFolder, ACP_SESSIONS_SUBFOLDER, workspaceKey(cwd))
}

/** The person's daily paid cap as an amount, or undefined when none is set. */
function dailyBudget(deps: AcpTeamDeps): UsdAmount | undefined {
  const cap = runtimeDailyBudgetUsd(deps.dataFolder)
  return cap > 0 ? Usd.from(cap).toAmount() : undefined
}

/** The default stored-file reader: the filesystem's, bounded by the caller's slice. */
async function fileBytes(file: string, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  signal.throwIfAborted()
  const bytes = await readFile(file)
  signal.throwIfAborted()
  return bytes.subarray(0, maxBytes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One announced task on one session: what its last tool call update said. */
interface AnnouncedTask {
  status: string
  isFinished: boolean
}

/** A task's ACP status from its tree status word. */
function isFinishedStatus(status: string): boolean {
  return ['done', 'failed', 'cancelled', 'closed', 'capped', 'merged', 'discarded'].includes(status)
}

/** Every worker node the tree shows, with the role and entry that name it. */
function treeWorkers(
  tree: TeamTreeData,
): readonly { roleId: string; agent: string; worker: TeamWorker }[] {
  const found: { roleId: string; agent: string; worker: TeamWorker }[] = []
  for (const role of tree.roles) {
    for (const entry of role.entries)
      for (const worker of entry.workers)
        found.push({ roleId: role.id, agent: entry.model ?? entry.provider, worker })
    for (const worker of [...role.queued, ...role.unmerged, ...role.interrupted])
      if (found.every((row) => row.worker.taskId !== worker.taskId))
        found.push({ roleId: role.id, agent: role.id, worker })
  }
  return found
}

/** One workspace folder's team: its binding, its board and its sessions. */
class WorkspaceTeam {
  private readonly board = new Map<string, unknown>()
  private stored: { snapshot: TeamSnapshot; template?: string } | undefined
  private loweredBudget: UsdAmount | undefined
  private requiredReviews: ReadonlySet<string> = new Set()
  private loading: Promise<void> | undefined
  private writes: Promise<void> = Promise.resolve()
  private readonly handlers = new Map<string, AcpTeamSessionHandler>()
  private readonly announced = new Map<string, Map<string, AnnouncedTask>>()
  private readonly plans = new Map<string, string>()
  private orchestratorModel = ''
  private isDisposed = false
  public readonly binding: TeamHostBinding

  public constructor(
    private readonly deps: AcpTeamDeps,
    private readonly table: UiText,
    private readonly locale: string,
    public readonly cwd: string,
  ) {
    this.binding = new TeamHostBinding({
      ports: {
        state: {
          get: (key) => this.readState(key),
          update: (key, value) => this.writeState(key, value),
        },
        settings: {
          // The binding exists only under `--team`: that flag is this
          // surface's switch, and the two-model rule does the rest.
          isTeamOn: () => true,
          isTeamWorkersOn: () => this.deps.paid()?.isOn('teamWorkers') ?? false,
          maxWorkers: () => availableParallelism(),
          isTrusted: this.deps.isTrusted,
        },
        orchestrator: {
          modelId: () => this.orchestratorModel,
          backend: () => this.deps.backendKind,
          defaultAgent: (model) =>
            this.deps.backendKind === 'modelApi'
              ? { kind: 'engine', agentId: 'default', model, pays: 'key' }
              : undefined,
          approvalMode: (sessionId) => {
            const handler = this.handlers.get(sessionId)
            return handler === undefined ? undefined : approvalModeFor(handler.mode(), true)
          },
        },
        engine: {
          repositoryRoot: () => this.cwd,
          storageRoot: path.join(teamFolder(this.deps, this.cwd), ACP_TEAM_STORAGE_FOLDER),
          platform: this.deps.platform,
          isTrusted: this.deps.isTrusted,
          listModels: () => this.deps.listWorkerModels(this.cwd),
          startWorker: (input) => this.deps.startWorker(this.cwd, input),
          now: this.deps.now ?? Date.now,
          log: this.deps.log,
        },
        paid: {
          allowKeyTasks: async (tasks, budget, context) => {
            const paid = this.deps.paid()
            if (paid === undefined) return false
            const decision = await paid.allows(
              this.cwd,
              context.sessionId,
              {
                feature: 'teamWorkers',
                tasks,
                dailyBudgetUsd: this.loweredBudget ?? budget ?? dailyBudget(this.deps),
              },
              false,
            )
            return decision !== false && decision !== undefined
          },
        },
        cards: {
          show: (sessionId, item) => {
            this.showCard(sessionId, item)
          },
        },
        newId: () => randomUUID(),
        now: this.deps.now ?? Date.now,
        log: this.deps.log,
      },
      canRunKind: (kind) => kind === 'engine',
      loadFactory: async () => {
        const { createTeamHost } = await import('../host/team/teamHostEntry')
        return createTeamHost
      },
      loadTeamMcp: async () => {
        const { TeamMcpServer, teamRosterAnswer } = await import('../host/team/teamHostEntry')
        return { server: new TeamMcpServer(this.deps.log), rosterAnswer: teamRosterAnswer }
      },
      uiText: () => this.table,
      uiLocale: () => this.locale,
      showTree: (tree) => {
        this.showTree(tree)
      },
      openRoles: () => Promise.reject(new Error(UI_TEXT.acpTeamRolesUnavailable)),
      showDiff: (_taskId, diff) => {
        for (const handler of this.handlers.values())
          handler.sendUpdate({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: diff },
          })
        return Promise.resolve()
      },
    })
  }

  private readState(key: string): unknown {
    if (key === TEAM_WORKSPACE_KEYS.team && this.stored !== undefined)
      return {
        ...this.stored.snapshot,
        ...(this.stored.template !== undefined && { template: this.stored.template }),
      }
    return this.board.get(key)
  }

  private writeState(key: string, value: unknown): Promise<void> {
    this.board.set(key, value)
    const board: Record<string, unknown> = {}
    for (const [name, entry] of this.board)
      if (name !== TEAM_WORKSPACE_KEYS.team) board[name] = entry
    const text = JSON.stringify(board)
    const folder = teamFolder(this.deps, this.cwd)
    const previous = this.writes
    this.writes = (async () => {
      await previous
      await mkdir(folder, { recursive: true })
      const target = path.join(folder, ACP_TEAM_BOARD_FILE)
      const temporary = `${target}.new`
      await writeFile(temporary, text, { mode: EXEC_TEAM_FILE_MODE })
      await rename(temporary, target)
    })()
    return this.writes
  }

  /** The admission's candidates: the stored entries this surface can dispatch. */
  private candidates(): { modelId: string; billsKey: boolean; isAvailable: boolean }[] {
    const snapshot = this.stored?.snapshot
    if (snapshot === undefined || this.stored?.template === 'Solo') return []
    const found: { modelId: string; billsKey: boolean; isAvailable: boolean }[] = []
    for (const role of snapshot.roles)
      for (const entry of role.pool)
        if (entry.agent !== undefined)
          found.push({
            modelId: entry.agent.model,
            billsKey: entry.agent.pays === 'key',
            isAvailable: entry.agent.kind === 'engine',
          })
    return found
  }
  private showTree(tree: TeamTreeData | undefined): void {
    for (const [sessionId, handler] of this.handlers) this.showTreeTo(sessionId, handler, tree)
  }

  /**
  The Agent map over ACP (M96b): running tasks as a `plan`, each task as
  a tool call whose report is its content and whose diff is `diff`
  content. Only changes go out: an editor is not re-sent what it shows.
  */
  private showTreeTo(
    sessionId: string,
    handler: AcpTeamSessionHandler,
    tree: TeamTreeData | undefined,
  ): void {
    if (this.isDisposed) return
    const workers = tree === undefined ? [] : treeWorkers(tree)
    const running = workers.filter((row) => !isFinishedStatus(row.worker.status))
    const planKey = running.map((row) => row.worker.taskId).join('\0')
    if (this.plans.get(sessionId) !== planKey) {
      this.plans.set(sessionId, planKey)
      handler.sendUpdate({
        sessionUpdate: 'plan',
        entries: teamPlanEntries(
          running.map((row) => ({
            taskId: row.worker.taskId,
            title: row.worker.brief === '' ? row.worker.taskId : row.worker.brief,
          })),
        ),
      })
    }
    let announced = this.announced.get(sessionId)
    if (announced === undefined) {
      announced = new Map()
      this.announced.set(sessionId, announced)
    }
    for (const row of workers) {
      const { worker } = row
      const known = announced.get(worker.taskId)
      if (known === undefined) {
        announced.set(worker.taskId, {
          status: worker.status,
          isFinished: isFinishedStatus(worker.status),
        })
        const call = teamTaskToolCall({
          taskId: worker.taskId,
          role: row.roleId,
          agent: row.agent,
          detail: worker.brief === '' ? worker.taskId : worker.brief,
        })
        handler.sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: call.toolCallId,
          title: call.title ?? worker.taskId,
          kind: TEAM_TASK_TOOL_KIND,
          status: isFinishedStatus(worker.status) ? 'in_progress' : (call.status ?? 'in_progress'),
        })
        if (isFinishedStatus(worker.status)) this.finishTask(handler, worker.taskId, worker.status)
        continue
      }
      if (known.status === worker.status) continue
      known.status = worker.status
      if (!isFinishedStatus(worker.status) || known.isFinished) continue
      known.isFinished = true
      this.finishTask(handler, worker.taskId, worker.status)
    }
  }

  /** A finished task's completion: its report, then its diffs re-sent with it. */
  private finishTask(handler: AcpTeamSessionHandler, taskId: string, status: string): void {
    void (async () => {
      const report = this.binding.taskReport(taskId)
      const summary = report?.summary ?? status
      let diffs: ToolCallContent[] = []
      try {
        diffs = await this.diffContents(taskId)
      } catch (error: unknown) {
        this.deps.log.warn(`ACP team diff for ${taskId} failed: ${failureForLog(error)}`)
      }
      if (this.isDisposed) return
      if (status === 'failed' || status === 'cancelled') {
        handler.sendUpdate({
          sessionUpdate: 'tool_call_update',
          toolCallId: teamTaskToolCallId(taskId),
          status: 'failed',
          content: [teamReportContent(summary), ...diffs],
        })
        return
      }
      const update = teamTaskReportUpdate({ taskId, report: summary, diffs })
      handler.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId: update.toolCallId,
        status: update.status ?? 'completed',
        ...(update.content !== undefined && update.content !== null && { content: update.content }),
      })
    })()
  }

  /** A finished task's whole-file diffs as ACP `diff` content (binary files named, not faked). */
  private async diffContents(taskId: string): Promise<ToolCallContent[]> {
    const files = await this.binding.taskDiffFiles(taskId)
    const contents: ToolCallContent[] = []
    const binary: string[] = []
    for (const file of files) {
      if (file.isBinary) binary.push(file.path)
      else
        contents.push(
          teamDiff({
            path: path.join(this.cwd, file.path),
            oldText: file.oldText,
            newText: file.newText,
          }),
        )
    }
    if (binary.length > 0)
      contents.push(teamReportContent(`${UI_TEXT.teamMergeAffectedFiles}: ${binary.join(', ')}`))
    return contents
  }

  private showCard(sessionId: string, item: TeamCardItem): void {
    const handler = this.handlers.get(sessionId)
    if (handler === undefined) {
      this.deps.log.warn(`ACP team card for a session the agent does not hold: ${item.kind}`)
      return
    }
    if (item.kind === 'teamSwitch') {
      handler.sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: fill(UI_TEXT.teamSwitchRow, {
            role: item.teamSwitch.roleId,
            from: item.teamSwitch.fromEntry,
            to: item.teamSwitch.toEntry,
            reason: item.teamSwitch.reason,
          }),
        },
      })
      return
    }
    if (item.status === 'completed') {
      handler.sendUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallId:
          item.kind === 'teamMerge'
            ? teamMergeToolCallId(item.teamMerge.taskId)
            : `${TEAM_TOOL_CALL_PREFIX}${WAITING_SEGMENT}${item.teamWaiting.waitingId}`,
        status: 'completed',
      })
      return
    }
    void (async () => {
      try {
        if (item.kind === 'teamWaiting') await this.askWaiting(sessionId, handler, item)
        else await this.askMerge(sessionId, handler, item)
      } catch (error: unknown) {
        this.deps.log.warn(`ACP team card failed: ${failureForLog(error)}`)
        handler.sendUpdate({
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text: error instanceof Error ? error.message : UI_TEXT.actionFailed,
          },
        })
      }
    })()
  }

  /** The waiting card as the editor's permission request, its four choices by name. */
  private async askWaiting(
    sessionId: string,
    handler: AcpTeamSessionHandler,
    item: Extract<TeamCardItem, { kind: 'teamWaiting' }>,
  ): Promise<void> {
    const options: PermissionOption[] = [
      { optionId: 'queue', name: UI_TEXT.teamWaitingQueue, kind: 'allow_once' },
      { optionId: 'raise', name: UI_TEXT.teamWaitingRaise, kind: 'allow_always' },
      { optionId: 'self', name: UI_TEXT.teamWaitingSelf, kind: 'reject_always' },
      { optionId: 'cancel', name: UI_TEXT.teamWaitingCancel, kind: 'reject_once' },
    ]
    const request: RequestPermissionRequest = {
      sessionId,
      toolCall: {
        toolCallId: `${TEAM_TOOL_CALL_PREFIX}${WAITING_SEGMENT}${item.teamWaiting.waitingId}`,
        title: formatTeamPermissionTitle({
          role: item.teamWaiting.roleId,
          agent: UI_TEXT.teamWaitingTitle,
          detail: item.teamWaiting.reasonText ?? item.teamWaiting.brief ?? item.teamWaiting.roleId,
        }),
        kind: TEAM_TASK_TOOL_KIND,
        status: 'pending',
      },
      options,
    }
    let choice: 'queue' | 'self' | 'raise' | 'cancel' = 'cancel'
    try {
      const response = await handler.requestPermission(request)
      const picked = response.outcome.outcome === 'selected' ? response.outcome.optionId : undefined
      const pickedChoice = (['queue', 'self', 'raise'] as const).find(
        (candidate) => candidate === picked,
      )
      if (pickedChoice !== undefined) choice = pickedChoice
    } catch (error: unknown) {
      // No answer is a denial (D62): the waiting task is cancelled, said in the log.
      this.deps.log.warn(`ACP team waiting prompt failed: ${failureForLog(error)}`)
    }
    await this.binding.handle({
      type: 'answerTeamWaiting',
      waitingId: item.teamWaiting.waitingId,
      choice,
    })
  }

  /**
  The merge card (M96b): a permission request carrying the diff, in
  every mode; Bypass shows it as a completed call and merges. Anything
  but the Merge answer discards, so a merge without the person's
  approval never lands.
  */
  private async askMerge(
    sessionId: string,
    handler: AcpTeamSessionHandler,
    item: Extract<TeamCardItem, { kind: 'teamMerge' }>,
  ): Promise<void> {
    const merge = item.teamMerge
    const tree = this.binding.tree()
    const agent =
      tree === undefined
        ? merge.roleId
        : (treeWorkers(tree).find((row) => row.worker.taskId === merge.taskId)?.agent ??
          merge.roleId)
    const reviewNote =
      this.requiredReviews.has(merge.roleId) && merge.review === 'not-reviewed'
        ? ` (${UI_TEXT.teamMergeNotReviewed})`
        : ''
    const detail = `${merge.brief}${reviewNote}`
    let diffs: ToolCallContent[] = []
    try {
      diffs = await this.diffContents(merge.taskId)
    } catch (error: unknown) {
      this.deps.log.warn(`ACP team merge diff failed: ${failureForLog(error)}`)
    }
    const hasDiff = diffs.some((content) => content.type === 'diff')
    if (handler.mode() === 'bypassPermissions') {
      if (hasDiff) {
        const call = teamMergeCompletedCall({
          mergeId: merge.taskId,
          role: merge.roleId,
          agent,
          detail,
          diffs,
        })
        handler.sendUpdate({
          sessionUpdate: 'tool_call',
          toolCallId: call.toolCallId,
          title: call.title ?? merge.taskId,
          kind: TEAM_TASK_TOOL_KIND,
          status: 'completed',
          ...(call.content !== undefined && call.content !== null && { content: call.content }),
        })
      }
      await this.binding.handle({
        type: 'decideTeamMerge',
        taskId: merge.taskId,
        decision: 'merge',
      })
      return
    }
    const options: PermissionOption[] = [
      { optionId: MERGE_OPTION, name: UI_TEXT.teamMergeAction, kind: 'allow_once' },
      { optionId: DISCARD_OPTION, name: UI_TEXT.teamDiscardAction, kind: 'reject_once' },
    ]
    const request: RequestPermissionRequest = hasDiff
      ? teamMergeRequest({
          sessionId,
          mergeId: merge.taskId,
          role: merge.roleId,
          agent,
          detail,
          diffs,
          options,
        })
      : {
          sessionId,
          toolCall: {
            toolCallId: teamMergeToolCallId(merge.taskId),
            title: formatTeamPermissionTitle({ role: merge.roleId, agent, detail }),
            kind: TEAM_TASK_TOOL_KIND,
            status: 'pending',
            content: [teamReportContent(detail), ...diffs],
          },
          options,
        }
    let decision: 'merge' | 'discard' = 'discard'
    try {
      const response = await handler.requestPermission(request)
      if (response.outcome.outcome === 'selected' && response.outcome.optionId === MERGE_OPTION)
        decision = 'merge'
    } catch (error: unknown) {
      // No answer is a denial (D62): the finished branch is discarded by
      // the merge flow's own decision, never landed unapproved.
      this.deps.log.warn(`ACP team merge prompt failed: ${failureForLog(error)}`)
    }
    await this.binding.handle({ type: 'decideTeamMerge', taskId: merge.taskId, decision })
  }
  /** The board and the stored snapshot, read once before anything is admitted. */
  public async load(): Promise<void> {
    this.loading ??= (async () => {
      const folder = teamFolder(this.deps, this.cwd)
      let raw: string | undefined
      try {
        raw = await readFile(path.join(folder, ACP_TEAM_BOARD_FILE), 'utf8')
      } catch (error: unknown) {
        if (!isErrno(error) || error.code !== 'ENOENT') throw error
      }
      if (raw !== undefined) {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw) as unknown
        } catch (error: unknown) {
          if (error instanceof SyntaxError)
            throw new Error(UI_TEXT.execTeamStateUnreadable, { cause: error })
          throw error
        }
        if (!isRecord(parsed)) throw new Error(UI_TEXT.execTeamStateUnreadable)
        for (const [key, value] of Object.entries(parsed)) this.board.set(key, value)
      }
      this.stored = await readStoredTeamSnapshot({
        dataFolder: this.deps.dataFolder,
        cwd: this.cwd,
        platform: this.deps.platform,
        signal: new AbortController().signal,
        readFile: this.deps.readFile ?? fileBytes,
        budgetUsd: dailyBudget(this.deps),
        onLoweredBudget: (cap) => {
          this.loweredBudget = cap
        },
        onRequireReviews: (roles) => {
          this.requiredReviews = new Set(roles)
        },
      })
    })()
    await this.loading
  }

  /** `teamSessionAdmission` over the stored team (its production caller). */
  public admission(modelId: string): { ok: true } | { ok: false; reason: string } {
    return teamSessionAdmission(
      {
        sessionModelId: modelId,
        customEntries: this.candidates(),
        teamSwitchOff: false,
        teamWorkersOn: this.deps.paid()?.isOn('teamWorkers') ?? false,
      },
      isSameTeamModel,
    )
  }

  /** Loads the service and probes its entries, then reads its conversation mode. */
  public async modeForNew(modelId: string): Promise<TeamConversationMode> {
    this.orchestratorModel = modelId
    await this.binding.open()
    if (this.deps.backendKind === 'museCode') return this.binding.teamMcp.modeForNewConversation()
    const source = this.binding.seams.teamDecisionSource(modelId)
    return source === undefined ? 'single-model' : decideTeamConversationMode(source).mode
  }

  public modeForSession(sessionId: string): TeamConversationMode {
    return this.binding.teamMcp.modeForSession(sessionId)
  }

  public async endpoint(sessionId?: string) {
    return await this.binding.teamMcp.endpointForConversation(sessionId)
  }

  /** Binds one started session: its mode is recorded, its handler registered. */
  public async attach(
    sessionId: string,
    handler: AcpTeamSessionHandler,
    isTeam: boolean,
    remember: TeamConversationMode | undefined,
  ): Promise<void> {
    if (remember !== undefined) await this.binding.teamMcp.rememberMode(sessionId, remember)
    if (!isTeam) return
    this.handlers.set(sessionId, handler)
    this.showTreeTo(sessionId, handler, this.binding.tree())
  }

  public async cancel(sessionId: string): Promise<void> {
    await this.binding.stopSessionTasks(sessionId)
  }

  public async close(sessionId: string): Promise<void> {
    this.handlers.delete(sessionId)
    this.announced.delete(sessionId)
    this.plans.delete(sessionId)
    await this.binding.stopSessionTasks(sessionId)
  }
  public async dispose(): Promise<void> {
    if (this.isDisposed) return
    this.isDisposed = true
    this.handlers.clear()
    await this.binding.dispose()
    await this.writes
  }
}

/** The ACP agent's team (`serve --team`): one workspace binding per folder. */
export function createAcpTeam(deps: AcpTeamDeps, table: UiText, locale: string): AcpTeamPort {
  setUiText(table, locale)
  const workspaces = new Map<string, WorkspaceTeam>()
  const workspaceFor = (cwd: string): WorkspaceTeam => {
    const known = workspaces.get(cwd)
    if (known !== undefined) return known
    const created = new WorkspaceTeam(deps, table, locale, cwd)
    workspaces.set(cwd, created)
    return created
  }
  const prepared = (
    team: WorkspaceTeam,
    isTeam: boolean,
    remember: TeamConversationMode | undefined,
    mcpServer?: SessionMcpHttpServer,
    notice?: string,
  ): AcpTeamPrepared => ({
    isTeam,
    ...(notice !== undefined && { notice }),
    ...(mcpServer !== undefined && { mcpServer }),
    attach: async (sessionId, handler) => {
      await team.attach(sessionId, handler, isTeam, remember)
      return {
        isTeamOn: () => isTeam,
        cancel: () => team.cancel(sessionId),
        close: () => team.close(sessionId),
      }
    },
  })
  const refuseNew = (team: WorkspaceTeam, modelId: string): Error => {
    const admission = team.admission(modelId)
    return teamRefusal(admission.ok ? UI_TEXT.teamNeedsSecondModel : admission.reason)
  }
  return {
    prepareNew: async (cwd, modelId) => {
      try {
        const team = workspaceFor(cwd)
        await team.load()
        const admission = team.admission(modelId)
        if (!admission.ok) throw teamRefusal(admission.reason)
        const mode = await team.modeForNew(modelId)
        if (mode !== 'team') throw refuseNew(team, modelId)
        if (deps.backendKind === 'museCode') {
          const endpoint = await team.endpoint()
          if (endpoint === undefined)
            throw teamRefusal(fill(UI_TEXT.teamRunnerUnavailable, { tool: TEAM_MCP_SERVER_NAME }))
          return prepared(team, true, 'team', endpoint)
        }
        return prepared(team, true, 'team')
      } catch (error: unknown) {
        throw asTeamRefusal(error)
      }
    },
    prepareResume: async (cwd, sessionId, modelId) => {
      const team = workspaceFor(cwd)
      await team.load()
      if (team.modeForSession(sessionId) !== 'team') return prepared(team, false, undefined)
      const admission = team.admission(modelId)
      if (!admission.ok) return prepared(team, false, 'single-model', undefined, admission.reason)
      const mode = await team.modeForNew(modelId)
      if (mode !== 'team')
        return prepared(team, false, 'single-model', undefined, UI_TEXT.teamNeedsSecondModel)
      if (deps.backendKind === 'museCode') {
        const endpoint = await team.endpoint(sessionId)
        return endpoint === undefined
          ? prepared(
              team,
              false,
              'single-model',
              undefined,
              fill(UI_TEXT.teamRunnerUnavailable, { tool: TEAM_MCP_SERVER_NAME }),
            )
          : prepared(team, true, 'team', endpoint)
      }
      return prepared(team, true, 'team')
    },
    seamsFor: (cwd): TeamHostSeams => workspaceFor(cwd).binding.seams,
    dispose: async () => {
      await Promise.all(Array.from(workspaces.values(), (team) => team.dispose()))
      workspaces.clear()
    },
  }
}
