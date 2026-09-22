// One `muse serve` process and the MSP sessions multiplexed over it.
//
// Built on the SDK's raw `Connection` rather than its `MuseClient` facade:
// `Connection.onNotification` holds a single handler, and the extension needs
// that handler for session-state notifications the facade does not surface.
// The process boundary (`MspHost`) is injected so unit tests drive the class
// through a fake in-memory transport.

import type { Connection } from '@muse-code/sdk'
import * as z from 'zod/mini'
import type { AgentEvent, QuestionAnswer, RequirementRef } from '../../../shared/agentEvents'
import type { CoreLogger } from '../../logging'
import { mapNotification } from './mapNotification'

/** What the SDK's `SpawnedMspConnection` provides, narrowed to what we use. */
export interface MspHost {
  readonly connection: Connection
  readonly initializeResult: unknown
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>
  close(): Promise<unknown>
}

export interface HostInfo {
  readonly serverName: string
  readonly serverVersion: string
  readonly museHome: string
}

export interface ModelSummary {
  readonly modelId: string
  readonly displayLabel: string
  readonly contextLimit: number | undefined
  readonly isDefault: boolean
  readonly isActive: boolean
}

export interface SkillSummary {
  readonly selector: string
  readonly displayName: string
  readonly description: string
  readonly argumentHint: string | undefined
}

export interface StartSessionOptions {
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: string
}

/** One ordered content part of a turn (MSP `TurnInputPart`). */
export type TurnPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image'
      readonly base64Data: string
      readonly mediaType: string
      readonly width: number
      readonly height: number
    }
  | { readonly type: 'skill'; readonly selector: string; readonly arguments?: string }

export interface TurnSubmission {
  readonly turnId: string
  /** `started`, `queued` or `steered` (open on the wire). */
  readonly disposition: string
}

export interface CompactOutcome {
  readonly status: string
  readonly reason: string | undefined
}

export interface ApprovalDecision {
  readonly approvalId: string
  readonly choiceId: string
  readonly requirementId: RequirementRef
  /** Only for choices with `acceptsFeedback`; delivered to the model. */
  readonly feedback?: string
}

export interface OutputPageRequest {
  readonly itemId: string
  readonly outputRef: string
  readonly offsetBytes: number
  readonly lengthBytes: number
}

export interface OutputPage {
  readonly content: string
  readonly encoding: string
  readonly mediaType: string
  readonly offsetBytes: number
  readonly byteLen: number
  readonly eof: boolean
}

export type SessionEventListener = (event: AgentEvent) => void

const initializeResultSchema = z.object({
  serverInfo: z.object({ name: z.string(), version: z.string() }),
  museHome: z.string(),
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

export class MuseSession {
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
  public async sendTurn(parts: readonly TurnPart[]): Promise<TurnSubmission> {
    const result = turnStartResultSchema.parse(await this.command('turn/start', { input: parts }))
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

export class MuseCodeHost {
  private readonly sessions = new Map<string, MuseSession>()
  private readonly exitListeners = new Set<(exit: string) => void>()
  public readonly info: HostInfo

  public constructor(
    private readonly host: MspHost,
    private readonly log: CoreLogger,
  ) {
    const parsed = initializeResultSchema.parse(host.initializeResult)
    this.info = {
      serverName: parsed.serverInfo.name,
      serverVersion: parsed.serverInfo.version,
      museHome: parsed.museHome,
    }
    host.connection.onNotification((notification) => {
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

  public onExit(listener: (description: string) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
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
      },
      { commandId },
    )
    const { session } = sessionStartResultSchema.parse(result)
    const handle = new MuseSession(
      session.sessionId,
      session.modelId ?? options.modelId,
      this.host.connection,
      () => {
        this.sessions.delete(session.sessionId)
      },
    )
    this.sessions.set(session.sessionId, handle)
    return handle
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
