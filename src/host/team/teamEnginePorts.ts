// The engine worker and merge ports (M96 lanes W and I, C-M96-3). An engine
// entry's task runs as a Model API conversation of its own, rooted in the
// task's own copy of the repository (`own-branch`: a shared clone on
// `agents/<role>/<task-id>`; `read-only`: a detached scratch copy), with the
// file tools only. The extension commits the branch at the end and publishes
// the `agents/` ref; only the orchestrator's `merge` writes the user's tree.
// Loads with dist/team.js; the host supplies the conversation and the paths.

import { mkdir, realpath } from 'node:fs/promises'
import {
  UI_TEXT,
  PERMISSION_MODES,
  TEAM_MODEL_TEXT,
  TEAM_ROLE_TOOLSETS,
  TEAM_TASK_MAX_REQUESTS_DEFAULT,
  TEAM_TASK_MAX_REQUESTS_WRITER,
  TEAM_TASK_MAX_REQUESTS_WRITER_ROLES,
  TEAM_THROTTLE_RECOVER_MS,
  TEAM_USAGE_LIMIT_COOLDOWN_MS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { approvalModeFor } from '../../shared/permissionModes'
import { type UsdAmount } from '../../shared/usd'
import type { TeamAgentRef, TeamReport, TeamUsage } from '../../shared/team'
import { sumUsd } from '../../shared/usd'
import { canonicalUsd } from '../../shared/usdSchema'
import type { SubagentUsage } from '../../shared/paid'
import type { AgentSession } from '../../core/agent/agentBackend'
import type { CoreLogger } from '../../core/logging'
import { AgentWorktreeSession } from '../../core/bestOfN/agentWorktreeSession'
import { builtinRoles } from '../../core/team/builtInRoles'
import { validateWorkerSettings, type TeamSettingCapabilities } from '../../core/team/modelSettings'
import { buildTeamCharter } from '../../core/team/charter'
import { isSameTeamModel } from '../../core/team/sameModel'
import { resolveTeamToolset } from '../../core/team/toolsets'
import { applyTeamMerge } from '../../core/team/teamMerge'
import {
  commitTaskBranch,
  publishTaskRef,
  removeTeamWorkspace,
  resolveBaseCommit,
  scratchBreach,
  startTeamWorkspace,
} from '../../core/team/teamWorkspaces'
import { isTeamGitError, type TeamGit } from '../../core/team/teamGit'
import { runEngineWorker } from '../../core/team/workers/engineWorker'
import { WORKER_NATIVE_IO } from '../../core/team/workers/workerFence'
import type { WorkerReportOutcome } from '../../core/team/workers/report'
import type {
  TeamHostServiceDeps,
  TeamMergePort,
  TeamTaskSpec,
  TeamWorkerOutcome,
  TeamWorkerPort,
} from '../../core/team/teamHostService'
import type {
  ResponseAttemptGuard,
  ResponseAttemptOutcome,
} from '../../core/backends/modelapi/transport'
import type { ToolIo } from '../../core/backends/modelapi/tools'
import { assertWorkerRoot } from '../../core/team/workers/workerFence'

/** One worker conversation the host started in the task's copy. */
export interface EngineWorkerSession {
  readonly session: AgentSession
  /** The tools that conversation offers: the charter's "You may" meets them. */
  readonly toolNames: readonly string[]
  readonly close: () => Promise<void>
}

export interface EngineTeamPortsDeps {
  /** The user's repository: the workspace folder; undefined without one. */
  readonly repositoryRoot: () => string | undefined
  /** The extension's own storage for this workspace: copies live under `agents/`. */
  readonly storageRoot: string
  readonly platform: NodeJS.Platform
  readonly isTrusted: () => boolean
  /** The engine's model list: the declared setup probe reads it. */
  readonly rates?: TeamWorkerPort['rates']
  readonly listModels: () => Promise<readonly string[]>
  /**
  The entry model's current capability record for pre-dispatch
  validation, qualified provider ids included. Absent keeps the fixed
  family table (unknown families stay lenient; the session re-checks).
  */
  readonly capabilitiesForModel?:
    | ((modelId: string) => TeamSettingCapabilities | undefined)
    | ((modelId: string) => Promise<TeamSettingCapabilities | undefined>)
  /** A Model API conversation rooted in `folder`, billed as `teamWorkers`. */
  readonly startWorker: (input: {
    readonly settings?: TeamTaskSpec['entry']['settings']
    readonly folder: string
    readonly modelId: string
    readonly approvalMode: string
    readonly admit: ResponseAttemptGuard
    readonly noteUsage: (modelId: string, usage: SubagentUsage) => void
    readonly parentSessionId: string
    /** Every file call of the worker's tools goes through the task's fence. */
    readonly fenceIo: (io: ToolIo) => ToolIo
  }) => Promise<EngineWorkerSession>
  readonly runGit?: TeamGit | undefined
  readonly now: () => number
  readonly log: CoreLogger
}

/** What dist/team.js takes from an editor: the service's ports and the engine's. */
export interface TeamHostBundleDeps extends Omit<TeamHostServiceDeps, 'workers' | 'merges'> {
  readonly engine: EngineTeamPortsDeps
}

/**
Binary-safe git with a credential-free environment unless the caller isolates further.
The governed runner lives in the first-use worker-operations chunk beside the
file adapter, so this entry keeps its budget; the inventory records that site.
*/
async function defaultTeamGit(platform: NodeJS.Platform): Promise<TeamGit> {
  const { processTeamGit } = await import('../../core/team/workers/workerOpsEntry')
  return processTeamGit(platform)
}

function teamReport(outcome: WorkerReportOutcome, isCeilingReached: boolean): TeamReport {
  if (outcome.ok) return outcome.report
  const summary = outcome.summary.trim() === '' ? TEAM_MODEL_TEXT.hostNoReport : outcome.summary
  if (isCeilingReached || outcome.status === 'capped') return { status: 'capped', summary }
  return { status: outcome.status === 'unstructured' ? 'unstructured' : 'failed', summary }
}

function addUsage(total: TeamUsage, usage: SubagentUsage): TeamUsage {
  return {
    input: total.input + usage.inputTokens,
    cachedInput: total.cachedInput + usage.cachedTokens,
    output: total.output + usage.outputTokens,
    reasoning: total.reasoning,
    modelCalls: total.modelCalls + 1,
    ...((total.costUsd !== undefined || usage.costUsd !== undefined) && {
      costUsd: sumUsd(
        ...(total.costUsd === undefined ? [] : [total.costUsd]),
        canonicalUsd(usage.costUsd ?? 0),
      ),
    }),
    estimated: total.estimated,
  }
}

/**
The MSP approval mode a role's saved permission mode selects for its
worker. An untouched selector reads as Plan (what the editor shows), so
only an explicit bypassPermissions allows everything; anything the panel
could not have saved is refused instead of run wide.
*/
function workerApprovalMode(permissionMode: string | undefined = 'plan'): string {
  const saved = PERMISSION_MODES.find((mode) => mode === permissionMode)
  if (saved === undefined) throw new Error(UI_TEXT.teamEditor.invalid)
  return approvalModeFor(saved, false)
}

/**
Best-effort removal of a copy the task made but never handed back. A
failure warns with fixed words (never the raw error) and stays silent
otherwise: the outer handler already rethrows the task's own failure.
*/
async function removeUnreturnedCopy(input: {
  readonly runGit: TeamGit
  readonly repositoryRoot: string
  readonly storageRoot: string
  readonly folder: string
  readonly agentsRef: string | undefined
  readonly noteWorkspace: () => Promise<void>
  readonly warn: (message: string) => void
  readonly taskId: string
}): Promise<void> {
  try {
    await removeTeamWorkspace(
      input.runGit,
      input.repositoryRoot,
      input.storageRoot,
      input.folder,
      input.agentsRef,
    )
    await input.noteWorkspace()
  } catch {
    input.warn(`Team task ${input.taskId}: its cleanup or recovery record could not be completed`)
  }
}

/** A worker runs no goal or background work to stop at its turn's end. */
function noTerminalWork(): void {
  // Nothing to stop: the worker host has no goals, schedules or background tasks.
}

const EMPTY_USAGE: TeamUsage = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  modelCalls: 0,
  estimated: false,
}

/** The engine worker and merge ports over one workspace's repository. */
export function createEngineTeamPorts(deps: EngineTeamPortsDeps): {
  readonly workers: TeamWorkerPort
  readonly merges: TeamMergePort
} {
  let defaultGit: Promise<TeamGit> | undefined
  const runGit: TeamGit =
    deps.runGit ??
    (async (args, cwd, input, env) =>
      await (
        await (defaultGit ??= defaultTeamGit(deps.platform))
      )(args, cwd, input, env))
  /**
  The storage root as the file system resolves it: a linked profile or a
  temporary folder behind a link (macOS's /var) is admitted by its real path,
  which the copies' fence compares against.
  */
  let canonical: Promise<string> | undefined
  const storage = async (): Promise<string> => {
    canonical ??= (async () => {
      await mkdir(deps.storageRoot, { recursive: true })
      return await realpath(deps.storageRoot)
    })()
    try {
      return await canonical
    } catch (error: unknown) {
      canonical = undefined
      throw error
    }
  }
  const limitedUntil = new Map<string, number>()
  const repository = (): string => {
    const root = deps.repositoryRoot()
    if (root === undefined) throw new Error(TEAM_MODEL_TEXT.hostNoRepository)
    return root
  }

  // Named apart from the eval harness's own runTask: the spawn-inventory
  // test-only proof matches identifiers by name, and these are different
  // runners (an engine worker task here, a paired eval case there).
  const runWorkerTask = async (
    spec: TeamTaskSpec,
    signal: AbortSignal,
  ): Promise<TeamWorkerOutcome> => {
    signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
    // The complete saved settings are checked against the entry model's
    // current capabilities before the working copy exists: an unsupported
    // value refuses with its reason, never silently changed or clamped later.
    const unsupported = validateWorkerSettings(
      spec.entry.settings,
      spec.entry.agent.model,
      await deps.capabilitiesForModel?.(spec.entry.agent.model),
    )
    if (unsupported !== undefined) throw new Error(unsupported)
    const repositoryRoot = repository()
    const builtin = builtinRoles().find((role) => role.id === spec.role.role)
    if (
      builtin === undefined &&
      (spec.role.purpose?.trim() === undefined ||
        spec.role.purpose.trim() === '' ||
        spec.role.workspace === undefined ||
        spec.role.tools === undefined ||
        spec.role.report === undefined)
    ) {
      throw new Error(fill(TEAM_MODEL_TEXT.hostRoleNotOffered, { role: spec.role.role }))
    }
    // A review reads the reviewed branch at its head, in a scratch copy.
    const reviewed = spec.reviewOf
    const mode =
      reviewed === undefined
        ? (spec.role.workspace ?? builtin?.workspace ?? 'read-only')
        : 'read-only'
    if (mode === 'in-place') throw new Error(TEAM_MODEL_TEXT.hostInPlaceNotOffered)
    const previous = spec.continueFrom
    const baseCommit =
      reviewed?.head ?? previous?.baseCommit ?? (await resolveBaseCommit(runGit, repositoryRoot))
    const workspace =
      previous?.folder === undefined
        ? await startTeamWorkspace(runGit, await storage(), deps.platform, {
            repositoryRoot,
            role: spec.role.role,
            taskId: spec.taskId,
            mode,
            baseCommit,
          })
        : { folder: previous.folder, branch: previous.branch, agentsRef: previous.agentsRef }
    const isNewCopy = previous?.folder === undefined
    let usage = EMPTY_USAGE
    let meterWrites = Promise.resolve()
    let hasReservations = false
    const recordWrite = (saved: Promise<void>): void => {
      const previousWrite = meterWrites
      meterWrites = (async () => {
        await Promise.all([previousWrite, saved])
      })()
      // Completion and the next reservation await this write. The synchronous
      // usage observer cannot await it; the service already records a failure.
      void meterWrites.catch(() => {
        /* Failure is surfaced by the next await. */
      })
    }
    try {
      await spec.meter.noteWorkspace({
        folder: workspace.folder,
        baseCommit,
        branch: workspace.branch,
        agentsRef: workspace.agentsRef,
      })
      signal.throwIfAborted()
      const groups =
        spec.role.tools ?? (builtin === undefined ? [] : TEAM_ROLE_TOOLSETS[builtin.id])
      const writePaths = spec.role.writePaths ?? builtin?.writePaths
      const fenceInput = {
        folder: workspace.folder,
        platform: deps.platform,
        io: WORKER_NATIVE_IO,
        workspaceRoot: repositoryRoot,
      }
      // The copy's identity is retained now: a replaced copy refuses every later call.
      const grant = await assertWorkerRoot(fenceInput)
      const check = (): void => {
        signal.throwIfAborted()
        spec.meter.admitRequest(true)
      }
      const admit: ResponseAttemptGuard = Object.assign(check, {
        reserveUsage: async (maximum: {
          inputTokens: number
          outputTokens: number
          costUsd?: UsdAmount | undefined
        }) => {
          check()
          await meterWrites
          check()
          const requestOrdinal = await spec.meter.reserveRequest({
            ...EMPTY_USAGE,
            input: maximum.inputTokens,
            output: maximum.outputTokens,
            modelCalls: 1,
            estimated: true,
            ...(maximum.costUsd !== undefined && { costUsd: canonicalUsd(maximum.costUsd) }),
          })
          hasReservations = true
          // The host's final synchronous fence runs after it owns this callback.
          // Every result belongs to this ordinal, including refused/unsent attempts.
          let hasSettled = false
          const settle = async (outcome: ResponseAttemptOutcome) => {
            if (hasSettled) return
            hasSettled = true
            const reported = outcome.kind === 'billed' ? outcome.usage : undefined
            recordWrite(
              spec.meter.settleRequest(
                requestOrdinal,
                {
                  ...EMPTY_USAGE,
                  ...(outcome.kind === 'ambiguous' && {
                    input: maximum.inputTokens,
                    output: maximum.outputTokens,
                    modelCalls: 1,
                    estimated: true,
                    ...(maximum.costUsd !== undefined && {
                      costUsd: canonicalUsd(maximum.costUsd),
                    }),
                  }),
                  ...(reported !== undefined && {
                    input: reported.inputTokens,
                    cachedInput: reported.cachedTokens,
                    output: reported.outputTokens,
                    modelCalls: 1,
                    ...(reported.costUsd !== undefined && { costUsd: reported.costUsd }),
                  }),
                  ...(outcome.kind === 'released' && { costUsd: canonicalUsd(0) }),
                },
                true,
              ),
            )
            await meterWrites
          }
          try {
            check()
          } catch (error: unknown) {
            // A late durable admission owns only its unsent ordinal, never an ended task.
            await settle({ kind: 'released' })
            throw error
          }
          return settle
        },
      })
      const { fenceWorkerToolIo } = await import('../../core/team/workers/workerToolIoEntry')
      check()
      const worker = await deps.startWorker({
        settings: spec.entry.settings,
        folder: workspace.folder,
        modelId: spec.entry.agent.model,
        // The role's saved permission mode runs the worker: Plan (the
        // editor's default for an untouched selector) denies edits, and only
        // bypassPermissions allows everything. A worker has no approval UI to
        // answer prompts, so prompting modes deny as well. A read-only copy
        // takes none regardless of the role.
        approvalMode:
          mode === 'read-only' ? 'denyUnmatched' : workerApprovalMode(spec.role.permissionMode),
        admit,
        noteUsage: (_modelId, reported) => {
          usage = addUsage(usage, reported)
          if (!hasReservations) recordWrite(spec.meter.noteUsage(usage))
        },
        parentSessionId: spec.parentSessionId,
        fenceIo: (io) =>
          fenceWorkerToolIo(io, {
            input: { ...fenceInput, grant },
            role: {
              roleId: spec.role.role,
              workspaceMode: mode,
              toolGroups: groups,
              ...(writePaths !== undefined && { writePaths }),
              reportShape: spec.role.report ?? builtin?.report ?? 'summary',
            },
            admit: () => {
              signal.throwIfAborted()
              spec.meter.admitRequest()
            },
          }),
      })
      spec.meter.noteSession?.(worker.session.sessionId)
      const adapter = new AgentWorktreeSession(worker.session, noTerminalWork)
      const stop = (): void => {
        void adapter.cancel().catch(() => {
          deps.log.warn('A team worker cancellation settled elsewhere')
        })
      }
      signal.addEventListener('abort', stop)
      let result
      try {
        const tools = resolveTeamToolset(
          { groups, writePaths },
          {
            offered: worker.toolNames,
            webSearchAllowed: false,
            imagesAllowed: false,
            delegates: [],
          },
        )
        const charter = buildTeamCharter(
          {
            id: spec.role.role,
            description: spec.role.purpose ?? builtin?.description ?? spec.role.role,
            workspace: mode,
            writePaths,
            done: spec.role.done ?? builtin?.done,
            report: spec.role.report ?? builtin?.report ?? 'summary',
            delegates: [],
            body: spec.role.guidance ?? builtin?.body ?? '',
          },
          tools,
        )
        const handoffData = previous?.report ?? reviewed?.report
        const handoff =
          handoffData === undefined
            ? ''
            : `\n\n${TEAM_MODEL_TEXT.handoffDataOpen}\n${JSON.stringify(handoffData)}\n${TEAM_MODEL_TEXT.handoffDataClose}`
        result = await runEngineWorker({
          task: {
            taskId: spec.taskId,
            roleId: spec.role.role,
            brief: `${spec.brief}${handoff}`,
            branch: workspace.branch ?? '',
            folder: workspace.folder,
            files: spec.files,
          },
          workspaceRoot: repositoryRoot,
          role: {
            roleId: spec.role.role,
            workspaceMode: mode,
            toolGroups: tools.groups,
            ...(writePaths !== undefined && { writePaths }),
            reportShape:
              reviewed === undefined
                ? (spec.role.report ?? builtin?.report ?? 'summary')
                : 'review',
          },
          prompt: { charter: charter.generated, body: charter.body, rulesAndSkills: '' },
          isTrusted: deps.isTrusted(),
          io: WORKER_NATIVE_IO,
          platform: deps.platform,
          session: adapter,
          requestCeiling: (TEAM_TASK_MAX_REQUESTS_WRITER_ROLES as readonly string[]).includes(
            spec.role.role,
          )
            ? TEAM_TASK_MAX_REQUESTS_WRITER
            : TEAM_TASK_MAX_REQUESTS_DEFAULT,
          declineChoiceId: 'abort',
          agentId: spec.entry.agent.agentId,
          marks: {
            markRateLimited: (agentId, retryAfterMs) => {
              limitedUntil.set(agentId, deps.now() + (retryAfterMs ?? TEAM_THROTTLE_RECOVER_MS))
            },
            markUsageLimited: (agentId) => {
              limitedUntil.set(agentId, deps.now() + TEAM_USAGE_LIMIT_COOLDOWN_MS)
            },
          },
          readTranscriptTail: () => Promise.resolve(adapter.lastMessage()),
          log: deps.log,
        })
      } finally {
        signal.removeEventListener('abort', stop)
        await worker.close()
      }
      await meterWrites
      signal.throwIfAborted()
      const report = teamReport(result.report, result.outcome.ceilingReached)
      if (mode === 'read-only') {
        const breach = await scratchBreach(runGit, workspace.folder)
        await removeTeamWorkspace(runGit, repositoryRoot, await storage(), workspace.folder)
        await spec.meter.noteWorkspace(undefined)
        return {
          isCeilingReached: result.outcome.ceilingReached,
          report:
            breach.length === 0
              ? report
              : {
                  status: 'failed',
                  summary: `${TEAM_MODEL_TEXT.hostReadOnlyBreach} ${breach.join(', ')}`,
                },
          usage,
        }
      }
      const branch = workspace.branch ?? ''
      const before = previous?.head ?? baseCommit
      const committed = await commitTaskBranch(runGit, workspace.folder, {
        branch,
        role: spec.role.role,
        taskId: spec.taskId,
        entryId: spec.entry.id,
      })
      if (committed.committed && workspace.agentsRef !== undefined) {
        await publishTaskRef(
          runGit,
          repositoryRoot,
          workspace.folder,
          branch,
          workspace.agentsRef,
          before,
        )
      }
      const changed = new TextDecoder()
        .decode(
          await runGit(
            ['diff', '--name-only', '-z', '--no-renames', baseCommit, committed.head, '--'],
            workspace.folder,
          ),
        )
        .split('\0')
        .filter((name) => name !== '')
      signal.throwIfAborted()
      return {
        isCeilingReached: result.outcome.ceilingReached,
        report,
        usage,
        branch,
        baseCommit,
        head: committed.head,
        changedFiles: changed,
        folder: workspace.folder,
        agentsRef: workspace.agentsRef,
      }
    } catch (error: unknown) {
      // A copy this task made and never handed back is removed; a reopened
      // task's copy stays with the finished task it came from.
      if (isNewCopy) {
        await removeUnreturnedCopy({
          runGit,
          repositoryRoot,
          storageRoot: await storage(),
          folder: workspace.folder,
          agentsRef: workspace.agentsRef,
          noteWorkspace: async () => {
            await spec.meter.noteWorkspace(undefined)
          },
          warn: (message: string) => {
            deps.log.warn(message)
          },
          taskId: spec.taskId,
        })
      }
      throw error
    }
  }

  const workers: TeamWorkerPort = {
    ...(deps.rates !== undefined && { rates: deps.rates }),
    canRun: (agent) => agent.kind === 'engine',
    probe: async (agent) => {
      const listed = await deps.listModels()
      return listed.some((model) => isSameTeamModel(model, agent.model))
    },
    run: runWorkerTask,
    isLimited: (agent: TeamAgentRef) => (limitedUntil.get(agent.agentId) ?? 0) > deps.now(),
  }

  const merges: TeamMergePort = {
    merge: async (task, signal, options) => {
      signal.throwIfAborted()
      const outcome = task.outcome
      if (
        outcome.folder === undefined ||
        outcome.agentsRef === undefined ||
        outcome.baseCommit === undefined ||
        outcome.head === undefined
      ) {
        throw new Error(TEAM_MODEL_TEXT.hostMergeNotReady)
      }
      const repositoryRoot = repository()
      const builtin = builtinRoles().find((role) => role.id === task.role.role)
      let actual: string | undefined
      try {
        actual = new TextDecoder()
          .decode(await runGit(['rev-parse', '--verify', outcome.agentsRef], repositoryRoot))
          .trim()
      } catch (error: unknown) {
        // An unknown ref (or unreadable repo) leaves the head unverified;
        // anything else is loud.
        if (isTeamGitError(error)) actual = undefined
        else throw error
      }
      const writePaths = task.role.writePaths ?? builtin?.writePaths
      signal.throwIfAborted()
      const result = await applyTeamMerge(
        { runGit, realPath: (candidate) => WORKER_NATIVE_IO.realPath(candidate) },
        {
          repositoryRoot,
          baseCommit: outcome.baseCommit,
          branchHead: outcome.head,
          ...(writePaths !== undefined && { writePaths }),
          agentRefs: [{ ref: outcome.agentsRef, expected: outcome.head, actual }],
          taskFolder: outcome.folder,
        },
        // The merge card listed the protected paths; the user's Merge approved them.
        { platform: deps.platform, allowProtected: options.allowProtected },
      )
      if (result.status === 'merged') {
        await removeTeamWorkspace(
          runGit,
          repositoryRoot,
          await storage(),
          outcome.folder,
          outcome.agentsRef,
        )
      }
      return {
        status: result.status,
        written: result.written,
        conflicts: result.conflicts.map((conflict) => conflict.path),
      }
    },
    diff: async (outcome) => {
      if (
        outcome.folder === undefined ||
        outcome.baseCommit === undefined ||
        outcome.head === undefined
      )
        throw new Error(TEAM_MODEL_TEXT.hostMergeNotReady)
      return new TextDecoder().decode(
        await runGit(
          [
            'diff',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            outcome.baseCommit,
            outcome.head,
            '--',
          ],
          outcome.folder,
        ),
      )
    },
    discard: async (task) => {
      const folder = task.outcome?.folder
      if (folder === undefined) return
      await removeTeamWorkspace(
        runGit,
        repository(),
        await storage(),
        folder,
        task.outcome?.agentsRef,
      )
    },
  }
  return { workers, merges }
}
