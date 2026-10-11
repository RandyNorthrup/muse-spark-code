// A session per task on the window's team host (M96 lane W, PLAN.md D75):
// a `muse serve` started through lane K's launcher and never the
// conversation's; the read-only host started with `--disable-write` and
// `--disable-shell`; the bridge's servers in `config.mcpServers` and the
// user's exclusive servers switched off where step 1 shows how.
//
// Seams: the team host's lifecycle is lane K's (`TeamHostProvider`), the
// bridge's servers are lane B's, the folder is lane I's, and the MSP
// approval payload's mapping to `MuseWorkerApprovalRequest` is the
// integration's. Nothing here guesses an uncaptured wire shape.

import type { SessionMcpServer } from '../../agent/agentBackend'
import type { ApprovalMode } from '../../../shared/permissionModes'
import {
  MUSE_DISABLE_SHELL_ARG,
  MUSE_DISABLE_WRITE_ARG,
  MUSE_SERVE_ARGS,
  MUSE_TRUST_WORKSPACE_ARG,
} from '../../../shared/constants'
import { reportForStop, type WorkerReportOutcome } from './report'
import {
  assertWorkerRoot,
  recheckWorkerRoot,
  userServerExclusion,
  type WorkerRootGrant,
  type WorkerFenceIo,
} from './workerFence'
export {
  userServerExclusion,
  MuseWorkerCapturePendingError,
  classifyMuseWorkerApproval,
  hasRefMove,
  isRefMovingGitCommand,
  MuseWorkerFolderError,
} from './workerFence'
import type { WorkerRolePolicy, WorkerTask } from './workerTypes'
import { WorkerUntrustedError } from './engineWorker'

/** The window's team host, or its read-only host: never the conversation's. */
export type MuseWorkerHostKind = 'team' | 'readOnly'

/** A `read-only` role runs on the read-only host; every other role on the team host. */
export function hostKindFor(role: WorkerRolePolicy): MuseWorkerHostKind {
  return role.workspaceMode === 'read-only' ? 'readOnly' : 'team'
}

/**
 * The `serve` arguments for a worker host. The read-only host is fixed for
 * its lifetime with `--disable-write` and `--disable-shell` (the 1.4.2
 * capture, research §4.7), so Muse Code itself refuses that worker's file
 * writes and shell. A trusted workspace loads its rules and skills.
 */
export function workerServeArgs(kind: MuseWorkerHostKind, isTrusted: boolean): readonly string[] {
  return [
    ...MUSE_SERVE_ARGS,
    ...(kind === 'readOnly' ? [MUSE_DISABLE_WRITE_ARG, MUSE_DISABLE_SHELL_ARG] : []),
    isTrusted ? MUSE_TRUST_WORKSPACE_ARG : MUSE_DISABLE_SHELL_ARG,
  ]
}

/** The host lane K lends a worker: started through its launcher, in the window's container. */
export interface MuseWorkerHostPort {
  readonly hostId: string
  readonly kind: MuseWorkerHostKind
  readonly startSession: (options: {
    readonly workspaceRoot: string
    readonly modelId: string
    readonly approvalMode: ApprovalMode
    readonly mcpServers: Readonly<Record<string, SessionMcpServer>>
  }) => Promise<MuseWorkerSessionPort>
}

/** Starts (or reuses) the window's team and read-only hosts. Lane K owns the lifecycle. */
export interface TeamHostProvider {
  readonly teamHost: () => Promise<MuseWorkerHostPort>
  readonly readOnlyHost: () => Promise<MuseWorkerHostPort>
}

/** A worker's session: one task, idle when its report is in. */
export interface MuseWorkerSessionPort {
  readonly sessionId: string
  readonly sendPrompt: (
    text: string,
  ) => Promise<{ readonly lastMessage: string | undefined; readonly stopReason: string }>
  readonly cancel: () => Promise<void>
  readonly dispose: () => void
}

/** Cancellation is available while startup/turn promises are still pending. */
export async function awaitWorkerAction<result>(
  signal: AbortSignal,
  action: () => Promise<result>,
): Promise<result> {
  signal.throwIfAborted()
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new WorkerCancelledError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    signal.throwIfAborted()
    const value = await Promise.race([action(), aborted])
    signal.throwIfAborted()
    return value
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

export class WorkerCancelledError extends Error {
  public constructor() {
    super('The worker was cancelled')
    this.name = 'WorkerCancelledError'
  }
}

/**
 * The session's `config.mcpServers`: the bridge's servers only. The task's
 * folder must be a working copy (or scratch copy) outside the workspace
 * tree; starting in the workspace is refused. `denyUnmatched` (Plan) for a
 * `read-only` role, `promptUnmatched` for every other role.
 */
export async function buildWorkerSessionConfig(input: {
  readonly task: WorkerTask
  readonly role: WorkerRolePolicy
  readonly modelId: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  /** Complete inventory from the host's user-server configuration. */
  readonly exclusiveUserServers: readonly string[]
  readonly bridgeServers: Readonly<Record<string, SessionMcpServer>>
}): Promise<{
  readonly grant: WorkerRootGrant
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: ApprovalMode
  readonly mcpServers: Readonly<Record<string, SessionMcpServer>>
}> {
  const grant = await assertWorkerRoot({ ...input, folder: input.task.folder })
  userServerExclusion(input.exclusiveUserServers)
  return {
    grant,
    workspaceRoot: grant.absolute,
    modelId: input.modelId,
    approvalMode: input.role.workspaceMode === 'read-only' ? 'denyUnmatched' : 'promptUnmatched',
    mcpServers: input.bridgeServers,
  }
}

/** An approval a worker's session raises, mapped from the host's payload by the integration. */
export type MuseWorkerApprovalRequest =
  | { readonly kind: 'shellCommand'; readonly command: string }
  | { readonly kind: 'writeFile'; readonly path: string }
  | { readonly kind: 'other'; readonly tool: string }

/** `deny` is answered without asking; `askUser` becomes the user's labelled card. */
export type MuseWorkerApprovalAnswer = 'deny' | 'askUser'

export interface MuseCodeWorkerDeps {
  readonly task: WorkerTask
  readonly role: WorkerRolePolicy
  readonly prompt: string
  readonly modelId: string
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: WorkerFenceIo
  readonly exclusiveUserServers: readonly string[]
  readonly isTrusted: boolean
  readonly bridgeServers: Readonly<Record<string, SessionMcpServer>>
  readonly hosts: TeamHostProvider
  readonly signal: AbortSignal
}

/**
 * Runs one Muse Code worker's task: a session per task on the window's team
 * host (the read-only host for a `read-only` role, never the
 * conversation's), in the task's folder, with the bridge's servers. The
 * worker ends its last message with the `muse-team-report` block.
 */
export async function runMuseCodeWorker(deps: MuseCodeWorkerDeps): Promise<{
  readonly sessionId: string
  readonly report: WorkerReportOutcome
}> {
  deps.signal.throwIfAborted()
  if (!deps.isTrusted) {
    throw new WorkerUntrustedError()
  }
  const config = await awaitWorkerAction(deps.signal, () =>
    buildWorkerSessionConfig({
      task: deps.task,
      role: deps.role,
      modelId: deps.modelId,
      workspaceRoot: deps.workspaceRoot,
      platform: deps.platform,
      io: deps.io,
      exclusiveUserServers: deps.exclusiveUserServers,
      bridgeServers: deps.bridgeServers,
    }),
  )
  const kind = hostKindFor(deps.role)
  const { grant, ...sessionOptions } = config
  const host = await awaitWorkerAction(deps.signal, () =>
    kind === 'readOnly' ? deps.hosts.readOnlyHost() : deps.hosts.teamHost(),
  )
  let session: MuseWorkerSessionPort | undefined
  try {
    session = await awaitWorkerAction(deps.signal, async () => {
      await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
      const opened = await host.startSession(sessionOptions)
      // A session created after abort must never receive a prompt.
      if (deps.signal.aborted) {
        try {
          void opened.cancel().catch(() => {
            /* Cleanup still follows when the peer is gone. */
          })
        } finally {
          opened.dispose()
        }
        throw new WorkerCancelledError()
      }
      return opened
    })
    await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
    const active = session
    const { lastMessage, stopReason } = await awaitWorkerAction(deps.signal, () =>
      active.sendPrompt(deps.prompt),
    )
    await recheckWorkerRoot({ ...deps, folder: deps.task.folder }, grant)
    return { sessionId: active.sessionId, report: reportForStop(lastMessage ?? '', stopReason) }
  } catch (error: unknown) {
    if (session !== undefined) {
      void session.cancel().catch(() => {
        /* Cleanup still follows when the peer is gone. */
      })
    }
    throw error
  } finally {
    session?.dispose()
  }
}
