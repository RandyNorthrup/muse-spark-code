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
  ISO_DATE_LENGTH,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_MAX_TOOL_ROUNDS,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_OUTPUT_ENCODING,
  MODEL_API_OUTPUT_MEDIA_TYPE,
  MODEL_API_SERVER_NAME,
  MODEL_API_TOOLS,
  MODEL_API_VERSION,
  OUTPUT_REF_PREFIX,
  STORED_SESSION_VERSION,
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
  SessionPage,
  SessionRecord,
  SkillSummary,
  StartSessionOptions,
  TurnPart,
  TurnSubmission,
} from '../../agent/agentBackend'
import { type SkillDefinition } from '../../context/skills'
import { WorkspaceContext } from '../../context/workspaceContext'
import type { CoreLogger } from '../../logging'
import { MissingApiKeyError, type ModelApiClient, ModelApiError, type RetryNotice } from './client'
import { type EnvironmentFacts, instructionsFor } from './instructions'
import {
  APPROVAL_CHOICE_IDS,
  choicesFor,
  isKnownChoice,
  isProtectedPath,
  PermissionEngine,
  type PermissionQuery,
} from './permissions'
import { recordOf, type SessionStore, type StoredSession } from './sessionStore'
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
  confineWorkspacePath,
  executeTool,
  parseQuestions,
  type PathResolution,
  readSkillArgs,
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
  /** Muse Code's personal skill root (PLAN.md D13); undefined without a home. */
  readonly personalSkillsRoot: string | undefined
  /** VS Code workspace trust: gates rules, skills, memory and the shell (D13). */
  readonly isWorkspaceTrusted: () => boolean
  /** Sessions between windows (D14); undefined without workspace storage. */
  readonly store?: SessionStore | undefined
  /** The git facts for the prompt's environment section (D15), read once per session. */
  readonly describeEnvironment: () => Promise<EnvironmentFacts>
}

const NO_ENVIRONMENT: EnvironmentFacts = { git: undefined }

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

function toolFailure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

/** A typed `/id arguments`, as the transcript shows it. */
function typedInvocation(selector: string, args: string | undefined): string {
  return `/${selector}${args === undefined ? '' : ` ${args}`}`
}

/**
 * A skill invocation as the model receives it: the host expands the skill's
 * body with the arguments, as Muse Code does for a `skill` input part.
 */
function skillInvocationText(skill: SkillDefinition, args: string | undefined): string {
  return `${UI_TEXT.skillInvoked} "${skill.id}". ${UI_TEXT.skillArguments} ${args ?? UI_TEXT.skillNoArguments}\n\n${skill.body}`
}

function contentPartsFor(
  parts: readonly TurnPart[],
  resolveSkill: (selector: string) => SkillDefinition | undefined,
): InputContentPart[] {
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
        // An unknown selector (the catalogue changed under the palette) goes as typed.
        const skill = resolveSkill(part.selector)
        return {
          type: 'input_text',
          text:
            skill === undefined
              ? typedInvocation(part.selector, part.arguments)
              : skillInvocationText(skill, part.arguments),
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
          return [typedInvocation(part.selector, part.arguments)]
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
  /** The rules, skills and memory of the workspace (PLAN.md D13). */
  private readonly context: WorkspaceContext
  /** The git facts of the prompt's environment section (D15), read on the first turn. */
  private environment: EnvironmentFacts | undefined
  private readonly pendingApprovals = new Map<string, Pending<ApprovalDecision>>()
  private readonly pendingQuestions = new Map<string, Pending<readonly QuestionAnswer[]>>()
  private readonly queuedTurns: QueuedTurn[] = []
  private active: ActiveTurn | undefined
  private effort: string = DEFAULT_EFFORT
  private todos: readonly TodoItem[] = []
  private usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  private firstPrompt: string | undefined
  private isDisposed = false
  /** The surfaces holding this session: closing one must not cancel another's turn. */
  private holders = 1
  public modelId: string
  public name: string | undefined
  public createdAt: string
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
    this.context = new WorkspaceContext({
      io: deps.io,
      workspaceRoot: deps.workspaceRoot,
      platform: deps.platform,
      personalSkillsRoot: deps.personalSkillsRoot,
      isWorkspaceTrusted: deps.isWorkspaceTrusted,
      warn: (message) => {
        deps.log.warn(`Workspace context: ${message}`)
      },
    })
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

  /** Never throws: a describer that fails leaves the section at "no git". */
  private async loadEnvironment(): Promise<EnvironmentFacts> {
    try {
      return await this.deps.describeEnvironment()
    } catch (error: unknown) {
      this.deps.log.warn(`The environment could not be described: ${describe(error)}`)
      return NO_ENVIRONMENT
    }
  }

  private body(): CreateResponseBody {
    const shell = shellToolFor(this.deps.platform)
    const hasShell = this.deps.isWorkspaceTrusted()
    const context = this.context.sections()
    return {
      model: this.modelId,
      input: this.replay.map((entry) => entry.item),
      instructions: instructionsFor({
        workspaceRoot: this.deps.workspaceRoot,
        platform: this.deps.platform,
        shellToolName: shell.name,
        shellName: shell.shellName,
        hasShell,
        today: new Date(this.deps.now()).toISOString().slice(0, ISO_DATE_LENGTH),
        environment: this.environment ?? NO_ENVIRONMENT,
        context,
      }),
      tools: toolDefinitions(this.deps.platform, {
        hasShell,
        hasSkills: context.skills.length > 0,
      }),
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
      item: { type: 'message', role: 'user', content: this.contentParts(parts) },
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
    // A retried request is announced in the transcript, as Muse Code's are (D25).
    const onRetry = (notice: RetryNotice) => {
      this.emit({
        type: 'turnRetry',
        turnId,
        attempt: notice.attempt,
        maxAttempts: notice.maxAttempts,
        retryDelayMs: notice.delayMs,
        reason: notice.reason,
      })
    }
    for await (const event of this.deps.client.streamResponse(this.body(), signal, onRetry)) {
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
    query: PermissionQuery,
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
      availableChoices: [...choicesFor(call.name, query.command)],
      isJudgeEscalated: false,
      isProtectedWrite: query.isProtected === true,
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
      this.permissions.allowForSession(call.name, query.command)
    }
    // Only the two allow choices this card offered approve; anything else refuses.
    const isApproved =
      decision.choiceId === APPROVAL_CHOICE_IDS.allowOnce ||
      decision.choiceId === APPROVAL_CHOICE_IDS.allowSession
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
    // No answers at all is the card's Cancel (M16); a submitted card answers every question.
    const isCancelled = answers.length === 0
    this.emit({
      type: 'questionSettled',
      userInputId,
      outcome: isCancelled ? CANCELLED : ANSWERED,
      answers: [...answers],
    })
    const text = isCancelled
      ? UI_TEXT.questionCancelledOutput
      : `${UI_TEXT.answersPrefix}\n${JSON.stringify(answers)}`
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

  private contentParts(parts: readonly TurnPart[]): InputContentPart[] {
    return contentPartsFor(parts, (selector) => this.context.skill(selector))
  }

  /** `read_skill`: the body of a catalogue skill, by id; never a path. */
  private readSkill(call: FunctionCallItem): ToolOutcome {
    const parsed = readSkillArgs.safeParse(argumentsOf(call))
    if (!parsed.success) {
      return toolFailure('invalid arguments: id is required')
    }
    const skill = this.context.skill(parsed.data.id)
    if (skill === undefined) {
      return toolFailure(`${UI_TEXT.skillNotFound} ${parsed.data.id}`)
    }
    return {
      output: `Skill ${skill.id}: ${skill.description}\n\n${skill.body}`,
      visibleOutput: `Loaded skill ${skill.id} (${skill.source})`,
    }
  }

  /** Where an edit-family call writes, confined (links resolved), or why it cannot. */
  private async editTarget(call: FunctionCallItem): Promise<PathResolution | undefined> {
    const given = pick(argumentsOf(call), 'path')
    return given === undefined
      ? undefined
      : await confineWorkspacePath(this.deps.workspaceRoot, given, this.deps.platform, this.deps.io)
  }

  /** A tool that named a path may have entered a directory with its own rules file. */
  private async touchPath(call: FunctionCallItem): Promise<void> {
    const given = pick(argumentsOf(call), 'path')
    if (given === undefined) {
      return
    }
    const resolved = await confineWorkspacePath(
      this.deps.workspaceRoot,
      given,
      this.deps.platform,
      this.deps.io,
    )
    if (resolved.ok) {
      await this.context.touch(resolved.relative)
    }
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
      case MODEL_API_TOOLS.readSkill: {
        return this.readSkill(call)
      }
      default: {
        return await executeTool(call.name, call.arguments, {
          workspaceRoot: this.deps.workspaceRoot,
          platform: this.deps.platform,
          io: this.deps.io,
          signal,
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
    const target = toolClass === 'edit' ? await this.editTarget(call) : undefined
    let outcome: ToolOutcome
    let isRejected = false
    if (toolClass === undefined) {
      outcome = toolFailure(`unknown tool ${call.name}`)
    } else if (toolClass === 'shell' && !this.deps.isWorkspaceTrusted()) {
      // Restricted Mode (PLAN.md D13): the tool is not offered, and a model
      // that calls it anyway is refused, never prompted.
      isRejected = true
      outcome = toolFailure(UI_TEXT.shellRestrictedMode)
    } else if (target?.ok === false) {
      // A path the tool would refuse anyway is refused before any card.
      outcome = toolFailure(target.reason)
    } else {
      const query: PermissionQuery = {
        toolName: call.name,
        toolClass,
        command: toolClass === 'shell' ? pick(argumentsOf(call), 'command') : undefined,
        isProtected: target?.ok === true && isProtectedPath(target.canonical),
      }
      const verdict = this.permissions.verdict(query)
      if (verdict === 'deny') {
        isRejected = true
        const reason = `${call.name} ${UI_TEXT.toolRefusedByMode}`
        outcome = { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
      } else if (verdict === 'ask') {
        const approval = await this.askApproval(itemId, call, signal, query)
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
    await this.touchPath(call)
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
          content: [
            { type: 'input_text', text: UI_TEXT.steeredPrefix },
            ...this.contentParts(parts),
          ],
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
    // The context comes first so a skill invocation can be expanded (D13);
    // it never throws, so the user message always follows.
    await this.context.load()
    this.environment ??= await this.loadEnvironment()
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
    this.touch()
    return Promise.resolve()
  }

  public setReasoningEffort(reasoningEffort: string): Promise<void> {
    if (reasoningEffort === '') {
      return Promise.reject(new Error('reasoning effort must not be empty'))
    }
    this.effort = reasoningEffort
    this.touch()
    return Promise.resolve()
  }

  public setApprovalMode(mode: string): Promise<void> {
    if (!(APPROVAL_MODES as readonly string[]).includes(mode)) {
      return Promise.reject(new Error(`unknown approval mode ${mode}`))
    }
    this.permissions.setMode(mode as ApprovalMode)
    this.touch()
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
    if (!isKnownChoice(decision.choiceId)) {
      return Promise.reject(new Error(`unknown choice ${decision.choiceId}`))
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

  /** Decline the prompt (M16): the tool resolves with no answers and tells the model so. */
  public cancelQuestions(userInputId: string): Promise<void> {
    return this.answerQuestions(userInputId, [])
  }

  /** This backend runs no subagents (PLAN.md D17); the map never offers the controls. */
  public controlSubagent(subagentId: string): Promise<void> {
    return Promise.reject(new Error(`${UI_TEXT.subagentsUnsupported} (${subagentId})`))
  }

  public messageSubagent(subagentId: string): Promise<void> {
    return Promise.reject(new Error(`${UI_TEXT.subagentsUnsupported} (${subagentId})`))
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

  public async listSkills(): Promise<readonly SkillSummary[]> {
    await this.context.load()
    return this.context
      .sections()
      .skills.filter((skill) => skill.isUserInvocable)
      .map((skill) => ({
        selector: skill.id,
        displayName: skill.name,
        description: skill.description,
        argumentHint: skill.argumentHint,
      }))
  }

  /** Re-reads the skill roots after their files changed; `skillsChanged` when the catalogue did. */
  public async refreshSkills(): Promise<void> {
    if (await this.context.refreshSkills()) {
      this.emit({ type: 'skillsChanged' })
    }
  }

  public rename(name: string): Promise<string | undefined> {
    this.name = name
    this.emit({ type: 'sessionNamed', name })
    this.touch()
    return Promise.resolve(name)
  }

  /** One more surface holds this session (a second panel resumed it, PLAN.md D25). */
  public retain(): void {
    this.holders += 1
  }

  /** Releases a surface's hold; the last one stops the turn and forgets the session. */
  public dispose(): void {
    if (this.isDisposed) {
      return
    }
    this.holders -= 1
    if (this.holders > 0) {
      return
    }
    this.isDisposed = true
    void this.cancel()
    this.listeners.clear()
    this.onDispose()
  }

  /** The host is closing: the session goes whoever still holds it. */
  public disposeAll(): void {
    this.holders = 1
    this.dispose()
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

  /** Everything a window needs to bring this session back (D14). */
  public snapshot(): StoredSession {
    return {
      version: STORED_SESSION_VERSION,
      sessionId: this.sessionId,
      workspaceRoot: this.deps.workspaceRoot,
      modelId: this.modelId,
      approvalMode: this.permissions.currentMode,
      effort: this.effort,
      ...(this.name !== undefined && { name: this.name }),
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      turnIds: [...this.turnIds],
      ...(this.forkedFrom !== undefined && { forkedFrom: this.forkedFrom }),
      ...(this.firstPrompt !== undefined && { firstPrompt: this.firstPrompt }),
      todos: [...this.todos],
      replay: [...this.replay],
      transcript: [...this.transcript],
      outputs: Object.fromEntries(this.outputs),
      usage: { ...this.usage },
    }
  }

  /** Fills a fresh session from its stored form; the session is idle afterwards. */
  public adopt(stored: StoredSession): void {
    this.replay.push(...stored.replay)
    this.transcript.push(...stored.transcript)
    this.turnIds.push(...stored.turnIds)
    for (const [ref, content] of Object.entries(stored.outputs)) {
      this.outputs.set(ref, content)
    }
    this.effort = stored.effort
    this.name = stored.name
    this.todos = [...stored.todos]
    this.firstPrompt = stored.firstPrompt
    this.forkedFrom = stored.forkedFrom
    this.createdAt = stored.createdAt
    this.lastActivityAt = stored.lastActivityAt
    this.turnCount = stored.turnIds.length
    this.usage = { ...stored.usage }
    this.status = IDLE
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
  /** What the store holds for this workspace, kept current as sessions change. */
  private readonly stored = new Map<string, StoredSession>()
  private readonly listListeners = new Set<(event: SessionListEvent) => void>()
  /** Saves run one after another; a failure is logged and never surfaces. */
  private saving: Promise<void> = Promise.resolve()
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

  private persist(session: ModelApiSession): void {
    const { store } = this.deps
    if (store === undefined) {
      return
    }
    const snapshot = session.snapshot()
    this.stored.set(snapshot.sessionId, snapshot)
    const previous = this.saving
    this.saving = (async () => {
      await previous
      try {
        await store.save(snapshot)
      } catch (error: unknown) {
        this.deps.log.warn(`Session ${snapshot.sessionId} was not saved: ${describe(error)}`)
      }
    })()
  }

  private create(
    modelId: string,
    approvalMode: ApprovalMode,
    sessionId: string = this.deps.newId(),
  ): ModelApiSession {
    const session = new ModelApiSession(
      sessionId,
      modelId,
      approvalMode,
      this.deps,
      () => {
        this.persist(session)
        this.announce(session)
      },
      () => {
        this.sessions.delete(sessionId)
      },
    )
    this.sessions.set(sessionId, session)
    return session
  }

  /** The live session, or the stored one brought back into this window. */
  private revive(sessionId: string): ModelApiSession | undefined {
    const live = this.sessions.get(sessionId)
    if (live !== undefined) {
      live.retain()
      return live
    }
    const stored = this.stored.get(sessionId)
    if (stored === undefined) {
      return undefined
    }
    const session = this.create(stored.modelId, stored.approvalMode, sessionId)
    session.adopt(stored)
    return session
  }

  private loaded(session: ModelApiSession): LoadedSession {
    return { session, record: session.record(), history: session.history() }
  }

  /** Reads the store once; this window's sessions then include the stored ones. */
  public async load(): Promise<void> {
    const { store } = this.deps
    if (store === undefined) {
      return
    }
    const sessions = await store.list()
    for (const stored of sessions) {
      if (stored.workspaceRoot === this.deps.workspaceRoot) {
        this.stored.set(stored.sessionId, stored)
      }
    }
  }

  /** Resolves once every queued save has run (tests, and the manager before it forgets the host). */
  public flush(): Promise<void> {
    return this.saving
  }

  public onExit(_listener: (exit: HostExit) => void): () => void {
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
    const records = Array.from(this.sessions.values(), (session) => session.record())
    for (const [sessionId, stored] of this.stored) {
      if (!this.sessions.has(sessionId)) {
        records.push(recordOf(stored))
      }
    }
    const sessions = records
      .filter((record) => record.workspaceRoot === options.workspaceRoot)
      .toSorted(
        (a, b) =>
          Date.parse(b.lastActivityAt ?? b.updatedAt) - Date.parse(a.lastActivityAt ?? a.updatedAt),
      )
      .slice(0, options.limit)
    return Promise.resolve({ sessions, nextCursor: undefined })
  }

  /** The stored transcript; this backend spawns no subagents, so this serves the History dialog's peers only. */
  public readSession(sessionId: string): Promise<SessionHistoryOutcome> {
    const stored = this.stored.get(sessionId)
    return stored === undefined
      ? Promise.reject(new Error(`session ${sessionId} is not held by this window`))
      : Promise.resolve({
          mode: 'inline',
          items: stored.transcript.map((entry) => entry.item),
          name: stored.name,
          todos: stored.todos,
        })
  }

  public resumeSession(sessionId: string, _modelId: string): Promise<LoadedSession> {
    const session = this.revive(sessionId)
    return session === undefined
      ? Promise.reject(new Error(`session ${sessionId} is not held by this window`))
      : Promise.resolve(this.loaded(session))
  }

  public forkSession(
    sessionId: string,
    modelId: string,
    lastTurnId?: string,
  ): Promise<LoadedSession> {
    // Copying needs no hold on a live source; a stored one is revived only for the copy.
    const live = this.sessions.get(sessionId)
    const source = live ?? this.revive(sessionId)
    if (source === undefined) {
      return Promise.reject(new Error(`session ${sessionId} is not held by this window`))
    }
    const fork = this.create(modelId, source.approvalMode)
    try {
      source.copyInto(fork, lastTurnId)
      this.persist(fork)
    } catch (error: unknown) {
      fork.dispose()
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    } finally {
      if (live === undefined) {
        source.dispose()
      }
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

  /** The skill files changed on disk: every session re-reads its catalogue. */
  public async refreshSkills(): Promise<void> {
    await Promise.all(Array.from(this.sessions.values(), (session) => session.refreshSkills()))
  }

  public async close(): Promise<void> {
    // Disposing removes the entry; a Map iterator tolerates that.
    for (const session of this.sessions.values()) {
      session.disposeAll()
    }
    await this.saving
  }
}
