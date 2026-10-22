// M96b headless policy loads only for --team, after exec preflight.
import { randomUUID } from 'node:crypto'
import { availableParallelism, tmpdir } from 'node:os'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type {
  TeamHostSeams,
  TeamHostService,
  TeamStatePort,
  TeamTaskSpec,
  TeamWorkerOutcome,
} from '../../core/team/teamHostService'
import type { EngineTeamPortsDeps } from '../../host/team/teamEnginePorts'
import type { TeamGit } from '../../core/team/teamGit'
import type { TeamToolResult } from '../../core/team/teamSeams'
import { isProtectedPath } from '../../core/protectedPaths'
import { redactSecrets } from '../../core/redact'
import { isErrno } from '../../core/fs/errno'
import { failureForLog } from '../../core/backends/musecode/logText'
import { teamSnapshotSchema, type TeamSnapshot } from '../../shared/team'
import { TEAM_WORKSPACE_KEYS, hasRunnableTeamEntry } from '../../shared/teamConversation'
import { lowerTeamWithJson, parseTeamJson, teamJsonPath } from '../../core/team/teamConfig'
import {
  ACP_SESSIONS_SUBFOLDER,
  EXEC_PROMPT_MAX_BYTES,
  EXEC_TEAM_GIT_OUTPUT_BYTES,
  EXEC_TEAM_STATE_FILE,
  EXEC_TEAM_RUN_PREFIX,
  EXEC_TEAM_BOARD_FILE,
  EXEC_TEAM_FILE_MODE,
  UI_TEXT,
} from '../../shared/constants'
import { fill, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { Usd, type UsdAmount } from '../../shared/usd'
import { workspaceKey } from '../dataFolder'
import type { CoreLogger } from '../../core/logging'
import {
  createHoldRef,
  currentOwner,
  isGitTimeout,
  predictedAgentsRef,
  pruneCleanupRef,
  recordCleanupOwner,
  recordCleanupRef,
  recordHoldRef,
  releaseHoldRef,
  removeStaleCleanupRefs,
  scanConflictMarkers,
  sweepStaleTeamRuns,
} from './execTeamRecovery'

export interface ExecTeamDeps {
  readonly dataFolder: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly provider: string | undefined
  readonly defaultPays: 'key' | 'local'
  readonly budgetUsd: UsdAmount
  readonly signal: AbortSignal
  readonly now: () => number
  readonly log: CoreLogger
  readonly readFile: (file: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  readonly listModels: () => Promise<readonly string[]>
  readonly startWorker: EngineTeamPortsDeps['startWorker']
  readonly onWritten: (files: readonly string[]) => void
  readonly secretLiterals: () => readonly string[]
  readonly lowerWorkerCap: (capUsd: UsdAmount) => void
}

export interface ExecTeam extends TeamHostSeams {
  /** Called after exec has resolved/validated its selected provider and model. */
  readonly prepare: (model: string) => Promise<void>
  readonly close: () => Promise<void>
}

async function optionalText(deps: ExecTeamDeps, file: string): Promise<string | undefined> {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      await deps.readFile(file, EXEC_PROMPT_MAX_BYTES, deps.signal),
    )
  } catch (error: unknown) {
    if (isErrno(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function invalid(reason: string): Error {
  return new Error(fill(UI_TEXT.execTeamConfigInvalid, { reason }))
}

/**
RVCM96B2 P3-9: team.json failures reach the user through the translated
table keys, never as raw zod or JSON text. The entry path (a key the user
wrote) is spliced as the technical detail.
*/
function configRefusal(reason: string): Error {
  if (reason === 'team.json is not JSON') return new Error(UI_TEXT.execTeamConfigNotJson)
  if (reason === 'team.json holds an object') return new Error(UI_TEXT.execTeamConfigNotObject)
  if (reason === 'team.json holds an invalid sharedFiles')
    return new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry: 'sharedFiles' }))
  const separator = reason.indexOf(': ')
  const entry =
    separator === -1
      ? reason.replace(/^team\.json (adds an? |raises |holds an (unknown key|invalid) )/, '')
      : reason.slice(separator + 2).trim()
  if (reason.includes(' adds ') || reason.includes(' raises '))
    return new Error(fill(UI_TEXT.execTeamConfigLowersOnly, { entry }))
  return entry === reason
    ? invalid(reason)
    : new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry }))
}

/** Lower only the snapshot's existing caps; repository text cannot add agents. */
async function lowerSnapshot(
  deps: ExecTeamDeps,
  snapshot: TeamSnapshot,
  requireReviews: (roles: readonly string[]) => void,
): Promise<TeamSnapshot> {
  const raw = await optionalText(deps, teamJsonPath(deps.cwd, deps.platform))
  if (raw === undefined) return snapshot
  const parsed = parseTeamJson(raw)
  if (!parsed.ok) throw configRefusal(parsed.reason)
  const roles = Object.fromEntries(
    snapshot.roles.map((role) => {
      const measures = new Set(role.pool.flatMap((entry) => entry.caps.map((cap) => cap.measure)))
      const caps: Record<string, number> = {
        concurrent: Math.min(...role.pool.map((entry) => entry.concurrent)),
      }
      for (const measure of measures) {
        const values = role.pool.map((entry) => entry.caps.filter((cap) => cap.measure === measure))
        if (values.every((value) => value.length > 0))
          caps[measure] = Math.min(...values.flat().map((cap) => cap.amount))
      }
      return [role.role, { caps }]
    }),
  )
  const lowering = lowerTeamWithJson({ roles, budgets: { spendUsd: deps.budgetUsd } }, parsed.file)
  if (!lowering.ok) throw configRefusal(lowering.reason)
  const budget = lowering.lowered.budgets['spendUsd']
  if (budget !== undefined) {
    // The file's number enters the exact decimal type directly; more than
    // six decimals is refused in the translated table key, not in English.
    try {
      deps.lowerWorkerCap(Usd.from(budget).toAmount())
    } catch (error: unknown) {
      throw new Error(fill(UI_TEXT.execTeamConfigBadEntry, { entry: 'budgets.spendUsd' }), {
        cause: error,
      })
    }
  }
  // This host's review role is code-review. Refuse a different requirement rather than ignore it.
  const unsupportedReviewer = Object.entries(lowering.lowered.reviewers).find(
    ([, reviewer]) => reviewer !== 'code-review',
  )
  if (
    unsupportedReviewer !== undefined ||
    (Object.keys(lowering.lowered.reviewers).length > 0 &&
      snapshot.roles.every((role) => !(role.role === 'code-review' && role.pool.length > 0)))
  )
    throw new Error(
      fill(UI_TEXT.execTeamReviewerUnsupported, {
        entry:
          unsupportedReviewer === undefined
            ? 'code-review'
            : `roles.${unsupportedReviewer[0]}.reviewer`,
      }),
    )
  requireReviews(Object.keys(lowering.lowered.reviewers))
  return {
    ...snapshot,
    roles: snapshot.roles
      .filter((role) => !lowering.lowered.offRoles.includes(role.role))
      .map((role) => ({
        ...role,
        pool: role.pool.map((entry) => ({
          ...entry,
          concurrent: Math.min(
            entry.concurrent,
            lowering.lowered.caps[role.role]?.['concurrent'] ?? entry.concurrent,
          ),
          caps: entry.caps.map((cap) => ({
            ...cap,
            amount: Math.min(
              cap.amount,
              lowering.lowered.caps[role.role]?.[cap.measure] ?? cap.amount,
            ),
          })),
        })),
      })),
  }
}

function unavailable(tool: string): TeamToolResult {
  const reason = fill(UI_TEXT.teamRunnerUnavailable, { tool })
  return { output: `Error: ${reason}`, visibleOutput: reason }
}

/**
RVCM96B2 P2-6: which hold a merge takes, if any. The card's denial wins;
otherwise any protected file (Windows spellings normalized, so a path
POSIX git reports with backslashes still holds) takes the protected
hold. Exported for tests: POSIX workers cannot produce a backslash
spelling (the tool fence refuses protected writes first, on every
platform), so only a unit test reaches the normalization branch here.
*/
export function needsMergeHold(
  denied: 'protected' | 'review' | undefined,
  changedFiles: readonly string[],
): 'protected' | 'review' | undefined {
  if (denied === 'review') return 'review'
  if (denied === 'protected') return 'protected'
  return changedFiles.some((name) => isProtectedPath(name.replaceAll('\\', '/')))
    ? 'protected'
    : undefined
}

/** The translated hold report for a kept branch: where, why, and how to end it. */
export function heldMergeError(kind: 'protected' | 'review', ref: string): Error {
  return new Error(
    fill(kind === 'review' ? UI_TEXT.execTeamMergeHeldReview : UI_TEXT.execTeamMergeHeldProtected, {
      ref,
    }),
  )
}

/**
A refused tool call carries the tool's bounded output, never a raw dump.
Falls back to the technical fallback (a ref or file name) when the tool
said nothing, so no new prose is needed.
*/
function gitFailureDetail(error: unknown, fallback: string): string {
  // Our own bounded-wait timeout carries no tool output: fall back to the
  // technical name instead of leaking the timeout's English text.
  if (isGitTimeout(error)) return fallback
  if (
    typeof error === 'object' &&
    error !== null &&
    'stderr' in error &&
    typeof error.stderr === 'string' &&
    error.stderr.trim() !== ''
  )
    return error.stderr.trim().slice(0, EXEC_TEAM_GIT_OUTPUT_BYTES)
  return error instanceof Error && error.message !== ''
    ? error.message.slice(0, EXEC_TEAM_GIT_OUTPUT_BYTES)
    : fallback
}

export async function createExecTeam(
  deps: ExecTeamDeps,
  table: UiText,
  locale: string,
): Promise<ExecTeam> {
  setUiText(table, locale)
  deps.signal.throwIfAborted()
  const file = path.join(
    deps.dataFolder,
    ACP_SESSIONS_SUBFOLDER,
    workspaceKey(deps.cwd),
    EXEC_TEAM_STATE_FILE,
  )
  const raw = await optionalText(deps, file)
  const stateData: Record<string, unknown> = {}
  let requiredReviews: ReadonlySet<string> = new Set()
  if (raw !== undefined) {
    // RVCM96B2 P3-9: the stored file is user data; a malformed one is
    // refused in the translated key, never as a raw JSON or zod dump.
    let document: unknown
    try {
      document = JSON.parse(raw) as unknown
    } catch (error: unknown) {
      // JSON.parse on text throws only for malformed content.
      if (error instanceof SyntaxError)
        throw new Error(UI_TEXT.execTeamStateUnreadable, { cause: error })
      throw error
    }
    const parsed = teamSnapshotSchema.safeParse(document)
    if (!parsed.success) throw new Error(UI_TEXT.execTeamStateUnreadable)
    const metadata = z.object({ template: z.optional(z.string()) }).safeParse(document)
    if (!metadata.success) throw new Error(UI_TEXT.execTeamStateUnreadable)
    stateData[TEAM_WORKSPACE_KEYS.team] = {
      ...teamSnapshotSchema.parse(
        await lowerSnapshot(deps, parsed.data, (roles) => {
          requiredReviews = new Set(roles)
        }),
      ),
      ...(metadata.data.template !== undefined && { template: metadata.data.template }),
    }
  }
  let service: TeamHostService | undefined
  let folder: string | undefined
  let modelId = ''
  let isClosed = false
  let writes = Promise.resolve()
  let landing = Promise.resolve()
  const assertOpen = (): void => {
    deps.signal.throwIfAborted()
    if (isClosed) throw new Error(UI_TEXT.execIncomplete)
  }
  const initializing = new Set<Promise<unknown>>()
  const running = new Set<Promise<unknown>>()
  const answers = new Set<Promise<unknown>>()
  const copies = new Map<
    string,
    { taskId: string; role: TeamTaskSpec['role']; outcome: TeamWorkerOutcome }
  >()
  // RVCM96B2 P2-6: merges the merge card denies are held, never discarded.
  const deniedMerges = new Map<string, 'protected' | 'review'>()
  let discardCopies: (() => Promise<void>) | undefined
  // The run's git handle for close-time reconciliation (set in prepare).
  let teamGit: TeamGit | undefined
  const state: TeamStatePort = {
    get: (key) => stateData[key],
    update: (key, value) => {
      stateData[key] = value
      const snapshot = redactSecrets(JSON.stringify(stateData), deps.secretLiterals())
      const previous = writes
      writes = (async () => {
        await previous
        if (folder === undefined) throw new Error(UI_TEXT.execIncomplete)
        const target = path.join(folder, EXEC_TEAM_BOARD_FILE)
        const temporary = `${target}.new`
        await writeFile(temporary, snapshot, { mode: EXEC_TEAM_FILE_MODE })
        await rename(temporary, target)
      })()
      return writes
    },
  }
  const track = <T>(pending: Promise<T>, set: Set<Promise<unknown>>): Promise<T> => {
    set.add(pending)
    void (async () => {
      try {
        await pending
      } catch {
        // The returning caller owns this failure; the observer only retires its tracking.
      } finally {
        set.delete(pending)
      }
    })()
    return pending
  }
  const close = async (): Promise<void> => {
    if (isClosed) return
    isClosed = true
    await Promise.allSettled(initializing)
    try {
      await service?.dispose({ waitForWorkers: true })
    } finally {
      await Promise.allSettled([...running, ...answers])
      try {
        await writes
      } finally {
        try {
          await discardCopies?.()
        } catch (error: unknown) {
          deps.log.warn(failureForLog(error))
        } finally {
          // RVCM96B2 P2-4: a normal end removes and clears the record.
          // Reconcile first (discards prune as they go; this catches what
          // they missed), then remove the folder with its ledger. Held
          // branches are never touched. A failed reconcile keeps the
          // folder and its ledger for the next run's sweep (RVCM96B2D
          // P2-8): a failed read or delete is recorded and retried, never
          // treated as absent.
          let isReconciled = true
          if (folder !== undefined && teamGit !== undefined) {
            try {
              await removeStaleCleanupRefs({
                git: teamGit,
                folder,
                onError: (error) => {
                  deps.log.warn(failureForLog(error))
                },
              })
            } catch (error: unknown) {
              deps.log.warn(failureForLog(error))
              isReconciled = false
            }
          }
          if (folder !== undefined && isReconciled) {
            try {
              await rm(folder, { recursive: true, force: true })
            } catch (error: unknown) {
              deps.log.warn(failureForLog(error))
            }
          }
        }
      }
    }
  }
  return {
    teamDecisionSource: (model) => service?.teamDecisionSource(model),
    teamRosterData: () => service?.teamRosterData(),
    isTeamInPlaceActive: () => false,
    teamRunner: {
      preview: async (args, context) =>
        (await service?.teamRunner.preview(args, context)) ?? unavailable('delegate'),
      delegate: async (args, context) =>
        (await service?.teamRunner.delegate(args, context)) ?? unavailable('delegate'),
      collect: async (args, context) =>
        (await service?.teamRunner.collect(args, context)) ?? unavailable('collect'),
      cancel: async (args, context) =>
        (await service?.teamRunner.cancel(args, context)) ?? unavailable('cancel'),
      merge: async (args, context) =>
        (await service?.teamRunner.merge(args, context)) ?? unavailable('merge'),
    },
    prepare: (model) =>
      track(
        (async () => {
          assertOpen()
          modelId = model
          const config = teamSnapshotSchema.safeParse(stateData[TEAM_WORKSPACE_KEYS.team])
          if (config.success)
            for (const role of config.data.roles)
              for (const entry of role.pool) {
                const agent = entry.agent
                if (
                  agent !== undefined &&
                  (agent.kind !== 'engine' || agent.pays === 'subscription')
                )
                  deps.log.warn(
                    fill(UI_TEXT.execTeamWorkerUnsupported, {
                      kind: agent.kind === 'engine' ? agent.pays : agent.kind,
                    }),
                  )
              }
          if (
            service !== undefined ||
            !hasRunnableTeamEntry(state, {
              orchestratorModelId: modelId,
              isTeamWorkersOn: true,
              canRunKind: (kind) => kind === 'engine',
            })
          )
            return
          const {
            createTeamHostService,
            createEngineTeamPorts,
            teamProgramFreeGit,
            setUiText: install,
          } = await import('../../host/team/teamHostEntry')
          install(table, locale)
          // The governed git runner rides the first-use worker-operations
          // chunk (dist/teamWorkerOps.js), as the editor's team host loads it.
          const { processTeamGit } = await import('../../core/team/workers/workerOpsEntry')
          const runGit = teamProgramFreeGit(processTeamGit(deps.platform))
          teamGit = runGit
          // RVCM96B2 P2-4: a later run sweeps exactly what dead runs left
          // (folders and owned refs their ledgers name); never fail the run.
          try {
            await sweepStaleTeamRuns({ git: runGit })
          } catch (error: unknown) {
            deps.log.warn(failureForLog(error))
          }
          folder = await mkdtemp(path.join(tmpdir(), EXEC_TEAM_RUN_PREFIX))
          try {
            await recordCleanupOwner(folder, currentOwner())
          } catch (error: unknown) {
            // Fail closed: without the owner record a dead run's folder is
            // unsweepable, so remove the empty folder and refuse the run.
            await rm(folder, { recursive: true, force: true })
            throw error
          }
          const ports = createEngineTeamPorts({
            repositoryRoot: () => deps.cwd,
            storageRoot: folder,
            platform: deps.platform,
            isTrusted: () => !isClosed && !deps.signal.aborted,
            listModels: deps.listModels,
            startWorker: deps.startWorker,
            now: deps.now,
            log: deps.log,
          })
          discardCopies = async () => {
            // Every copy gets its discard: one failure must not spare the
            // rest (the close-time reconcile removes what this misses).
            await Promise.allSettled(
              Array.from(copies.values(), (task) => ports.merges.discard(task)),
            )
            copies.clear()
          }
          service = createTeamHostService({
            state,
            settings: {
              isTeamOn: () => !isClosed,
              isTeamWorkersOn: () => !isClosed,
              isTrusted: () => !isClosed && !deps.signal.aborted,
              // D121: no ceiling of ours. The machine's own parallelism bounds
              // how many workers start at once; the provider's limits and
              // live throttling bound each entry below it (teamCeilings).
              maxWorkers: () => availableParallelism(),
            },
            orchestrator: {
              modelId: () => modelId,
              backend: () => 'modelApi',
              approvalMode: () => 'promptUnmatched',
              defaultAgent: (model) => ({
                kind: 'engine',
                agentId: 'default',
                model,
                ...(deps.provider !== undefined && { provider: deps.provider }),
                pays: deps.defaultPays,
              }),
            },
            workers: {
              ...ports.workers,
              canRun: (agent) => agent.kind === 'engine' && agent.pays !== 'subscription',
              run: (spec, signal) =>
                track(
                  (async () => {
                    // RVCM96B2 P2-4: record the owned ref BEFORE the worker
                    // starts, so a later run sweeps it when this one dies.
                    // A failed record fails the worker, never an orphan.
                    if (
                      folder !== undefined &&
                      spec.reviewOf === undefined &&
                      spec.continueFrom?.folder === undefined
                    ) {
                      const ref = predictedAgentsRef(spec.role.role, spec.taskId)
                      if (ref !== undefined) {
                        await recordCleanupRef(folder, {
                          repo: deps.cwd,
                          role: spec.role.role,
                          taskId: spec.taskId,
                          ref,
                        })
                      }
                    }
                    const outcome = await ports.workers.run(spec, signal)
                    if (outcome.folder !== undefined)
                      copies.set(spec.taskId, { taskId: spec.taskId, role: spec.role, outcome })
                    return outcome
                  })(),
                  running,
                ),
            },
            merges: {
              ...ports.merges,
              discard: async (task) => {
                await ports.merges.discard(task)
                copies.delete(task.taskId)
                // RVCM96B2 P2-4: the run itself removed the ref; clear the record.
                if (folder !== undefined && task.outcome?.agentsRef !== undefined) {
                  try {
                    await pruneCleanupRef(folder, deps.cwd, task.outcome.agentsRef)
                  } catch (error: unknown) {
                    deps.log.warn(failureForLog(error))
                  }
                }
              },
              merge: async (task, signal) => {
                const previous = landing
                let release: (() => void) | undefined
                // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Shared host typechecks target ES2023/Node 20, which lacks withResolvers (PLAN.md section 8); the executor installs this release synchronously.
                landing = new Promise<void>((resolve) => {
                  release = resolve
                })
                try {
                  await previous
                  signal.throwIfAborted()
                  // RVCM96B2 P2-6: a denied merge never destroys the finished
                  // branch: hold its head, record the hold, and tell the
                  // model where it is, why, and how to retry or discard.
                  const outcome = task.outcome
                  const outcomeFolder = outcome.folder
                  const outcomeHead = outcome.head
                  if (outcomeFolder === undefined || outcomeHead === undefined)
                    throw new Error(UI_TEXT.teamTaskUnknown)
                  const hold = needsMergeHold(
                    deniedMerges.get(task.taskId),
                    outcome.changedFiles ?? [],
                  )
                  if (hold !== undefined) {
                    let ref: string
                    try {
                      ref = await createHoldRef(
                        runGit,
                        deps.cwd,
                        outcomeFolder,
                        task.role.role,
                        task.taskId,
                        outcomeHead,
                      )
                    } catch (error: unknown) {
                      throw new Error(
                        fill(UI_TEXT.execTeamMergeBlocked, {
                          entry: task.taskId,
                          detail: gitFailureDetail(error, task.taskId),
                        }),
                        { cause: error },
                      )
                    }
                    if (folder !== undefined) {
                      try {
                        await recordHoldRef(folder, {
                          repo: deps.cwd,
                          role: task.role.role,
                          taskId: task.taskId,
                          ref,
                        })
                      } catch (error: unknown) {
                        deps.log.warn(failureForLog(error))
                      }
                    }
                    throw heldMergeError(hold, ref)
                  }
                  const outcomeBase = outcome.baseCommit
                  if (outcomeBase === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
                  // RVCM96B2 P2-5: the gate is conflict markers in the merged
                  // result, not whitespace style: hard breaks, trailing
                  // spaces and CRLF pass. Local, credential-free Git; every
                  // refusal carries the bounded tool output, translated.
                  let scan: Awaited<ReturnType<typeof scanConflictMarkers>>
                  try {
                    scan = await scanConflictMarkers(
                      runGit,
                      outcomeFolder,
                      outcomeBase,
                      outcomeHead,
                      outcome.changedFiles ?? [],
                    )
                  } catch (error: unknown) {
                    throw new Error(
                      fill(UI_TEXT.execTeamMergeBlocked, {
                        entry: task.taskId,
                        detail: gitFailureDetail(error, outcomeHead),
                      }),
                      { cause: error },
                    )
                  }
                  if (scan.status === 'markers')
                    throw new Error(fill(UI_TEXT.execTeamMergeMarkers, { detail: scan.detail }))
                  if (scan.status === 'too-large')
                    throw new Error(
                      fill(UI_TEXT.execTeamMergeBlocked, {
                        entry: task.taskId,
                        detail: `${String(scan.bytes)} bytes`,
                      }),
                    )
                  const merged = await ports.merges.merge(task, signal, { allowProtected: false })
                  if (merged.status === 'merged') {
                    copies.delete(task.taskId)
                    // RVCM96B2 P2-4: merged away; clear the record.
                    if (folder !== undefined && task.outcome.agentsRef !== undefined) {
                      try {
                        await pruneCleanupRef(folder, deps.cwd, task.outcome.agentsRef)
                      } catch (error: unknown) {
                        deps.log.warn(failureForLog(error))
                      }
                    }
                    // RVCM96B2 P2-6 retention: a later merge of the same
                    // task replaces its hold.
                    try {
                      await releaseHoldRef(runGit, deps.cwd, task.role.role, task.taskId)
                    } catch (error: unknown) {
                      deps.log.warn(failureForLog(error))
                    }
                  }
                  deps.onWritten(merged.written)
                  return merged
                } finally {
                  deniedMerges.delete(task.taskId)
                  release?.()
                }
              },
            },
            paid: {
              allowKeyTasks: (_tasks, _budget, context) =>
                Promise.resolve(!isClosed && !context.signal.aborted && !deps.signal.aborted),
            },
            cards: {
              show: (_session, item) => {
                if (service === undefined || item.status !== 'inProgress') return
                const answer = (async () => {
                  // The shared host registers a waiting card after show returns.
                  await Promise.resolve()
                  if (item.kind === 'teamWaiting') {
                    await service.answerWaiting(item.teamWaiting.waitingId, 'cancel')
                  } else {
                    // RVCM96B2 P2-6: a denied merge is held, never discarded:
                    // stash the denial and drive the merge, whose wrapper
                    // keeps the branch under a hold ref and tells the model.
                    let denied: 'protected' | 'review' | undefined
                    if ((item.teamMerge.protectedPaths?.length ?? 0) > 0) denied = 'protected'
                    else if (
                      requiredReviews.has(item.teamMerge.roleId) &&
                      item.teamMerge.review === 'not-reviewed'
                    )
                      denied = 'review'
                    if (denied !== undefined) deniedMerges.set(item.teamMerge.taskId, denied)
                    await service.decideMerge(item.teamMerge.taskId, 'merge')
                  }
                })()
                void (async () => {
                  try {
                    await track(answer, answers)
                  } catch (error: unknown) {
                    deps.log.warn(failureForLog(error))
                  }
                })()
              },
            },
            newId: () => randomUUID(),
            now: deps.now,
            log: deps.log,
          })
          await service.probeEntries()
          assertOpen()
        })(),
        initializing,
      ),
    close,
  }
}
