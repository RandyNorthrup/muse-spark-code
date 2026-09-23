// The internal agent protocol both backends implement (PLAN.md D1): the
// Muse Code host (MSP over `muse serve`, M2–M6) and the Model API backend
// (direct HTTPS with an in-process tool harness, M7). The conversation
// controller and the webview see only these interfaces and the AgentEvent
// union, never which backend is active.

import type {
  AgentEvent,
  ItemSnapshot,
  QuestionAnswer,
  RequirementRef,
  TodoItem,
} from '../../shared/agentEvents'
import type { SubscriptionUsage } from '../../shared/usage'

export type BackendKind = 'museCode' | 'modelApi'

export interface HostInfo {
  readonly kind: BackendKind
  readonly serverName: string
  readonly serverVersion: string
  /** Capabilities the host granted at handshake (`sessionMcp`, …). */
  readonly grantedCapabilities: readonly string[]
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

/** A per-session MCP server over streamable HTTP (MSP `SessionMcpServerConfig`). */
export interface SessionMcpHttpServer {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export interface StartSessionOptions {
  readonly workspaceRoot: string
  readonly modelId: string
  readonly approvalMode: string
  /** IDE tool servers, keyed by name; needs the `sessionMcp` grant. */
  readonly mcpServers?: Readonly<Record<string, SessionMcpHttpServer>>
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

export interface ListSessionsOptions {
  readonly workspaceRoot: string
  readonly limit: number
  readonly cursor?: string
}

/** A stored session as the host lists it (the MSP `Session` object, narrowed). */
export interface SessionRecord {
  readonly sessionId: string
  readonly name?: string | undefined
  readonly title?: string | undefined
  readonly firstUserPrompt?: string | undefined
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastActivityAt?: string | undefined
  readonly branch?: string | undefined
  readonly status: string
  readonly turnCount: number
  readonly forkedFrom?: { readonly sessionId: string } | null | undefined
  readonly workspaceRoot?: string | null | undefined
}

export interface SessionPage {
  readonly sessions: readonly SessionRecord[]
  readonly nextCursor: string | undefined
}

/** What a resumed or forked session's history yields for the transcript. */
export interface SessionHistoryOutcome {
  /** `inline`, `snapshot`, `anchoredSnapshot` or `none` (then `items` is empty). */
  readonly mode: string
  readonly items: readonly ItemSnapshot[]
  readonly name: string | undefined
  readonly todos: readonly TodoItem[]
}

/** A session loaded by resume or minted by fork (M6). */
export interface LoadedSession {
  readonly session: AgentSession
  readonly record: SessionRecord
  readonly history: SessionHistoryOutcome
}

/** A stored session changed (a full row) or was unloaded. */
export type SessionListEvent =
  | { readonly type: 'changed'; readonly record: SessionRecord }
  | { readonly type: 'closed'; readonly sessionId: string; readonly reason: string }

/** One live conversation on a host. */
export interface AgentSession {
  readonly sessionId: string
  readonly modelId: string
  onEvent(listener: SessionEventListener): () => void
  /**
   * Submit a turn. `displayText` is the transcript's presentation form of
   * the prompt, used when the parts carry more than the user typed (M5).
   */
  sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission>
  /** Inject input into the running turn; rejects when it is no longer running. */
  steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string>
  cancel(): Promise<void>
  setModel(modelId: string): Promise<void>
  /** The session's standing reasoning-effort default (wire vocabulary). */
  setReasoningEffort(reasoningEffort: string): Promise<void>
  /** One of the four MSP approval modes (shared/permissionModes.ts). */
  setApprovalMode(mode: string): Promise<void>
  compact(): Promise<CompactOutcome>
  decideApproval(decision: ApprovalDecision): Promise<void>
  answerQuestions(userInputId: string, answers: readonly QuestionAnswer[]): Promise<void>
  readOutput(request: OutputPageRequest): Promise<OutputPage>
  listSkills(): Promise<readonly SkillSummary[]>
  /** Resolves to the canonical name, or undefined when it arrives as an event. */
  rename(name: string): Promise<string | undefined>
  dispose(): void
}

/** One backend process or connection, multiplexing sessions. */
export interface AgentHost {
  readonly info: HostInfo
  onExit(listener: (description: string) => void): () => void
  listModels(sessionId?: string): Promise<readonly ModelSummary[]>
  startSession(options: StartSessionOptions): Promise<AgentSession>
  listSessions(options: ListSessionsOptions): Promise<SessionPage>
  /** A session's transcript without loading it (a subagent's child session, M14). */
  readSession(sessionId: string): Promise<SessionHistoryOutcome>
  resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpHttpServer>>,
  ): Promise<LoadedSession>
  forkSession(sessionId: string, modelId: string, lastTurnId?: string): Promise<LoadedSession>
  onSessionListEvent(listener: (event: SessionListEvent) => void): () => void
  /**
   * The subscription usage the host last observed (M8); undefined when there
   * is none: a key-billed backend, or a CLI that has not seen a usage frame
   * yet (it reports one after a turn).
   */
  readUsage(): Promise<SubscriptionUsage | undefined>
  /** A fresh observation arrived (MSP `usage/changed`). */
  onUsageChanged(listener: (usage: SubscriptionUsage) => void): () => void
  readonly sessionCount: number
  close(): Promise<void>
}
