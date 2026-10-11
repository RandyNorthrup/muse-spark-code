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
import type { TeamToolResult } from '../../core/team/teamSeams'
import { isProtectedPath } from '../../core/protectedPaths'
import { redactSecrets } from '../../core/redact'
import { storeErrorCode } from '../../host/backend/storeErrors'
import { teamSnapshotSchema, type TeamSnapshot } from '../../shared/team'
import { TEAM_WORKSPACE_KEYS, hasRunnableTeamEntry } from '../../shared/teamConversation'
import { lowerTeamWithJson, parseTeamJson, teamJsonPath } from '../../core/team/teamConfig'
import {
  ACP_SESSIONS_SUBFOLDER,
  EXEC_PROMPT_MAX_BYTES,
  EXEC_TEAM_STATE_FILE,
  EXEC_TEAM_RUN_PREFIX,
  EXEC_TEAM_BOARD_FILE,
  EXEC_TEAM_FILE_MODE,
  TEAM_ENGINE_HARD_CEILING,
  TEAM_MAX_WORKERS_PER_CPU,
  UI_TEXT,
} from '../../shared/constants'
import { fill, setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { Usd, type UsdAmount } from '../../shared/usd'
import { workspaceKey } from '../dataFolder'
import type { CoreLogger } from '../../core/logging'

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
    if (storeErrorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

function invalid(reason: string): Error {
  return new Error(fill(UI_TEXT.execTeamConfigInvalid, { reason }))
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
  if (!parsed.ok) throw invalid(parsed.reason)
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
  const lowering = lowerTeamWithJson(
    { roles, budgets: { spendUsd: Number(deps.budgetUsd) } },
    parsed.file,
  )
  if (!lowering.ok) throw invalid(lowering.reason)
  const budget = lowering.lowered.budgets['spendUsd']
  if (budget !== undefined) deps.lowerWorkerCap(Usd.from(budget).toAmount())
  // This host's review role is code-review. Refuse a different requirement rather than ignore it.
  if (
    Object.values(lowering.lowered.reviewers).some((role) => role !== 'code-review') ||
    (Object.keys(lowering.lowered.reviewers).length > 0 &&
      snapshot.roles.every((role) => !(role.role === 'code-review' && role.pool.length > 0)))
  )
    throw invalid(UI_TEXT.teamTaskUnknown)
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
    const document: unknown = JSON.parse(raw)
    const parsed = teamSnapshotSchema.safeParse(document)
    if (!parsed.success) throw invalid(parsed.error.message)
    const metadata = z.object({ template: z.optional(z.string()) }).safeParse(document)
    if (!metadata.success) throw invalid(metadata.error.message)
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
  let discardCopies: (() => Promise<void>) | undefined
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
        } finally {
          if (folder !== undefined) await rm(folder, { recursive: true, force: true })
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
            processTeamGit,
            teamProgramFreeGit,
            setUiText: install,
          } = await import('../../host/team/teamHostEntry')
          install(table, locale)
          folder = await mkdtemp(path.join(tmpdir(), EXEC_TEAM_RUN_PREFIX))
          const runGit = teamProgramFreeGit(processTeamGit(deps.platform))
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
            await Promise.all(Array.from(copies.values(), (task) => ports.merges.discard(task)))
            copies.clear()
          }
          service = createTeamHostService({
            state,
            settings: {
              isTeamOn: () => !isClosed,
              isTeamWorkersOn: () => !isClosed,
              isTrusted: () => !isClosed && !deps.signal.aborted,
              maxWorkers: () =>
                Math.min(
                  TEAM_ENGINE_HARD_CEILING,
                  TEAM_MAX_WORKERS_PER_CPU * availableParallelism(),
                ),
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
                  if (
                    (task.outcome.changedFiles ?? []).some((name) =>
                      isProtectedPath(name.replaceAll('\\', '/')),
                    )
                  )
                    throw new Error(UI_TEXT.execTeamProtectedDenied)
                  if (task.outcome.folder === undefined) throw new Error(UI_TEXT.teamTaskUnknown)
                  // Local, credential-free Git checks; no repository hook or paid call.
                  await runGit(
                    [
                      'diff',
                      '--check',
                      '--no-ext-diff',
                      '--no-textconv',
                      task.outcome.baseCommit ?? '',
                      task.outcome.head ?? '',
                      '--',
                    ],
                    task.outcome.folder,
                  )
                  const merged = await ports.merges.merge(task, signal, { allowProtected: false })
                  if (merged.status === 'merged') copies.delete(task.taskId)
                  deps.onWritten(merged.written)
                  return merged
                } finally {
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
                    const shouldDeny =
                      (item.teamMerge.protectedPaths?.length ?? 0) > 0 ||
                      (requiredReviews.has(item.teamMerge.roleId) &&
                        item.teamMerge.review === 'not-reviewed')
                    await service.decideMerge(
                      item.teamMerge.taskId,
                      shouldDeny ? 'discard' : 'merge',
                    )
                  }
                })()
                void (async () => {
                  try {
                    await track(answer, answers)
                  } catch (error: unknown) {
                    deps.log.warn(error instanceof Error ? error.message : UI_TEXT.execIncomplete)
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
