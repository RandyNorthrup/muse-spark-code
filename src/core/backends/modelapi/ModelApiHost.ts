// The Model API backend (PLAN.md D1, M7): sessions held in this process,
// each a replayed conversation on `POST /v1/responses` (stateless reasoning
// replay, `store: false`) with the in-process tool harness, the permission
// engine and the approval / question cards of the transcript. Emits the
// same AgentEvents as the Muse Code host, so nothing above it changes.
// Sessions live for the host's lifetime (this VS Code window).

import { Buffer } from 'node:buffer'
import type {
  AgentEvent,
  ApprovalSubject,
  ItemSnapshot,
  QuestionAnswer,
  TodoItem,
} from '../../../shared/agentEvents'
import {
  AUTH_REQUIRED_ERROR_KIND,
  CONTEXT_PRESSURE_HIGH,
  CONTEXT_PRESSURE_MEDIUM,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  HTTP_UNAUTHORIZED,
  MODEL_API_CONTEXT_WINDOW,
  MODEL_API_EFFORT_OFF,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_OUTPUT_ENCODING,
  MODEL_API_OUTPUT_MEDIA_TYPE,
  MODEL_API_SERVER_NAME,
  MODEL_API_TOOLS,
  MODEL_API_VERSION,
  OUTPUT_REF_PREFIX,
  THINKING_OFF_EFFORT,
  UI_TEXT,
} from '../../../shared/constants'
import { APPROVAL_MODES, type ApprovalMode } from '../../../shared/permissionModes'
import type { SubscriptionUsage } from '../../../shared/usage'
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
  SessionPage,
  SessionRecord,
  SkillSummary,
  StartSessionOptions,
  TurnPart,
  TurnSubmission,
} from '../../agent/agentBackend'
import type { CoreLogger } from '../../logging'
import { MissingApiKeyError, type ModelApiClient, ModelApiError } from './client'
import { instructionsFor } from './instructions'
import { APPROVAL_CHOICE_IDS, choicesFor, PermissionEngine } from './permissions'
import {
  type CreateResponseBody,
  type FunctionCallItem,
  type InputContentPart,
  type InputItem,
  isFunctionCallItem,
  isMessageItem,
  isReasoningItem,
  messageText,
  type OutputItem,
  type ResponseObject,
  type StreamEvent,
  type Usage,
} from './schemas'
import {
  classifyTool,
  executeTool,
  parseQuestions,
  shellToolFor,
  todoWriteArgs,
  toolDefinitions,
  type ToolIo,
  type ToolOutcome,
} from './tools'

export interface ModelApiHostDeps {
  readonly client: ModelApiClient
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
  readonly newId: () => string
  /** Epoch milliseconds. */
  readonly now: () => number
  readonly log: CoreLogger
}

interface ReplayItem {
  readonly turnId: string
  readonly item: InputItem
}

interface TranscriptItem {
  readonly turnId: string
  readonly item: ItemSnapshot
}

interface QueuedTurn {
  readonly turnId: string
  readonly parts: readonly TurnPart[]
  readonly displayText: string | undefined
}

interface ActiveTurn {
  readonly turnId: string
  readonly abort: AbortController
  /** Steered input, appended before the next model call. */
  readonly steered: (readonly TurnPart[])[]
}

interface Pending<T> {
  resolve(value: T): void
  reject(error: Error): void
}

interface ApprovalOutcome {
  readonly isApproved: boolean
  readonly feedback: string | undefined
}

/** Where a streamed output item stands while its deltas arrive. */
interface OpenItem {
  readonly ourId: string
  readonly kind: 'agentMessage' | 'reasoning'
  text: string
  readonly summary: string[]
}

const IN_PROGRESS = 'inProgress'
const COMPLETED = 'completed'
const FAILED = 'failed'
const REJECTED = 'rejected'
const CANCELLED = 'cancelled'
const IDLE = 'idle'
const RUNNING = 'running'
const NOOP = 'noop'
const ACCEPTED = 'accepted'
const NO_COMPACTABLE_HISTORY = 'no_compactable_history'
const COMPACTION_TURN_ID = 'compaction'
const MODEL_API_ERROR_KIND = 'modelApi'
const TURN_NOT_RUNNING = 'the turn is not running'
const TURN_RUNNING = 'a turn is running'
const SUMMARY_FIELD_PREFIX = 'summary.'
const TEXT_FIELD = 'text'
const OUTPUT_TEXT = 'output_text'
const PRESSURE_LOW = 'low'
const PRESSURE_MEDIUM = 'medium'
const PRESSURE_HIGH = 'high'
const ANSWERED = 'answered'
const DECISION_APPROVED = 'approved'
const DECISION_ABORT = 'abort'
const RESOLVED_BY_USER = 'user'
const NO_UNSUBSCRIBE = (): undefined => undefined

class AbortedError extends Error {
  public constructor() {
    super('cancelled')
    this.name = 'AbortedError'
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof MissingApiKeyError ||
    (error instanceof ModelApiError && error.status === HTTP_UNAUTHORIZED)
  )
}

function pressureFor(used: number, window: number): string {
  const fraction = used / window
  if (fraction >= CONTEXT_PRESSURE_HIGH) {
    return PRESSURE_HIGH
  }
  return fraction >= CONTEXT_PRESSURE_MEDIUM ? PRESSURE_MEDIUM : PRESSURE_LOW
}

function contentPartsFor(parts: readonly TurnPart[]): InputContentPart[] {
  return parts.map((part) => {
    switch (part.type) {
      case 'text': {
        return { type: 'input_text', text: part.text }
      }
      case 'image': {
        return {
          type: 'input_image',
          image_url: `data:${part.mediaType};base64,${part.base64Data}`,
          detail: 'auto',
        }
      }
      case 'skill': {
        // No skills on this backend: the invocation goes to the model as typed.
        return {
          type: 'input_text',
          text: `/${part.selector}${part.arguments === undefined ? '' : ` ${part.arguments}`}`,
        }
      }
    }
  })
}

function typedText(parts: readonly TurnPart[]): string {
  return parts
    .flatMap((part) => {
      switch (part.type) {
        case 'text': {
          return [part.text]
        }
        case 'skill': {
          return [`/${part.selector}${part.arguments === undefined ? '' : ` ${part.arguments}`}`]
        }
        case 'image': {
          return []
        }
      }
    })
    .join('\n')
    .trim()
}

function argumentsOf(call: FunctionCallItem): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function pick(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/** What the approval card is about, in the MSP subject vocabulary. */
function subjectFor(call: FunctionCallItem, platform: NodeJS.Platform): ApprovalSubject {
  const args = argumentsOf(call)
  if (call.name === shellToolFor(platform).name) {
    return { kind: 'shell', command: pick(args, 'command') ?? call.arguments }
  }
  const path = pick(args, 'path')
  return path === undefined
    ? { kind: 'tool', toolName: call.name }
    : { kind: 'fileWrite', path, toolName: call.name }
}

/** Resolves with the awaited value, or rejects as soon as the turn is cancelled. */
function waitFor<T>(signal: AbortSignal, register: (pending: Pending<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError())
      return
    }
    const onAbort = () => {
      reject(new AbortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    register({
      resolve: (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      reject: (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    })
  })
}

export class ModelApiSession implements AgentSession {
  private readonly listeners = new Set<SessionEventListener>()
  private readonly replay: ReplayItem[] = []
  private readonly transcript: TranscriptItem[] = []
  private readonly turnIds: string[] = []
  private readonly outputs = new Map<string, string>()
  private readonly permissions: PermissionEngine
  private readonly pendingApprovals = new Map<string, Pending<ApprovalDecision>>()
  private readonly pendingQuestions = new Map<string, Pending<readonly QuestionAnswer[]>>()
  private readonly queuedTurns: QueuedTurn[] = []
  private active: ActiveTurn | undefined
  private effort: string = DEFAULT_EFFORT
  private todos: readonly TodoItem[] = []
  private usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  private firstPrompt: string | undefined
  private isDisposed = false
  public modelId: string
  public name: string | undefined
  public readonly createdAt: string
  public lastActivityAt: string
  public turnCount = 0
  public status: string = IDLE
  public forkedFrom: string | undefined

  public constructor(
    public readonly sessionId: string,
    modelId: string,
    approvalMode: ApprovalMode,
    private readonly deps: ModelApiHostDeps,
    private readonly onChanged: () => void,
    private readonly onDispose: () => void,
  ) {
    this.modelId = modelId
    this.permissions = new PermissionEngine(approvalMode)
    this.createdAt = new Date(deps.now()).toISOString()
    this.lastActivityAt = this.createdAt
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private touch(): void {
    this.lastActivityAt = new Date(this.deps.now()).toISOString()
    this.onChanged()
  }

  private body(): CreateResponseBody {
    const shell = shellToolFor(this.deps.platform)
    return {
      model: this.modelId,
      input: this.replay.map((entry) => entry.item),
      instructions: instructionsFor({
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        shellToolName: shell.name,
        shellName: shell.shellName,
      }),
      tools: toolDefinitions(this.deps.platform),
      tool_choice: 'auto',
      reasoning: {
        effort: this.effort === THINKING_OFF_EFFORT ? MODEL_API_EFFORT_OFF : this.effort,
        summary: 'auto',
      },
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      max_output_tokens: MODEL_API_MAX_OUTPUT_TOKENS,
      prompt_cache_key: this.sessionId,
    }
  }

  private recordTranscript(turnId: string, item: ItemSnapshot): void {
    this.transcript.push({ turnId, item })
  }

  private appendUserMessage(
    turnId: string,
    parts: readonly TurnPart[],
    displayText: string | undefined,
  ): void {
    this.replay.push({
      turnId,
      item: { type: 'message', role: 'user', content: contentPartsFor(parts) },
    })
    const text = displayText ?? typedText(parts)
    this.firstPrompt ??= text
    const attachments = parts.flatMap((part) =>
      part.type === 'image'
        ? [{ type: 'image', mediaType: part.mediaType, width: part.width, height: part.height }]
        : [],
    )
    this.recordTranscript(turnId, {
      itemId: this.deps.newId(),
      kind: 'userMessage',
      status: COMPLETED,
      turnId,
      text,
      ...(attachments.length > 0 && { attachments }),
    })
  }

  private noteUsage(usage: Usage | null | undefined): void {
    if (usage === null || usage === undefined) {
      return
    }
    this.usage = {
      inputTokens: this.usage.inputTokens + usage.input_tokens,
      outputTokens: this.usage.outputTokens + usage.output_tokens,
      cachedTokens: this.usage.cachedTokens + (usage.input_tokens_details?.cached_tokens ?? 0),
      reasoningTokens:
        this.usage.reasoningTokens + (usage.output_tokens_details?.reasoning_tokens ?? 0),
    }
    this.emit({ type: 'tokenUsage', ...this.usage, modelId: this.modelId })
    this.noteContext(usage.input_tokens + usage.output_tokens)
  }

  private noteContext(usedTokens: number): void {
    this.emit({
      type: 'contextUsage',
      usedTokens,
      windowTokens: MODEL_API_CONTEXT_WINDOW,
      pressure: pressureFor(usedTokens, MODEL_API_CONTEXT_WINDOW),
    })
  }

  /** The streamed item's tracking entry, created on first sight. */
  private openItem(
    open: Map<string, OpenItem>,
    wireId: string,
    kind: OpenItem['kind'],
    turnId: string,
  ): OpenItem {
    const existing = open.get(wireId)
    if (existing !== undefined) {
      return existing
    }
    const entry: OpenItem = { ourId: this.deps.newId(), kind, text: '', summary: [] }
    open.set(wireId, entry)
    this.emit({
      type: 'itemStarted',
      item: {
        itemId: entry.ourId,
        kind,
        status: IN_PROGRESS,
        turnId,
        ...(kind === 'agentMessage' ? { text: '' } : { summary: [] }),
      },
    })
    return entry
  }

  private completeItem(entry: OpenItem, turnId: string): void {
    const item: ItemSnapshot =
      entry.kind === 'agentMessage'
        ? { itemId: entry.ourId, kind: entry.kind, status: COMPLETED, turnId, text: entry.text }
        : {
            itemId: entry.ourId,
            kind: entry.kind,
            status: COMPLETED,
            turnId,
            summary: [...entry.summary],
          }
    this.emit({ type: 'itemCompleted', item })
    this.recordTranscript(turnId, item)
  }

  /** One streamed event applied to the transcript; the response when terminal. */
  private applyStreamEvent(
    event: StreamEvent,
    open: Map<string, OpenItem>,
    turnId: string,
  ): ResponseObject | undefined {
    switch (event.type) {
      case 'response.output_item.added': {
        const { item } = event
        if (isMessageItem(item) || isReasoningItem(item)) {
          const kind = isMessageItem(item) ? 'agentMessage' : 'reasoning'
          this.openItem(open, item.id ?? String(event.output_index ?? open.size), kind, turnId)
        }
        return undefined
      }
      case 'response.output_text.delta': {
        const entry = this.openItem(open, event.item_id, 'agentMessage', turnId)
        entry.text += event.delta
        this.emit({ type: 'textDelta', itemId: entry.ourId, field: TEXT_FIELD, delta: event.delta })
        return undefined
      }
      case 'response.reasoning_summary_text.delta': {
        const entry = this.openItem(open, event.item_id, 'reasoning', turnId)
        const index = event.summary_index ?? 0
        while (entry.summary.length <= index) {
          entry.summary.push('')
        }
        entry.summary[index] = `${entry.summary[index] ?? ''}${event.delta}`
        this.emit({
          type: 'textDelta',
          itemId: entry.ourId,
          field: `${SUMMARY_FIELD_PREFIX}${String(index)}`,
          delta: event.delta,
        })
        return undefined
      }
      case 'response.output_item.done': {
        this.finishStreamedItem(event.item, event.output_index, open, turnId)
        return undefined
      }
      case 'response.completed': {
        return event.response
      }
      case 'response.incomplete': {
        this.deps.log.warn(
          `Model API response ${event.response.id} incomplete: ${event.response.incomplete_details?.reason ?? 'no reason'}`,
        )
        return event.response
      }
      case 'response.failed': {
        const failure = event.response.error
        throw new ModelApiError(
          failure?.message ?? 'The response failed',
          0,
          undefined,
          failure?.code ?? undefined,
        )
      }
      case 'error': {
        throw new ModelApiError(event.message, 0, undefined, event.code ?? undefined)
      }
      default: {
        return undefined
      }
    }
  }

  /** `response.output_item.done`: the final text or summary of a streamed item. */
  private finishStreamedItem(
    item: OutputItem,
    outputIndex: number | undefined,
    open: Map<string, OpenItem>,
    turnId: string,
  ): void {
    const wireId = item.id ?? String(outputIndex ?? open.size)
    if (isMessageItem(item)) {
      const entry = this.openItem(open, wireId, 'agentMessage', turnId)
      const text = messageText(item)
      entry.text = text === '' ? entry.text : text
      this.completeItem(entry, turnId)
    } else if (isReasoningItem(item)) {
      const entry = this.openItem(open, wireId, 'reasoning', turnId)
      const summary = (item.summary ?? []).map((part) => part.text)
      if (summary.length > 0) {
        entry.summary.splice(0, entry.summary.length, ...summary)
      }
      this.completeItem(entry, turnId)
    }
  }

  /** One model call: streams the reply into the transcript, returns the calls to run. */
  private async streamOnce(
    turnId: string,
    signal: AbortSignal,
  ): Promise<readonly FunctionCallItem[]> {
    const open = new Map<string, OpenItem>()
    let final: ResponseObject | undefined
    for await (const event of this.deps.client.streamResponse(this.body(), signal)) {
      final = this.applyStreamEvent(event, open, turnId) ?? final
    }
    if (final === undefined) {
      throw new ModelApiError(
        'The stream ended without a completed response',
        0,
        undefined,
        undefined,
      )
    }
    return this.adoptOutput(turnId, final)
  }

  /** Keeps the completed output for replay and returns its function calls. */
  private adoptOutput(turnId: string, response: ResponseObject): readonly FunctionCallItem[] {
    const calls: FunctionCallItem[] = []
    for (const item of response.output) {
      if (isMessageItem(item)) {
        this.replay.push({
          turnId,
          item: {
            type: 'message',
            role: 'assistant',
            content: [{ type: OUTPUT_TEXT, text: messageText(item) }],
          },
        })
      } else if (isReasoningItem(item)) {
        // Only replayable with its encrypted content; a bare summary is dropped.
        if (typeof item.encrypted_content === 'string') {
          this.replay.push({ turnId, item })
        }
      } else if (isFunctionCallItem(item)) {
        this.replay.push({ turnId, item })
        calls.push(item)
      }
    }
    this.noteUsage(response.usage)
    return calls
  }

  private async askApproval(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ApprovalOutcome> {
    const approvalId = this.deps.newId()
    this.emit({
      type: 'approvalRequested',
      approvalId,
      itemId,
      toolName: call.name,
      rawArgs: call.arguments,
      requirementId: { approvalId, sourceIndex: 0 },
      subject: subjectFor(call, this.deps.platform),
      availableChoices: [...choicesFor(call.name)],
      isJudgeEscalated: false,
      isProtectedWrite: false,
    })
    let decision: ApprovalDecision
    try {
      decision = await waitFor<ApprovalDecision>(signal, (pending) => {
        this.pendingApprovals.set(approvalId, pending)
      })
    } finally {
      this.pendingApprovals.delete(approvalId)
    }
    if (decision.choiceId === APPROVAL_CHOICE_IDS.allowSession) {
      this.permissions.allowForSession(call.name)
    }
    const isApproved = decision.choiceId !== APPROVAL_CHOICE_IDS.abort
    this.emit({
      type: 'approvalResolved',
      approvalId,
      itemId,
      decision: isApproved ? DECISION_APPROVED : DECISION_ABORT,
      resolvedBy: RESOLVED_BY_USER,
    })
    return { isApproved, feedback: decision.feedback }
  }

  private async askUser(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    const questions = parseQuestions(call.arguments)
    if (typeof questions === 'string') {
      return { output: `Error: ${questions}`, visibleOutput: questions, failureReason: questions }
    }
    const userInputId = this.deps.newId()
    this.emit({ type: 'questionRequested', userInputId, itemId, questions: [...questions] })
    let answers: readonly QuestionAnswer[]
    try {
      answers = await waitFor<readonly QuestionAnswer[]>(signal, (pending) => {
        this.pendingQuestions.set(userInputId, pending)
      })
    } finally {
      this.pendingQuestions.delete(userInputId)
    }
    this.emit({ type: 'questionSettled', userInputId, outcome: ANSWERED, answers: [...answers] })
    const text = `${UI_TEXT.answersPrefix}\n${JSON.stringify(answers)}`
    return { output: text, visibleOutput: text }
  }

  private writeTodos(call: FunctionCallItem): ToolOutcome {
    let raw: unknown
    try {
      raw = JSON.parse(call.arguments)
    } catch {
      raw = undefined
    }
    const parsed = todoWriteArgs.safeParse(raw)
    if (!parsed.success) {
      const reason = 'invalid task list'
      return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
    }
    this.todos = parsed.data.items
    this.emit({ type: 'todoChanged', items: [...this.todos] })
    const summary = `${String(this.todos.length)} tasks`
    return { output: summary, visibleOutput: summary }
  }

  private async perform(
    itemId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    switch (call.name) {
      case MODEL_API_TOOLS.askUser: {
        return await this.askUser(itemId, call, signal)
      }
      case MODEL_API_TOOLS.todoWrite: {
        return this.writeTodos(call)
      }
      default: {
        return await executeTool(call.name, call.arguments, {
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
          io: this.deps.io,
        })
      }
    }
  }

  /** Permission check, execution and the transcript row for one tool call. */
  private async runCall(
    turnId: string,
    call: FunctionCallItem,
    signal: AbortSignal,
  ): Promise<void> {
    const itemId = this.deps.newId()
    const started: ItemSnapshot = {
      itemId,
      kind: 'toolCall',
      status: IN_PROGRESS,
      turnId,
      tool: call.name,
      args: call.arguments,
    }
    this.emit({ type: 'itemStarted', item: started })
    const toolClass = classifyTool(call.name)
    let outcome: ToolOutcome
    let isRejected = false
    if (toolClass === undefined) {
      const reason = `unknown tool ${call.name}`
      outcome = { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
    } else {
      const verdict = this.permissions.verdict(call.name, toolClass)
      if (verdict === 'deny') {
        isRejected = true
        const reason = `${call.name} ${UI_TEXT.toolRefusedByMode}`
        outcome = { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
      } else if (verdict === 'ask') {
        const approval = await this.askApproval(itemId, call, signal)
        if (approval.isApproved) {
          outcome = await this.perform(itemId, call, signal)
        } else {
          isRejected = true
          const reason = `${call.name} ${UI_TEXT.toolRejectedByUser}`
          const feedback = approval.feedback === undefined ? '' : `\nUser: ${approval.feedback}`
          outcome = {
            output: `Error: ${reason}${feedback}`,
            visibleOutput: reason,
            failureReason: reason,
          }
        }
      } else {
        outcome = await this.perform(itemId, call, signal)
      }
    }
    let status = COMPLETED
    if (outcome.failureReason !== undefined) {
      status = isRejected ? REJECTED : FAILED
    }
    const outputRef = outcome.patch === undefined ? undefined : `${OUTPUT_REF_PREFIX}${itemId}`
    if (outputRef !== undefined && outcome.patch !== undefined) {
      this.outputs.set(outputRef, outcome.patch.document)
    }
    const completed: ItemSnapshot = {
      ...started,
      status,
      visibleOutput: outcome.visibleOutput,
      ...(outcome.failureReason !== undefined && { failureReason: outcome.failureReason }),
      ...(outputRef !== undefined &&
        outcome.patch !== undefined && {
          patchRef: { id: outputRef, byteLen: Buffer.byteLength(outcome.patch.document) },
          patchSummary: outcome.patch.summary,
        }),
    }
    this.emit({ type: 'itemCompleted', item: completed })
    this.recordTranscript(turnId, completed)
    this.replay.push({
      turnId,
      item: { type: 'function_call_output', call_id: call.call_id, output: outcome.output },
    })
  }

  private drainSteered(turn: ActiveTurn): void {
    for (const parts of turn.steered.splice(0)) {
      const text = typedText(parts)
      this.replay.push({
        turnId: turn.turnId,
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: UI_TEXT.steeredPrefix }, ...contentPartsFor(parts)],
        },
      })
      this.recordTranscript(turn.turnId, {
        itemId: this.deps.newId(),
        kind: 'userMessage',
        status: COMPLETED,
        turnId: turn.turnId,
        text,
      })
    }
  }

  private async loop(turn: ActiveTurn): Promise<void> {
    for (let round = 0; round < MODEL_API_MAX_TOOL_ROUNDS; round += 1) {
      this.drainSteered(turn)
      const calls = await this.streamOnce(turn.turnId, turn.abort.signal)
      if (calls.length === 0) {
        return
      }
      for (const call of calls) {
        await this.runCall(turn.turnId, call, turn.abort.signal)
      }
    }
    throw new Error(`stopped after ${String(MODEL_API_MAX_TOOL_ROUNDS)} tool rounds`)
  }

  private async runTurn(queued: QueuedTurn): Promise<void> {
    const turn: ActiveTurn = { turnId: queued.turnId, abort: new AbortController(), steered: [] }
    this.active = turn
    this.status = RUNNING
    this.turnIds.push(turn.turnId)
    this.emit({ type: 'turnStarted', turnId: turn.turnId })
    this.emit({ type: 'sessionStatus', status: RUNNING })
    this.appendUserMessage(turn.turnId, queued.parts, queued.displayText)
    this.touch()
    const startedAt = this.deps.now()
    let terminal = COMPLETED
    let reason: string | undefined
    let errorKind: string | undefined
    try {
      await this.loop(turn)
    } catch (error: unknown) {
      if (turn.abort.signal.aborted) {
        terminal = CANCELLED
      } else {
        terminal = FAILED
        reason = describe(error)
        errorKind = isAuthFailure(error) ? AUTH_REQUIRED_ERROR_KIND : MODEL_API_ERROR_KIND
        this.deps.log.warn(`Model API turn ${turn.turnId} failed: ${reason}`)
      }
    }
    this.active = undefined
    this.status = IDLE
    this.turnCount += 1
    this.emit({
      type: 'turnCompleted',
      turnId: turn.turnId,
      terminal,
      ...(reason !== undefined && { reason }),
      ...(errorKind !== undefined && { errorKind }),
      durationMs: this.deps.now() - startedAt,
    })
    this.emit({ type: 'sessionStatus', status: IDLE })
    this.touch()
    const next = this.queuedTurns.shift()
    if (next !== undefined) {
      void this.runTurn(next)
    }
  }

  /** The text a stream event contributes to a collected reply; throws on failure. */
  private collectedText(event: StreamEvent): string {
    switch (event.type) {
      case 'response.output_text.delta': {
        return event.delta
      }
      case 'response.failed': {
        throw new ModelApiError(
          event.response.error?.message ?? 'The response failed',
          0,
          undefined,
          undefined,
        )
      }
      case 'error': {
        throw new ModelApiError(event.message, 0, undefined, event.code ?? undefined)
      }
      case 'response.completed': {
        this.noteUsage(event.response.usage)
        return ''
      }
      default: {
        return ''
      }
    }
  }

  /** Collects the reply text of one model call without touching the transcript. */
  private async collectText(body: CreateResponseBody, signal: AbortSignal): Promise<string> {
    let text = ''
    for await (const event of this.deps.client.streamResponse(body, signal)) {
      text += this.collectedText(event)
    }
    return text
  }

  // --- AgentSession ---

  public onEvent(listener: SessionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  public get approvalMode(): ApprovalMode {
    return this.permissions.currentMode
  }

  public sendTurn(parts: readonly TurnPart[], displayText?: string): Promise<TurnSubmission> {
    const turnId = this.deps.newId()
    const queued: QueuedTurn = { turnId, parts, displayText }
    if (this.active === undefined) {
      void this.runTurn(queued)
      return Promise.resolve({ turnId, disposition: 'started' })
    }
    this.queuedTurns.push(queued)
    return Promise.resolve({ turnId, disposition: 'queued' })
  }

  public steer(expectedTurnId: string, parts: readonly TurnPart[]): Promise<string> {
    if (this.active?.turnId !== expectedTurnId) {
      return Promise.reject(new Error(TURN_NOT_RUNNING))
    }
    this.active.steered.push(parts)
    return Promise.resolve(expectedTurnId)
  }

  public cancel(): Promise<void> {
    this.queuedTurns.length = 0
    this.active?.abort.abort()
    return Promise.resolve()
  }

  public setModel(modelId: string): Promise<void> {
    this.modelId = modelId
    this.emit({ type: 'modelChanged', modelId })
    return Promise.resolve()
  }

  public setReasoningEffort(reasoningEffort: string): Promise<void> {
    if (reasoningEffort === '') {
      return Promise.reject(new Error('reasoning effort must not be empty'))
    }
    this.effort = reasoningEffort
    return Promise.resolve()
  }

  public setApprovalMode(mode: string): Promise<void> {
    if (!(APPROVAL_MODES as readonly string[]).includes(mode)) {
      return Promise.reject(new Error(`unknown approval mode ${mode}`))
    }
    this.permissions.setMode(mode as ApprovalMode)
    return Promise.resolve()
  }

  /**
   * Summarises the conversation with one model call and replays only the
   * summary from then on, as `/compact` does in Muse Code.
   */
  public async compact(): Promise<CompactOutcome> {
    if (this.replay.length === 0) {
      return { status: NOOP, reason: NO_COMPACTABLE_HISTORY }
    }
    if (this.active !== undefined) {
      throw new Error(TURN_RUNNING)
    }
    const abort = new AbortController()
    const body: CreateResponseBody = {
      ...this.body(),
      input: [
        ...this.replay.map((entry) => entry.item),
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: UI_TEXT.compactionPrompt }],
        },
      ],
      tools: [],
    }
    const summary = await this.collectText(body, abort.signal)
    this.replay.splice(0, this.replay.length, {
      turnId: COMPACTION_TURN_ID,
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: `${UI_TEXT.compactionPrefix}\n\n${summary}` }],
      },
    })
    const item: ItemSnapshot = {
      itemId: this.deps.newId(),
      kind: 'compaction',
      status: COMPLETED,
      fallbackText: UI_TEXT.compactionDone,
    }
    this.emit({ type: 'itemCompleted', item })
    this.recordTranscript(COMPACTION_TURN_ID, item)
    const { stream: _stream, ...countable } = this.body()
    this.noteContext(await this.deps.client.countInputTokens(countable))
    this.touch()
    return { status: ACCEPTED, reason: undefined }
  }

  public decideApproval(decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.approvalId)
    if (pending === undefined) {
      return Promise.reject(new Error(`approval ${decision.approvalId} is not pending`))
    }
    pending.resolve(decision)
    return Promise.resolve()
  }

  public answerQuestions(userInputId: string, answers: readonly QuestionAnswer[]): Promise<void> {
    const pending = this.pendingQuestions.get(userInputId)
    if (pending === undefined) {
      return Promise.reject(new Error(`question ${userInputId} is not pending`))
    }
    pending.resolve(answers)
    return Promise.resolve()
  }

  public readOutput(request: OutputPageRequest): Promise<OutputPage> {
    const content = this.outputs.get(request.outputRef)
    if (content === undefined) {
      return Promise.reject(new Error(`unknown output ${request.outputRef}`))
    }
    const bytes = Buffer.from(content, MODEL_API_OUTPUT_ENCODING)
    const end = Math.min(request.offsetBytes + request.lengthBytes, bytes.length)
    const slice = bytes.subarray(request.offsetBytes, end)
    return Promise.resolve({
      content: slice.toString(MODEL_API_OUTPUT_ENCODING),
      encoding: MODEL_API_OUTPUT_ENCODING,
      mediaType: MODEL_API_OUTPUT_MEDIA_TYPE,
      offsetBytes: request.offsetBytes,
      byteLen: slice.length,
      eof: end >= bytes.length,
    })
  }

  public listSkills(): Promise<readonly SkillSummary[]> {
    return Promise.resolve([])
  }

  public rename(name: string): Promise<string | undefined> {
    this.name = name
    this.emit({ type: 'sessionNamed', name })
    this.touch()
    return Promise.resolve(name)
  }

  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    void this.cancel()
    this.listeners.clear()
    this.onDispose()
  }

  // --- host-side views ---

  public record(): SessionRecord {
    return {
      sessionId: this.sessionId,
      ...(this.name !== undefined && { name: this.name }),
      ...(this.firstPrompt !== undefined && {
        title: this.firstPrompt,
        firstUserPrompt: this.firstPrompt,
      }),
      createdAt: this.createdAt,
      updatedAt: this.lastActivityAt,
      lastActivityAt: this.lastActivityAt,
      status: this.status,
      turnCount: this.turnCount,
      forkedFrom: this.forkedFrom === undefined ? null : { sessionId: this.forkedFrom },
      workspaceRoot: this.deps.workspaceRoot,
    }
  }

  public history(): SessionHistoryOutcome {
    return {
      mode: 'inline',
      items: this.transcript.map((entry) => entry.item),
      name: this.name,
      todos: [...this.todos],
    }
  }

  /** Copies the turns through `lastTurnId` (all of them when absent) into `target`. */
  public copyInto(target: ModelApiSession, lastTurnId: string | undefined): void {
    const cut =
      lastTurnId === undefined ? this.turnIds.length - 1 : this.turnIds.indexOf(lastTurnId)
    if (cut === -1) {
      throw new Error(`invalid fork boundary for session ${this.sessionId}: unknown turn`)
    }
    const kept = new Set(this.turnIds.slice(0, cut + 1))
    kept.add(COMPACTION_TURN_ID)
    target.replay.push(...this.replay.filter((entry) => kept.has(entry.turnId)))
    target.transcript.push(...this.transcript.filter((entry) => kept.has(entry.turnId)))
    target.turnIds.push(...this.turnIds.slice(0, cut + 1))
    target.turnCount = target.turnIds.length
    target.firstPrompt = this.firstPrompt
    target.forkedFrom = this.sessionId
    target.effort = this.effort
    for (const [ref, content] of this.outputs) {
      target.outputs.set(ref, content)
    }
  }
}

export class ModelApiHost implements AgentHost {
  private readonly sessions = new Map<string, ModelApiSession>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  public readonly info: HostInfo = {
    kind: 'modelApi',
    serverName: MODEL_API_SERVER_NAME,
    serverVersion: MODEL_API_VERSION,
    grantedCapabilities: [],
  }

  public constructor(private readonly deps: ModelApiHostDeps) {}

  private announce(session: ModelApiSession): void {
    for (const listener of this.listListeners) {
      listener({ type: 'changed', record: session.record() })
    }
  }

  private create(modelId: string, approvalMode: ApprovalMode): ModelApiSession {
    const sessionId = this.deps.newId()
    const session = new ModelApiSession(
      sessionId,
      modelId,
      approvalMode,
      this.deps,
      () => {
        this.announce(session)
      },
      () => {
        this.sessions.delete(sessionId)
      },
    )
    this.sessions.set(sessionId, session)
    return session
  }

  private loaded(session: ModelApiSession): LoadedSession {
    return { session, record: session.record(), history: session.history() }
  }

  public onExit(_listener: (description: string) => void): () => void {
    // No process behind this host: nothing ever exits.
    return NO_UNSUBSCRIBE
  }

  public async listModels(sessionId?: string): Promise<readonly ModelSummary[]> {
    const ids = await this.deps.client.listModels()
    const active = sessionId === undefined ? undefined : this.sessions.get(sessionId)?.modelId
    return ids
      .filter((id) => id.startsWith(MODEL_API_MODEL_PREFIX))
      .map((id) => ({
        modelId: id,
        displayLabel: id,
        contextLimit: MODEL_API_CONTEXT_WINDOW,
        isDefault: id === DEFAULT_MODEL_ID,
        isActive: id === active,
      }))
  }

  public startSession(options: StartSessionOptions): Promise<AgentSession> {
    if (!(APPROVAL_MODES as readonly string[]).includes(options.approvalMode)) {
      return Promise.reject(new Error(`unknown approval mode ${options.approvalMode}`))
    }
    const session = this.create(options.modelId, options.approvalMode as ApprovalMode)
    this.announce(session)
    return Promise.resolve(session)
  }

  public listSessions(options: ListSessionsOptions): Promise<SessionPage> {
    const sessions = Array.from(this.sessions.values(), (session) => session.record())
      .filter((record) => record.workspaceRoot === options.workspaceRoot)
      .toSorted(
        (a, b) =>
          Date.parse(b.lastActivityAt ?? b.updatedAt) - Date.parse(a.lastActivityAt ?? a.updatedAt),
      )
      .slice(0, options.limit)
    return Promise.resolve({ sessions, nextCursor: undefined })
  }

  public resumeSession(sessionId: string, _modelId: string): Promise<LoadedSession> {
    const session = this.sessions.get(sessionId)
    return session === undefined
      ? Promise.reject(new Error(`session ${sessionId} is not held by this window`))
      : Promise.resolve(this.loaded(session))
  }

  public forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    const source = this.sessions.get(sessionId)
    if (source === undefined) {
      return Promise.reject(new Error(`session ${sessionId} is not held by this window`))
    }
    const fork = this.create(modelId, source.approvalMode)
    try {
      source.copyInto(fork, lastTurnId)
    } catch (error: unknown) {
      fork.dispose()
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
    this.announce(fork)
    return Promise.resolve(this.loaded(fork))
  }

  public onSessionListEvent(listener: (event: SessionListEvent) => void): () => void {
    this.listListeners.add(listener)
    return () => {
      this.listListeners.delete(listener)
    }
  }

  /** A key has no subscription window: the dialog shows token totals instead. */
  public readUsage(): Promise<SubscriptionUsage | undefined> {
    return Promise.resolve(undefined)
  }

  public onUsageChanged(_listener: (usage: SubscriptionUsage) => void): () => void {
    return NO_UNSUBSCRIBE
  }

  public get sessionCount(): number {
    return this.sessions.size
  }

  public close(): Promise<void> {
    // Disposing removes the entry; a Map iterator tolerates that.
    for (const session of this.sessions.values()) {
      session.dispose()
    }
    return Promise.resolve()
  }
}
