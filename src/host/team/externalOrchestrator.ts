// An external ACP agent leading a conversation as orchestrator (PLAN.md
// D250, amending D75). The extension is the agent's ACP client and nothing
// more: the agent keeps its loop, its system prompt, its tools and its
// sign-in. What it receives from us is tools and instructions only — the
// conversation's own team MCP endpoint (and the `ide` server) in
// `session/new` `mcpServers`, over HTTP where the agent advertises it and
// through the shipped stdio bridge (`dist/teamHttpBridge.js`) where it does
// not — plus the panel's own surfaces: its messages, tool calls and plans
// stream as conversation items, its permission requests become the person's
// approval cards, Stop sends `session/cancel`, and an auth error names the
// agent's own sign-in command instead of any login of ours.
//
// One host owns one agent process (spawned lazily on the first session) and
// every session this conversation opens on it. The process is a child of
// this window: killed with its tree on close, respawned on demand after an
// unexpected exit (resume goes through `session/load` where the agent
// advertised it). Its environment is the person's own minus credential
// variables (rule 8): our stored keys never reach another vendor's agent,
// and its CLI credential store never needs them.
//
// The protocol work itself is lane W's one ACP connection
// (`acpProcess.ts`): this module only translates between ACP session
// updates and the conversation's `AgentEvent`s, and serves the client's
// `fs/*` methods confined to the workspace.

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { AuthMethod, McpServer } from '@agentclientprotocol/sdk'
import {
  GoalRefusedError,
  ModeKeptError,
  SessionNotFoundError,
  SteerRefusedError,
  type AgentHost,
  type AgentSession,
  type ApprovalDecision,
  type HostExit,
  type HostInfo,
  type ListSessionsOptions,
  type LoadedSession,
  type ModelSummary,
  type OutputPage,
  type SessionEventListener,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionMcpServer,
  type SessionPage,
  type SessionRecord,
  type SkillSummary,
  type StartSessionOptions,
  type TurnPart,
  type TurnSubmission,
} from '../../core/agent/agentBackend'
import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import type { SubscriptionUsage } from '../../shared/usage'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT, CONTEXT_PRESSURE_HIGH, CONTEXT_PRESSURE_MEDIUM } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { isProtectedPath } from '../../core/protectedPaths'
import { assertWorkerRoot, WORKER_NATIVE_IO } from '../../core/team/workers/workerFence'
import { failureForLog } from '../../core/backends/musecode/logText'
import {
  AcpAuthRequiredError,
  AcpMethodNotFoundError,
  type AcpAgentConnection,
  type AcpConfigSelector,
  type AcpPermissionOption,
} from '../../core/team/workers/acpWorker'
import type { ExternalAgent } from '../../core/team/externalAgents'
import { isExternalDefaultModel } from '../../core/team/externalAgents'
import { connectAcpAgent, type AcpClientHandlers } from './acpProcess'

/** Everything the host starts from; all host-provided, nothing global. */
export interface ExternalOrchestratorDeps {
  /** The picked agent: launch facts, label, payer, sign-in command. */
  readonly agent: ExternalAgent
  /** The resolved executable (the entry's PATH lookup). */
  readonly command: string
  /** The stdio bridge the agent spawns for HTTP MCP servers it cannot take. */
  readonly bridge: {
    readonly command: string
    readonly args: readonly string[]
    /** Fixed entries beside the endpoint's (e.g. run-as-node for Electron). */
    readonly env?: readonly { readonly name: string; readonly value: string }[]
  }
  readonly log: CoreLogger
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  readonly newId: () => string
  readonly now: () => number
}

const IN_PROGRESS = 'inProgress'
const COMPLETED = 'completed'
const FAILED = 'failed'
const CANCELLED = 'cancelled'
const AUTH_KIND = 'authentication'
const SUMMARY_FIELD = 'summary.0'
const TEXT_FIELD = 'text'
const SESSION_MCP_CAPABILITY = 'sessionMcp'
const NO_UNSUBSCRIBE = (): undefined => undefined
// The bridge's own environment names (`teamHttpBridgeEntry.ts` reads them).
const BRIDGE_URL_ENV = 'MUSE_TEAM_BRIDGE_URL'
const BRIDGE_HEADERS_ENV = 'MUSE_TEAM_BRIDGE_HEADERS'

/** The sign-in sentence for this agent, in the installed language. */
function signInSentence(agent: ExternalAgent): string {
  return fill(UI_TEXT.teamExternalSignIn, {
    agent: agent.label,
    command: agent.signInCommand,
  })
}

/** The refusal for what this agent runs itself, in the installed language. */
function doesItselfSentence(agent: ExternalAgent): string {
  return fill(UI_TEXT.teamExternalDoesItself, { agent: agent.label })
}

/** The sentence for an agent process that is not running (D250). */
function stoppedSentence(agent: ExternalAgent): string {
  return fill(UI_TEXT.teamExternalStopped, { agent: agent.label })
}

/** ACP `ToolCallStatus` onto the conversation's item status words. */
function itemStatus(status: string | undefined, fallback = IN_PROGRESS): string {
  switch (status) {
    case 'completed': {
      return COMPLETED
    }
    case 'failed': {
      return FAILED
    }
    case 'pending':
    case 'in_progress': {
      return IN_PROGRESS
    }
    default: {
      return fallback
    }
  }
}

/** ACP plan entry status onto the panel's todo words (translate.ts in reverse). */
function todoStatus(status: string): string {
  return status === 'in_progress' ? 'inProgress' : status
}

function pressureFor(used: number, window: number): string {
  const fraction = window > 0 ? used / window : 0
  if (fraction >= CONTEXT_PRESSURE_HIGH) return 'high'
  return fraction >= CONTEXT_PRESSURE_MEDIUM ? 'medium' : 'low'
}

// Loose ACP v1 update shapes at this boundary (the SDK's own generated
// schemas, and our producer in `src/acp/translate.ts`): fields beyond what
// the panel renders ride along untouched.
const textBlock = z.looseObject({
  type: z.string(),
  text: z.optional(z.string()),
})
const chunkUpdate = z.looseObject({
  sessionUpdate: z.enum(['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk']),
  content: textBlock,
  messageId: z.optional(z.nullable(z.string())),
})
const toolContentItem = z.looseObject({
  type: z.string(),
  content: z.optional(textBlock),
  path: z.optional(z.nullable(z.string())),
})
const toolCallFields = {
  toolCallId: z.string(),
  title: z.optional(z.nullable(z.string())),
  kind: z.optional(z.nullable(z.string())),
  status: z.optional(z.nullable(z.string())),
  content: z.optional(z.array(toolContentItem)),
  locations: z.optional(
    z.array(z.looseObject({ path: z.string(), line: z.optional(z.nullable(z.number())) })),
  ),
  rawInput: z.optional(z.unknown()),
  rawOutput: z.optional(z.unknown()),
}
const toolCallUpdate = z.looseObject({
  sessionUpdate: z.enum(['tool_call', 'tool_call_update']),
  ...toolCallFields,
})
const planUpdate = z.looseObject({
  sessionUpdate: z.literal('plan'),
  entries: z.array(z.looseObject({ content: z.string(), status: z.string() })),
})
const usageUpdate = z.looseObject({
  sessionUpdate: z.literal('usage_update'),
  used: z.number(),
  size: z.number(),
})
const modeUpdate = z.looseObject({
  sessionUpdate: z.literal('current_mode_update'),
  currentModeId: z.string(),
})
const commandsUpdate = z.looseObject({
  sessionUpdate: z.literal('available_commands_update'),
  availableCommands: z.array(
    z.looseObject({
      name: z.string(),
      description: z.string(),
      input: z.optional(z.nullable(z.looseObject({ hint: z.optional(z.nullable(z.string())) }))),
    }),
  ),
})
const infoUpdate = z.looseObject({
  sessionUpdate: z.literal('session_info_update'),
  title: z.optional(z.nullable(z.string())),
})

type ToolCallWire = z.infer<typeof toolCallUpdate>

/** The text a tool call's content carries, for the item's visible output. */
function toolOutputText(wire: ToolCallWire): string | undefined {
  const parts: string[] = []
  const contents = wire.content ?? []
  for (const item of contents) {
    if (item.type === 'content' && item.content?.text !== undefined) parts.push(item.content.text)
    else if (item.type === 'diff' && item.path !== undefined && item.path !== null)
      parts.push(item.path)
  }
  if (typeof wire.rawOutput === 'string' && wire.rawOutput !== '') parts.push(wire.rawOutput)
  return parts.length === 0 ? undefined : parts.join('\n')
}

/** A tool call's raw input as the text the panel shows. */
function rawInputText(rawInput: unknown): string {
  return typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
}

/** An item snapshot for a tool call, from the wire's fields as they stand. */
function toolItemFrom(wire: ToolCallWire, previous?: ItemSnapshot): ItemSnapshot {
  const output = toolOutputText(wire)
  const args = wire.rawInput === undefined ? previous?.args : rawInputText(wire.rawInput)
  const visibleOutput = output ?? previous?.visibleOutput
  return {
    itemId: wire.toolCallId,
    kind: 'toolCall',
    status: itemStatus(wire.status ?? undefined, previous?.status ?? IN_PROGRESS),
    tool: wire.title ?? wire.kind ?? previous?.tool ?? 'tool',
    ...(args !== undefined && { args }),
    ...(visibleOutput !== undefined && { visibleOutput }),
    ...(wire.status === 'failed' && output !== undefined && { failureReason: output }),
  }
}

/** The turn's failure, in words: the agent's own sign-in, or what it said. */
function turnFailure(
  agent: ExternalAgent,
  error: unknown,
): { readonly kind: string; readonly message: string } {
  if (error instanceof AcpAuthRequiredError)
    return { kind: AUTH_KIND, message: signInSentence(agent) }
  return {
    kind: 'backend',
    message: error instanceof Error ? error.message : stoppedSentence(agent),
  }
}

/** How the host reaches back into a session (updates, permissions, death). */
interface SessionHooks {
  readonly connection: () => AcpAgentConnection
  readonly onDisposed: (session: ExternalOrchestratorSession) => void
}

interface PendingApproval {
  readonly itemId: string
  readonly options: readonly AcpPermissionOption[]
  readonly settle: (optionId: string | undefined) => void
}

/** One ACP session as a conversation: items, turns, approvals, settings. */
export class ExternalOrchestratorSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  private readonly items = new Map<string, ItemSnapshot>()
  private readonly order: string[] = []
  private readonly approvals = new Map<string, PendingApproval>()
  private commands: readonly SkillSummary[] = []
  private modes: readonly string[] = []
  private currentMode: string | undefined
  private openChunk:
    { readonly id: string; readonly kind: 'agentMessage' | 'reasoning' } | undefined
  private runningTurn: string | undefined
  private title: string | undefined
  private isDisposed = false
  private isLoading = false
  public modelId: string

  public readonly servesReasoningEffort = (effort: string): boolean => {
    const selector = this.selectorFor(['effort', 'thought_level', 'reasoning_effort'])
    return selector?.values.includes(effort) === true
  }

  public constructor(
    public readonly sessionId: string,
    public readonly cwd: string,
    private readonly deps: ExternalOrchestratorDeps,
    private readonly hooks: SessionHooks,
    modelId: string,
  ) {
    this.modelId = modelId
  }

  private emit(event: AgentEvent): void {
    if (this.isLoading) return
    for (const listener of this.listeners) listener(event)
  }

  private record(item: ItemSnapshot): void {
    if (!this.items.has(item.itemId)) this.order.push(item.itemId)
    this.items.set(item.itemId, item)
  }

  private openItem(item: ItemSnapshot): void {
    this.record(item)
    this.emit({ type: 'itemStarted', item })
  }

  private closeItem(item: ItemSnapshot): void {
    this.record(item)
    this.emit({ type: 'itemCompleted', item })
    if (this.openChunk?.id === item.itemId) this.openChunk = undefined
  }

  /** One raw `session/update` from the agent, translated for the panel. */
  private onChunk(chunk: z.infer<typeof chunkUpdate>): void {
    const text = chunk.content.text ?? ''
    if (chunk.sessionUpdate === 'user_message_chunk') {
      // Only a session/load replay sends these; they rebuild history.
      if (!this.isLoading) return
      const id = chunk.messageId ?? this.openChunk?.id ?? this.deps.newId()
      this.appendChunk(id, 'userMessage', text)
      return
    }
    const kind = chunk.sessionUpdate === 'agent_thought_chunk' ? 'reasoning' : 'agentMessage'
    const id =
      chunk.messageId ?? (this.openChunk?.kind === kind ? this.openChunk.id : this.deps.newId())
    this.appendChunk(id, kind, text)
  }

  private appendChunk(id: string, kind: ItemSnapshot['kind'], text: string): void {
    const existing = this.items.get(id)
    if (existing === undefined) {
      const item: ItemSnapshot =
        kind === 'reasoning'
          ? { itemId: id, kind, status: IN_PROGRESS, summary: [text] }
          : { itemId: id, kind, status: IN_PROGRESS, text }
      this.openItem(item)
    } else if (kind === 'reasoning') {
      const summary = [...(existing.summary ?? [])]
      summary[0] = (summary[0] ?? '') + text
      this.record({ ...existing, summary })
      this.emit({ type: 'textDelta', itemId: id, field: SUMMARY_FIELD, delta: text })
    } else {
      this.record({ ...existing, text: (existing.text ?? '') + text })
      this.emit({ type: 'textDelta', itemId: id, field: TEXT_FIELD, delta: text })
    }
    if (kind === 'agentMessage' || kind === 'reasoning') this.openChunk = { id, kind }
  }

  private onToolCall(wire: ToolCallWire): void {
    const previous = this.items.get(wire.toolCallId)
    const item = toolItemFrom(wire, previous)
    if (item.status === COMPLETED || item.status === FAILED) {
      this.closeItem(item)
      return
    }
    if (previous === undefined) this.openItem(item)
    else {
      this.record(item)
      this.emit({ type: 'itemUpdated', item })
    }
  }

  /** Every open permission card ends as dismissed; the agent reads `cancelled`. */
  private settleApprovalsCancelled(): void {
    for (const [approvalId, pending] of this.approvals) {
      this.emit({
        type: 'approvalResolved',
        approvalId,
        itemId: pending.itemId,
        decision: 'abort',
        resolvedBy: 'user',
      })
      pending.settle(undefined)
    }
    this.approvals.clear()
  }

  /** Prompt blocks from a turn's parts; throws on a part ACP cannot carry. */
  private blocksFor(parts: readonly TurnPart[]): unknown[] {
    return parts.map((part) => this.blockFor(part))
  }

  private blockFor(part: TurnPart): unknown {
    switch (part.type) {
      case 'text': {
        return { type: 'text', text: part.text }
      }
      case 'skill': {
        return {
          type: 'text',
          text: `/${part.selector}${part.arguments === undefined || part.arguments === '' ? '' : ` ${part.arguments}`}`,
        }
      }
      case 'image': {
        return { type: 'image', data: part.base64Data, mimeType: part.mediaType }
      }
      case 'textFile': {
        return {
          type: 'resource',
          resource: { uri: part.name, mimeType: part.mediaType, text: part.text },
        }
      }
      case 'file': {
        return {
          type: 'resource',
          resource: { uri: part.name, mimeType: part.mediaType, blob: part.base64Data },
        }
      }
      case 'media': {
        throw new Error(UI_TEXT.teamExternalMediaUnsupported)
      }
    }
  }

  private async runPrompt(turnId: string, blocks: readonly unknown[]): Promise<void> {
    try {
      const { stopReason } = await this.promptWithAuth(blocks)
      this.finishTurn(turnId, stopReason === 'cancelled' ? CANCELLED : COMPLETED)
    } catch (error: unknown) {
      this.deps.log.warn(`external prompt failed: ${failureForLog(error)}`)
      this.finishTurn(turnId, FAILED, turnFailure(this.deps.agent, error))
    }
  }

  /**
  One prompt, with the agent's own `authenticate` passed through once when
  it answers not-signed-in with an agent-kind method (D250); a terminal
  method is never run by us — the sign-in sentence names its CLI instead.
  */
  private async promptWithAuth(
    blocks: readonly unknown[],
  ): Promise<{ readonly stopReason: string }> {
    const connection = this.hooks.connection()
    try {
      return await connection.promptBlocks(this.sessionId, blocks)
    } catch (error: unknown) {
      if (!(error instanceof AcpAuthRequiredError)) throw error
      const agentMethod = error.methods.find((method) => !('type' in method))
      if (agentMethod === undefined) throw error
      await connection.authenticate(agentMethod.id)
      return await connection.promptBlocks(this.sessionId, blocks)
    }
  }

  private finishTurn(
    turnId: string,
    terminal: string,
    error?: { readonly kind: string; readonly message: string },
  ): void {
    if (this.runningTurn === turnId) this.runningTurn = undefined
    for (const id of this.order) {
      const item = this.items.get(id)
      if (item?.status === IN_PROGRESS)
        this.closeItem({ ...item, status: terminal === FAILED ? FAILED : COMPLETED })
    }
    this.openChunk = undefined
    this.emit({
      type: 'turnCompleted',
      turnId,
      terminal,
      ...(error !== undefined && {
        reason: error.message,
        errorKind: error.kind,
        retryable: false,
      }),
    })
  }

  private selectors(): readonly AcpConfigSelector[] {
    return this.hooks.connection().configSelectors(this.sessionId)
  }

  private selectorFor(categories: readonly string[]): AcpConfigSelector | undefined {
    return this.selectors().find(
      (selector) => selector.category !== undefined && categories.includes(selector.category),
    )
  }

  /**
  The MSP approval mode an agent mode id shows as, from the preset's
  captured mode table (identity for ids that are MSP modes themselves, as
  our own agent's are). Undefined: no honest label exists for it.
  */
  private mspModeFor(agentMode: string): string | undefined {
    return mspModeForAgent(this.deps.agent, agentMode)
  }

  /** The agent mode id an MSP approval mode selects, where the table knows one. */
  private agentModeFor(mspMode: string): string | undefined {
    return agentModeForMsp(this.deps.agent, mspMode, this.modes)
  }

  /** The running mode in MSP words for a kept-mode refusal ('' when unknown). */
  private actualMode(): string {
    return this.currentMode === undefined ? '' : (this.mspModeFor(this.currentMode) ?? '')
  }

  public get isRunning(): boolean {
    return this.runningTurn !== undefined
  }

  public get sessionTitle(): string | undefined {
    return this.title
  }

  /** The agent's advertised session modes, for the host's mode mapping. */
  public noteModes(advertised: readonly string[], current: string | undefined): void {
    this.modes = advertised
    this.currentMode = current
  }

  /** Session/load replay collects history instead of streaming it live. */
  public setLoading(isLoading: boolean): void {
    this.isLoading = isLoading
  }

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    // A (re)attach replays what this session already holds, as the other
    // hosts' attach replays their items; live events follow.
    for (const id of this.order) {
      const item = this.items.get(id)
      if (item !== undefined) listener({ type: 'itemCompleted', item })
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  public onSessionUpdate(update: unknown): void {
    const chunk = chunkUpdate.safeParse(update)
    if (chunk.success) {
      this.onChunk(chunk.data)
      return
    }
    const tool = toolCallUpdate.safeParse(update)
    if (tool.success) {
      this.onToolCall(tool.data)
      return
    }
    const plan = planUpdate.safeParse(update)
    if (plan.success) {
      this.emit({
        type: 'todoChanged',
        items: plan.data.entries.map((entry) => ({
          text: entry.content,
          status: todoStatus(entry.status),
        })),
      })
      return
    }
    const usage = usageUpdate.safeParse(update)
    if (usage.success) {
      this.emit({
        type: 'contextUsage',
        usedTokens: usage.data.used,
        windowTokens: usage.data.size,
        pressure: pressureFor(usage.data.used, usage.data.size),
      })
      return
    }
    const mode = modeUpdate.safeParse(update)
    if (mode.success) {
      this.currentMode = mode.data.currentModeId
      const mapped = this.mspModeFor(mode.data.currentModeId)
      if (mapped !== undefined) this.emit({ type: 'approvalModeChanged', mode: mapped })
      return
    }
    const commands = commandsUpdate.safeParse(update)
    if (commands.success) {
      this.commands = commands.data.availableCommands.map((command) => ({
        selector: command.name,
        displayName: command.name,
        description: command.description,
        argumentHint: command.input?.hint ?? undefined,
      }))
      this.emit({ type: 'skillsChanged' })
      return
    }
    const info = infoUpdate.safeParse(update)
    if (!info.success || info.data.title === undefined || info.data.title === null) {
      return
    }

    this.title = info.data.title
    this.emit({ type: 'sessionNamed', name: info.data.title })
  }

  /**
  The agent asked permission: the person's card answers, never a policy of
  ours (D250). Resolves with the chosen ACP option, or undefined (the wire's
  `cancelled`) when the person dismissed it or the session ended first.
  */
  public requestPermission(
    toolCall: {
      toolCallId: string
      title?: string
      kind?: string
      rawInput?: unknown
      locations?: readonly { path: string }[]
    },
    options: readonly AcpPermissionOption[],
  ): Promise<{ readonly optionId: string } | undefined> {
    if (this.isDisposed) return Promise.resolve(undefined)
    if (!this.items.has(toolCall.toolCallId)) {
      this.openItem(
        toolItemFrom({
          sessionUpdate: 'tool_call',
          toolCallId: toolCall.toolCallId,
          title: toolCall.title,
          kind: toolCall.kind,
          rawInput: toolCall.rawInput,
        }),
      )
    }
    const approvalId = this.deps.newId()
    return new Promise((resolve) => {
      this.approvals.set(approvalId, {
        itemId: toolCall.toolCallId,
        options,
        settle: (optionId) => {
          resolve(optionId === undefined ? undefined : { optionId })
        },
      })
      this.emit({
        type: 'approvalRequested',
        approvalId,
        itemId: toolCall.toolCallId,
        toolName: toolCall.title ?? toolCall.kind ?? 'tool',
        rawArgs: toolCall.rawInput === undefined ? '' : rawInputText(toolCall.rawInput),
        requirementId: { approvalId, sourceIndex: 0 },
        subject: {
          kind: toolCall.kind ?? 'tool',
          toolName: toolCall.title ?? toolCall.kind ?? 'tool',
          ...(toolCall.locations?.[0] !== undefined && { path: toolCall.locations[0].path }),
        },
        availableChoices: options.map((option) => ({
          choiceId: option.optionId,
          label: option.name ?? option.kind,
          decision: option.kind.startsWith('allow') ? 'allow' : 'deny',
          scope: option.kind.endsWith('always') ? 'always' : 'once',
        })),
        isJudgeEscalated: false,
        isProtectedWrite: (toolCall.locations ?? []).some((location) =>
          isProtectedPath(location.path),
        ),
        ...(this.runningTurn !== undefined && { turnId: this.runningTurn }),
      })
    })
  }

  public decideApproval(decision: ApprovalDecision): Promise<void> {
    const pending = this.approvals.get(decision.approvalId)
    if (pending === undefined) return Promise.resolve()
    this.approvals.delete(decision.approvalId)
    const chosen = pending.options.find((option) => option.optionId === decision.choiceId)
    this.emit({
      type: 'approvalResolved',
      approvalId: decision.approvalId,
      itemId: pending.itemId,
      decision: chosen?.kind.startsWith('allow') === true ? 'approved' : 'abort',
      resolvedBy: 'user',
    })
    pending.settle(chosen?.optionId)
    return Promise.resolve()
  }

  public sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    if (this.isDisposed) throw new Error(stoppedSentence(this.deps.agent))
    const blocks = this.blocksFor(parts)
    const turnId = this.deps.newId()
    const userMessageId = this.deps.newId()
    const shown =
      displayText ??
      parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('')
    this.runningTurn = turnId
    this.emit({ type: 'turnStarted', turnId })
    const userItem: ItemSnapshot = {
      itemId: userMessageId,
      kind: 'userMessage',
      status: COMPLETED,
      text: shown,
    }
    this.record(userItem)
    this.emit({ type: 'itemCompleted', item: userItem })
    void this.runPrompt(turnId, blocks)
    return Promise.resolve({ turnId, disposition: 'started', userMessageId })
  }

  public async cancel(): Promise<void> {
    this.settleApprovalsCancelled()
    await this.hooks.connection().cancel(this.sessionId)
  }

  public steer(): Promise<never> {
    // ACP has no steer: nothing is taken, so the caller sends a new turn.
    throw new SteerRefusedError(doesItselfSentence(this.deps.agent))
  }

  public setModelCallAllowance(): void {
    // The agent manages its own turn bounds (D250); nothing to bind.
  }

  /** The model the agent says this session runs, where it advertises one. */
  public advertisedModel(): string | undefined {
    return this.selectorFor(['model'])?.currentValue
  }

  public async setModel(modelId: string): Promise<void> {
    const selector = this.selectorFor(['model'])
    if (selector?.currentValue === modelId) {
      this.modelId = modelId
      return
    }
    const confirmed = await this.hooks.connection().setModel(this.sessionId, modelId)
    this.modelId = confirmed
    this.emit({ type: 'modelChanged', modelId: confirmed })
  }

  /**
  A default effort is sent only where the agent serves that tier under
  that name; otherwise the session keeps the agent's own (D250).
  */
  public async setReasoningEffort(effort: string): Promise<void> {
    const selector = this.selectorFor(['effort', 'thought_level', 'reasoning_effort'])
    if (!selector?.values.includes(effort))
      throw new Error(
        fill(UI_TEXT.teamExternalEffortRefused, { agent: this.deps.agent.label, effort }),
      )
    await this.hooks.connection().setConfigValue(this.sessionId, selector.id, effort)
    this.emit({ type: 'effortChanged', effort })
  }

  /**
  Selects the agent mode this MSP approval mode maps to; a mode with no
  counterpart keeps the agent's own and says so (`ModeKeptError`).
  */
  public async setApprovalMode(mode: string): Promise<void> {
    const target = this.agentModeFor(mode)
    if (target === undefined)
      throw new ModeKeptError(
        fill(UI_TEXT.teamExternalModeKept, { agent: this.deps.agent.label }),
        this.actualMode(),
      )
    if (target === this.currentMode) return
    const connection = this.hooks.connection()
    try {
      await connection.setConfigOption(this.sessionId, target)
    } catch (error: unknown) {
      if (!(error instanceof AcpMethodNotFoundError)) throw error
      await connection.setMode(this.sessionId, target)
    }
    this.currentMode = target
    this.emit({ type: 'approvalModeChanged', mode })
  }

  /**
  Best-effort mode at session start: the agent keeps its own mode when the
  panel's mode has no counterpart in its table (D250), and the pill then
  follows the mode it actually runs where that mode has MSP words.
  */
  public async applyStartMode(mode: string | undefined): Promise<void> {
    if (mode === undefined) return
    try {
      await this.setApprovalMode(mode)
    } catch (error: unknown) {
      if (!(error instanceof ModeKeptError)) throw error
      const shown = this.actualMode()
      if (shown !== '') this.emit({ type: 'approvalModeChanged', mode: shown })
    }
  }

  public listSkills(): Promise<readonly SkillSummary[]> {
    return Promise.resolve(this.commands)
  }

  public refreshSkills(): Promise<readonly SkillSummary[]> {
    return Promise.resolve(this.commands)
  }

  public answerQuestions(): Promise<void> {
    // This session never asks through the panel's question surface (the
    // agent's questions are its own text); an unknown id resolves quietly,
    // as the contract states.
    return Promise.resolve()
  }

  public cancelQuestions(): Promise<void> {
    return Promise.resolve()
  }

  public deferQuestions(): Promise<void> {
    return Promise.resolve()
  }

  public clarifyQuestions(): Promise<void> {
    return Promise.resolve()
  }

  public moveToBackground(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public stopTask(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public stopAllTasks(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public runUserShell(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public controlSubagent(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public messageSubagent(): Promise<void> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public controlGoal(): Promise<never> {
    throw new GoalRefusedError('noGoal', doesItselfSentence(this.deps.agent))
  }

  public compact(): Promise<{ status: string; reason: string | undefined }> {
    return Promise.resolve({
      status: 'unsupported',
      reason: doesItselfSentence(this.deps.agent),
    })
  }

  public rename(): Promise<undefined> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public readOutput(): Promise<never> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  /** The items this session holds, in order (host read/fork source). */
  public readItems(): readonly ItemSnapshot[] {
    const items: ItemSnapshot[] = []
    for (const id of this.order) {
      const item = this.items.get(id)
      if (item !== undefined) items.push({ ...item, status: COMPLETED })
    }
    return items
  }

  /** The process died under this session: fail the open turn honestly. */
  public onProcessEnded(): void {
    this.settleApprovalsCancelled()
    if (this.runningTurn === undefined) return
    const turnId = this.runningTurn
    this.runningTurn = undefined
    this.finishTurn(turnId, FAILED, {
      kind: 'backend',
      message: stoppedSentence(this.deps.agent),
    })
  }

  public dispose(): void {
    if (this.isDisposed) return
    this.isDisposed = true
    this.settleApprovalsCancelled()
    if (this.runningTurn !== undefined) {
      // Disposal never waits on the agent; cancel rides out on its own and
      // a dead agent's refusal is the same end state.
      void this.hooks.connection().cancel(this.sessionId).catch(NO_UNSUBSCRIBE)
    }
    this.listeners.clear()
    this.hooks.onDisposed(this)
  }
}

// ---------------------------------------------------------------------------
// Permission-mode translation. The panel speaks MSP approval modes; an ACP
// agent advertises its own mode ids. Only the presets' captured tables
// (lane W) plus identity (our own agent advertises MSP words) translate —
// anything else keeps the agent's mode and says so through `ModeKeptError`,
// never a guess at another vendor's semantics.
// ---------------------------------------------------------------------------

const MSP_MODES: ReadonlySet<string> = new Set([
  'promptUnmatched',
  'denyUnmatched',
  'onRequest',
  'allowAll',
])

/** MSP mode → the agent mode id it selects (preset tables only). */
const PRESET_MSP_TO_AGENT: Readonly<Record<string, Readonly<Partial<Record<string, string>>>>> = {
  claude: {
    denyUnmatched: 'plan',
    promptUnmatched: 'default',
    onRequest: 'auto',
    allowAll: 'bypassPermissions',
  },
  codex: {
    denyUnmatched: 'read-only',
    promptUnmatched: 'workspace-write',
  },
}

function agentModeForMsp(
  agent: ExternalAgent,
  mspMode: string,
  advertised: readonly string[],
): string | undefined {
  if (advertised.includes(mspMode)) return mspMode
  const table = agent.preset === undefined ? undefined : PRESET_MSP_TO_AGENT[agent.preset]
  const mapped = table?.[mspMode]
  return mapped !== undefined && advertised.includes(mapped) ? mapped : undefined
}

function mspModeForAgent(agent: ExternalAgent, agentMode: string): string | undefined {
  if (MSP_MODES.has(agentMode)) return agentMode
  const table = agent.preset === undefined ? undefined : PRESET_MSP_TO_AGENT[agent.preset]
  return table === undefined
    ? undefined
    : Object.entries(table).find(([, id]) => id === agentMode)?.[0]
}

// ---------------------------------------------------------------------------
// The host: one agent process, spawned lazily, shared by its sessions.
// ---------------------------------------------------------------------------

interface LiveProcess {
  readonly child: ChildProcess
  readonly connection: AcpAgentConnection
  readonly mcpHttp: boolean
  readonly loadSession: boolean
  readonly authMethods: readonly AuthMethod[]
}

export class ExternalOrchestratorHost implements AgentHost {
  private readonly sessions = new Map<string, ExternalOrchestratorSession>()
  private readonly exitListeners = new Set<(exit: HostExit) => void>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  private live: LiveProcess | undefined
  private starting: Promise<LiveProcess> | undefined
  private isExpectedClose = false
  public readonly info: HostInfo

  public constructor(private readonly deps: ExternalOrchestratorDeps) {
    this.info = {
      kind: 'external',
      serverName: deps.agent.label,
      serverVersion: '',
      grantedCapabilities: [SESSION_MCP_CAPABILITY],
      canEditSessions: false,
    }
  }

  private async ensureProcess(cwd: string): Promise<LiveProcess> {
    if (this.live !== undefined) return this.live
    if (this.starting !== undefined) return await this.starting
    const starting = this.startProcess(cwd)
    this.starting = starting
    try {
      this.live = await starting
      return this.live
    } finally {
      if (this.starting === starting) this.starting = undefined
    }
  }

  private async startProcess(cwd: string): Promise<LiveProcess> {
    const { agent, command, platform, baseEnv } = this.deps
    const child = spawn(command, [...agent.args], {
      cwd,
      env: withoutCredentials({ ...baseEnv }),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: platform !== 'win32',
      windowsHide: true,
    })
    child.stderr.setEncoding('utf8')
    let isHeardStderr = false
    child.stderr.on('data', () => {
      if (isHeardStderr) return
      isHeardStderr = true
      // The agent's own words never reach the log (they can name an account).
      this.deps.log.warn('The external orchestrator wrote to stderr')
    })
    child.stdin.on('error', () => {
      // The connection's write path reports the same pipe failure.
    })
    const exited = new Promise<HostExit>((resolveExit) => {
      child.once('exit', (code, signal) => {
        resolveExit({
          description: signal === null ? `exit code ${String(code ?? 0)}` : `signal ${signal}`,
          isExpected: this.isExpectedClose,
          isPersistent: false,
          isFailure: !this.isExpectedClose && (signal !== null || (code ?? 0) !== 0),
        })
      })
      child.once('error', () => {
        resolveExit({
          description: 'spawn error',
          isExpected: this.isExpectedClose,
          isPersistent: false,
          isFailure: !this.isExpectedClose,
        })
      })
    })
    const handlers: AcpClientHandlers = {
      onPermissionRequest: async (toolCall, options) => {
        const session = this.sessionForToolCall()
        if (session === undefined) return
        return await session.requestPermission(
          {
            toolCallId: toolCall.toolCallId,
            title: toolCall.title,
            ...(toolCall.kind !== undefined && toolCall.kind !== null && { kind: toolCall.kind }),
            ...(toolCall.rawInput !== undefined && { rawInput: toolCall.rawInput }),
            ...(toolCall.locations !== undefined && { locations: toolCall.locations }),
          },
          options,
        )
      },
      onFsRead: async (path, grant) => await this.serveFsRead(path, grant.absolute),
      onFsWrite: async (path, content, grant) =>
        await this.serveFsWrite(path, content, grant.absolute),
      onUpdate: () => {
        // The worker text lane: this host streams raw updates instead.
      },
      onSessionUpdate: (sessionId, update) => {
        this.sessions.get(sessionId)?.onSessionUpdate(update)
      },
    }
    const connection = connectAcpAgent({
      stdin: child.stdin,
      stdout: child.stdout,
      handlers,
      log: this.deps.log,
      supportsTerminalAuth: false,
      disposeProcess: () => {
        // The host owns the child's end (close/exit below); the connection
        // must not kill it from under a session that outlives one turn.
      },
    })
    void exited.then((exit) => {
      if (this.live?.child !== child) return
      this.live = undefined
      for (const session of this.sessions.values()) session.onProcessEnded()
      for (const listener of this.exitListeners) listener(exit)
    })
    const initialized = await connection.initialize()
    return {
      child,
      connection,
      mcpHttp: initialized.agent.mcpHttp,
      loadSession: initialized.agent.loadSession,
      authMethods: initialized.authMethods,
    }
  }

  /**
  The session a permission request belongs to. The wire handler carries no
  session id (lane W's seam answers by grant); this host runs one lead
  conversation, so its live session is the asker — with several sessions
  (a fork), the running one is.
  */
  private sessionForToolCall(): ExternalOrchestratorSession | undefined {
    for (const session of this.sessions.values()) if (session.isRunning) return session
    return this.sessions.values().next().value
  }

  private connection(): AcpAgentConnection {
    if (this.live === undefined) throw new Error(stoppedSentence(this.deps.agent))
    return this.live.connection
  }

  /** `fs/read_text_file`, confined to the workspace the session leads in. */
  private async serveFsRead(
    given: string,
    root: string,
  ): Promise<{ readonly content: string } | { readonly error: string }> {
    const confined = await this.confine(given, root)
    if (confined === undefined) return { error: 'outside the workspace' }
    try {
      return { content: await readFile(confined, 'utf8') }
    } catch (error: unknown) {
      this.deps.log.warn(`external fs read failed: ${failureForLog(error)}`)
      return { error: 'unreadable' }
    }
  }

  /** `fs/write_text_file`: confined, and a protected path is refused. */
  private async serveFsWrite(
    given: string,
    content: string,
    root: string,
  ): Promise<{ readonly ok: true } | { readonly error: string }> {
    const confined = await this.confine(given, root)
    if (confined === undefined) return { error: 'outside the workspace' }
    if (isProtectedPath(confined)) return { error: 'protected path' }
    try {
      await writeFile(confined, content, 'utf8')
      return { ok: true }
    } catch (error: unknown) {
      this.deps.log.warn(`external fs write failed: ${failureForLog(error)}`)
      return { error: 'unwritable' }
    }
  }

  /** The real path under `root`, or undefined when it escapes (links followed). */
  private async confine(given: string, root: string): Promise<string | undefined> {
    const realRoot = await realpath(root)
    const absolute = path.isAbsolute(given) ? given : path.resolve(realRoot, given)
    let real = absolute
    try {
      real = await realpath(absolute)
    } catch (error: unknown) {
      // A path that does not exist yet has no real path: confine lexically.
      // Any other failure keeps its kind for the caller.
      if (!isMissingPath(error)) throw error
    }
    const rel = path.relative(realRoot, real)
    const isEscapes = rel.startsWith(`..${path.sep}`) || rel === '..' || path.isAbsolute(rel)
    return isEscapes ? undefined : real
  }

  /**
  The session's MCP servers as ACP `McpServer`s (D250): HTTP straight to
  the endpoint where the agent advertises it, else the shipped stdio
  bridge forwarding to the very same endpoint — never a second tool set.
  */
  private acpMcpServers(
    live: LiveProcess,
    servers: Readonly<Record<string, SessionMcpServer>> | undefined,
  ): McpServer[] {
    if (servers === undefined) return []
    return Object.entries(servers).map(([name, server]) => {
      if ('command' in server) {
        return {
          name,
          command: server.command,
          args: [...server.args],
          env: Object.entries(server.env).map(([key, value]) => ({ name: key, value })),
        }
      }
      if (live.mcpHttp) {
        return {
          name,
          type: 'http' as const,
          url: server.url,
          headers: Object.entries(server.headers).map(([key, value]) => ({
            name: key,
            value,
          })),
        }
      }
      return {
        name,
        command: this.deps.bridge.command,
        args: [...this.deps.bridge.args],
        env: [
          ...(this.deps.bridge.env ?? []),
          { name: BRIDGE_URL_ENV, value: server.url },
          { name: BRIDGE_HEADERS_ENV, value: JSON.stringify(server.headers) },
        ],
      }
    })
  }

  private async grantFor(cwd: string) {
    return await assertWorkerRoot({
      workspaceRoot: cwd,
      folder: cwd,
      platform: this.deps.platform,
      io: WORKER_NATIVE_IO,
      isInPlace: true,
    })
  }

  private track(session: ExternalOrchestratorSession): ExternalOrchestratorSession {
    this.sessions.set(session.sessionId, session)
    return session
  }

  private makeSession(sessionId: string, cwd: string, modelId: string) {
    return new ExternalOrchestratorSession(
      sessionId,
      cwd,
      this.deps,
      {
        connection: () => this.connection(),
        onDisposed: (ended) => {
          if (this.sessions.get(ended.sessionId) !== ended) {
            return
          }

          this.sessions.delete(ended.sessionId)
          for (const listener of this.listListeners)
            listener({ type: 'closed', sessionId: ended.sessionId, reason: 'disposed' })
        },
      },
      modelId,
    )
  }

  private recordOf(session: ExternalOrchestratorSession): SessionRecord {
    const stamp = new Date(this.deps.now()).toISOString()
    return {
      sessionId: session.sessionId,
      ...(session.sessionTitle !== undefined && { title: session.sessionTitle }),
      createdAt: stamp,
      updatedAt: stamp,
      status: session.isRunning ? 'running' : 'idle',
      turnCount: 0,
      workspaceRoot: session.cwd,
    }
  }

  private historyOf(session: ExternalOrchestratorSession): SessionHistoryOutcome {
    return {
      mode: 'inline',
      items: session.readItems(),
      name: session.sessionTitle,
      todos: [],
      goal: null,
    }
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public onExit(listener: (exit: HostExit) => void): () => void {
    this.exitListeners.add(listener)
    return () => {
      this.exitListeners.delete(listener)
    }
  }

  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  public async startSession(options: StartSessionOptions): Promise<AgentSession> {
    const cwd = options.workspaceRoot
    const live = await this.ensureProcess(cwd)
    const grant = await this.grantFor(cwd)
    const mcpServers = this.acpMcpServers(live, options.mcpServers)
    let started: Awaited<ReturnType<AcpAgentConnection['sessionNew']>>
    try {
      started = await live.connection.sessionNew({ cwd, mcpServers, grant })
    } catch (error: unknown) {
      if (error instanceof AcpAuthRequiredError)
        throw new Error(signInSentence(this.deps.agent), { cause: error })
      throw error
    }
    const session = this.makeSession(started.sessionId, cwd, this.deps.agent.model)
    this.track(session)
    session.noteModes(started.advertisedModes, started.currentMode)
    // The stored pick's model: the agent's own default (marker), or a model
    // the person named, which the agent must confirm or nothing starts.
    const wanted = options.modelId
    if (!isExternalDefaultModel(this.deps.agent) && wanted !== this.deps.agent.agentId) {
      try {
        await session.setModel(wanted)
      } catch (error: unknown) {
        session.dispose()
        throw new Error(
          fill(UI_TEXT.teamExternalModelRefused, {
            agent: this.deps.agent.label,
            model: wanted,
          }),
          { cause: error },
        )
      }
    } else {
      const actual = session.advertisedModel()
      if (actual !== undefined) session.modelId = actual
    }
    await session.applyStartMode(options.approvalMode)
    return session
  }

  public async resumeSession(
    sessionId: string,
    modelId: string,
    mcpServers?: Readonly<Record<string, SessionMcpServer>>,
  ): Promise<LoadedSession> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) throw new SessionNotFoundError(sessionId)
    if (this.live !== undefined)
      return {
        session,
        record: this.recordOf(session),
        history: this.historyOf(session),
        activeTurnId: undefined,
      }
    const live = await this.ensureProcess(session.cwd)
    if (!live.loadSession) throw new SessionNotFoundError(sessionId)
    const grant = await this.grantFor(session.cwd)
    session.setLoading(true)
    try {
      const loaded = await live.connection.sessionLoad({
        sessionId,
        cwd: session.cwd,
        mcpServers: this.acpMcpServers(live, mcpServers),
        grant,
      })
      session.noteModes(loaded.advertisedModes, loaded.currentMode)
    } catch (error: unknown) {
      if (error instanceof AcpMethodNotFoundError) throw new SessionNotFoundError(sessionId)
      if (error instanceof AcpAuthRequiredError)
        throw new Error(signInSentence(this.deps.agent), { cause: error })
      throw error
    } finally {
      session.setLoading(false)
    }
    const actual = session.advertisedModel()
    if (actual !== undefined && actual !== modelId && !isExternalDefaultModel(this.deps.agent))
      await session.setModel(modelId)
    else if (actual !== undefined) session.modelId = actual
    return {
      session,
      record: this.recordOf(session),
      history: this.historyOf(session),
      activeTurnId: undefined,
    }
  }

  public listModels(sessionId?: string): Promise<readonly ModelSummary[]> {
    const agent = this.deps.agent
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId)
    if (session !== undefined && this.live !== undefined) {
      const selector = this.connection()
        .configSelectors(session.sessionId)
        .find((row) => row.category === 'model')
      if (selector !== undefined) {
        return Promise.resolve(
          selector.values.map((modelId, index) => ({
            modelId,
            displayLabel: modelId,
            contextLimit: undefined,
            isDefault: index === 0,
            isActive: modelId === selector.currentValue,
          })),
        )
      }
      return Promise.resolve([
        {
          modelId: session.modelId,
          displayLabel: session.modelId,
          contextLimit: undefined,
          isDefault: true,
          isActive: true,
        },
      ])
    }
    return Promise.resolve([
      {
        modelId: agent.model,
        displayLabel: agent.label,
        contextLimit: undefined,
        isDefault: true,
        isActive: true,
      },
    ])
  }

  public listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const records: SessionRecord[] = []
    for (const session of this.sessions.values()) {
      if (session.cwd === options.workspaceRoot) records.push(this.recordOf(session))
    }
    return Promise.resolve({ sessions: records.slice(0, options.limit), nextCursor: undefined })
  }

  public readSession(sessionId: string): Promise<SessionHistoryOutcome> {
    const session = this.sessions.get(sessionId)
    if (session === undefined) throw new SessionNotFoundError(sessionId)
    return Promise.resolve(this.historyOf(session))
  }

  public readSessionOutput(): Promise<OutputPage> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public forkSession(): Promise<LoadedSession> {
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public deleteSession(sessionId: string): Promise<void> {
    if (!this.sessions.has(sessionId)) throw new SessionNotFoundError(sessionId)
    // The agent owns its stored sessions; ending ours deletes nothing of
    // its, so refuse rather than pretend (canDeleteSessions stays unset).
    throw new Error(doesItselfSentence(this.deps.agent))
  }

  public onUsageChanged(): () => void {
    return NO_UNSUBSCRIBE
  }

  public readUsage(): Promise<SubscriptionUsage | undefined> {
    return Promise.resolve(undefined)
  }

  public close(): Promise<void> {
    this.isExpectedClose = true
    const live = this.live
    this.live = undefined
    for (const session of this.sessions.values()) session.dispose()
    if (live === undefined) return Promise.resolve()
    live.connection.close()
    const { child } = live
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    if (this.deps.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGTERM')
        return Promise.resolve()
      } catch (error: unknown) {
        if (!isMissingPath(error)) throw error
      }
    }
    child.kill()
    return Promise.resolve()
  }
}

/** A Node `ENOENT`/`ESRCH` (a path or process already gone). */
function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ESRCH')
  )
}
