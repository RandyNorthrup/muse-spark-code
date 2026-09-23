// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import type { Connection } from '@muse-code/sdk'
import * as z from 'zod/mini'
import type { AgentEvent, QuestionAnswer } from '../../../shared/agentEvents'
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
import type { CoreLogger } from '../../logging'
import { mapNotification } from './mapNotification'
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

export class MuseSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  private isDisposed = false

  public constructor(
    public readonly sessionId: string,
    public readonly modelId: string,
    private readonly connection: Connection,
    private readonly onDispose: () => void,
  ) {}

  /** One MSP command against this session with a freshly minted commandId. */
  private async command(method: string, params: Record<string, unknown>): Promise<unknown> {
    const commandId = this.connection.mintCommandId()
    return await this.connection.command(
      method,
      { commandId, sessionId: this.sessionId, ...params },
      { commandId },
    )
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

  /** One page of a stored tool output or patch document (`item/readOutput`). */
  public async readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const result = await this.connection.command('item/readOutput', {
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
    const result = await this.connection.command('skill/list', { sessionId: this.sessionId })
    return skillListResultSchema.parse(result).skills.map((skill) => ({
      selector: skill.selector,
      displayName: skill.displayName,
      description: skill.description,
      argumentHint: skill.argumentHint,
    }))
  }

  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    this.listeners.clear()
    this.onDispose()
  }
}

export class MuseCodeHost implements AgentHost {
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: string) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private readonly usageListeners = new Set<(usage: SubscriptionUsage) => void>()
  public readonly info: MuseHostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
  ) {
    const parsed = initializeResultSchema.parse(host.initializeResult)
    this.info = {
      kind: 'museCode',
      serverName: parsed.serverInfo.name,
      serverVersion: parsed.serverInfo.version,
      museHome: parsed.museHome,
      grantedCapabilities: parsed.grantedCapabilities ?? [],
    }
    host.connection.onNotification((notification) => {
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
    })
    host.connection.onServerRequest((request) => {
      if (MIRRORED_SERVER_REQUESTS.has(request.method)) {
        this.log.info(`MSP server request ${request.method} declined; answered by command`)
      } else {
        this.log.warn(`Unsupported MSP server request ${request.method}; refusing`)
      }
      return Promise.reject(new Error(`unsupported server request: ${request.method}`))
    })
    void host.exited.then((exit) => {
      const description = `code ${String(exit.code)}, signal ${String(exit.signal)}`
      this.log.warn(`muse serve exited (${description})`)
      for (const listener of this.exitListeners) {
        listener(description)
      }
    })
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
      return existing
    }
    const handle = new MuseSession(record.sessionId, modelId, this.host.connection, () => {
      this.sessions.delete(record.sessionId)
    })
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

  public onExit(listener: (description: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  /** The subscription window the CLI last observed; absent until a turn has run. */
  public async readUsage(): Promise<SubscriptionUsage | undefined> {
    const result = await this.host.connection.command(USAGE_READ, {})
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
    const result = await this.host.connection.command('session/list', {
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
    const result = await this.host.connection.command(
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
    const result = await this.host.connection.command('session/read', {
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
    const result = await this.host.connection.command(
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
    const result = await this.host.connection.command('model/list', {
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
    const result = await this.host.connection.command(
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
    // Close the process first: the host emits session/statusChanged for every
    // loaded session on the way down, and those must still find their session.
    await this.host.close()
    for (const session of this.sessions.values()) {
      session.dispose()
    }
  }
}
