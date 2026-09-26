// The Muse Spark agent over the Agent Client Protocol (PLAN.md D62): one
// client on stdio, any number of sessions, each an AgentSession of the
// backend chosen at launch. The client's editor shows the chat, the tool
// calls, the plan and the permission prompts; the backend runs the tools.
//
// What the panel guarantees holds here too: an approval is decided only
// with a choice the backend offered, and one the client did not answer is
// denied (D62); "Edit automatically" answers only what the panel's rule
// allows (`editAutomaticallyChoice`, D24); paid features stay off (D60).
// Every update of a turn goes out before the turn's response.

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
  type RequestPermissionResponse,
  type SessionConfigOption,
  type SessionModeState,
  type SessionUpdate,
  type StopReason,
} from '@agentclientprotocol/sdk'
import {
  type AgentHost,
  type AgentSession,
  PromptSettledError,
  type ModelSummary,
  type SessionMcpServer,
  type SkillSummary,
  type TurnPart,
} from '../core/agent/agentBackend'
import { editAutomaticallyChoice } from '../core/agent/approvalRules'
import type { CoreLogger } from '../core/logging'
import type { AgentEvent } from '../shared/agentEvents'
import {
  ACP_AGENT_NAME,
  ACP_AGENT_TITLE,
  ACP_CONFIG_IDS,
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
import {
  approvalModeFor,
  availablePermissionModes,
  permissionModeDetail,
} from '../shared/permissionModes'
import { formAnswers, questionForm, questionsText } from './questions'
import {
  approvalToolCall,
  decidedChoice,
  mcpServersFrom,
  permissionOptions,
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
  readonly readiness: () => Promise<BackendReadiness>
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

const CANCELLED_TERMINAL = 'cancelled'
const FAILED_TERMINAL = 'failed'
// Turns that finished before `sendTurn` answered with their id; a few suffice.
const EARLY_FINISHES_KEPT = 8

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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
  private skills: readonly SkillSummary[] = []
  private areCommandsAnnounced = false
  private effort: EffortLevel = DEFAULT_EFFORT
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
    try {
      await this.client.notify('session/update', { sessionId: this.sessionId, update })
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: an update was not sent: ${describe(error)}`,
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
      this.deps.log.warn(`ACP session ${this.sessionId}: skills unavailable: ${describe(error)}`)
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
    let choice = editAutomaticallyChoice(event, this.mode)
    if (choice === undefined) {
      let response: RequestPermissionResponse | undefined
      try {
        // The tool call the request names has gone out first.
        await this.outbox
        response = await this.client.request('session/request_permission', {
          sessionId: this.sessionId,
          toolCall: approvalToolCall(event, this.cwd),
          options: permissionOptions(event.availableChoices),
        })
      } catch (error: unknown) {
        this.deps.log.warn(
          `ACP session ${this.sessionId}: permission request failed, denying: ${describe(error)}`,
        )
      }
      choice = decidedChoice(response, event.availableChoices)
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
      const level = error instanceof PromptSettledError ? 'info' : 'warn'
      this.deps.log[level](
        `ACP session ${this.sessionId}: approval ${event.approvalId}: ${describe(error)}`,
      )
    }
  }

  private async ask(event: QuestionRequest): Promise<void> {
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
        const answers = formAnswers(event.questions, response)
        if (answers !== undefined) {
          await this.session.answerQuestions(event.userInputId, answers)
          return
        }
      }
      await this.session.cancelQuestions(event.userInputId)
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: question ${event.userInputId}: ${describe(error)}`,
      )
    }
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

  /** The session's standing effort, as the panel sets it on a new session. */
  public async applyEffort(effort: EffortLevel): Promise<void> {
    const served = servedEffort(this.modelId, effort)
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
    if (this.pending !== undefined) {
      throw RequestError.invalidRequest(undefined, UI_TEXT.acpPromptBusy)
    }
    const parsed = promptParts(blocks, this.cwd)
    if (!parsed.ok) {
      throw RequestError.invalidParams(undefined, parsed.reason)
    }
    await this.announceCommands()
    const finished = new Promise<StopReason>((resolve, reject) => {
      this.pending = { resolve, reject, turnId: undefined, isCancelled: false }
    })
    try {
      const submission = await this.session.sendTurn(
        this.withSkill(parsed.parts),
        parsed.displayText,
      )
      this.noteTurnId(submission.turnId)
    } catch (error: unknown) {
      this.pending = undefined
      throw error
    }
    const reason = await finished
    await this.outbox
    return reason
  }

  public async cancel(): Promise<void> {
    if (this.pending === undefined) {
      return
    }
    this.pending.isCancelled = true
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`ACP session ${this.sessionId}: cancel failed: ${describe(error)}`)
    }
  }

  /** The backend went away: the running prompt ends with its reason. */
  public hostExited(description: string): void {
    this.pending?.reject(RequestError.internalError(undefined, description))
    this.pending = undefined
  }

  public dispose(): void {
    this.unsubscribe()
    this.session.dispose()
  }
}

/** The agent's state across the connection: the client's capabilities and the live sessions. */
class AgentState {
  private readonly sessions = new Map<string, AcpSession>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
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

  private async requireReady(): Promise<void> {
    const readiness = await this.deps.backend.readiness()
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

  private register(
    host: AgentHost,
    session: AgentSession,
    cwd: string,
    client: AgentContext,
    models: readonly ModelSummary[],
  ): AcpSession {
    const acp = new AcpSession(
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
    // A session loaded again replaces the one held, which stops listening.
    this.sessions.get(session.sessionId)?.dispose()
    this.sessions.set(session.sessionId, acp)
    return acp
  }

  private watch(host: AgentHost): void {
    if (this.watchedHosts.has(host)) {
      return
    }
    this.watchedHosts.add(host)
    host.onExit((exit) => {
      this.deps.log.warn(`The ${host.info.kind} backend stopped: ${exit.description}`)
      for (const [sessionId, acp] of this.sessions) {
        if (acp.host !== host) {
          continue
        }
        acp.hostExited(exit.description)
        this.sessions.delete(sessionId)
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
    await this.requireReady()
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
    const acp = this.register(host, session, cwd, client, models)
    await acp.applyEffort(DEFAULT_EFFORT)
    return { sessionId: session.sessionId, modes: acp.modes(), configOptions: acp.configOptions() }
  }

  public async loadSession(
    sessionId: string,
    cwd: string,
    requestedMcp: readonly McpServer[] | undefined,
    client: AgentContext,
    isReplayed: boolean,
  ) {
    const { host, models } = await this.openHost(cwd)
    const loaded = await host.resumeSession(
      sessionId,
      startingModel(models),
      this.forwardedMcp(host, requestedMcp),
    )
    const acp = this.register(host, loaded.session, cwd, client, models)
    if (isReplayed) {
      await acp.replay([...loaded.history.items])
      acp.sendPlan(loaded.history.todos)
    }
    return { modes: acp.modes(), configOptions: acp.configOptions() }
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
    const found = this.sessions.get(sessionId)
    if (found === undefined) {
      throw RequestError.resourceNotFound(sessionId)
    }
    return found
  }

  public closeSession(sessionId: string): void {
    this.session(sessionId).dispose()
    this.sessions.delete(sessionId)
  }
}

/** The agent: register it on a stream with `connect`. */
export function createAcpAgent(deps: AcpAgentDeps): AgentApp {
  const state = new AgentState(deps)
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
    .onRequest('session/close', (context) => {
      state.closeSession(context.params.sessionId)
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
      await state.session(context.params.sessionId).cancel()
    })
}
