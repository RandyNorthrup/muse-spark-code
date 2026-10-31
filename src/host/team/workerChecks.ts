// The heavy-check route of a team worker (M96c, PLAN.md D75 "Check slots"): a
// Muse Code worker reaches the person's `run_checks` as the tool of a session
// MCP server of its own, served here over loopback with a token that names
// its task. A call is the bridge's `bridgeRunChecks` (M96c lane O): the
// person's configured commands over the files the task changed, routed by
// `routeWorkerCheck` to a local check slot, so it waits for the machine
// governor's `check` capacity and a free folder, runs against a snapshot of
// the task's copy, and gives both back (CheckSlots, `checkSlots.ts`).
//
// Nothing here starts for a task without the checks group or while no check is
// configured: that task gets no server. Runners over SSH are not on this
// route yet (`runners` is empty), so every check goes to a local slot.

import { randomBytes, randomUUID } from 'node:crypto'
import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { SessionMcpServer } from '../../core/agent/agentBackend'
import type { CoreLogger } from '../../core/logging'
import { handleMcpMessage, mcpRequestKeys, type McpTool } from '../../core/mcp'
import type { CheckJob, CheckResult } from '../../core/runners/routing'
import type { TeamGit } from '../../core/team/teamGit'
import {
  confineWorkerPath,
  hasRefMove,
  WORKER_NATIVE_IO,
} from '../../core/team/workers/workerFence'
import type { WorkerRolePolicy } from '../../core/team/workers/workerTypes'
import {
  CLI_OUTPUT_MAX_BYTES,
  HTTP_STATUS,
  IDE_MCP_LOOPBACK_HOST,
  IDE_MCP_TOKEN_BYTES,
  MODEL_API_MODEL_TEXT,
  TEAM_CHECK_LOCKFILES,
  TEAM_CHECKS_SERVER,
  TEAM_CHECKS_TOOL,
  TEAM_MODEL_TEXT,
  TEAM_PROCESS_MODEL_TEXT,
  UI_TEXT,
  type CheckCommandSetting,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { answerMcp, isSameLoopbackSecret, listenLoopback, readLoopbackBody } from '../mcpLoopback'
import { bridgeRunChecks } from './mcpBridge'

const AUTHORIZATION_HEADER = 'authorization'
const BEARER_PREFIX = 'Bearer '
const POST = 'POST'
const SERVER_INFO = { name: 'muse_spark_team_checks', version: '1' } as const
/** `git status --porcelain=v1 -z`: two status letters, a space, then the path. */
const STATUS_PREFIX_LENGTH = 3
const NUL = '\0'

/** The task a `run_checks` endpoint belongs to: its copy and the role that binds it. */
export interface WorkerCheckTask {
  /** The task's working copy; the checks run against a snapshot of it. */
  readonly folder: string
  readonly workspaceRoot: string
  readonly role: WorkerRolePolicy
}

export interface WorkerChecksDeps {
  readonly platform: NodeJS.Platform
  readonly isTrusted: () => boolean
  /** `museSpark.checkCommands`: the person's own check commands. */
  readonly checks: () => readonly CheckCommandSetting[]
  /** The governed local slot: waits for the `check` capacity and a folder, runs, gives both back. */
  readonly localSlot: (job: CheckJob) => Promise<CheckResult>
  /** Git over the task's copy, for the files it changed. */
  readonly runGit: TeamGit
  readonly log: CoreLogger
}

/** A task's session MCP servers for `run_checks`, and the end of its endpoint. */
export interface WorkerCheckEndpoint {
  readonly servers: Readonly<Record<string, SessionMcpServer>>
  readonly close: () => void
}

interface Registration {
  readonly task: WorkerCheckTask
  readonly isCurrent: () => boolean
}

/** The files a task changed, from git's own status over its copy (renames count by new name). */
async function changedFiles(runGit: TeamGit, folder: string): Promise<readonly string[]> {
  const status = new TextDecoder().decode(
    await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], folder),
  )
  const entries = status.split(NUL).filter((entry) => entry !== '')
  const files: string[] = []
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? ''
    const letters = entry.slice(0, 2)
    // A rename or copy is followed by the path it came from.
    if (letters.includes('R') || letters.includes('C')) index += 1
    if (!letters.includes('D')) files.push(entry.slice(STATUS_PREFIX_LENGTH))
  }
  return files
}

/** The lockfiles the copy holds: they key a slot's install. */
async function heldLockfiles(folder: string): Promise<readonly string[]> {
  const held: string[] = []
  for (const name of TEAM_CHECK_LOCKFILES) {
    try {
      await access(path.join(folder, name))
      held.push(name)
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  return held
}

/** One call's result text: each check's exit code and where it ran, then its whole output. */
function resultText(results: readonly CheckResult[], checks: readonly CheckCommandSetting[]) {
  const names = results.map((result, index) => checks[index]?.name ?? result.runId)
  return [
    MODEL_API_MODEL_TEXT.runChecksLead,
    ...results.map(
      (result, index) =>
        `${fill(TEAM_PROCESS_MODEL_TEXT.hostCheckResult, {
          name: names[index] ?? result.runId,
          code: String(result.exitCode),
          location: result.location,
        })}\n${result.output}`,
    ),
  ].join('\n\n')
}

/**
The window's `run_checks` endpoints for Muse Code workers: one loopback server
started on the first task that gets one, one token per task, all closed with the
team.
*/
export function createWorkerChecks(deps: WorkerChecksDeps) {
  const registrations = new Map<string, Registration>()
  const inFlight = new Map<string, AbortController>()
  let listening: ReturnType<typeof listenLoopback> | undefined
  /** The tool for one request: the bridge's `run_checks` over this task, stopped with the request. */
  const toolFor = async (registration: Registration, signal: AbortSignal): Promise<McpTool> => {
    const { task, isCurrent } = registration
    const checks = deps.checks()
    const lockfiles = await heldLockfiles(task.folder)
    const bridge = bridgeRunChecks({
      checks: () => checks,
      platform: deps.platform,
      isCurrentAndAllowed: () => isCurrent() && task.role.toolGroups.includes('checks'),
      makeJob: (command, timeoutMs) => ({
        runId: randomUUID(),
        cwd: task.folder,
        command,
        timeoutMs,
        commandClass: 'declared',
        labels: [],
        preferredRunners: [],
        lockfiles,
        signal,
        onOutput: () => {
          // The result carries the whole output; nothing watches it arrive.
        },
      }),
      pathsFor: async (given) => {
        if (given === undefined) return await changedFiles(deps.runGit, task.folder)
        const confined = await Promise.all(
          given.map(
            async (file) =>
              await confineWorkerPath(
                {
                  folder: task.folder,
                  workspaceRoot: task.workspaceRoot,
                  platform: deps.platform,
                  io: WORKER_NATIVE_IO,
                },
                file,
              ),
          ),
        )
        return confined.map((file, index) => {
          if (!file.ok)
            throw new Error(
              fill(MODEL_API_MODEL_TEXT.runChecksMissingPath, { path: given[index] ?? '' }),
            )
          return file.relative
        })
      },
      // The commands are the person's own; the one thing a worker never does is move a ref.
      guard: (job) => {
        if (hasRefMove(job.command, deps.platform === 'win32' ? 'powershell' : 'bash'))
          return Promise.reject(new Error(TEAM_PROCESS_MODEL_TEXT.hostCheckMovesRef))
        return Promise.resolve(job.command)
      },
      // Runners over SSH are not on this route: the only leg is the local slot.
      runners: () => [],
      routing: {
        isTrusted: deps.isTrusted,
        localLabels: [],
        sample: () => Promise.reject(new Error(UI_TEXT.teamRunners.offline)),
        remote: () => Promise.reject(new Error(UI_TEXT.teamRunners.offline)),
        local: deps.localSlot,
      },
      pack: (results) => Promise.resolve(resultText(results as CheckResult[], checks)),
    })
    return {
      name: bridge.definition.name,
      description: bridge.definition.description,
      inputSchema: {
        type: 'object',
        properties: bridge.definition.properties,
        required: [...bridge.definition.required],
      },
      call: async (args) => {
        const text = await bridge.call(args)
        if (typeof text !== 'string') throw new TypeError(TEAM_MODEL_TEXT.hostNoReport)
        return text
      },
    }
  }

  /** The task whose token the request presents, compared in constant time. */
  const registrationOf = (
    request: IncomingMessage,
  ): readonly [string, Registration] | undefined => {
    const header = request.headers[AUTHORIZATION_HEADER]
    const presented =
      typeof header === 'string' && header.startsWith(BEARER_PREFIX)
        ? header.slice(BEARER_PREFIX.length)
        : ''
    return [...registrations].find(
      ([token]) => presented !== '' && isSameLoopbackSecret(presented, token),
    )
  }

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method !== POST) {
      response.writeHead(HTTP_STATUS.methodNotAllowed).end()
      return
    }
    const found = registrationOf(request)
    if (found === undefined) {
      deps.log.warn('The team check server refused a request without its task token')
      response.writeHead(HTTP_STATUS.unauthorized).end()
      return
    }
    const [token, registration] = found
    const body = await readLoopbackBody(request, CLI_OUTPUT_MAX_BYTES)
    if (body === undefined) {
      response.statusCode = HTTP_STATUS.badRequest
      response.end()
      return
    }
    // Keyed by token and request id: two tasks' identical ids never meet.
    const keys = mcpRequestKeys(body)
    if (keys.cancelled !== undefined) inFlight.get(`${token}:${keys.cancelled}`)?.abort()
    const flightKey = keys.request === undefined ? undefined : `${token}:${keys.request}`
    const controller = new AbortController()
    response.once('close', () => {
      if (!response.writableFinished) controller.abort()
    })
    if (flightKey !== undefined) inFlight.set(flightKey, controller)
    try {
      const outcome = await handleMcpMessage(
        body,
        [await toolFor(registration, controller.signal)],
        SERVER_INFO,
        controller.signal,
      )
      if (response.destroyed) return
      answerMcp(response, outcome)
    } finally {
      if (flightKey !== undefined && inFlight.get(flightKey) === controller)
        inFlight.delete(flightKey)
    }
  }

  const respond = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      await handle(request, response)
    } catch {
      // Fixed words: a failure can carry caller data or the bearer header.
      deps.log.error('The team check server request failed')
      if (!response.headersSent) response.statusCode = HTTP_STATUS.internalServerError
      response.end()
    }
  }

  return {
    /**
    The session MCP servers a task gets: the `run_checks` endpoint when its role
    has the checks group and the person configured a check; none otherwise.
    `isCurrent` ends the endpoint's answers once the task's attempt is over.
    */
    async serve(
      task: WorkerCheckTask,
      isCurrent: () => boolean,
    ): Promise<WorkerCheckEndpoint | undefined> {
      if (!task.role.toolGroups.includes('checks') || deps.checks().length === 0) return undefined
      listening ??= listenLoopback(
        (request, response) => {
          void respond(request, response)
        },
        deps.log,
        'Team check server',
      )
      const { port } = await listening
      const token = randomBytes(IDE_MCP_TOKEN_BYTES).toString('hex')
      registrations.set(token, { task, isCurrent })
      return {
        servers: {
          [TEAM_CHECKS_SERVER]: {
            url: `http://${IDE_MCP_LOOPBACK_HOST}:${String(port)}/${TEAM_CHECKS_TOOL}`,
            headers: { Authorization: `${BEARER_PREFIX}${token}` },
          },
        },
        close: () => {
          registrations.delete(token)
          for (const [key, controller] of inFlight)
            if (key.startsWith(`${token}:`)) controller.abort()
        },
      }
    },
    close: async (): Promise<void> => {
      registrations.clear()
      for (const controller of inFlight.values()) controller.abort()
      const started = listening
      listening = undefined
      if (started === undefined) return
      const { server } = await started
      server.closeAllConnections()
      server.close()
    },
  }
}
