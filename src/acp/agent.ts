// The Muse Spark agent over the Agent Client Protocol (PLAN.md D62): one
// client on stdio, any number of sessions, each an AgentSession of the
// backend chosen at launch. The client's editor shows the chat, the tool
// calls, the plan and the permission prompts; the backend runs the tools.
//
// What the panel guarantees holds here too: an approval is decided only
// with a choice the backend offered, and one the client did not answer is
// denied (D62); "Edit automatically" answers only what the panel's rule
// allows (`editAutomaticallyChoice`, D24); a paid feature is on only with
// its flag, and each use asks in the editor first, naming its price (M58,
// paid.ts). Every update of a turn goes out before the turn's response.

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  agent as acpAgent,
  type AgentApp,
  type AgentContext,
  type AuthMethod,
  type ClientCapabilities,
  type ContentBlock,
  type CreateElicitationRequest,
  type InitializeResponse,
  type ListSessionsResponse,
  type McpServer,
  PROTOCOL_VERSION,
  RequestError,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk'
import {
  type AgentHost,
  type AgentSession,
  isPromptSettledError,
  type ModelSummary,
  type SessionMcpServer,
  type SkillSummary,
  type TurnPart,
} from '../core/agent/agentBackend'
import { editAutomaticallyChoice } from '../core/agent/approvalRules'
import { failureForLog } from '../core/backends/musecode/logText'
import type { CoreLogger } from '../core/logging'
import { type PaidUseAnswer, paidUseQuestion } from '../core/paid/paidConsent'
import type { AgentEvent } from '../shared/agentEvents'
import {
  ACP_AGENT_NAME,
  ACP_AGENT_TITLE,
  ACP_CONFIG_IDS,
  ACP_PAID_TOOL_CALL_PREFIX,
  ACP_SESSION_LIST_LIMIT,
  type AcpBackendKind,
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_EFFORT,
  type EffortLevel,
  MSP_REQUESTED_CAPABILITIES,
  type PermissionMode,
  UI_TEXT,
} from '../shared/constants'
import { effortForThinking, effortLabel, effortLevelsFor, isEffortLevel } from '../shared/effort'
import { fill } from '../shared/l10n/text'
import { parseSkillInvocation } from '../shared/mentions'
import type { PaidUseRequest } from '../shared/paid'
import {
  approvalModeFor,
  availablePermissionModes,
  permissionModeDetail,
} from '../shared/permissionModes'
import { type AcpPaidUse, paidUseAnswer, paidUseOptions } from './paid'
import { formAnswers, questionForm, questionsText } from './questions'
import {
  approvalToolCall,
  decidedChoice,
  mcpServersFrom,
  permissionOptions,
  permissionResponse,
  planEntries,
  promptParts,
  UpdateTranslator,
} from './translate'

// Muse Code runs a session's MCP servers only with this grant (M63c).
const [SESSION_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES

/** Whether the backend can start a session now, and what the user must do if not. */
export type BackendReadiness =
  | { readonly state: 'ready' }
  | { readonly state: 'signedOut'; readonly message: string }
  | { readonly state: 'unavailable'; readonly message: string }

/** The backend the agent was started on (the runtime builds it, D62). */
export interface AcpBackend {
  readonly kind: AcpBackendKind
  /** `isRecheck`: the user says they signed in, so nothing said before counts (`authenticate`). */
  readonly readiness: (isRecheck: boolean) => Promise<BackendReadiness>
  /** The host for a folder, started on first use. */
  readonly hostFor: (cwd: string) => Promise<AgentHost>
}

export interface AcpAgentOptions {
  /** Bypass permissions is offered (`--allow-dangerously-skip-permissions`). */
  readonly canBypass: boolean
  /** Contributor-tier models are listed (`--allow-contributor-models`). */
  readonly allowsContributorModels: boolean
  readonly initialMode: PermissionMode
}

/** How the user signs in to the chosen backend (D61, D62). */
export interface SignInMethod {
  readonly id: string
  readonly name: string
  readonly description: string
  /** Appended to the agent's configured command by a client that runs terminal sign-ins. */
  readonly args: readonly string[]
  /** The command a user runs by hand where the client cannot (`muse-spark-code-acp auth set`). */
  readonly command: string
}

export interface AcpAgentDeps {
  readonly backend: AcpBackend
  readonly version: string
  readonly options: AcpAgentOptions
  readonly signIn: SignInMethod
  /** The folder a `session/list` without one lists (the agent's own). */
  readonly defaultCwd: string
  /** The flagged paid features; the agent asks before each use (M63c, M58). */
  readonly paid: AcpPaidUse
  readonly log: CoreLogger
}

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>
type QuestionRequest = Extract<AgentEvent, { type: 'questionRequested' }>
type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>

interface PendingPrompt {
  readonly resolve: (reason: StopReason) => void
  readonly reject: (error: unknown) => void
  turnId: string | undefined
  isCancelled: boolean
}

type PromptOutcome = { readonly reason: StopReason } | { readonly error: unknown }

interface PreparingPrompt {
  isCancelled: boolean
  error?: unknown
}

/** Identity of the latest load or resume; kept while earlier releases finish. */
interface SessionClaim {
  readonly sessionId: string
}

const CANCELLED_TERMINAL = 'cancelled'
const FAILED_TERMINAL = 'failed'
// Turns that finished before `sendTurn` answered with their id; a few suffice.
const EARLY_FINISHES_KEPT = 8

function isContributorModel(modelId: string): boolean {
  return modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX)
}

/** The model a new session starts on: the backend's default, else the first listed. */
function startingModel(models: readonly ModelSummary[]): string {
  const model = models.find((candidate) => candidate.isDefault) ?? models[0]
  if (model === undefined) {
    throw RequestError.internalError(undefined, UI_TEXT.acpNoModels)
  }
  return model.modelId
}

/** The default effort where the model serves it, else the nearest tier it has. */
function servedEffort(modelId: string, wanted: EffortLevel): EffortLevel {
  const levels = effortLevelsFor(modelId)
  return levels.includes(wanted) ? wanted : (levels.at(-1) ?? DEFAULT_EFFORT)
}

/** One ACP session over one AgentSession. */
class AcpSession {
  private readonly translator: UpdateTranslator
  private readonly unsubscribe: () => void
  private readonly approvals = new Map<string, ApprovalRequest>()
  private readonly earlyFinishes = new Map<string, TurnCompleted>()
  private outbox: Promise<void> = Promise.resolve()
  private pending: PendingPrompt | undefined
  /**
   * A prompt before its turn starts, while the session's skills are first
   * announced: the session is busy, and a cancel ends the prompt there.
   */
  private preparing: PreparingPrompt | undefined
  private skills: readonly SkillSummary[] = []
  private areCommandsAnnounced = false
  private effort: EffortLevel = DEFAULT_EFFORT
  /** Let go (closed, loaded again, or never set up): the editor's late answers decide nothing. */
  private isDisposed = false
  /** A turn being started (`sendTurn` not yet answered): a release waits for it, then stops it. */
  private starting: Promise<unknown> | undefined
  public readonly sessionId: string

  public constructor(
    public readonly session: AgentSession,
    public readonly host: AgentHost,
    private readonly cwd: string,
    private readonly client: AgentContext,
    private readonly clientCapabilities: ClientCapabilities,
    private readonly models: readonly ModelSummary[],
    private readonly deps: AcpAgentDeps,
    private mode: PermissionMode,
    private modelId: string,
  ) {
    this.sessionId = session.sessionId
    this.translator = new UpdateTranslator(cwd, false)
    this.unsubscribe = session.onEvent((event) => {
      this.onEvent(event)
    })
  }

  /** Queues an update behind the ones before it: the client sees them in order. */
  private send(update: SessionUpdate): void {
    this.outbox = this.deliver(this.outbox, update)
  }

  private async deliver(previous: Promise<void>, update: SessionUpdate): Promise<void> {
    await previous
    if (this.isDisposed) {
      // Let go: nothing more reaches the editor for it, not even history
      // a load queued before a close or a newer load.
      return
    }
    try {
      await this.client.notify('session/update', { sessionId: this.sessionId, update })
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: an update was not sent: ${failureForLog(error)}`,
      )
    }
  }

  /** `/selector arguments` naming one of the session's skills runs that skill, as in the panel. */
  private withSkill(parts: TurnPart[]): TurnPart[] {
    const [first, ...rest] = parts
    if (first?.type !== 'text') {
      return parts
    }
    const selectors = new Set(this.skills.map((skill) => skill.selector))
    const invocation = parseSkillInvocation(first.text, selectors)
    if (invocation === undefined) {
      return parts
    }
    const skill: TurnPart =
      invocation.arguments === undefined
        ? { type: 'skill', selector: invocation.selector }
        : { type: 'skill', selector: invocation.selector, arguments: invocation.arguments }
    return [skill, ...rest]
  }

  private async announceCommands(): Promise<void> {
    if (this.areCommandsAnnounced) {
      return
    }
    this.areCommandsAnnounced = true
    await this.refreshCommands()
  }

  private async refreshCommands(): Promise<void> {
    try {
      this.skills = await this.session.listSkills()
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: skills unavailable: ${failureForLog(error)}`,
      )
      return
    }
    this.send({
      sessionUpdate: 'available_commands_update',
      availableCommands: this.skills.map((skill) => ({
        name: skill.selector,
        description: skill.description === '' ? skill.displayName : skill.description,
        input: skill.argumentHint === undefined ? null : { hint: skill.argumentHint },
      })),
    })
  }

  private onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'approvalRequested': {
        this.approvals.set(event.approvalId, event)
        void this.askPermission(event)
        return
      }
      case 'approvalUpdated': {
        const first = this.approvals.get(event.approvalId)
        if (first !== undefined) {
          const next: ApprovalRequest = {
            ...first,
            requirementId: event.requirementId,
            subject: event.subject,
            availableChoices: event.availableChoices,
          }
          this.approvals.set(event.approvalId, next)
          void this.askPermission(next)
        }
        return
      }
      case 'approvalResolved': {
        this.approvals.delete(event.approvalId)
        return
      }
      case 'questionRequested': {
        void this.ask(event)
        return
      }
      case 'turnCompleted': {
        this.finishTurn(event)
        return
      }
      case 'skillsChanged': {
        void this.refreshCommands()
        return
      }
      case 'modelChanged': {
        this.modelId = event.modelId
        this.send({ sessionUpdate: 'config_option_update', configOptions: this.configOptions() })
        return
      }
      case 'effortChanged': {
        if (isEffortLevel(event.effort)) {
          this.effort = event.effort
          this.send({ sessionUpdate: 'config_option_update', configOptions: this.configOptions() })
        }
        return
      }
      default: {
        for (const update of this.translator.updates(event)) {
          this.send(update)
        }
      }
    }
  }

  private noteTurnId(turnId: string): void {
    const pending = this.pending
    if (pending === undefined) {
      return
    }
    pending.turnId = turnId
    const early = this.earlyFinishes.get(turnId)
    if (early === undefined) {
      return
    }
    this.earlyFinishes.delete(turnId)
    this.settle(pending, early)
  }

  private finishTurn(event: TurnCompleted): void {
    const pending = this.pending
    if (pending?.turnId === event.turnId) {
      this.settle(pending, event)
      return
    }
    if (pending?.turnId !== undefined) {
      return
    }
    this.earlyFinishes.set(event.turnId, event)
    const [oldest] = this.earlyFinishes.keys()
    if (oldest !== undefined && this.earlyFinishes.size > EARLY_FINISHES_KEPT) {
      this.earlyFinishes.delete(oldest)
    }
  }

  /** ACP's answer to the prompt: cancelled whenever the client cancelled it (as the spec requires). */
  private settle(pending: PendingPrompt, event: TurnCompleted): void {
    this.pending = undefined
    if (pending.isCancelled || event.terminal === CANCELLED_TERMINAL) {
      pending.resolve('cancelled')
      return
    }
    if (event.terminal === FAILED_TERMINAL) {
      pending.reject(
        RequestError.internalError(undefined, event.reason ?? event.errorKind ?? event.terminal),
      )
      return
    }
    pending.resolve('end_turn')
  }

  private async askPermission(event: ApprovalRequest): Promise<void> {
    const pending = this.pending
    let choice = editAutomaticallyChoice(event, this.mode)
    if (choice === undefined) {
      let response: RequestPermissionResponse | undefined
      try {
        // The tool call the request names has gone out first.
        await this.outbox
        if (!this.isCurrentPrompt(pending) || this.approvals.get(event.approvalId) !== event) {
          return
        }
        response = permissionResponse(
          await this.client.request('session/request_permission', {
            sessionId: this.sessionId,
            toolCall: approvalToolCall(event, this.cwd),
            options: permissionOptions(event.availableChoices),
          }),
        )
      } catch (error: unknown) {
        this.deps.log.warn(
          `ACP session ${this.sessionId}: permission request failed, denying: ${failureForLog(error)}`,
        )
      }
      choice = decidedChoice(response, event.availableChoices)
    }
    if (!this.isCurrentPrompt(pending) || this.approvals.get(event.approvalId) !== event) {
      // Let go while the editor was asked: the answer is for a session it
      // no longer shows, which another session may now hold.
      return
    }
    if (choice === undefined) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: approval ${event.approvalId} offers no denial; stopping the turn`,
      )
      await this.cancel()
      return
    }
    try {
      await this.session.decideApproval({
        approvalId: event.approvalId,
        choiceId: choice.choiceId,
        requirementId: event.requirementId,
      })
    } catch (error: unknown) {
      const level = isPromptSettledError(error) ? 'info' : 'warn'
      this.deps.log[level](
        `ACP session ${this.sessionId}: approval ${event.approvalId}: ${failureForLog(error)}`,
      )
    }
  }

  private async ask(event: QuestionRequest): Promise<void> {
    const pending = this.pending
    try {
      if (this.clientCapabilities.elicitation?.form == null) {
        this.send({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: questionsText(event.questions) },
        })
      } else {
        const request: CreateElicitationRequest = {
          sessionId: this.sessionId,
          mode: 'form',
          message: UI_TEXT.acpQuestionFormMessage,
          requestedSchema: questionForm(event.questions),
        }
        const response = await this.client.request('elicitation/create', request)
        if (!this.isCurrentPrompt(pending)) {
          return
        }
        const answers = formAnswers(event.questions, response)
        if (answers !== undefined) {
          await this.session.answerQuestions(event.userInputId, answers)
          return
        }
        this.deps.log.info(
          `ACP session ${this.sessionId}: question ${event.userInputId} declined: the form came back without an answer that fits each question`,
        )
      }
      if (this.isCurrentPrompt(pending)) {
        await this.session.cancelQuestions(event.userInputId)
      }
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: question ${event.userInputId}: ${failureForLog(error)}`,
      )
      // A form that failed is declined, so the turn goes on without the answer.
      if (this.isCurrentPrompt(pending)) {
        await this.declineQuestions(event.userInputId)
      }
    }
  }

  /**
   * A session let go changes nothing more on the backend, which a newer
   * load may now hold, and replays nothing: the request fails instead.
   */
  private ensureHeld(): void {
    if (this.isDisposed) {
      throw RequestError.resourceNotFound(this.sessionId)
    }
  }

  /** A late answer belongs only to the prompt that asked, while that prompt still runs. */
  private isCurrentPrompt(pending: PendingPrompt | undefined): boolean {
    return !this.isDisposed && this.pending === pending && pending?.isCancelled !== true
  }

  private isCurrentPaidPrompt(
    pending: PendingPrompt | undefined,
    preparing: PreparingPrompt | undefined,
  ): boolean {
    return (
      this.isCurrentPrompt(pending) &&
      this.preparing === preparing &&
      preparing?.isCancelled !== true
    )
  }

  private async cancelTurn(): Promise<void> {
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`ACP session ${this.sessionId}: cancel failed: ${failureForLog(error)}`)
    }
  }

  private async declineQuestions(userInputId: string): Promise<void> {
    if (this.isDisposed) {
      return
    }
    try {
      await this.session.cancelQuestions(userInputId)
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: question ${userInputId} not declined: ${failureForLog(error)}`,
      )
    }
  }

  /**
   * The question before a paid use (M58, PLAN.md D48): a row naming what is
   * about to be billed and its price, and a permission prompt on it with the
   * popup's answers. Anything but Allow once or Allow always is Deny.
   */
  public async askPaidUse(request: PaidUseRequest, canRemember: boolean): Promise<PaidUseAnswer> {
    const pending = this.pending
    const preparing = this.preparing
    // Unique for the client's lifetime: a session loaded again starts afresh.
    const toolCallId = `${ACP_PAID_TOOL_CALL_PREFIX}${randomUUID()}`
    const { title, detail } = paidUseQuestion(request)
    const content = [{ type: 'content' as const, content: { type: 'text' as const, text: detail } }]
    this.send({
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      kind: 'other',
      status: 'pending',
      content,
    })
    let answer: PaidUseAnswer = 'deny'
    try {
      await this.outbox
      if (!this.isCurrentPaidPrompt(pending, preparing)) {
        return 'deny'
      }
      const params: RequestPermissionRequest = {
        sessionId: this.sessionId,
        toolCall: { toolCallId, title, status: 'pending', content },
        options: paidUseOptions(canRemember),
      }
      const response = await this.client.request('session/request_permission', params)
      // A session let go while the editor was asked is billed for nothing.
      answer = this.isCurrentPaidPrompt(pending, preparing)
        ? paidUseAnswer(permissionResponse(response), canRemember)
        : 'deny'
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: the paid-use question failed, denying: ${failureForLog(error)}`,
      )
    }
    this.send({
      sessionUpdate: 'tool_call_update',
      toolCallId,
      status: answer === 'deny' ? 'failed' : 'completed',
    })
    return answer
  }

  public modes(): SessionModeState {
    return {
      currentModeId: this.mode,
      availableModes: availablePermissionModes(this.deps.options.canBypass).map((mode) => ({
        id: mode,
        name: UI_TEXT.permissionModes[mode],
        description: permissionModeDetail(mode, this.deps.backend.kind),
      })),
    }
  }

  public configOptions(): SessionConfigOption[] {
    return [
      {
        id: ACP_CONFIG_IDS.model,
        name: UI_TEXT.groupModel,
        category: 'model',
        type: 'select',
        currentValue: this.modelId,
        options: this.models.map((model) => ({ value: model.modelId, name: model.displayLabel })),
      },
      {
        id: ACP_CONFIG_IDS.effort,
        name: UI_TEXT.effortItem,
        category: 'thought_level',
        type: 'select',
        currentValue: this.effort,
        options: effortLevelsFor(this.modelId).map((level) => ({
          value: level,
          name: effortLabel(level),
        })),
      },
    ]
  }

  /**
   * A loaded or resumed session made to run as the agent advertises it.
   * Everything shown comes from the backend's answer or an explicit set,
   * never from what the handle holds: Muse Code's resumed handle holds the
   * model the agent asked for, while the CLI keeps the one the session last
   * ran on. The permission mode shown is set; the model is the one the
   * backend reports active where the agent lists it, else the default, set
   * (a contributor model the agent hides is left); the effort shown is set.
   */
  public async matchAdvertised(): Promise<void> {
    this.ensureHeld()
    await this.session.setApprovalMode(approvalModeFor(this.mode, true))
    const reported = await this.host.listModels(this.sessionId)
    const active = reported.find((model) => model.isActive)
    if (active !== undefined && this.models.some((model) => model.modelId === active.modelId)) {
      this.modelId = active.modelId
    } else {
      const listed = startingModel(this.models)
      this.ensureHeld()
      await this.session.setModel(listed)
      this.modelId = listed
    }
    await this.applyEffort(this.effort)
  }

  /** The session's standing effort, as the panel sets it on a new session. */
  public async applyEffort(effort: EffortLevel): Promise<void> {
    const served = servedEffort(this.modelId, effort)
    this.ensureHeld()
    await this.session.setReasoningEffort(effortForThinking(served, true))
    this.effort = served
  }

  public async setMode(modeId: string): Promise<void> {
    const mode = availablePermissionModes(this.deps.options.canBypass).find(
      (candidate) => candidate === modeId,
    )
    if (mode === undefined) {
      throw RequestError.invalidParams(undefined, modeId)
    }
    this.ensureHeld()
    await this.session.setApprovalMode(approvalModeFor(mode, true))
    this.mode = mode
  }

  public async setConfigOption(configId: string, value: unknown): Promise<void> {
    if (typeof value !== 'string') {
      throw RequestError.invalidParams(undefined, configId)
    }
    if (configId === ACP_CONFIG_IDS.model) {
      if (this.models.every((model) => model.modelId !== value)) {
        throw RequestError.invalidParams(undefined, value)
      }
      this.ensureHeld()
      await this.session.setModel(value)
      this.modelId = value
      await this.applyEffort(this.effort)
      return
    }
    if (configId !== ACP_CONFIG_IDS.effort) {
      throw RequestError.invalidParams(undefined, configId)
    }
    if (!isEffortLevel(value) || !effortLevelsFor(this.modelId).includes(value)) {
      throw RequestError.invalidParams(undefined, value)
    }
    await this.applyEffort(value)
  }

  /** A loaded session's history, as the updates a live one would have sent. */
  public async replay(items: Parameters<UpdateTranslator['itemUpdates']>[0][]): Promise<void> {
    this.ensureHeld()
    const history = new UpdateTranslator(this.cwd, true)
    for (const item of items) {
      for (const update of history.itemUpdates(item, true)) {
        this.send(update)
      }
    }
    await this.outbox
  }

  public sendPlan(todos: Parameters<typeof planEntries>[0]): void {
    if (todos.length > 0) {
      this.send({ sessionUpdate: 'plan', entries: planEntries(todos) })
    }
  }

  public async prompt(blocks: readonly ContentBlock[]): Promise<StopReason> {
    this.ensureHeld()
    if (this.pending !== undefined || this.preparing !== undefined) {
      throw RequestError.invalidRequest(undefined, UI_TEXT.acpPromptBusy)
    }
    const parsed = promptParts(blocks, this.cwd)
    if (!parsed.ok) {
      throw RequestError.invalidParams(undefined, parsed.reason)
    }
    const preparing: PreparingPrompt = { isCancelled: false }
    this.preparing = preparing
    try {
      await this.announceCommands()
    } finally {
      this.preparing = undefined
    }
    if ('error' in preparing) {
      throw preparing.error
    }
    if (preparing.isCancelled) {
      await this.outbox
      return 'cancelled'
    }
    // Outcomes are values: a host exit before turn/start answers must not
    // reject a promise that the prompt has not yet reached (Node would exit).
    const finished = new Promise<PromptOutcome>((resolve) => {
      this.pending = {
        resolve: (reason) => {
          resolve({ reason })
        },
        reject: (error: unknown) => {
          resolve({ error })
        },
        turnId: undefined,
        isCancelled: false,
      }
    })
    try {
      const starting = this.session.sendTurn(this.withSkill(parsed.parts), parsed.displayText)
      this.starting = starting
      const submission = await starting
      this.noteTurnId(submission.turnId)
    } catch (error: unknown) {
      this.pending = undefined
      if (this.isDisposed) {
        // Let go while starting: a close cancels; a host exit fails.
        const outcome = await finished
        if ('error' in outcome) {
          throw outcome.error
        }
        return outcome.reason
      }
      throw error
    } finally {
      this.starting = undefined
    }
    const outcome = await finished
    if ('error' in outcome) {
      throw outcome.error
    }
    await this.outbox
    return outcome.reason
  }

  public async cancel(): Promise<void> {
    if (this.preparing !== undefined) {
      this.preparing.isCancelled = true
      this.deps.log.info(`ACP session ${this.sessionId}: cancelled before its turn started`)
      return
    }
    if (this.pending === undefined) {
      return
    }
    this.pending.isCancelled = true
    // Stopped once its start is answered, as in release(): a stop sent
    // while the turn is still starting finds no turn, and the turn would
    // then run on, editing and billing, while the editor is told it ended.
    try {
      await this.starting
    } catch {
      // The prompt that started it reports the failed start.
    }
    await this.cancelTurn()
  }

  /** The backend went away: the running prompt ends with its reason. */
  public hostExited(description: string): void {
    const error = RequestError.internalError(undefined, description)
    if (this.preparing !== undefined) {
      this.preparing.error = error
    }
    this.pending?.reject(error)
    this.pending = undefined
  }

  public get isReleased(): boolean {
    return this.isDisposed
  }

  /**
   * Let go (closed, loaded again, or never set up). At once it stops
   * following the backend, the editor's late answers decide nothing, and a
   * prompt it was running ends cancelled. That turn is then stopped on the
   * backend too, once it has started, as the editor was told; a turn left
   * running would go on editing and billing with no one watching, and a
   * session loaded again shares the backend session, so nothing else would
   * stop it. Then the backend session is let go.
   */
  public async release(): Promise<void> {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    if (this.preparing !== undefined) {
      this.preparing.isCancelled = true
    }
    const wasRunning = this.pending !== undefined
    this.pending?.resolve('cancelled')
    this.pending = undefined
    this.unsubscribe()
    if (wasRunning) {
      // Stopped once its start is answered, even a start that failed: one
      // past its deadline (Muse Code's `turn/start`) may still start.
      try {
        await this.starting
      } catch {
        // The prompt that started it has already ended cancelled.
      }
      await this.cancelTurn()
    }
    this.session.dispose()
  }
}

/** The agent's state across the connection: the client's capabilities and the live sessions. */
class AgentState {
  private readonly sessions = new Map<string, AcpSession>()
  /** Sessions being set up (`adopt`), by id: a newer load or a close lets them go too. */
  private readonly adopting = new Map<string, AcpSession>()
  private readonly claims = new Map<string, SessionClaim>()
  /** Remains visible even when the session is no longer available for requests. */
  private readonly releasing = new Map<string, Promise<unknown>>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
  private readonly exitedHosts = new WeakSet<AgentHost>()
  private clientCapabilities: ClientCapabilities = {}

  public constructor(private readonly deps: AcpAgentDeps) {}

  /**
   * The sign-in: run by the client in a terminal where it can (the spec
   * allows a terminal method only then), otherwise by the user, whose
   * `authenticate` this checks.
   */
  private authMethod(): AuthMethod {
    const { id, name, description, args, command } = this.deps.signIn
    return this.clientCapabilities.auth?.terminal === true
      ? { type: 'terminal', id, name, description, args: [...args] }
      : { id, name, description: fill(UI_TEXT.acpSignInByHand, { command }) }
  }

  private async requireReady(isRecheck = false): Promise<void> {
    const readiness = await this.deps.backend.readiness(isRecheck)
    if (readiness.state === 'signedOut') {
      throw RequestError.authRequired(undefined, readiness.message)
    }
    if (readiness.state === 'unavailable') {
      throw RequestError.internalError(undefined, readiness.message)
    }
  }

  private async openHost(
    cwd: string,
  ): Promise<{ readonly host: AgentHost; readonly models: readonly ModelSummary[] }> {
    if (!path.isAbsolute(cwd)) {
      throw RequestError.invalidParams(undefined, cwd)
    }
    await this.requireReady()
    const host = await this.deps.backend.hostFor(cwd)
    this.watch(host)
    const listed = await host.listModels()
    const models = this.deps.options.allowsContributorModels
      ? listed
      : listed.filter((model) => !isContributorModel(model.modelId))
    return { host, models }
  }

  /**
   * A backend session the agent now owns (new, loaded or resumed), held only
   * once `prepare` has set what the editor is shown: until then no request
   * finds it, and if anything fails the backend session is let go and the
   * request fails, so no session outlives a request that returned no id.
   */
  private async adopt(
    host: AgentHost,
    session: AgentSession,
    cwd: string,
    client: AgentContext,
    models: readonly ModelSummary[],
    claim: SessionClaim,
    prepare: (acp: AcpSession) => Promise<void>,
  ): Promise<AcpSession> {
    // A session loaded again replaces the one held, and one still being set
    // up by an earlier load, before anything runs on it: both hosts hand
    // back a session they hold, retained, so they would share it. Those stop
    // following it and answering at once (`release`); if this load then
    // fails, nothing is held for that id and the editor loads it again.
    const { sessionId } = session
    let acp: AcpSession | undefined
    try {
      this.ensureClaim(claim, host)
      // One shared barrier survives removal from the request maps. The
      // latest request alone can attach after the old turn is stopped.
      await this.releaseAll(sessionId)
      this.ensureClaim(claim, host)
      acp = new AcpSession(
        session,
        host,
        cwd,
        client,
        this.clientCapabilities,
        models,
        this.deps,
        this.deps.options.initialMode,
        session.modelId,
      )
      this.adopting.set(sessionId, acp)
      await prepare(acp)
      this.ensureClaim(claim, host)
      if (acp.isReleased) {
        // A newer load of this session, or a close, let it go meanwhile.
        throw RequestError.resourceNotFound(sessionId)
      }
    } catch (error: unknown) {
      if (acp === undefined) {
        session.dispose()
      } else {
        await acp.release()
      }
      if (this.claims.get(sessionId) === claim) {
        this.claims.delete(sessionId)
      }
      throw error
    } finally {
      if (this.adopting.get(sessionId) === acp) {
        this.adopting.delete(sessionId)
      }
    }
    this.sessions.set(sessionId, acp)
    return acp
  }

  private claimSession(sessionId: string): SessionClaim {
    const claim = { sessionId }
    this.claims.set(sessionId, claim)
    return claim
  }

  private ensureClaim(claim: SessionClaim, host: AgentHost): void {
    if (this.claims.get(claim.sessionId) !== claim || this.exitedHosts.has(host)) {
      throw RequestError.resourceNotFound(claim.sessionId)
    }
  }

  /**
   * Lets go of the session held for `sessionId` and one being set up, so no
   * request finds either; resolves once each has stopped its turn and let
   * its backend session go. False when there was neither.
   */
  private async releaseAll(sessionId: string): Promise<boolean> {
    const found = [this.sessions.get(sessionId), this.adopting.get(sessionId)].filter(
      (acp) => acp !== undefined,
    )
    this.sessions.delete(sessionId)
    this.adopting.delete(sessionId)
    const previous = this.releasing.get(sessionId)
    if (previous === undefined && found.length === 0) {
      return false
    }
    const released = Promise.all([previous, ...found.map((acp) => acp.release())])
    this.releasing.set(sessionId, released)
    try {
      await released
    } finally {
      if (this.releasing.get(sessionId) === released) {
        this.releasing.delete(sessionId)
      }
    }
    return true
  }

  private watch(host: AgentHost): void {
    if (this.watchedHosts.has(host)) {
      return
    }
    this.watchedHosts.add(host)
    host.onExit((exit) => {
      this.exitedHosts.add(host)
      this.deps.log.warn(`The ${host.info.kind} backend stopped: ${exit.description}`)
      for (const [sessionId, acp] of [...this.sessions, ...this.adopting]) {
        if (acp.host !== host) {
          continue
        }
        acp.hostExited(exit.description)
        this.claims.delete(sessionId)
        void this.releaseAll(sessionId)
      }
    })
  }

  /**
   * The editor's MCP servers for a session (M63c): passed to Muse Code when
   * it granted `sessionMcp`; the Model API backend runs none. Only their
   * names are logged, as headers and environments can hold secrets.
   */
  private forwardedMcp(
    host: AgentHost,
    requested: readonly McpServer[] | undefined,
  ): Readonly<Record<string, SessionMcpServer>> | undefined {
    if (requested === undefined || requested.length === 0) {
      return undefined
    }
    const names = requested.map((server) => server.name).join(', ')
    if (host.info.kind !== 'museCode') {
      this.deps.log.warn(
        `MCP servers from the editor not passed on (${names}): the ${host.info.kind} backend runs none`,
      )
      return undefined
    }
    if (!host.info.grantedCapabilities.includes(SESSION_MCP_CAPABILITY)) {
      this.deps.log.warn(
        `MCP servers from the editor not passed on (${names}): Muse Code did not grant ${SESSION_MCP_CAPABILITY}`,
      )
      return undefined
    }
    const { servers, skipped } = mcpServersFrom(requested)
    if (skipped.length > 0) {
      this.deps.log.warn(
        `MCP servers from the editor left out (SSE, or a name used twice): ${skipped.join(', ')}`,
      )
    }
    this.deps.log.info(`MCP servers from the editor: ${Object.keys(servers).join(', ')}`)
    return servers
  }

  public initialize(clientCapabilities: ClientCapabilities | undefined): InitializeResponse {
    this.clientCapabilities = clientCapabilities ?? {}
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true, audio: false, embeddedContext: true },
        // Stdio servers every agent takes; HTTP ones Muse Code runs too (M63c).
        mcpCapabilities: { http: this.deps.backend.kind === 'museCode', sse: false },
        sessionCapabilities: { list: {}, resume: {}, close: {} },
      },
      authMethods: [this.authMethod()],
      agentInfo: { name: ACP_AGENT_NAME, title: ACP_AGENT_TITLE, version: this.deps.version },
    }
  }

  /** Confirms the sign-in took; the client asks again if not. */
  public async authenticate(): Promise<Record<string, never>> {
    await this.requireReady(true)
    return {}
  }

  public async newSession(
    cwd: string,
    requestedMcp: readonly McpServer[] | undefined,
    client: AgentContext,
  ) {
    const { host, models } = await this.openHost(cwd)
    const modelId = startingModel(models)
    const mcpServers = this.forwardedMcp(host, requestedMcp)
    const session = await host.startSession({
      workspaceRoot: cwd,
      modelId,
      approvalMode: approvalModeFor(this.deps.options.initialMode, true),
      ...(mcpServers !== undefined && { mcpServers }),
    })
    // The mode and model went with the start; the effort is set here.
    const claim = this.claimSession(session.sessionId)
    const acp = await this.adopt(host, session, cwd, client, models, claim, (started) =>
      started.applyEffort(DEFAULT_EFFORT),
    )
    return { sessionId: session.sessionId, modes: acp.modes(), configOptions: acp.configOptions() }
  }

  public async loadSession(
    sessionId: string,
    cwd: string,
    requestedMcp: readonly McpServer[] | undefined,
    client: AgentContext,
    isReplayed: boolean,
  ) {
    // Claimed before backend I/O: a slow older resume cannot replace a
    // newer request, and a close can invalidate one still loading.
    const claim = this.claimSession(sessionId)
    try {
      const { host, models } = await this.openHost(cwd)
      this.ensureClaim(claim, host)
      const loaded = await host.resumeSession(
        sessionId,
        startingModel(models),
        this.forwardedMcp(host, requestedMcp),
      )
      // A session resumes on the approval mode, model and effort it last had,
      // which may differ from what the editor is told (a more permissive mode,
      // a hidden model): they are set before anything is replayed, as the
      // panel sets its own on a resume. Nothing is shown that does not run:
      // if the backend refuses, the load fails instead.
      const acp = await this.adopt(
        host,
        loaded.session,
        cwd,
        client,
        models,
        claim,
        async (resumed) => {
          await resumed.matchAdvertised()
          if (!isReplayed) {
            return
          }
          await resumed.replay([...loaded.history.items])
          resumed.sendPlan(loaded.history.todos)
        },
      )
      return { modes: acp.modes(), configOptions: acp.configOptions() }
    } catch (error: unknown) {
      if (this.claims.get(sessionId) === claim) {
        this.claims.delete(sessionId)
      }
      throw error
    }
  }

  public async listSessions(
    cwd: string | undefined,
    cursor: string | undefined,
  ): Promise<ListSessionsResponse> {
    const folder = cwd ?? this.deps.defaultCwd
    const { host } = await this.openHost(folder)
    const page = await host.listSessions({
      workspaceRoot: folder,
      limit: ACP_SESSION_LIST_LIMIT,
      ...(cursor !== undefined && { cursor }),
    })
    return {
      sessions: page.sessions.map((record) => ({
        sessionId: record.sessionId,
        cwd: record.workspaceRoot ?? folder,
        title: record.name ?? record.title ?? record.firstUserPrompt ?? null,
        updatedAt: record.lastActivityAt ?? record.updatedAt,
      })),
      nextCursor: page.nextCursor ?? null,
    }
  }

  public session(sessionId: string): AcpSession {
    const found = this.held(sessionId)
    if (found === undefined) {
      throw RequestError.resourceNotFound(sessionId)
    }
    return found
  }

  /** The session held under this id, if any (none while it is being set up). */
  public held(sessionId: string): AcpSession | undefined {
    return this.sessions.get(sessionId)
  }

  /** The editor closes a session: the one held, or one still being set up. */
  public async closeSession(sessionId: string): Promise<void> {
    const wasClaimed = this.claims.delete(sessionId)
    const wasReleased = await this.releaseAll(sessionId)
    if (!wasClaimed && !wasReleased) {
      throw RequestError.resourceNotFound(sessionId)
    }
  }

  /** A paid use asked in the session it is for; one the agent does not hold is denied (M58). */
  public async askPaidUse(
    sessionId: string,
    request: PaidUseRequest,
    canRemember: boolean,
  ): Promise<PaidUseAnswer> {
    const acp = this.sessions.get(sessionId)
    if (acp === undefined) {
      this.deps.log.warn(
        `Paid use of ${request.feature}: no editor session ${sessionId} to ask in, so it is denied`,
      )
      return 'deny'
    }
    return await acp.askPaidUse(request, canRemember)
  }
}

/** The agent: register it on a stream with `connect`. */
export function createAcpAgent(deps: AcpAgentDeps): AgentApp {
  const state = new AgentState(deps)
  deps.paid.attach((sessionId, request, canRemember) =>
    state.askPaidUse(sessionId, request, canRemember),
  )
  return acpAgent({ name: ACP_AGENT_NAME })
    .onRequest('initialize', (context) => state.initialize(context.params.clientCapabilities))
    .onRequest('authenticate', () => state.authenticate())
    .onRequest('session/new', (context) =>
      state.newSession(context.params.cwd, context.params.mcpServers, context.client),
    )
    .onRequest('session/load', (context) => {
      const { sessionId, cwd, mcpServers } = context.params
      return state.loadSession(sessionId, cwd, mcpServers, context.client, true)
    })
    .onRequest('session/resume', (context) => {
      const { sessionId, cwd, mcpServers } = context.params
      return state.loadSession(sessionId, cwd, mcpServers ?? undefined, context.client, false)
    })
    .onRequest('session/list', (context) =>
      state.listSessions(context.params.cwd ?? undefined, context.params.cursor ?? undefined),
    )
    .onRequest('session/close', async (context) => {
      await state.closeSession(context.params.sessionId)
      return {}
    })
    .onRequest('session/set_mode', async (context) => {
      await state.session(context.params.sessionId).setMode(context.params.modeId)
      return {}
    })
    .onRequest('session/set_config_option', async (context) => {
      const session = state.session(context.params.sessionId)
      await session.setConfigOption(context.params.configId, context.params.value)
      return { configOptions: session.configOptions() }
    })
    .onRequest('session/prompt', async (context) => ({
      stopReason: await state.session(context.params.sessionId).prompt(context.params.prompt),
    }))
    .onNotification('session/cancel', async (context) => {
      // A notification has no answer: a cancel for a session already
      // closed, still being set up, or never held stops nothing.
      await state.held(context.params.sessionId)?.cancel()
    })
}
