// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import { type CommandOptions, type Connection, MspError } from '@muse-code/sdk'
import * as z from 'zod/mini'
import type { AgentEvent, QuestionAnswer } from '../../../shared/agentEvents'
import {
  MILLISECONDS_PER_SECOND,
  MSP_COMMAND_TIMEOUT_MS,
  MSP_LONG_COMMAND_TIMEOUT_MS,
  MSP_LONG_COMMANDS,
  MUSE_EXIT_MEANINGS,
  type SubagentAction,
} from '../../../shared/constants'
import { withDeadline } from '../../timeouts'
import {
  type SubscriptionUsage,
  subscriptionUsageSchema,
  usageReadResultSchema,
} from '../../../shared/usage'
import type {
  AgentHost,
  AgentSession,
  ApprovalDecision,
  CompactOutcome,
  HostExit,
  HostInfo,
  ListSessionsOptions,
  LoadedSession,
  ModelSummary,
  OutputPage,
  OutputPageRequest,
  SessionEventListener,
  SessionHistoryOutcome,
  SessionListEvent,
  SessionMcpHttpServer,
  SessionPage,
  SkillSummary,
  StartSessionOptions,
  TurnPart,
  TurnSubmission,
} from '../../agent/agentBackend'
import { SessionNotLoadedError } from '../../agent/agentBackend'
import type { CoreLogger } from '../../logging'
import { mapNotification, type WireNotification } from './mapNotification'
import {
  historyOutcome,
  sessionClosedSchema,
  type SessionEnvelope,
  sessionEnvelopeSchema,
  sessionListChangedSchema,
  sessionListResultSchema,
  sessionRenameResultSchema,
} from './sessionRecords'

/** What the SDK's `SpawnedMspConnection` provides, narrowed to what we use. */
export interface MspHost {
  readonly connection: Connection
  readonly initializeResult: unknown
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>
  close(): Promise<unknown>
}

/** The MSP host's identity plus what the extension logs about it. */
export interface MuseHostInfo extends HostInfo {
  readonly museHome: string
}

const SESSION_LIST_CHANGED = 'session/listChanged'
const SESSION_CLOSED = 'session/closed'
const USAGE_CHANGED = 'usage/changed'
const USAGE_READ = 'usage/read'
const HISTORY_PREFERENCE_INLINE = 'inline'

const initializeResultSchema = z.object({
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  museHome: z.string(),
  grantedCapabilities: z.optional(z.array(z.string())),
})

const sessionStartResultSchema = z.object({
  session: z.object({ sessionId: z.string(), modelId: z.nullable(z.string()) }),
})

const turnStartResultSchema = z.object({
  turnId: z.string(),
  status: z.string(),
  disposition: z.optional(z.string()),
})

const turnSteerResultSchema = z.object({ turnId: z.string(), status: z.string() })

const compactResultSchema = z.object({ status: z.string(), reason: z.optional(z.string()) })

const modelListResultSchema = z.object({
  models: z.array(
    z.object({
      modelId: z.string(),
      displayLabel: z.string(),
      contextLimit: z.nullable(z.number()),
      isDefault: z.boolean(),
      isActive: z.optional(z.boolean()),
    }),
  ),
})

const skillListResultSchema = z.object({
  skills: z.array(
    z.object({
      selector: z.string(),
      displayName: z.string(),
      description: z.string(),
      argumentHint: z.optional(z.string()),
    }),
  ),
})

const readOutputResultSchema = z.object({
  content: z.string(),
  encoding: z.string(),
  mediaType: z.string(),
  offsetBytes: z.number(),
  byteLen: z.number(),
  eof: z.boolean(),
})

const DEFAULT_DISPOSITION = 'started'

// The host also mirrors an approval or question as a JSON-RPC server request.
// The SDK's own facade documents that the notification is the enrolled
// surface and the decision travels as `approval/decide` / `userInput/answer`
// (verified live 2026-09-21: the request was refused and the prompt still
// settled from the command), so these two are declined quietly.
const MIRRORED_SERVER_REQUESTS: ReadonlySet<string> = new Set([
  'approval/request',
  'userInput/request',
])

const SESSION_NOT_LOADED = 'sessionNotLoaded'

/** How long a command may wait (PLAN.md D25); overridable for tests. */
export interface CommandTimeouts {
  readonly normalMs: number
  readonly longMs: number
}

const DEFAULT_TIMEOUTS: CommandTimeouts = {
  normalMs: MSP_COMMAND_TIMEOUT_MS,
  longMs: MSP_LONG_COMMAND_TIMEOUT_MS,
}

/**
 * One MSP command with a deadline. `sessionNotLoaded` (the host evicted or
 * closed the session) becomes a `SessionNotLoadedError` the controller
 * answers by resuming the session.
 */
async function commandWithin(
  connection: Connection,
  timeouts: CommandTimeouts,
  method: string,
  params: Record<string, unknown>,
  options?: CommandOptions,
): Promise<unknown> {
  const timeoutMs = MSP_LONG_COMMANDS.has(method) ? timeouts.longMs : timeouts.normalMs
  try {
    return await withDeadline(
      connection.command(method, params, options),
      timeoutMs,
      `Muse Code did not answer ${method} within ${String(Math.round(timeoutMs / MILLISECONDS_PER_SECOND))} s`,
    )
  } catch (error: unknown) {
    const sessionId = params['sessionId']
    if (
      typeof sessionId === 'string' &&
      error instanceof MspError &&
      error.kind === SESSION_NOT_LOADED
    ) {
      throw new SessionNotLoadedError(sessionId, error.message)
    }
    throw error
  }
}

/** A process exit as the conversations see it (D25). */
export function describeExit(
  exit: { readonly code: number | null; readonly signal: string | null },
  isExpected: boolean,
): HostExit {
  if (exit.code === null) {
    return {
      description: `Muse Code was stopped by ${exit.signal ?? 'an unknown signal'}`,
      isExpected,
      isPersistent: false,
    }
  }
  const meaning = MUSE_EXIT_MEANINGS[exit.code]
  return meaning === undefined
    ? {
        description: `Muse Code exited with code ${String(exit.code)}`,
        isExpected,
        isPersistent: false,
      }
    : {
        description: `${meaning.text} (exit ${String(exit.code)})`,
        isExpected,
        isPersistent: meaning.isPersistent,
      }
}

export class MuseSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  /** The surfaces holding this handle (PLAN.md D25): the last release disposes it. */
  private holders = 1
  private isDisposed = false

  public constructor(
    public readonly sessionId: string,
    public readonly modelId: string,
    private readonly connection: Connection,
    private readonly onDispose: () => void,
    private readonly timeouts: CommandTimeouts = DEFAULT_TIMEOUTS,
  ) {}

  /** One MSP command against this session with a freshly minted commandId. */
  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    const commandId = this.connection.mintCommandId()
    return await commandWithin(
      this.connection,
      this.timeouts,
      method,
      { commandId, sessionId: this.sessionId, ...params },
      { commandId },
    )
  }

  /** One more surface holds this handle (a second panel resumed the same session). */
  public retain(): void {
    this.holders += 1
  }

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** @internal Called by the host dispatcher. */
  public emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  /** Submit one user turn; queued behind a running turn by host default. */
  /**
   * Submit a turn. `displayText` is the transcript's presentation form of the
   * prompt (MSP: durable, never model-visible), used when the parts carry
   * more than the user typed (editor context, M5).
   */
  public async sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    const result = turnStartResultSchema.parse(
      await this.command('turn/start', {
        input: parts,
        ...(displayText !== undefined && { displayText }),
      }),
    )
    return { turnId: result.turnId, disposition: result.disposition ?? DEFAULT_DISPOSITION }
  }

  /**
   * Inject input into the turn believed to be running. The host rejects the
   * steer when that turn is no longer the running one, so input meant for one
   * turn never leaks into the next; callers fall back to `sendTurn`.
   */
  public async steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string> {
    const result = await this.command('turn/steer', { expectedTurnId, input: parts })
    return turnSteerResultSchema.parse(result).turnId
  }

  /** Ask the host to stop the running turn gracefully. */
  public async cancel(): Promise<void> {
    await this.command('turn/cancel', {})
  }

  /** Stop the running turn immediately. */
  public async interrupt(): Promise<void> {
    await this.command('turn/interrupt', {})
  }

  /** Durable model selection; applies from the next model call. */
  public async setModel(modelId: string): Promise<void> {
    await this.command('session/setModel', { model: { modelId } })
  }

  /** The session's standing reasoning-effort default (wire vocabulary). */
  public async setReasoningEffort(reasoningEffort: string): Promise<void> {
    await this.command('session/setReasoningEffort', { reasoningEffort })
  }

  /** Select one of the host's preconfigured approval modes. */
  public async setApprovalMode(mode: string): Promise<void> {
    await this.command('session/setApprovalMode', { mode })
  }

  /** Summarise older context; `status` is `noop` with a reason when nothing to do. */
  public async compact(): Promise<CompactOutcome> {
    const result = compactResultSchema.parse(await this.command('session/compact', {}))
    return { status: result.status, reason: result.reason }
  }

  /**
   * Answer a gated tool call. `requirementId` is the stage token from the
   * request; a stale one is rejected by the host, never silently applied.
   */
  public async decideApproval(decision: ApprovalDecision): Promise<void> {
    await this.command('approval/decide', {
      approvalId: decision.approvalId,
      choiceId: decision.choiceId,
      requirementId: decision.requirementId,
      ...(decision.feedback !== undefined && { feedback: decision.feedback }),
    })
  }

  /** Answer every question of a `request_user_input` prompt. */
  public async answerQuestions(
    userInputId: string,
    answers: readonly QuestionAnswer[],
  ): Promise<void> {
    await this.command('userInput/answer', { userInputId, answers: [...answers] })
  }

  /** Decline a `request_user_input` prompt (`userInput/cancel`, M16). */
  public async cancelQuestions(userInputId: string): Promise<void> {
    await this.command('userInput/cancel', { userInputId })
  }

  /** `subagent/interrupt`, `stop`, `resume` or `close` on a child (M18). */
  public async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    await this.command(`subagent/${action}`, { subagentId })
  }

  /** `subagent/sendMessage` (a note while it runs) or `subagent/followupTask` (M18). */
  public async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    await this.command(isFollowup ? 'subagent/followupTask' : 'subagent/sendMessage', {
      subagentId,
      body,
    })
  }

  /** One page of a stored tool output or patch document (`item/readOutput`). */
  public async readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const result = await commandWithin(this.connection, this.timeouts, 'item/readOutput', {
      sessionId: this.sessionId,
      itemId: request.itemId,
      outputRef: request.outputRef,
      offsetBytes: request.offsetBytes,
      lengthBytes: request.lengthBytes,
    })
    return readOutputResultSchema.parse(result)
  }

  /**
   * Set the durable session name; resolves to the canonical name the host
   * settled, or undefined when it will arrive as `session/nameChanged`.
   * Muse Code 1.3.0 refuses this on Windows (UnsupportedPlatform, PLAN.md M6).
   */
  public async rename(name: string): Promise<string | undefined> {
    const result = sessionRenameResultSchema.parse(await this.command('session/rename', { name }))
    return result.name
  }

  /** The user-invocable skills in this session's workspace and plugins. */
  public async listSkills(): Promise<readonly SkillSummary[]> {
    const result = await commandWithin(this.connection, this.timeouts, 'skill/list', {
      sessionId: this.sessionId,
    })
    return skillListResultSchema.parse(result).skills.map((skill) => ({
      selector: skill.selector,
      displayName: skill.displayName,
      description: skill.description,
      argumentHint: skill.argumentHint,
    }))
  }

  /** Releases this surface's hold; the last one forgets the session (D25). */
  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.holders -= 1
    if (this.holders > 0) {
      return
    }
    this.isDisposed = true
    this.listeners.clear()
    this.onDispose()
  }

  /** The host is closing: the handle goes whoever still holds it. */
  public disposeAll(): void {
    this.holders = 1
    this.dispose()
  }
}

export class MuseCodeHost implements AgentHost {
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private readonly usageListeners = new Set<(usage: SubscriptionUsage) => void>()
  /** Set by `close()`: the exit that follows is the extension's, not a crash (D25). */
  private isClosing = false
  public readonly info: MuseHostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
    private readonly timeouts: CommandTimeouts = DEFAULT_TIMEOUTS,
  ) {
    const parsed = initializeResultSchema.parse(host.initializeResult)
    this.info = {
      kind: 'museCode',
      serverName: parsed.serverInfo.name,
      serverVersion: parsed.serverInfo.version,
      museHome: parsed.museHome,
      grantedCapabilities: parsed.grantedCapabilities ?? [],
    }
    // The SDK's connection keeps one handler; a throw inside it would end the
    // read loop and leave the connection deaf without a word (D25).
    host.connection.onNotification((notification) => {
      try {
        this.dispatch(notification)
      } catch (error: unknown) {
        this.log.error(`MSP ${notification.method} could not be handled: ${String(error)}`)
      }
    })
    host.connection.onServerRequest((request) => {
      if (MIRRORED_SERVER_REQUESTS.has(request.method)) {
        this.log.info(`MSP server request ${request.method} declined; answered by command`)
      } else {
        this.log.warn(`Unsupported MSP server request ${request.method}; refusing`)
      }
      return Promise.reject(new Error(`unsupported server request: ${request.method}`))
    })
    // A connection that ends while the process lives (a framing violation)
    // is as good as dead: the process is closed so the exit is reported.
    void host.connection.closed.then(() => {
      if (this.isClosing) {
        return
      }
      this.log.warn('The MSP connection closed while muse serve was running; closing it')
      void this.host.close()
    })
    void host.exited.then((exit) => {
      const described = describeExit(exit, this.isClosing)
      if (described.isExpected) {
        this.log.info(`muse serve exited as asked (${described.description})`)
      } else {
        this.log.warn(`muse serve exited (${described.description})`)
      }
      for (const listener of this.exitListeners) {
        listener(described)
      }
    })
  }

  /** One notification: a host-level event, or a session's. */
  private dispatch(notification: WireNotification): void {
    if (this.dispatchHostEvent(notification.method, notification.params)) {
      return
    }
    const mapped = mapNotification(notification)
    if (mapped === undefined) {
      return
    }
    const session = this.sessions.get(mapped.sessionId)
    if (session === undefined) {
      this.log.warn(`MSP event ${notification.method} for unknown session ${mapped.sessionId}`)
      return
    }
    session.emit(mapped.event)
  }

  private async command(
    method: string,
    params: Record<string, unknown>,
    options?: CommandOptions,
  ): Promise<unknown> {
    return await commandWithin(this.host.connection, this.timeouts, method, params, options)
  }

  /**
   * Host-level notifications bypass the per-session routing: the list
   * stream (`sessionListStream` grant) is about stored sessions, loaded here
   * or not, and `usage/changed` is about the account. True when the method
   * was one of them.
   */
  private dispatchHostEvent(method: string, params: unknown): boolean {
    if (method === USAGE_CHANGED) {
      const parsed = subscriptionUsageSchema.safeParse(params)
      if (parsed.success) {
        for (const listener of this.usageListeners) {
          listener(parsed.data)
        }
      } else {
        this.warnShape(method)
      }
      return true
    }
    if (method !== SESSION_LIST_CHANGED && method !== SESSION_CLOSED) {
      return false
    }
    const event = this.parseListEvent(method, params)
    if (event === undefined) {
      this.warnShape(method)
      return true
    }
    for (const listener of this.listListeners) {
      listener(event)
    }
    return true
  }

  private warnShape(method: string): void {
    this.log.warn(`MSP ${method} had an unexpected shape; ignored`)
  }

  private parseListEvent(method: string, params: unknown): SessionListEvent | undefined {
    if (method === SESSION_LIST_CHANGED) {
      const parsed = sessionListChangedSchema.safeParse(params)
      return parsed.success ? { type: 'changed', record: parsed.data.session } : undefined
    }
    const parsed = sessionClosedSchema.safeParse(params)
    return parsed.success
      ? { type: 'closed', sessionId: parsed.data.sessionId, reason: parsed.data.reason }
      : undefined
  }

  /** Registers the handle for a session this connection now holds. */
  private track(record: { readonly sessionId: string }, modelId: string): MuseSession {
    const existing = this.sessions.get(record.sessionId)
    if (existing !== undefined) {
      // A second surface on the same session: closing one must not deafen the other.
      existing.retain()
      return existing
    }
    const handle = new MuseSession(
      record.sessionId,
      modelId,
      this.host.connection,
      () => {
        this.sessions.delete(record.sessionId)
      },
      this.timeouts,
    )
    this.sessions.set(record.sessionId, handle)
    return handle
  }

  private loaded(envelope: SessionEnvelope, modelId: string): LoadedSession {
    return {
      session: this.track(envelope.session, modelId),
      record: envelope.session,
      history: historyOutcome(envelope),
    }
  }

  private mcpConfig(
    mcpServers: Readonly<Record<string, SessionMcpHttpServer>> | undefined,
  ): Record<string, unknown> {
    if (mcpServers === undefined) {
      return {}
    }
    return {
      config: {
        mcpServers: Object.fromEntries(
          Object.entries(mcpServers).map(([name, server]) => [
            name,
            // `optional`: a tool-server hiccup never blocks the session.
            {
              transport: 'streamableHttp',
              url: server.url,
              headers: server.headers,
              mode: 'optional',
            },
          ]),
        ),
      },
    }
  }

  public onExit(listener: (exit: HostExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** The subscription window the CLI last observed; absent until a turn has run. */
  public async readUsage(): Promise<SubscriptionUsage | undefined> {
    const result = await this.command(USAGE_READ, {})
    return usageReadResultSchema.parse(result).usage
  }

  public onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void {
    this.usageListeners.add(listener)
    return () => {
      this.usageListeners.delete(listener)
    }
  }

  /** Stored-session changes on this host (needs the `sessionListStream` grant). */
  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  /** One page of this workspace's stored sessions, newest activity first. */
  public async listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const result = await this.command('session/list', {
      workspaceRoot: options.workspaceRoot,
      limit: options.limit,
      ...(options.cursor !== undefined && { cursor: options.cursor }),
    })
    const page = sessionListResultSchema.parse(result)
    return { sessions: page.sessions, nextCursor: page.nextCursor ?? undefined }
  }

  /**
   * Load a stored session on this connection with its history inline where
   * the host's budget allows (the served mode is reported). `modelId` is
   * the caller's standing selection: the record's own `modelId` is the
   * metadata fold's and not to be trusted (PLAN.md M6).
   */
  public async resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpHttpServer>>,
  ): Promise<LoadedSession> {
    const commandId = this.host.connection.mintCommandId()
    const result = await this.command(
      'session/resume',
      {
        commandId,
        sessionId,
        history: HISTORY_PREFERENCE_INLINE,
        ...this.mcpConfig(mcpServers),
      },
      { commandId },
    )
    return this.loaded(sessionEnvelopeSchema.parse(result), modelId)
  }

  /** A point-in-time read with items, without loading the session. */
  public async readSession(sessionId: string): Promise<SessionHistoryOutcome> {
    const result = await this.command('session/read', {
      sessionId,
      excludeItems: false,
    })
    return historyOutcome(sessionEnvelopeSchema.parse(result))
  }

  /**
   * Copy a session's completed turns (through `lastTurnId`, or all of them)
   * into a new session, loaded here. Muse Code 1.3.0 refuses this on
   * Windows ("invalid fork boundary ... WriteFailed", PLAN.md M6).
   */
  public async forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    const commandId = this.host.connection.mintCommandId()
    const result = await this.command(
      'session/fork',
      {
        commandId,
        sessionId,
        ...(lastTurnId !== undefined && { cutPoint: { lastTurnId } }),
      },
      { commandId },
    )
    return this.loaded(sessionEnvelopeSchema.parse(result), modelId)
  }

  /** The visible model catalogue; with a session id the active row is flagged. */
  public async listModels(sessionId?: string): Promise<readonly ModelSummary[]> {
    const result = await this.command('model/list', {
      ...(sessionId !== undefined && { sessionId }),
    })
    return modelListResultSchema.parse(result).models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      contextLimit: model.contextLimit ?? undefined,
      isDefault: model.isDefault,
      isActive: model.isActive ?? false,
    }))
  }

  public async startSession(options: StartSessionOptions): Promise<MuseSession> {
    const commandId = this.host.connection.mintCommandId()
    const result = await this.command(
      'session/start',
      {
        commandId,
        workspaceRoot: options.workspaceRoot,
        modelId: options.modelId,
        approvalMode: options.approvalMode,
        ...this.mcpConfig(options.mcpServers),
      },
      { commandId },
    )
    const { session } = sessionStartResultSchema.parse(result)
    return this.track(session, session.modelId ?? options.modelId)
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public async close(): Promise<void> {
    // The exit that follows is the extension's own (D25).
    this.isClosing = true
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    await this.host.close()
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
  }
}
