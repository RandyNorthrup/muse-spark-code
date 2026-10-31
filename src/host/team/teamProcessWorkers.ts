// The process-worker ports (RLF-TEAMWORKERS, TEAMWIRE open question 2 as
// decided by the lead): Muse Code workers on the team's own Muse Code host
// and external ACP workers on a held ACP session per task, assembled beside
// the engine port in a lazy bundle (dist/teamProcess.js, first process
// worker). The team's own Muse Code host starts through
// `startTeamMuseCodeHost` over the native process lifetime
// (`startNativeTeamLifetime`) on the first Muse Code worker and stops with
// the team (`dispose`). An external agent's own sign-in is never read: a
// worker whose agent reports `auth_required` fails with words telling the
// person to sign in with that agent's CLI.

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  HOOK_CONFIG_MAX_BYTES,
  TEAM_KILL_GRACE_MS,
  TEAM_LOAD_CPU_HIGH,
  TEAM_LOAD_FREE_MEMORY_MIN,
  TEAM_LOAD_SAMPLE_MS,
  TEAM_LOAD_WINDOW_MS,
  TEAM_MODEL_TEXT,
  TEAM_READ_ONLY_COMMANDS,
  TEAM_TOOL_GROUP_TOOLS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { TeamAgentRef, TeamAttempt, TeamReport, TeamUsage } from '../../shared/team'
import type { AgentEvent } from '../../shared/agentEvents'
import type { CoreLogger } from '../../core/logging'
import { failureForLog } from '../../core/backends/musecode/logText'
import type { MuseCodeHost, MuseSession } from '../../core/backends/musecode/MuseCodeHost'
import type { ShellDialect } from '../../core/backends/modelapi/shellSyntax'
import type { TeamGit } from '../../core/team/teamGit'
import type {
  TeamTaskSpec,
  TeamWorkerOutcome,
  TeamWorkerPort,
} from '../../core/team/teamHostService'
import {
  ACP_PRESETS,
  AcpAuthRequiredError,
  AcpModeError,
  acpFsRead,
  acpFsWrite,
  pickOnceOption,
  runAcpWorker,
  type AcpPermissionToolCall,
  type AcpPreset,
  type AcpPresetId,
} from '../../core/team/workers/acpWorker'
import { WORKER_NATIVE_IO } from '../../core/team/workers/workerFence'
import { buildWorkerPrompt } from '../../core/team/workers/engineWorker'
import {
  runMuseCodeWorker,
  workerServeArgs,
  type MuseWorkerApprovalRequest,
  type MuseWorkerHostKind,
  type MuseWorkerHostPort,
  type MuseWorkerSessionPort,
  type TeamHostProvider,
} from '../../core/team/workers/museCodeWorker'
import type { WorkerReportOutcome } from '../../core/team/workers/report'
import {
  answerAcpPermission,
  AcpUserServersSwitchError,
  classifyMuseWorkerApproval,
} from '../../core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../core/team/workers/workerTypes'
import type { ShellJobDeps } from '../backend/shellJob'
import {
  connectAcpAgent,
  findAcpPresetCommand,
  spawnAcpAgent,
  type TeamChildLauncher,
} from './acpProcess'
import { createLoadGuard } from './loadGuard'
import {
  startNativeTeamLifetime,
  startTeamMuseCodeHost,
  type TeamProcessLifetime,
} from './processLifetime'
import { createTeamJournal } from './teamJournal'
import { createWindowAuthority, createWindowIdentity } from './windowIdentity'
import {
  beginTaskCopy,
  canonicalStorage,
  endTaskCopy,
  planWorkerTask,
  removeUnreturnedCopy,
  requireRepository,
  roleGrants,
  type TaskCopy,
  type TaskCopyDeps,
} from './taskCopy'

/** A resolved `muse serve` launch: the editor's own CLI resolution. */
export interface TeamMuseServeLaunch {
  readonly command: string
  /** Arguments before the `serve …` part (empty for the CLI's own binary). */
  readonly prefixArgs: readonly string[]
  /**
  Host flags the editor's own posture adds after `serve` (the shell sandbox),
  never a flag that selects a provider or a model.
  */
  readonly postureArgs: readonly string[]
  /** The host's environment: the guarded serve environment, never a credential. */
  readonly env: NodeJS.ProcessEnv
}

export interface TeamProcessWorkersDeps {
  readonly repositoryRoot: () => string | undefined
  /** The extension's own storage for this workspace: copies live under `agents/`. */
  readonly storageRoot: string
  /** The storage directory the team journal roots under (`<dir>/team/journal/<window>`). */
  readonly journalStorageDirectory: string
  readonly platform: NodeJS.Platform
  readonly isTrusted: () => boolean
  readonly extensionVersion: string
  /** The editor's Muse Code CLI resolution; undefined runs no Muse Code worker. */
  readonly resolveMuseServe: () => TeamMuseServeLaunch | undefined
  /** `contributor_mode_enabled` in the person's own Muse Code settings; absent reads as off. */
  readonly isContributorMode: () => boolean
  /** The window's environment for external agents; scrubbed again at spawn. */
  readonly baseEnv: () => NodeJS.ProcessEnv
  readonly pathEntries: () => readonly string[]
  /** Windows only: the job assembly the native lifetime contains children in. */
  readonly windows?: ShellJobDeps | undefined
  readonly runGit: TeamGit
  /** The external agents' preset table; absent, the captured presets (`ACP_PRESETS`). */
  readonly presets?: Readonly<Record<AcpPresetId, AcpPreset>> | undefined
  readonly now: () => number
  readonly log: CoreLogger
}

export interface ProcessTeamPorts {
  readonly workers: TeamWorkerPort
  /** Stops every host and external agent this team started. */
  readonly dispose: () => Promise<void>
}

const EMPTY_USAGE: TeamUsage = {
  input: 0,
  cachedInput: 0,
  output: 0,
  reasoning: 0,
  modelCalls: 0,
  estimated: true,
}

/** The agent kinds these ports run. */
function isProcessKind(agent: TeamAgentRef): boolean {
  return agent.kind === 'museCode' || agent.kind === 'external'
}

/** The preset an external entry names: its `agentId` is the preset id. */
function presetFor(
  presets: Readonly<Record<AcpPresetId, AcpPreset>>,
  agent: TeamAgentRef,
): AcpPreset | undefined {
  const id = (Object.keys(presets) as AcpPresetId[]).find((known) => known === agent.agentId)
  return id === undefined ? undefined : presets[id]
}

function teamReport(outcome: WorkerReportOutcome): TeamReport {
  if (outcome.ok) return outcome.report
  const summary = outcome.summary.trim() === '' ? TEAM_MODEL_TEXT.hostNoReport : outcome.summary
  if (outcome.status === 'capped') return { status: 'capped', summary }
  return { status: outcome.status === 'unstructured' ? 'unstructured' : 'failed', summary }
}

/**
Whether a request the role's policy allows to ask may be answered yes: only
the person's own saved permission mode for the role says so. A worker has no
approval card of its own, so Manual, Plan and Auto answer no; Accept edits
answers yes to file edits only; Bypass permissions answers yes. The role's
own refusals (outside the copy, outside `write-paths`, a ref move, a command
off its list) are never reached: they refuse before this is asked.
*/
export function isAskedApprovalAllowed(
  permissionMode: string | undefined,
  isEdit: boolean,
): boolean {
  return permissionMode === 'bypassPermissions' || (permissionMode === 'acceptEdits' && isEdit)
}

/** The shell dialect a platform's agents run commands in. */
function shellDialect(platform: NodeJS.Platform): ShellDialect {
  return platform === 'win32' ? 'powershell' : 'bash'
}

/** The MSP approval subject as the classifier reads it (captured kinds: shell, fileWrite, fileAccess). */
export function museApprovalRequest(
  event: Extract<AgentEvent, { type: 'approvalRequested' }>,
): MuseWorkerApprovalRequest {
  const { subject } = event
  if (subject.kind === 'shell' && subject.command !== undefined)
    return { kind: 'shellCommand', command: subject.command }
  return subject.path !== undefined &&
    (subject.kind === 'fileWrite' || (subject.kind === 'fileAccess' && subject.access === 'write'))
    ? { kind: 'writeFile', path: subject.path }
    : { kind: 'other', tool: subject.toolName ?? event.toolName }
}

/** What the Muse Code session port needs about the task it serves. */
interface MuseTaskContext {
  readonly spec: TeamTaskSpec
  readonly role: WorkerRolePolicy
  readonly folder: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly log: CoreLogger
  readonly usage: { current: TeamUsage }
  /** Set when a refusal ended the turn: the failure the worker rethrows. */
  readonly refusal: { error: Error | undefined }
}

/** A failure as an error the worker can rethrow, its cause kept. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(TEAM_MODEL_TEXT.hostStopped, { cause: error })
}

/** Muse Code's `turnCompleted` as the worker runner's stop reasons. */
function museStopReason(terminal: string, reason: string | undefined): string {
  if (terminal === 'completed') return reason ?? 'end_turn'
  return terminal === 'cancelled' ? 'cancelled' : (reason ?? terminal)
}

/**
One worker's session: a turn ends with `turnCompleted`; every approval the
host raises is answered by the role's policy (declined unless the person's
saved mode for the role allows it), every question is declined, and each
reported model call is metered and re-admitted, so a met cap, a stop or a
withdrawn trust cancels the turn.
*/
function museSessionPort(session: MuseSession, context: MuseTaskContext): MuseWorkerSessionPort {
  return {
    sessionId: session.sessionId,
    sendPrompt: async (text) => {
      let lastText: string | undefined
      let writes = Promise.resolve()
      const decide = async (
        event: Extract<AgentEvent, { type: 'approvalRequested' }>,
      ): Promise<void> => {
        const request = museApprovalRequest(event)
        const answer = await classifyMuseWorkerApproval({
          role: context.role,
          request,
          dialect: shellDialect(context.platform),
          readOnlyCommands: new Set(TEAM_READ_ONLY_COMMANDS),
          folder: context.folder,
          platform: context.platform,
          io: WORKER_NATIVE_IO,
          workspaceRoot: context.workspaceRoot,
        })
        const isAllowed =
          answer === 'askUser' &&
          isAskedApprovalAllowed(context.spec.role.permissionMode, request.kind === 'writeFile')
        const choice = event.availableChoices.find((candidate) =>
          isAllowed
            ? candidate.decision === 'approved' && candidate.scope === 'once'
            : candidate.decision === 'abort',
        )
        if (choice === undefined) throw new Error(TEAM_MODEL_TEXT.hostNoApprovalChoice)
        await session.decideApproval({
          approvalId: event.approvalId,
          choiceId: choice.choiceId,
          requirementId: event.requirementId,
        })
      }
      // A refusal or a failed answer ends the turn: the worker rethrows it after the stop.
      const stopTurn = (error: unknown): void => {
        context.refusal.error = asError(error)
        void session.cancel().catch(() => {
          context.log.warn('A team Muse Code worker cancellation settled elsewhere')
        })
      }
      const ended = new Promise<{ readonly terminal: string; readonly reason: string | undefined }>(
        (resolve) => {
          const stop = session.onEvent((event) => {
            switch (event.type) {
              case 'itemCompleted': {
                if (event.item.kind === 'agentMessage' && event.item.text !== undefined)
                  lastText = event.item.text
                break
              }
              case 'tokenUsage': {
                const usage = context.usage.current
                context.usage.current = {
                  ...usage,
                  input: usage.input + event.inputTokens,
                  cachedInput: usage.cachedInput + (event.cachedTokens ?? 0),
                  output: usage.output + event.outputTokens,
                  reasoning: usage.reasoning + (event.reasoningTokens ?? 0),
                  modelCalls: usage.modelCalls + 1,
                }
                const earlier = writes
                const reported = context.usage.current
                writes = (async () => {
                  await earlier
                  await context.spec.meter.noteUsage(reported)
                })()
                try {
                  context.spec.meter.admitRequest()
                } catch (error: unknown) {
                  // A refusal (a met cap, a stop, withdrawn trust) ends the turn; its kind is logged.
                  context.log.warn(failureForLog(error))
                  stopTurn(error)
                }
                break
              }
              case 'approvalRequested': {
                void decide(event).catch(stopTurn)
                break
              }
              case 'questionRequested': {
                void session.cancelQuestions(event.userInputId).catch(() => {
                  context.log.warn('A team Muse Code worker question could not be declined')
                })
                break
              }
              case 'turnCompleted': {
                stop()
                resolve({ terminal: event.terminal, reason: event.reason })
                break
              }
              default: {
                break
              }
            }
          })
        },
      )
      context.spec.meter.admitRequest()
      await session.sendTurn([{ type: 'text', text }])
      const end = await ended
      await writes
      if (context.refusal.error !== undefined) throw context.refusal.error
      return { lastMessage: lastText, stopReason: museStopReason(end.terminal, end.reason) }
    },
    cancel: async () => {
      await session.cancel()
    },
    dispose: () => {
      session.dispose()
    },
  }
}

/** The proof a contained child's retirement gives the board: only a real OS container proves it. */
function proofOf(
  confirmed: { readonly container: string },
  end: { readonly descendants: string },
): TeamAttempt['retirement'] {
  if (end.descendants !== 'proved') return undefined
  if (confirmed.container === 'windowsJob') return { kind: 'proved', method: 'windowsJob' }
  return confirmed.container === 'linuxScope'
    ? { kind: 'proved', method: 'linuxCgroup' }
    : undefined
}

/** The Muse Code and external worker ports over one workspace's repository. */
export function createProcessTeamPorts(deps: TeamProcessWorkersDeps): ProcessTeamPorts {
  const copyDeps: TaskCopyDeps = deps
  const presets = deps.presets ?? ACP_PRESETS
  const storage = canonicalStorage(deps.storageRoot)
  const proofs = new Map<string, TeamAttempt['retirement']>()
  const launches = new Set<Promise<unknown>>()

  // The team's own native lifetime, journal and load sampler: made on the
  // first process worker, never for an engine-only team.
  let lifetime: Promise<TeamProcessLifetime> | undefined
  let loadGuard: ReturnType<typeof createLoadGuard> | undefined
  const startLifetime = async (): Promise<TeamProcessLifetime> => {
    try {
      const identity = createWindowIdentity(deps.now())
      const authority = createWindowAuthority(identity, () =>
        // This window only ever writes its own journal: no foreign owner is taken over here.
        Promise.reject(new Error(TEAM_MODEL_TEXT.hostJournalForeign)),
      )
      const journal = createTeamJournal({
        storageDirectory: deps.journalStorageDirectory,
        authority,
        owner: identity,
        maxRecordBytes: HOOK_CONFIG_MAX_BYTES,
        platform: deps.platform,
      })
      const guard = createLoadGuard({
        sampleMs: TEAM_LOAD_SAMPLE_MS,
        cpuHigh: TEAM_LOAD_CPU_HIGH,
        windowMs: TEAM_LOAD_WINDOW_MS,
        freeMemoryMin: TEAM_LOAD_FREE_MEMORY_MIN,
        now: deps.now,
        changed: () => {
          // The sampler's reading is read through `isHostBusy` at each launch.
        },
      })
      guard.start()
      loadGuard = guard
      const started = await startNativeTeamLifetime({
        journal,
        isHostBusy: guard.isHostBusy,
        killGraceMs: TEAM_KILL_GRACE_MS,
        ...(deps.windows !== undefined && { windows: deps.windows }),
      })
      if (started.orphans.length > 0 || started.unreadable.length > 0)
        deps.log.warn(
          `Another window left ${String(started.orphans.length)} team process(es) and ${String(started.unreadable.length)} unreadable launch record(s); the team did not touch them`,
        )
      return started.lifetime
    } catch (error: unknown) {
      // A lifetime that failed to start is tried again by the next worker.
      lifetime = undefined
      loadGuard?.dispose()
      loadGuard = undefined
      throw error
    }
  }
  const ensureLifetime = async (): Promise<TeamProcessLifetime> =>
    await (lifetime ??= startLifetime())

  // The team's own Muse Code hosts, one per kind, made on first use.
  const hosts = new Map<MuseWorkerHostKind, Promise<MuseCodeHost>>()
  const startMuseHost = async (kind: MuseWorkerHostKind): Promise<MuseCodeHost> => {
    try {
      const launch = deps.resolveMuseServe()
      if (launch === undefined) throw new Error(TEAM_MODEL_TEXT.hostMuseNotFound)
      const root = requireRepository(deps)
      return await startTeamMuseCodeHost({
        lifetime: await ensureLifetime(),
        request: {
          command: launch.command,
          args: [
            ...launch.prefixArgs,
            ...workerServeArgs(
              kind,
              deps.isTrusted(),
              deps.isContributorMode(),
              launch.postureArgs,
            ),
          ],
          cwd: root,
          taskId: `muse-host-${kind}`,
          env: launch.env,
          priority: 'belowNormal',
        },
        log: deps.log,
        extensionVersion: deps.extensionVersion,
      })
    } catch (error: unknown) {
      // A failed start is forgotten, so the next worker tries once more.
      hosts.delete(kind)
      throw error
    }
  }
  const museHost = async (kind: MuseWorkerHostKind): Promise<MuseCodeHost> => {
    const existing = hosts.get(kind)
    if (existing !== undefined) return await existing
    const started = startMuseHost(kind)
    hosts.set(kind, started)
    return await started
  }

  const providerFor = (
    context: Omit<MuseTaskContext, 'refusal' | 'usage'>,
    usage: MuseTaskContext['usage'],
  ) => {
    const refusal: MuseTaskContext['refusal'] = { error: undefined }
    const portFor = (kind: MuseWorkerHostKind): MuseWorkerHostPort => ({
      hostId: `team-${kind}`,
      kind,
      startSession: async (options) => {
        const host = await museHost(kind)
        const session = await host.startSession(options)
        context.spec.meter.noteSession?.(session.sessionId)
        return museSessionPort(session, { ...context, usage, refusal })
      },
    })
    const provider: TeamHostProvider = {
      teamHost: () => Promise.resolve(portFor('team')),
      readOnlyHost: () => Promise.resolve(portFor('readOnly')),
    }
    return provider
  }

  const runMuse = async (
    spec: TeamTaskSpec,
    copy: TaskCopy,
    signal: AbortSignal,
  ): Promise<{ readonly report: WorkerReportOutcome; readonly usage: TeamUsage }> => {
    // Muse Code and external agents bring their own tools: the role's groups are offered whole.
    const offered = [
      ...new Set(
        roleGrants(spec, copy.builtin).groups.flatMap((group) => TEAM_TOOL_GROUP_TOOLS[group]),
      ),
    ]
    const plan = planWorkerTask(spec, copy, offered)
    const prompt = await buildWorkerPrompt(
      plan.prompt,
      plan.task,
      WORKER_NATIVE_IO,
      deps.platform,
      copy.repositoryRoot,
    )
    const usage = { current: EMPTY_USAGE }
    const result = await runMuseCodeWorker({
      task: plan.task,
      role: plan.role,
      prompt,
      modelId: spec.entry.agent.model,
      workspaceRoot: copy.repositoryRoot,
      platform: deps.platform,
      io: WORKER_NATIVE_IO,
      exclusiveUserServers: [],
      isTrusted: deps.isTrusted(),
      bridgeServers: {},
      hosts: providerFor(
        {
          spec,
          role: plan.role,
          folder: plan.task.folder,
          workspaceRoot: copy.repositoryRoot,
          platform: deps.platform,
          log: deps.log,
        },
        usage,
      ),
      signal,
    })
    return { report: result.report, usage: usage.current }
  }

  const launcherFor = (taskId: string): TeamChildLauncher => ({
    spawn: async (input) => {
      const started = await ensureLifetime()
      const contained = await started.launch({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        taskId,
        priority: 'belowNormal',
      })
      // The proof is the container's: a bare process group never proves its descendants ended.
      const retire = async (): Promise<void> => {
        try {
          const end = await contained.retire()
          proofs.set(taskId, proofOf(await contained.confirmation, end))
        } catch {
          deps.log.warn('A team external agent could not be retired')
        }
      }
      return {
        stdin: contained.child.stdin,
        stdout: contained.child.stdout,
        wait: () =>
          new Promise((resolve) => {
            if (contained.child.exitCode === null) {
              contained.child.once('exit', (code) => {
                resolve({ exitCode: code })
              })
            } else {
              resolve({ exitCode: contained.child.exitCode })
            }
          }),
        kill: () => {
          const retiring = retire()
          launches.add(retiring)
          void retiring.finally(() => {
            launches.delete(retiring)
          })
        },
      }
    },
  })

  const runExternal = async (
    spec: TeamTaskSpec,
    copy: TaskCopy,
    signal: AbortSignal,
  ): Promise<{ readonly report: WorkerReportOutcome; readonly usage: TeamUsage }> => {
    const preset = presetFor(presets, spec.entry.agent)
    if (preset === undefined)
      throw new Error(fill(TEAM_MODEL_TEXT.hostKindNotOffered, { kind: spec.entry.agent.kind }))
    const command = findAcpPresetCommand(preset, deps.platform, deps.pathEntries(), existsSync)
    if (command === undefined)
      throw new Error(fill(TEAM_MODEL_TEXT.hostExternalNotFound, { command: preset.command }))
    const plan = planWorkerTask(spec, copy, [])
    try {
      const child = await spawnAcpAgent({
        preset,
        command,
        cwd: plan.task.folder,
        workspaceRoot: copy.repositoryRoot,
        io: WORKER_NATIVE_IO,
        baseEnv: deps.baseEnv(),
        platform: deps.platform,
        launchId: randomUUID(),
        launcher: launcherFor(spec.taskId),
      })
      const access = {
        role: plan.role,
        folder: plan.task.folder,
        workspaceRoot: copy.repositoryRoot,
        platform: deps.platform,
        io: WORKER_NATIVE_IO,
      }
      const connection = connectAcpAgent({
        stdin: child.stdin,
        stdout: child.stdout,
        supportsTerminalAuth: false,
        log: deps.log,
        disposeProcess: () => {
          child.kill()
        },
        handlers: {
          onPermissionRequest: async (toolCall: AcpPermissionToolCall, options, grant) => {
            const verdict = await answerAcpPermission({
              ...access,
              grant,
              dialect: shellDialect(deps.platform),
              readOnlyCommands: new Set(TEAM_READ_ONLY_COMMANDS),
              toolCall,
            })
            const isAllowed =
              verdict.action === 'allowOnce' ||
              (verdict.action === 'askUser' &&
                isAskedApprovalAllowed(
                  spec.role.permissionMode,
                  ['edit', 'delete', 'move'].includes(toolCall.kind ?? ''),
                ))
            const optionId = pickOnceOption(options, isAllowed)
            return optionId === undefined ? undefined : { optionId }
          },
          onFsRead: (path, grant) => acpFsRead({ ...access, grant }, path),
          onFsWrite: (path, content, grant) => acpFsWrite({ ...access, grant }, path, content),
          onUpdate: () => {
            // A worker's progress text is not shown: its report is.
          },
        },
      })
      const result = await runAcpWorker({
        task: plan.task,
        role: plan.role,
        preset,
        prompt: plan.prompt,
        modelId: spec.entry.agent.model,
        workspaceRoot: copy.repositoryRoot,
        // `spawnAcpAgent` only starts an agent with its preset's captured switch.
        nativeServersExcluded: true,
        isTrusted: deps.isTrusted(),
        io: WORKER_NATIVE_IO,
        platform: deps.platform,
        bridgeServers: [],
        connection,
        signal,
      })
      return { report: result.report, usage: EMPTY_USAGE }
    } catch (error: unknown) {
      if (error instanceof AcpAuthRequiredError)
        throw new Error(TEAM_MODEL_TEXT.hostExternalNotSignedIn, { cause: error })
      if (error instanceof AcpUserServersSwitchError)
        throw new Error(fill(TEAM_MODEL_TEXT.hostExternalNoSwitch, { agent: error.preset }), {
          cause: error,
        })
      if (error instanceof AcpModeError)
        throw new Error(
          fill(TEAM_MODEL_TEXT.hostExternalNoMode, { agent: error.preset, shape: error.shape }),
          { cause: error },
        )
      throw error
    }
  }

  const workers: TeamWorkerPort = {
    canRun: isProcessKind,
    probe: (agent) => {
      if (agent.kind === 'museCode') return Promise.resolve(deps.resolveMuseServe() !== undefined)
      const preset = presetFor(presets, agent)
      return Promise.resolve(
        preset !== undefined &&
          findAcpPresetCommand(preset, deps.platform, deps.pathEntries(), existsSync) !== undefined,
      )
    },
    retirement: (taskId) => proofs.get(taskId),
    run: async (spec, signal) => {
      signal.throwIfAborted()
      if (!deps.isTrusted()) throw new Error(TEAM_MODEL_TEXT.hostUntrusted)
      const copy = await beginTaskCopy(copyDeps, storage, spec)
      try {
        await spec.meter.noteWorkspace({
          folder: copy.workspace.folder,
          baseCommit: copy.baseCommit,
          branch: copy.workspace.branch,
          agentsRef: copy.workspace.agentsRef,
        })
        signal.throwIfAborted()
        const ran =
          spec.entry.agent.kind === 'museCode'
            ? await runMuse(spec, copy, signal)
            : await runExternal(spec, copy, signal)
        signal.throwIfAborted()
        const report = teamReport(ran.report)
        const outcome: TeamWorkerOutcome = await endTaskCopy(copyDeps, storage, {
          spec,
          copy,
          signal,
          report,
          isCeilingReached: report.status === 'capped',
          usage: ran.usage,
        })
        return outcome
      } catch (error: unknown) {
        await removeUnreturnedCopy(copyDeps, storage, {
          spec,
          copy,
          warn: (message) => {
            deps.log.warn(message)
          },
        })
        throw error
      }
    },
  }

  return {
    workers,
    dispose: async () => {
      const started = lifetime
      const closing: Promise<void>[] = []
      for (const pending of hosts.values()) {
        closing.push(
          (async () => {
            const host = await pending
            await host.close()
          })(),
        )
      }
      hosts.clear()
      await Promise.allSettled(closing)
      await Promise.allSettled(launches)
      if (started !== undefined) {
        const native = await started
        await native.dispose()
      }
      loadGuard?.dispose()
    },
  }
}
