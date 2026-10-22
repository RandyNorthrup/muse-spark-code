import { estimateFailureText } from '../shared/estimateDiagnostic'
import type { UsdAmount } from '../shared/usdSchema'
import { vaultApprovalText } from '../runtime/vault/vaultApproval'
// The Muse Spark agent over the Agent Client Protocol (PLAN.md D62): one
// client on stdio, any number of sessions, each an AgentSession of the
// backend chosen at launch. The client's editor shows the chat, the tool
// calls, the plan and the permission prompts; the backend runs the tools.
//
// What the panel guarantees holds here too: an approval is decided only
// with a choice the backend offered, and one the client did not answer is
// denied (D62); "Edit Automatically" answers only what the panel's rule
// allows (`editAutomaticallyChoice`, D24); a paid feature is on only with
// its flag, and each use asks in the editor first, naming its price (M58,
// paid.ts). Every update of a turn goes out before the turn's response.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { UsageAdapter } from '../runtime/usage/usageAdapter'
import type { VoiceCompanion, VoiceCompanionContext } from '../runtime/companion/voiceEntry'
import { agentListingText, listedAgents, listedAgentId } from '../core/agent/agentListing'
import { parseWhatsNewContent } from '../core/whatsNew/whatsNewContent'
import { whatsNewTextForContent } from '../core/whatsNew/whatsNewText'
import { buildAgentReceipt } from '../shared/agentReceipt'
import { recoveryStamp } from '../shared/agentRecovery'
import { agentStateText } from '../shared/agentOutcome'
import { compactReference } from '../shared/cliCommands'
import type { AcpSchedulePort } from './schedules'
import path from 'node:path'
import { type AcpPlaybookBundle, acpPlaybook } from './playbook'
import { signInLossFailure } from './signInLoss'
import type { PlaybookSurfacePort } from '../runtime/playbook/command'
import {
  agent as acpAgent,
  type AgentApp,
  type AvailableCommand,
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
  isModeKeptError,
  isPermissionReviewerError,
  isPromptSettledError,
  type ModelSummary,
  type SessionMcpServer,
  type SkillSummary,
  type TurnPart,
  type TurnSubmission,
} from '../core/agent/agentBackend'
import { editAutomaticallyChoice } from '../core/agent/approvalRules'
import { failureForLog } from '../core/backends/musecode/logText'
import { wireWordForLog } from '../core/logging'
import { resolveResumedModel } from '../core/backends/musecode/resumedModel'
import {
  isLinuxSandboxBlocked,
  type LinuxSandboxReadiness,
} from '../core/backends/musecode/sandbox'
import { unlessAborted } from '../core/timeouts'
import type { CoreLogger } from '../core/logging'
import { type PaidUseAnswer, paidUseQuestion } from '../core/paid/paidConsent'
import type { AgentEvent } from '../shared/agentEvents'
import { parsePlaybackPrompt } from '../shared/playbackCommand'
import { playbackTurnText } from '../core/playback/playbackPrompt'
import {
  ACP_AGENT_NAME,
  ACP_AGENT_TITLE,
  ACP_COMPACT_COMMAND,
  ACP_CONFIG_IDS,
  ACP_PAID_TOOL_CALL_PREFIX,
  ACP_QUESTIONS_BUNDLE_FILE,
  ACP_SESSION_LIST_LIMIT,
  type AcpBackendKind,
  AUTH_REQUIRED_ERROR_KIND,
  type ReportEventKind,
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_EFFORT,
  type EffortLevel,
  MSP_REQUESTED_CAPABILITIES,
  SCHEDULE_ACP_RELEASE_TIMEOUT_MS,
  type PermissionMode,
  QUESTION_DEFER_DEFAULT_SECONDS,
  SANDBOX_CANNOT_START_MODEL_NOTE,
  UI_TEXT,
  SLASH_COMMAND_NAMES,
  WHATS_NEW_CONTENT_FILE,
} from '../shared/constants'
import { isCredentialStoreDown } from '../host/auth/credentialStore'
import { effortForThinking, effortLabel, effortLevelsFor, isEffortLevel } from '../shared/effort'
import { fill, formatBytes, formatUnit, uiLocale } from '../shared/l10n/text'
import type { AcpAttachment, AcpMediaFactory, AcpMediaPort } from './media'
import { MediaRefusal } from './media'
import { UserRefusalError } from '../shared/refusal'
import { parseSkillInvocation, slashCommandText } from '../shared/mentions'
import { sessionTitle } from '../shared/sessions'
import type { PaidUseRequest } from '../shared/paid'
import {
  approvalModeFor,
  availablePermissionModes,
  composerModeForApprovalMode,
  mspStartPermissionProfile,
  permissionModeDetail,
} from '../shared/permissionModes'
import { type AcpPaidUse, paidUseAnswer, paidUseOptions } from './paid'
import { acpResourceCommand, acpResourceUpdates, resourceCommands } from './resources'
import type { RuntimeResources } from '../runtime/resources/port'
import { resourceStatusText } from '../runtime/resources/text'
import type {
  AcpQuestionDeferral,
  AcpQuestionRegistry,
  AcpQuestionRegistryFactory,
  AcpQueuedAnswerLease,
} from './questionDeferral'
import {
  AcpAccounts,
  accountErrorText,
  isAccountSwitchRefusedError,
  type AccountsSessionPort,
} from './accounts'
import { isInvalidProvidersFileError } from './accountText'
import { runUploadsCommand, type AcpUploadsPort } from './uploads'
import {
  acpQuestionClock,
  questionDeferralLoader,
  type AcpQuestionBundle,
} from './questionDeferralBundle'
import type { QuestionClock } from '../shared/questions'
import {
  approvalToolCall,
  decidedChoice,
  isMediaLink,
  mcpServersFrom,
  permissionOptions,
  permissionResponse,
  planEntries,
  PART_SEPARATOR,
  promptParts,
  UpdateTranslator,
} from './translate'
import { adoptedMode, answerChoice, ApprovalAnswers } from './permissionAsk'
import type { AcpSharingPort } from './sharing'
import { acpReportArguments, runAcpReport, type AcpReportsPort } from './reports'
import { type AcpVault, vaultPermissionAnswer, vaultPermissionOptions, vaultSlash } from './vault'
import { type VaultApprovalRequest, type VaultApprovalAnswer } from '../shared/vault'
import type { AcpEstimatePort } from './estimate'

// Muse Code runs a session's MCP servers only with this grant (M63c).
const [SESSION_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES

/** Whether the backend can start a session now, and what the user must do if not. */
export type BackendReadiness =
  | { readonly state: 'ready' }
  | {
      readonly state: 'signedOut'
      readonly message: string
      /**
      The credential store itself cannot be read, so no stored key could
      be checked. A session may still open: only a step that needs a
      stored key refuses, in this message's words.
      */
      readonly storeDown?: true
    }
  | { readonly state: 'unavailable'; readonly message: string }

/** The backend the agent was started on (the runtime builds it, D62). */
export interface AcpBackend {
  readonly kind: AcpBackendKind
  /** `isRecheck`: the user says they signed in, so nothing said before counts (`authenticate`). */
  readonly readiness: (isRecheck: boolean, modelHint?: string) => Promise<BackendReadiness>
  /** The host for a folder, started on first use. */
  readonly hostFor: (cwd: string) => Promise<AgentHost>
  /**
  What the Linux capability probe measured (F91); absent where it does
  not apply, while no host has started, or where the backend predates it.
  */
  readonly shellSandboxReadiness?: (cwd: string) => LinuxSandboxReadiness | undefined
}

export interface AcpAgentOptions {
  /** Bypass permissions is offered (`--allow-dangerously-skip-permissions`). */
  readonly canBypass: boolean
  /**
  Contributor-tier models are listed, and a named contributor-tier id is
  attempted even when the CLI's catalogue omits it
  (`--allow-contributor-models`).
  */
  readonly allowsContributorModels: boolean
  readonly initialMode: PermissionMode
  readonly initialModelId?: string
  readonly questionsDeferAfterSeconds?: number
  readonly scheduleAuthorization?: {
    readonly scheduledPrompts: boolean
    readonly maxBudgetUsd?: UsdAmount
  }
  /** Headless exec cannot invoke user entry points, even through a prompt. */
  readonly isHeadless?: boolean
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
  /** Terminal provider actions verify their own local result, independently of Meta. */
  readonly verify?: () => Promise<string | undefined>
}

export interface AcpAgentDeps {
  readonly legalScan?:
    | ((
        cwd: string,
        signal: AbortSignal,
        isRegistryOn: boolean,
        canLookupRegistry: (hosts: readonly string[]) => Promise<boolean>,
      ) => Promise<string>)
    | undefined

  readonly onClientName?: (name: string) => void
  /** Shared journal/service, required lazily on the local /usage command. */
  readonly usage?: Pick<UsageAdapter, 'access' | 'openPage'>
  readonly dictation?: (context: VoiceCompanionContext) => Promise<VoiceCompanion>
  /** The account upload ledger, required lazily on the local /uploads command. */
  readonly uploads?: AcpUploadsPort
  /** I binds P's durable, authorized workspace/team adapter. */
  readonly playbookFor?: (cwd: string, sessionId: string) => PlaybookSurfacePort
  readonly schedules?: AcpSchedulePort
  /** I binds P's local /playbook parsing and rendering (the journal bundle). */
  readonly playbookBundle?: () => AcpPlaybookBundle
  /** H-W-SESSION: one profile-owned account service, bound to this backend. */
  readonly accounts?: AccountsSessionPort
  readonly vault?: AcpVault
  readonly backend: AcpBackend
  readonly version: string
  readonly options: AcpAgentOptions
  readonly signIn: SignInMethod
  readonly providerSignIns?: readonly SignInMethod[]
  /**
  Ends what `logout` can besides held sessions: removing the credential
  the agent itself keeps. Absent where that credential is not the
  agent's to remove (the Muse Code CLI's sign-in).
  */
  readonly signOut?: () => Promise<void>
  /** The folder a `session/list` without one lists (the agent's own). */
  readonly defaultCwd: string
  /** The flagged paid features; the agent asks before each use (M63c, M58). */
  readonly paid: AcpPaidUse
  readonly log: CoreLogger
  /** The process-wide lazy governor; subscriptions do not start it. */
  readonly resources?: RuntimeResources
  /** M118-X-ACP: P/C storage/rendering and the host's explicit preview/insert bridge. */
  readonly sharing?: AcpSharingPort
  /** Required Q/runtime binding: portable registry plus durable idle-answer queue. */
  readonly questions: AcpQuestionRegistryFactory | 'decline'
  readonly questionClock?: QuestionClock
  /** Same-build factory loader; tests inject the source factory. */
  readonly questionBundle?: () => AcpQuestionBundle
  /** W's lazy runtime binding; absent media entry points refuse before dispatch. */
  readonly media?: AcpMediaFactory
  /**
  Report a problem (M93 lane A, PLAN.md D72): facts-only error observation
  for the standalone report's journal. The runtime wires this to its local
  recorder adapter in ACP mode; the report subcommand reads it back. The
  observer receives a fixed event kind and a fixed short code per failure
  site — never a message, stack, path, prompt or session id — so observing
  cannot leak what the scrub would remove. It runs after the log call,
  never touches ACP stdout, and a throwing observer never breaks the
  session. Absent, the agent behaves exactly as before.
  */
  readonly reportError?: (fact: AcpErrorFact) => void
  /** M113's lazy deterministic engine, scoped to this session's workspace. */
  readonly reports?: AcpReportsPort
  /** M117: supplied by the lazy estimator loader; absence is reported locally. */
  readonly estimate?: AcpEstimatePort
}

/** One observed failure as facts: a fixed kind and a fixed short code, nothing else. */
export interface AcpErrorFact {
  readonly kind: ReportEventKind
  readonly code: string
}

/** Hands one fixed code to the error observer; a throwing observer never breaks the session. */
function observeError(deps: AcpAgentDeps, code: string): void {
  const report = deps.reportError
  if (report === undefined) {
    return
  }
  try {
    report({ kind: 'errorNotice', code })
  } catch {
    // Observing never breaks the session it watches.
  }
}

type ApprovalRequest = Extract<AgentEvent, { type: 'approvalRequested' }>
type QuestionRequest = Extract<AgentEvent, { type: 'questionRequested' }>
type ElicitationRequest = Extract<AgentEvent, { type: 'elicitationRequested' }>
type TurnCompleted = Extract<AgentEvent, { type: 'turnCompleted' }>

interface PendingPrompt {
  readonly resolve: (reason: StopReason) => void
  readonly reject: (error: unknown) => void
  turnId: string | undefined
  isCancelled: boolean
  answerLease?: AcpQueuedAnswerLease | undefined
  userMessageId?: string
  readonly earlyAdmissions: Set<string>
  answerCommit?: Promise<void>
}

type PromptOutcome = { readonly reason: StopReason } | { readonly error: unknown }

interface PreparingPrompt {
  isCancelled: boolean
  readonly abort: AbortController
  error?: unknown
  abandonElicitation?: () => void
  readonly reportAbort?: AbortController
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

/**
The bundle loader's refusal: the legal scanner that could not load (its
cause stays in the log). Only this failure says the scan could not run.
*/
export function isLegalScanUnavailable(error: unknown): boolean {
  return error instanceof Error && error.message === UI_TEXT.legalScanUnavailable
}

function accountRequestError(error: unknown): RequestError {
  // A refused switch is user-actionable (the session kept its account), not
  // an internal failure: answer invalidRequest with the stay-put text.
  if (isAccountSwitchRefusedError(error))
    return RequestError.invalidRequest(undefined, error.message)
  const text = accountErrorText(error)
  return text === UI_TEXT.accounts.invalidAccount
    ? RequestError.invalidParams(undefined, text)
    : RequestError.internalError(undefined, text)
}

/**
Configured provider defaults never fall through to another model. The
default is the backend's, else the first listed — among models that can
run the coding agent (F83). A limited model starts a session only when
nothing usable is listed, where its first turn is refused with the
limit's own sentence.
*/
function startingModel(
  models: readonly ModelSummary[],
  requested?: string,
  isStrict = false,
): string {
  if (requested !== undefined) {
    const matches = models.filter(
      (model) =>
        model.modelId === requested ||
        model.modelId.slice(model.modelId.indexOf('/') + 1) === requested,
    )
    if (matches.length === 1 && matches[0] !== undefined) return matches[0].modelId
    // D4: an unknown model names what runs instead of one generic sentence.
    // The provider-aware sentences live in runExec's pre-session check; the
    // session backstop names this backend's models for any unmatched ref.
    throw RequestError.invalidParams(
      undefined,
      fill(UI_TEXT.execModelAvailable, {
        model: requested,
        available: models.map((model) => model.modelId).join(', '),
      }),
    )
  }
  const usable = models.filter((candidate) => candidate.agentLimit === undefined)
  const pool = usable.length > 0 ? usable : models
  const model =
    pool.find((candidate) => candidate.isDefault && candidate.modelId.includes('/')) ??
    pool.find((candidate) => candidate.isDefault) ??
    (isStrict ? undefined : pool[0])
  if (model === undefined) {
    if (pool.length === 0) throw RequestError.internalError(undefined, UI_TEXT.acpNoModels)
    throw RequestError.invalidParams(
      undefined,
      `${UI_TEXT.execProviderModelRequired}: ${models.map((candidate) => candidate.modelId).join(', ')}`,
    )
  }
  return model.modelId
}

/** The tiers a model serves: its own list where the backend knows it. */
export function modelEffortLevels(
  models: readonly ModelSummary[],
  modelId: string,
): readonly EffortLevel[] {
  return effortLevelsFor(modelId, models.find((model) => model.modelId === modelId)?.effortLevels)
}

/**
The refusal an editor reads for a level the model does not serve: the
sentence plus the levels it does serve, the same words headless `exec`
refuses with, so both surfaces name the choice.
*/
export function effortRefusalData(models: readonly ModelSummary[], modelId: string): string {
  return `${UI_TEXT.execEffortUnavailable} --effort: ${modelEffortLevels(models, modelId).join(', ')}`
}

/**
The level a new session selects: the model's own default where the
backend knows it and serves it, else the standing default (a chosen
level still wins: applyEffort keeps every tier the model serves).
*/
export function defaultEffortFor(
  models: readonly ModelSummary[],
  modelId: string,
  chosen?: EffortLevel,
): EffortLevel {
  const summary = models.find((model) => model.modelId === modelId)
  const levels = effortLevelsFor(modelId, summary?.effortLevels)
  if (chosen !== undefined && levels.includes(chosen)) return chosen
  const fallback = summary?.defaultEffort
  return fallback !== undefined &&
    effortLevelsFor(modelId, summary?.effortLevels).includes(fallback)
    ? fallback
    : DEFAULT_EFFORT
}

/**
One announced command per skill. The CLI lists a plugin's lone skill
twice (the bare plugin name and the self-qualified `name:name` selector
with the same text), and may repeat a selector. Keep the first entry
for each exact selector; collapse a self-qualified alias only when its
bare form reads the same. Distinct selectors with different text stay.
*/
export function dedupeSkillSelectors(skills: readonly SkillSummary[]): readonly SkillSummary[] {
  const kept: SkillSummary[] = []
  const seen = new Set<string>()
  for (const skill of skills) {
    if (seen.has(skill.selector)) continue
    seen.add(skill.selector)
    kept.push(skill)
  }
  return kept.filter((skill) => {
    const separator = skill.selector.indexOf(':')
    if (separator === -1) return true
    const plugin = skill.selector.slice(0, separator)
    if (skill.selector.slice(separator + 1) !== plugin) return true
    // A self-qualified pair reads once when its bare form reads the same.
    return kept.every(
      (other) =>
        other === skill ||
        other.selector !== plugin ||
        other.description !== skill.description ||
        (other.argumentHint ?? '') !== (skill.argumentHint ?? ''),
    )
  })
}

/** The client renders boolean options only with this capability (stable 2026-07-06). */
export function hasBooleanOptions(client: ClientCapabilities | undefined): boolean {
  const flag = client?.session?.configOptions?.boolean
  return flag !== undefined && flag !== null
}

/**
Further workspace roots from a session request: every entry is an
absolute path, kept as sent. Anything else is a bad request, never a
session scoped somewhere the editor did not ask for.
*/
export function parseAdditionalDirectories(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw RequestError.invalidParams()
  const roots: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !isAbsoluteRoot(entry)) {
      throw RequestError.invalidParams()
    }
    roots.push(entry)
  }
  return roots
}

/** Absolute on this machine or written with Windows separators (an editor on one). */
function isAbsoluteRoot(entry: string): boolean {
  return path.isAbsolute(entry) || path.win32.isAbsolute(entry)
}

/** One ACP session over one AgentSession. */
class AcpSession {
  private readonly questionRegistry: AcpQuestionRegistry | undefined
  private questions: AcpQuestionDeferral | undefined
  private readonly questionBundle: () => AcpQuestionBundle
  private media: Promise<AcpMediaPort> | undefined
  private readonly attachments: AcpAttachment[] = []
  private accounts: AcpAccounts | undefined
  private readonly translator: UpdateTranslator
  private unsubscribe: (() => void) | undefined
  private readonly unsubscribeResources: (() => void) | undefined
  private readonly approvals = new Map<string, ApprovalRequest>()
  /** What the client already answered, so one command is asked about once (F16). */
  private readonly permissionAnswers = new ApprovalAnswers()
  private readonly earlyFinishes = new Map<string, TurnCompleted>()
  private outbox: Promise<void> = Promise.resolve()
  private pending: PendingPrompt | undefined
  /**
  A prompt before its turn starts, while the session's skills are first
  announced: the session is busy, and a cancel ends the prompt there.
  */
  private legalStop: AbortController | undefined
  private preparing: PreparingPrompt | undefined
  private skills: readonly SkillSummary[] = []
  private areCommandsAnnounced = false
  private hasShownResourcePause = false
  /** F91: the editor heard once that Muse Code's Linux sandbox cannot start here. */
  private hasSaidSandboxCannotStart = false
  /** F91: the model heard once that Muse Code's Linux sandbox cannot start here. */
  private hasToldModelSandboxCannotStart = false
  private releaseSchedules: (() => Promise<void>) | undefined
  private isScheduleHostAvailable = true
  private effort: EffortLevel = DEFAULT_EFFORT
  private isEffortChosen = false
  /** The conversation's Fast switch; off by default, reset on model change. */
  private fast = false
  private modelChangeRevision = 0
  private effortChangeRevision = 0
  /** Let go (closed, loaded again, or never set up): the editor's late answers decide nothing. */
  private isDisposed = false
  private vaultGeneration = 0
  private readonly vaultRequests = new Set<AbortController>()
  private readonly dictationStop = new AbortController()
  private readonly dictationPages = new Set<VoiceCompanion>()
  /** A turn being started (`sendTurn` not yet answered): a release waits for it, then stops it. */
  private starting: Promise<unknown> | undefined
  /** The last backend mode command queued: each one runs after the one before it. */
  private modeOrder: Promise<unknown> = Promise.resolve()
  /**
  The turn's own stop: aborting it sends `$/cancel_request` for the
  client's requests still waiting (permission, elicitation), the
  cascade the cancellation page shows. Fresh per turn; spent by
  cancel, release or a host exit.
  */
  private clientStop: AbortController | undefined
  /** Whether paid uses may offer "Allow always" here (a boolean option, G06). */
  private rememberPaid = true
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
    private activeTurnId: string | undefined,
    private readonly noteChoice: () => void,
  ) {
    this.sessionId = session.sessionId
    this.questionBundle =
      deps.questionBundle ??
      questionDeferralLoader({
        bundlePath: path.join(__dirname, ACP_QUESTIONS_BUNDLE_FILE),
        log: deps.log,
      })
    const questionClock = deps.questionClock ?? acpQuestionClock
    this.questionRegistry =
      deps.questions === 'decline'
        ? undefined
        : deps.questions({
            session,
            clock: questionClock,
            deliver: (message) => this.getQuestions().deliver(message),
          })
    this.translator = new UpdateTranslator(
      cwd,
      false,
      undefined,
      'museCode',
      clientCapabilities.session?.notices != null,
    )
    this.unsubscribeResources = deps.resources?.subscribe(this.sessionId, (notice) => {
      const updates = acpResourceUpdates(notice, this.areNoticesSupported)
      const isPause = notice.event.type === 'levelChanged' && notice.event.to === 'pause'
      for (const update of updates) {
        if (isPause && this.hasShownResourcePause && update.sessionUpdate === 'agent_message_chunk')
          update.content = { type: 'text', text: resourceStatusText(notice.status) }
        if (isPause && this.hasShownResourcePause && update.sessionUpdate === 'notice')
          update.title = resourceStatusText(notice.status)
        this.send(update)
      }
      if (isPause) this.hasShownResourcePause = true
    })
    // The session subscribes in loadQuestions (M112): subscribing here too
    // would deliver every backend event twice.
    this.accounts =
      deps.accounts === undefined
        ? undefined
        : new AcpAccounts(
            this.sessionId,
            deps.accounts,
            () => {
              this.send({
                sessionUpdate: 'config_option_update',
                configOptions: this.configOptions(),
              })
            },
            (text, event) => {
              // An account swap or stop is the app's own status, never the
              // model's words: its own notice where the client can show
              // one, the agent-message fallback otherwise (F82's class).
              // The structured event rides `_meta` either way.
              this.send(
                this.areNoticesSupported
                  ? {
                      sessionUpdate: 'notice',
                      severity: event.type === 'stop' ? 'warning' : 'info',
                      title: text,
                      _meta: { accountNotice: event },
                    }
                  : {
                      sessionUpdate: 'agent_message_chunk',
                      _meta: { accountNotice: event },
                      content: { type: 'text', text },
                    },
              )
            },
          )
  }

  private getQuestions(): AcpQuestionDeferral {
    if (this.questions !== undefined) return this.questions
    if (this.questionRegistry === undefined) throw new Error(UI_TEXT.questionAnswerFailed)
    this.questions = this.questionBundle().createAcpQuestions(
      {
        registry: this.questionRegistry,
        clock: this.deps.questionClock ?? acpQuestionClock,
        seconds: this.deps.options.questionsDeferAfterSeconds ?? QUESTION_DEFER_DEFAULT_SECONDS,
        session: this.session,
        turn: () => ({
          isReleased: this.isDisposed,
          isCancelled: this.pending?.isCancelled === true,
          turnId: this.pending?.turnId ?? this.activeTurnId,
          starting: this.starting,
        }),
        notice: (text) => {
          this.questionNotice(text)
        },
        failed: () => {
          this.questionFailed()
          observeError(this.deps, 'questionFailed')
        },
      },
      UI_TEXT,
      uiLocale(),
    )
    return this.questions
  }

  private questionStateNotSaved(): void {
    this.deps.log.warn(`ACP session ${this.sessionId}: question state was not saved`)
  }

  private questionFailed(): void {
    this.deps.log.warn(`ACP session ${this.sessionId}: question operation failed`)
  }

  private async endQuestions(isCancelled: boolean): Promise<void> {
    await (this.questions?.turnEnded(isCancelled) ?? this.questionRegistry?.turnEnded(isCancelled))
  }

  /** Cancellation/release callbacks can change the prompt across await. */
  private wasEstimateCancelled(preparing: PreparingPrompt): boolean {
    return preparing.isCancelled || this.isDisposed
  }

  /** The client advertised `session.notices`: app statuses go out as notices. */
  private get areNoticesSupported(): boolean {
    return this.clientCapabilities.session?.notices != null
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
      observeError(this.deps, 'updateNotSent')
    }
  }

  /**
  `/playback` answered as usage (D203): with anything after it, or
  anything beside it — a playback takes no arguments, and nothing it
  came with may run as an ordinary turn with tools.
  */
  private async answerPlaybackUsage(preparing: PreparingPrompt): Promise<'cancelled' | 'end_turn'> {
    await this.announceCommands()
    if ('error' in preparing) throw preparing.error
    if (!preparing.isCancelled)
      this.send({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: UI_TEXT.playbackUsage },
      })
    await this.outbox
    return preparing.isCancelled ? 'cancelled' : 'end_turn'
  }

  /**
  A `/playback` turn (D203): the backend's own no-tools turn, which
  refuses every call in code. A backend with none (Muse Code: MSP is
  select-never-create, and no approval mode denies reads, let alone the
  file tools' edits) cannot run one, so the playback is refused instead
  of sent as an ordinary turn a reactive stop might reach too late.
  */
  private startPlaybackTurn(): Promise<TurnSubmission> {
    // Refused while a turn runs (one a resumed session carries, say), as the
    // panel refuses it.
    if (this.activeTurnId !== undefined) {
      return Promise.reject(RequestError.invalidRequest(undefined, UI_TEXT.playbackBusy))
    }
    const parts: readonly TurnPart[] = [{ type: 'text', text: playbackTurnText() }]
    const display = `/${SLASH_COMMAND_NAMES.playback}`
    const playback = this.session.playback
    return playback === undefined
      ? Promise.reject(RequestError.invalidRequest(undefined, UI_TEXT.playbackNeedsModelApi))
      : playback.call(this.session, parts, display)
  }

  /**
  One backend mode command, run after the ones queued before it: the
  Plan hold, its restore and the client's `session/set_mode` never
  overlap, so a restore cannot land after a newer selection, and it reads
  the mode to put back when it runs. The latest explicit choice stays.
  */
  private async inModeOrder<T>(command: () => Promise<T>): Promise<T> {
    const previous = this.modeOrder
    const next = (async () => {
      try {
        await previous
      } catch {
        // The command before this one answered its own caller with its failure.
      }
      return await command()
    })()
    this.modeOrder = next
    return await next
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
      observeError(this.deps, 'skillsUnavailable')
      // A failed skill list still announces the local commands (help, the
      // question commands when the registry is present, /playbook when the
      // playbook is bound): the failure only empties the remote skill list.
      this.skills = []
    }
    this.send({
      sessionUpdate: 'available_commands_update',
      availableCommands: this.availableCommands(),
    })
  }

  private availableCommands(): AvailableCommand[] {
    return [
      ...(this.deps.sharing
        ?.commands()
        .filter((command) => command.name !== SLASH_COMMAND_NAMES.help) ?? []),
      { name: SLASH_COMMAND_NAMES.help, description: UI_TEXT.referenceIntro, input: null },
      { name: 'whatsnew', description: UI_TEXT.paletteTips.whatsNew, input: null },
      ...(this.deps.vault === undefined
        ? []
        : [
            {
              name: 'vault',
              description: UI_TEXT.vault.title,
              input: { hint: 'status | list | lock | audit' },
            },
          ]),
      ...(this.accounts === undefined
        ? []
        : [{ name: 'accounts', description: UI_TEXT.accounts.slashDescription, input: null }]),
      { name: ACP_COMPACT_COMMAND, description: UI_TEXT.compactDetail, input: null },
      {
        name: SLASH_COMMAND_NAMES.playback,
        description: UI_TEXT.playbackDetail,
        input: null,
      },
      {
        name: SLASH_COMMAND_NAMES.report,
        description: UI_TEXT.reportSlashDescription,
        input: { hint: '<kind> [args] | history' },
      },
      ...(this.deps.legalScan === undefined
        ? []
        : [{ name: 'legal', description: UI_TEXT.legalScanDisclaimer, input: null }]),
      ...(this.deps.usage === undefined
        ? []
        : [
            {
              name: 'usage',
              description: UI_TEXT.acpUsageDescription,
              input: null,
            },
          ]),
      ...(this.deps.dictation === undefined
        ? []
        : [{ name: 'dictate', description: UI_TEXT.companionVoiceOpen, input: null }]),
      ...(this.deps.uploads === undefined
        ? []
        : [
            {
              name: 'uploads',
              description: UI_TEXT.media.uploadsDescription,
              input: { hint: UI_TEXT.media.uploadsUsage },
            },
          ]),
      ...(this.deps.resources === undefined
        ? []
        : resourceCommands().filter(
            (command) => command.name !== 'usage' || this.deps.usage === undefined,
          )),
      {
        name: 'agents',
        description: UI_TEXT.referenceAgentOutcomes,
        input: { hint: '[receipt|continue|retry] [ID]' },
      },
      ...(this.deps.playbookFor === undefined
        ? []
        : [
            {
              name: 'playbook',
              description: UI_TEXT.playbookHelpDescription,
              input: { hint: 'status|record|settings' },
            },
          ]),
      ...(this.deps.schedules === undefined || this.deps.schedules.isAvailable === false
        ? []
        : [
            {
              name: 'schedule',
              description: UI_TEXT.scheduleV2.labels.title,
              input: { hint: UI_TEXT.scheduleV2.runtime.usage },
            },
          ]),
      ...(this.deps.media === undefined || this.deps.options.isHeadless === true
        ? []
        : [
            {
              name: 'attach',
              description: UI_TEXT.paletteTips.attachFile,
              input: { hint: '<path>' },
            },
            { name: 'record', description: UI_TEXT.media.attachRecording, input: null },
          ]),
      ...(this.deps.estimate === undefined || this.deps.estimate.isAvailable === false
        ? []
        : [
            {
              name: SLASH_COMMAND_NAMES.estimate,
              description: UI_TEXT.estimateCliHelp,
              input: { hint: UI_TEXT.estimateUsage },
            },
          ]),
      ...dedupeSkillSelectors(this.skills)
        .filter(
          (skill) =>
            skill.selector !== SLASH_COMMAND_NAMES.help &&
            skill.selector !== SLASH_COMMAND_NAMES.estimate &&
            skill.selector !== SLASH_COMMAND_NAMES.playback &&
            skill.selector !== ACP_COMPACT_COMMAND &&
            skill.selector !== 'legal' &&
            ![
              'answer',
              'questions',
              'share',
              'prompt',
              'resources',
              'agents',
              SLASH_COMMAND_NAMES.report,
              'attach',
              'record',
              'accounts',
              'vault',
              'whatsnew',
              'uploads',
            ].includes(skill.selector) &&
            ((this.deps.usage === undefined && this.deps.resources === undefined) ||
              skill.selector !== 'usage') &&
            (this.deps.playbookFor === undefined || skill.selector !== 'playbook') &&
            skill.selector !== 'schedule',
        )
        .map((skill) => ({
          name: skill.selector,
          description: skill.description === '' ? skill.displayName : skill.description,
          input: skill.argumentHint === undefined ? null : { hint: skill.argumentHint },
        })),
      ...(this.questionRegistry === undefined
        ? []
        : [
            { name: 'answer', description: UI_TEXT.acpAnswerHelp, input: { hint: '<n> <text>' } },
            { name: 'questions', description: UI_TEXT.acpQuestionsHelp, input: null },
          ]),
    ]
  }

  private mediaPort(): Promise<AcpMediaPort> {
    const factory = this.deps.media
    if (factory === undefined)
      throw RequestError.invalidParams(undefined, UI_TEXT.media.uploadStorageUnknown)
    this.media ??= factory({
      cwd: this.cwd,
      sessionId: this.sessionId,
      backend: this.deps.backend.kind,
      modelId: () => this.modelId,
      interactive: this.deps.options.isHeadless !== true,
    })
    return this.media
  }

  /** The local /uploads command over the account ledger; other text falls through. */
  private async uploadsCommand(
    blocks: readonly ContentBlock[],
    signal: AbortSignal,
  ): Promise<boolean> {
    const [first] = blocks
    if (blocks.length !== 1 || first?.type !== 'text') return false
    signal.throwIfAborted()
    const outcome = await runUploadsCommand(first.text, {
      files: this.deps.uploads,
      send: (text) => {
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      },
      signal,
      confirmForeign: (name) => this.confirmUploadForeignDeletion(name, signal),
    })
    return outcome === 'handled'
  }

  /**
  A foreign file's confirmation (PLAN D85.2): the ACP permission request
  exactly where VS Code asks with its modal dialog. Refused, failed or
  cancelled keeps the file.
  */
  private async confirmUploadForeignDeletion(name: string, signal: AbortSignal): Promise<boolean> {
    try {
      const response = permissionResponse(
        await unlessAborted(
          this.client.request('session/request_permission', {
            sessionId: this.sessionId,
            toolCall: {
              toolCallId: `uploads-foreign-${randomUUID()}`,
              title: fill(UI_TEXT.media.otherAppFileConfirmation, { name }),
              kind: 'other',
              status: 'pending',
              content: [],
              locations: [],
            },
            options: [
              { optionId: 'uploads-foreign-allow', name: UI_TEXT.allowOnce, kind: 'allow_once' },
              { optionId: 'uploads-foreign-deny', name: UI_TEXT.paidDeny, kind: 'reject_once' },
            ],
          }),
          signal,
        ),
      )
      return (
        response.outcome.outcome === 'selected' &&
        response.outcome.optionId === 'uploads-foreign-allow'
      )
    } catch {
      return false
    }
  }

  private async mediaCommand(
    blocks: readonly ContentBlock[],
    signal: AbortSignal,
  ): Promise<boolean> {
    const [first] = blocks
    if (blocks.length !== 1 || first?.type !== 'text') return false
    const text = first.text.trim()
    const attach = /^\/attach(?:\s+(.+))?$/su.exec(text)
    const isRecord = text === '/record'
    if (attach === null && !isRecord) return false
    if (this.deps.options.isHeadless === true) {
      // A queued headless attachment never sends: no second turn carries
      // it. /record is refused the same way (M105 E2 review).
      if (isRecord) throw RequestError.invalidParams(undefined, UI_TEXT.media.recordingUserOnly)
      throw RequestError.invalidParams(undefined, UI_TEXT.media.attachHeadless)
    }
    // D121: no attach count of ours — any number of attachments is held;
    // the transports' frame validity and the send path answer for the rest.
    const given = attach?.[1]?.trim()
    if (!isRecord && (given === undefined || given === ''))
      throw RequestError.invalidParams(undefined, UI_TEXT.attachmentUnreadable)
    const port = await this.mediaPort()
    signal.throwIfAborted()
    let attachment: AcpAttachment | undefined
    try {
      attachment = isRecord ? await port.record(signal) : await port.attach(given ?? '', signal)
    } catch (error: unknown) {
      if (signal.aborted) throw error
      // Refusals name themselves in UI sentences (answered as written); a
      // refusal the user chose names itself too. Anything else answers
      // unreadable, never in its own words.
      if (error instanceof MediaRefusal) throw RequestError.invalidParams(undefined, error.message)
      if (error instanceof UserRefusalError)
        throw RequestError.invalidParams(undefined, error.message)
      throw RequestError.invalidParams(undefined, UI_TEXT.attachmentUnreadable)
    }
    if (attachment === undefined) return true
    if (signal.aborted || this.isDisposed) {
      await attachment.dispose?.()
      signal.throwIfAborted()
      throw RequestError.resourceNotFound(this.sessionId)
    }
    this.attachments.push(attachment)
    // Only video and audio have a duration; other kinds ack without one
    // (M105 E2 review).
    const metadata =
      'durationSeconds' in attachment.info
        ? fill(UI_TEXT.media.replayMetadata, {
            name: attachment.name,
            duration:
              attachment.info.durationSeconds === null
                ? UI_TEXT.media.durationUnknown
                : formatUnit(attachment.info.durationSeconds, 'second'),
            size: formatBytes(attachment.info.sizeBytes),
          })
        : fill(UI_TEXT.media.replayMetadataNoDuration, {
            name: attachment.name,
            size: formatBytes(attachment.info.sizeBytes),
          })
    this.send({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: metadata },
    })
    return true
  }

  private onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'turnStarted': {
        this.activeTurnId = event.turnId
        const pending = this.pending
        if (pending?.turnId === event.turnId && pending.userMessageId === undefined) {
          this.commitAnswers(pending)
        }
        return
      }
      case 'messageAdmitted': {
        const pending = this.pending
        if (pending?.answerLease === undefined) return
        if (pending.turnId === undefined) {
          pending.earlyAdmissions.add(event.userMessageId)
          const [oldest] = pending.earlyAdmissions
          if (oldest !== undefined && pending.earlyAdmissions.size > EARLY_FINISHES_KEPT) {
            pending.earlyAdmissions.delete(oldest)
          }
        } else if (pending.userMessageId === event.userMessageId) this.commitAnswers(pending)
        return
      }
      case 'turnWithdrawn': {
        this.finishTurn({ ...event, type: 'turnCompleted', terminal: CANCELLED_TERMINAL })
        return
      }
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
        this.permissionAnswers.resolved(event.approvalId)
        return
      }
      case 'questionRequested': {
        void this.ask(event)
        return
      }
      case 'questionSettled': {
        this.questions?.settled(event.userInputId, event.outcome)
        return
      }
      case 'elicitationRequested': {
        void this.askElicitation(event)
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
        this.modelChangeRevision += 1
        this.modelId = event.modelId
        this.noteChoice()
        this.send({ sessionUpdate: 'config_option_update', configOptions: this.configOptions() })
        return
      }
      case 'approvalModeChanged': {
        // The CLI changed the mode itself (a ceiling or managed policy): the
        // editor keeps showing the mode it set, and the log keeps the fact.
        this.deps.log.warn(
          `ACP session ${this.sessionId}: Muse Code now runs approval mode ${wireWordForLog(event.mode)}`,
        )
        return
      }
      case 'effortChanged': {
        if (isEffortLevel(event.effort)) {
          this.effortChangeRevision += 1
          this.effort = event.effort
          this.noteChoice()
          this.send({ sessionUpdate: 'config_option_update', configOptions: this.configOptions() })
        }
        return
      }
      case 'itemStarted':
      case 'itemUpdated':
      case 'itemCompleted': {
        for (const update of this.translator.updates(event)) {
          this.send(update)
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

  private noteTurnId(turnId: string, disposition: string): void {
    const pending = this.pending
    if (pending === undefined) {
      return
    }
    pending.turnId = turnId
    const early = this.earlyFinishes.get(turnId)
    if (early === undefined) {
      if (disposition === 'started') this.activeTurnId = turnId
      return
    }
    this.earlyFinishes.delete(turnId)
    void this.settle(pending, early)
  }

  private commitAnswers(pending: PendingPrompt): void {
    const lease = pending.answerLease
    if (lease === undefined || pending.isCancelled || this.isDisposed) return
    pending.answerLease = undefined
    pending.answerCommit = (async () => {
      try {
        await this.questionRegistry?.commitQueued(lease.token)
        if (!this.isDisposed) this.getQuestions().sentQueued()
      } catch (error: unknown) {
        // The model is still running: retain pending so another prompt is busy.
        this.deps.log.warn(
          `ACP session ${this.sessionId}: queued commit failed, retaining pending: ${failureForLog(error)}`,
        )
        pending.reject(RequestError.internalError(undefined, UI_TEXT.questionQueueCommitFailed))
      }
    })()
  }

  private async releaseAnswers(pending = this.pending): Promise<void> {
    if (pending === undefined) return
    const lease = pending.answerLease
    if (lease === undefined) return
    pending.answerLease = undefined
    try {
      await this.questionRegistry?.releaseQueued(lease.token)
    } catch {
      this.questionStateNotSaved()
    }
  }

  private finishCompaction(status: string): void {
    const pending = this.pending
    this.pending = undefined
    pending?.resolve(
      status === CANCELLED_TERMINAL || pending.isCancelled ? 'cancelled' : 'end_turn',
    )
  }

  private finishTurn(event: TurnCompleted): void {
    const wasActive = this.activeTurnId === event.turnId
    if (wasActive) this.activeTurnId = undefined
    const pending = this.pending
    if (pending?.turnId === event.turnId) {
      void this.settle(pending, event)
      return
    }
    if (pending === undefined && wasActive) {
      void this.endQuestions(event.terminal === CANCELLED_TERMINAL).catch(() => {
        this.questionStateNotSaved()
      })
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
  private async settle(pending: PendingPrompt, event: TurnCompleted): Promise<void> {
    this.pending = undefined
    await this.releaseAnswers(pending)
    await pending.answerCommit
    void this.endQuestions(pending.isCancelled || event.terminal === CANCELLED_TERMINAL).catch(
      () => {
        this.questionStateNotSaved()
      },
    )
    if (pending.isCancelled || event.terminal === CANCELLED_TERMINAL) {
      pending.resolve('cancelled')
      return
    }
    if (event.terminal === FAILED_TERMINAL) {
      // A restarted backend whose replacement lost the sign-in says so
      // loudly (F94): an `authRequired` turn names the restart and the way
      // back, instead of failing as just another turn.
      const restartCause =
        event.errorKind === AUTH_REQUIRED_ERROR_KIND ? this.host.peekRestartCause?.() : undefined
      const loud =
        restartCause === undefined
          ? undefined
          : signInLossFailure({
              errorKind: event.errorKind,
              reason: event.reason,
              restartCause,
            })
      if (loud !== undefined && restartCause !== undefined) {
        // The loud words go to the client, never to the log as sent: they
        // carry the turn's reason, which is text the CLI chose (AGENTS.md
        // rule 8, as `markAuthRequired` logs only a protocol word).
        this.deps.log.warn(
          `ACP session ${this.sessionId}: sign-in lost across a backend restart (${restartCause})`,
        )
        pending.reject(loud)
        return
      }
      pending.reject(
        RequestError.internalError(undefined, event.reason ?? event.errorKind ?? event.terminal),
      )
      return
    }
    // A turn that ran to completion proves the host: no later failure blames
    // the restart this host replaced.
    this.host.clearRestartCause?.()
    pending.resolve(event.errorKind === 'max_turn_requests' ? 'max_turn_requests' : 'end_turn')
  }

  private async askPermission(event: ApprovalRequest): Promise<void> {
    const pending = this.pending
    // A command is asked about once (F16): an answer already given for this
    // approval or its tool call is applied again, never asked again.
    let choice = editAutomaticallyChoice(event, this.mode) ?? this.permissionAnswers.reuse(event)
    let settled: ApprovalRequest = event
    if (choice === undefined) {
      // One client request per approval: a newer stage arriving while one is
      // open is settled by that request's answer, never by a second request.
      if (!this.permissionAnswers.claim(event.approvalId)) {
        return
      }
      try {
        // The tool call the request names has gone out first.
        await this.outbox
        const latest = this.approvals.get(event.approvalId)
        if (latest === undefined || !this.isCurrentPrompt(pending)) {
          return
        }
        if (latest !== event) {
          // A newer stage superseded this one while waiting: settle it
          // instead. The claim is released first (idempotent) so the
          // re-entered ask can take it.
          this.permissionAnswers.release(event.approvalId)
          await this.askPermission(latest)
          return
        }
        let response: RequestPermissionResponse | undefined
        try {
          response = permissionResponse(
            await this.client.request(
              'session/request_permission',
              {
                sessionId: this.sessionId,
                toolCall: approvalToolCall(event, this.cwd),
                options: permissionOptions(event.availableChoices),
              },
              this.clientRequestOptions(),
            ),
          )
        } catch (error: unknown) {
          this.deps.log.warn(
            `ACP session ${this.sessionId}: permission request failed, denying: ${failureForLog(error)}`,
          )
          observeError(this.deps, 'permissionRequestFailed')
        }
        const current = this.approvals.get(event.approvalId)
        if (current === undefined || !this.isCurrentPrompt(pending)) {
          return
        }
        settled = current
        // The answer is never discarded when a newer stage landed mid-ask:
        // the picked meaning moves to it, else the denial default decides.
        choice =
          answerChoice(response, event.availableChoices, settled.availableChoices) ??
          decidedChoice(undefined, settled.availableChoices)
      } finally {
        this.permissionAnswers.release(event.approvalId)
      }
    }
    if (!this.isCurrentPrompt(pending) || this.approvals.get(event.approvalId) !== settled) {
      // Let go while the editor was asked: the answer is for a session it
      // no longer shows, which another session may now hold.
      return
    }
    if (choice === undefined) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: approval ${settled.approvalId} offers no denial; stopping the turn`,
      )
      observeError(this.deps, 'approvalWithoutDenial')
      await this.cancel()
      return
    }
    // The next stage can arrive before approval/decide is acknowledged.
    // Publish the consent synchronously so that event reuses it, not a new ask.
    this.permissionAnswers.remember(settled.approvalId, settled.itemId, choice)
    try {
      await this.session.decideApproval({
        approvalId: settled.approvalId,
        choiceId: choice.choiceId,
        requirementId: settled.requirementId,
      })
    } catch (error: unknown) {
      // A settled approval the session already forgot is routine; anything
      // else warns. Both log the redacted failure, never its text.
      const message = `ACP session ${this.sessionId}: approval ${settled.approvalId}: ${failureForLog(error)}`
      if (isPromptSettledError(error)) this.deps.log.info(message)
      else this.deps.log.warn(message)
    }
  }

  /**
  Cancels a failed form when the turn still owns it; an already-settled
  form stays settled, never surfacing the client's error text.
  */
  private async cancelElicitation(
    pending: PendingPrompt | undefined,
    elicitationId: string,
  ): Promise<void> {
    if (this.isCurrentPrompt(pending)) {
      try {
        await this.session.settleElicitation?.call(this.session, elicitationId, {
          kind: 'cancelled',
        })
      } catch {
        this.deps.log.info('ACP elicitation was already settled')
      }
    }
  }

  /**
  An MCP server's elicitation form (M91 lane M) through the client's own
  form path: the client's answer settles the session's form, validated
  against the server's schema there. Without forms the turn carries on
  and the request is cancelled; a failed form cancels it too, never
  answering by a guess.
  */
  private async askElicitation(event: ElicitationRequest): Promise<void> {
    const pending = this.pending
    const settle = this.session.settleElicitation
    const message = `${fill(UI_TEXT.elicitationTitle, { server: event.server })}\n${event.message}`
    try {
      const { elicitationSchema, elicitationText, parseElicitationResult } =
        this.questionBundle().acpElicitation(UI_TEXT, uiLocale())
      if (settle === undefined || this.clientCapabilities.elicitation?.form == null) {
        this.send({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: elicitationText(message, event.fields) },
        })
      } else {
        const request: CreateElicitationRequest = {
          sessionId: this.sessionId,
          mode: 'form',
          message,
          requestedSchema: elicitationSchema(event.fields),
        }
        const response = await this.client.request(
          'elicitation/create',
          request,
          this.clientRequestOptions(),
        )
        if (!this.isCurrentPrompt(pending)) {
          return
        }
        const parsed = parseElicitationResult(response)
        if (parsed?.action === 'accept') {
          try {
            await settle.call(this.session, event.elicitationId, {
              kind: 'accepted',
              values: { ...parsed.content },
            })
          } catch (error: unknown) {
            // The session refused the content: cancel instead of hanging
            // on a form nobody else will answer.
            this.deps.log.warn(
              `ACP session ${this.sessionId}: elicitation ${event.elicitationId} not accepted: ${failureForLog(error)}`,
            )
            if (this.isCurrentPrompt(pending)) {
              await settle.call(this.session, event.elicitationId, { kind: 'cancelled' })
            }
          }
          return
        }
        await settle.call(this.session, event.elicitationId, {
          kind: parsed?.action === 'decline' ? 'declined' : 'cancelled',
        })
        return
      }
      if (this.isCurrentPrompt(pending)) {
        try {
          await settle?.call(this.session, event.elicitationId, { kind: 'cancelled' })
        } catch {
          // A timeout may already have settled the form. Never surface the
          // client's error text or turn that race into an unhandled promise.
          this.deps.log.info('ACP elicitation was already settled')
        }
      }
    } catch {
      this.deps.log.warn(`ACP session ${this.sessionId}: elicitation ${event.elicitationId} failed`)
      // A form that failed is cancelled, so the tool call goes on without the answer.
      await this.cancelElicitation(pending, event.elicitationId)
    }
  }

  private async ask(event: QuestionRequest): Promise<void> {
    try {
      if (this.questionRegistry === undefined) {
        // Explicit headless policy: decline at once, without a form or a timer.
        await this.session.cancelQuestions(event.userInputId)
        return
      }
      await this.getQuestions().askClient(
        event,
        this.client,
        this.clientCapabilities.elicitation?.form != null,
        this.pending?.turnId ?? this.activeTurnId,
      )
    } catch {
      this.questionFailed()
      observeError(this.deps, 'questionFailed')
      if (this.questionRegistry === undefined) return
      try {
        await this.session.cancelQuestions(event.userInputId)
      } catch {
        this.questionFailed()
      }
    }
  }

  private questionNotice(text: string): void {
    // Its own message, named so the client never folds it into a turn's.
    this.send({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
      messageId: randomUUID(),
    })
  }

  /** Whether the probe measured at host start that Muse Code's Linux sandbox cannot start here. */
  private sandboxCannotStart(): boolean {
    return (
      this.deps.backend.kind === 'museCode' &&
      isLinuxSandboxBlocked(this.deps.backend.shellSandboxReadiness?.(this.cwd))
    )
  }

  /**
  F91: the model hears it once, at the tail, so a failing read-only
  command never reads as a dead shell. Earlier request bytes are
  untouched: this part is appended, never spliced into what came before.
  The told-flag flips only after an accepted submission at the call site:
  a send that fails or is cancelled before reaching Muse Code must not
  silence every later turn.
  */
  private sandboxModelNote(): readonly TurnPart[] {
    return this.hasToldModelSandboxCannotStart || !this.sandboxCannotStart()
      ? []
      : [{ type: 'text', text: SANDBOX_CANNOT_START_MODEL_NOTE }]
  }

  private isCurrentReport(preparing: PreparingPrompt): boolean {
    return this.preparing === preparing && !preparing.isCancelled && !this.isDisposed
  }

  /**
  A session let go changes nothing more on the backend, which a newer
  load may now hold, and replays nothing: the request fails instead.
  */
  private ensureHeld(): void {
    if (this.isDisposed) {
      throw RequestError.resourceNotFound(this.sessionId)
    }
  }

  /**
  Show the wire mode a refused mode change names (GRV251D): the editor is
  told the mode the host runs. Nothing is published when no editor mode
  selects it; the throw still carries the error's own true sentence.
  */
  private async showRunningMode(
    error: { actualMode: string },
    preferred: PermissionMode,
  ): Promise<void> {
    const shown = composerModeForApprovalMode(error.actualMode, preferred, true)
    if (shown === undefined) return
    this.mode = shown
    this.send({ sessionUpdate: 'current_mode_update', currentModeId: shown })
    await this.outbox
  }

  /** A load or resume runs on the remembered mode: a refusal names the host's instead. */
  private async syncRememberedMode(): Promise<void> {
    try {
      await this.session.setApprovalMode(approvalModeFor(this.mode, true))
    } catch (error: unknown) {
      if (!isPermissionReviewerError(error) && !isModeKeptError(error)) throw error
      await this.showRunningMode(error, this.mode)
      throw error
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

  private async runLegalScan(
    scan: NonNullable<AcpAgentDeps['legalScan']>,
    isRegistryOn: boolean,
  ): Promise<StopReason> {
    const stop = new AbortController()
    const preparing: PreparingPrompt = { isCancelled: false, abort: stop }
    this.legalStop = stop
    this.preparing = preparing
    let text: string
    try {
      text = await scan(this.cwd, stop.signal, isRegistryOn, async (hosts) => {
        const response = permissionResponse(
          await unlessAborted(
            this.client.request(
              'session/request_permission',
              {
                sessionId: this.sessionId,
                toolCall: {
                  toolCallId: 'legal-registry-notice',
                  title: fill(UI_TEXT.legalRegistryNotice, { hosts: hosts.join(', ') }),
                  kind: 'other',
                  status: 'pending',
                  content: [],
                  locations: [],
                },
                options: [
                  { optionId: 'legal-registry-allow', name: UI_TEXT.allowOnce, kind: 'allow_once' },
                  { optionId: 'legal-registry-deny', name: UI_TEXT.paidDeny, kind: 'reject_once' },
                ],
              },
              { cancellationSignal: stop.signal },
            ),
            stop.signal,
          ),
        )
        return (
          response.outcome.outcome === 'selected' &&
          response.outcome.optionId === 'legal-registry-allow'
        )
      })
    } catch (error: unknown) {
      if (stop.signal.aborted) return 'cancelled'
      // Only the scanner failing to load says it could not be loaded: the
      // bundle loader's contract throws exactly `legalScanUnavailable` (the
      // log has the cause). A failing scan, a refused permission prompt or a
      // lost update carries its own cause instead.
      if (isLegalScanUnavailable(error))
        throw RequestError.internalError(undefined, UI_TEXT.legalScanUnavailable)
      throw error
    } finally {
      if (this.legalStop === stop) this.legalStop = undefined
      if (this.preparing === preparing) this.preparing = undefined
    }
    if (stop.signal.aborted || preparing.isCancelled || this.isDisposed) return 'cancelled'
    this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
    await this.outbox
    return 'end_turn'
  }

  /**
  What's New in another editor (M99): this version's release notes as
  text, read from the package's own content file beside the agent bundle
  and checked before use. A missing or unreadable file is logged with its
  path and answered with the generic failure, never an empty success.
  */
  private whatsNewText(): string {
    const file = path.join(__dirname, WHATS_NEW_CONTENT_FILE)
    try {
      return whatsNewTextForContent(
        parseWhatsNewContent(readFileSync(file, 'utf8')),
        this.deps.version,
      )
    } catch (error: unknown) {
      this.deps.log.warn(
        `ACP session ${this.sessionId}: What's New unavailable: ${failureForLog(error)} (${file})`,
      )
      return UI_TEXT.actionFailed
    }
  }

  private async usageReply(
    blocks: readonly ContentBlock[],
    preparing: PreparingPrompt,
  ): Promise<boolean> {
    const [block] = blocks
    if (
      this.deps.dictation !== undefined &&
      blocks.length === 1 &&
      block?.type === 'text' &&
      block.text.trim() === '/dictate'
    ) {
      const page = await this.deps.dictation({
        cwd: this.cwd,
        signal: this.dictationStop.signal,
        isCurrent: () => !this.isDisposed,
        askPaid: async (title, detail, canRemember, signal) =>
          await this.askPaidQuestion(title, detail, canRemember, () => !this.isDisposed, signal),
        send: async (text, signal) => {
          signal.throwIfAborted()
          if (
            this.isDisposed ||
            this.preparing !== undefined ||
            this.pending !== undefined ||
            this.activeTurnId !== undefined
          )
            throw new Error('EVOICE_BUSY')
          let accept!: () => void
          // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Host type project targets Node 20; the resolver is assigned synchronously (PLAN.md §8).
          const accepted = new Promise<void>((resolve) => {
            accept = resolve
          })
          const abort = () => {
            this.cancelPreparing()
            void this.cancelTurn()
          }
          signal.addEventListener('abort', abort, { once: true })
          const running = this.prompt([{ type: 'text', text }], accept)
          // A sent ACP turn outlives the companion's HTTP admission request.
          void running.catch(() => {
            this.deps.log.warn('Companion ACP prompt failed')
          })
          try {
            const admitted = (async (): Promise<StopReason | 'admitted'> => {
              await accepted
              return 'admitted'
            })()
            const outcome = await Promise.race([admitted, running])
            signal.throwIfAborted()
            // A preparation cancelled before admission starts no backend
            // turn: report nothing sent, so the browser keeps the reviewed
            // text for retry. A local outcome counts as sent.
            if (outcome === 'cancelled') throw new Error('EVOICE_NOT_SENT')
            this.send({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } })
          } finally {
            signal.removeEventListener('abort', abort)
          }
        },
      })
      if (!this.canReplyUsage(preparing)) {
        await page.close()
        return true
      }
      this.dictationPages.add(page)
      void page.closed.then(() => {
        this.dictationPages.delete(page)
      })
      this.send({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `[${UI_TEXT.companionVoiceOpen}](${page.launchUrl()})` },
      })
      return true
    }
    const usage = this.deps.usage
    if (
      usage === undefined ||
      blocks.length !== 1 ||
      block?.type !== 'text' ||
      !['/usage', '/usage page', '/usage open'].includes(block.text.trim())
    )
      return false
    const entry = await import('../runtime/usage/usageAcp')
    entry.setUiText(UI_TEXT, uiLocale())
    await entry.replyAcpUsage({
      usage,
      preparing,
      canReply: () => this.canReplyUsage(preparing),
      send: (text) => {
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
      },
      canElicitUrl: this.clientCapabilities.elicitation?.url != null,
      sessionId: this.sessionId,
      request: (params, signal) =>
        this.client.request('elicitation/create', params, { cancellationSignal: signal }),
      log: this.deps.log,
    })
    return true
  }

  private canReplyUsage(preparing: PreparingPrompt): boolean {
    return !preparing.isCancelled && !this.isDisposed
  }

  private cancelVaultRequests(): void {
    this.vaultGeneration += 1
    for (const controller of this.vaultRequests) controller.abort()
  }

  /**
  The turn's stop as request options: the SDK sends `$/cancel_request`
  for the request when it aborts (G04). Outside a turn there is nothing
  to stop, so no options.
  */
  private clientRequestOptions(): { cancellationSignal: AbortSignal } | undefined {
    const stop = this.clientStop
    return stop === undefined ? undefined : { cancellationSignal: stop.signal }
  }

  /**
  The question before a paid use (M58, PLAN.md D48): a row naming what is
  about to be billed and its price, and a permission prompt on it with the
  popup's answers. Anything but Allow once or Allow always is Deny.
  */
  private async agentCommand(line: string, preparing: PreparingPrompt): Promise<string> {
    const isCancelled = () => preparing.isCancelled
    const [, action, id, ...extra] = line.split(/\s+/)
    const history = await this.host.readSession(this.sessionId)
    this.ensureHeld()
    if (isCancelled()) return UI_TEXT.paidDeny
    if (action === undefined) return agentListingText(history.items, Date.now())
    if (id === undefined || extra.length > 0 || !['receipt', 'continue', 'retry'].includes(action))
      throw RequestError.invalidParams(undefined, UI_TEXT.referenceAgentOutcomes)
    const agent = listedAgents(history.items).find((item) => listedAgentId(item) === id)
    if (agent === undefined)
      throw RequestError.invalidParams(undefined, UI_TEXT.agentContinueUnavailable)
    if (action === 'receipt') {
      const childHistory =
        agent.childSessionId === undefined
          ? undefined
          : await this.host.readSession(agent.childSessionId)
      const items = childHistory?.items ?? [agent]
      this.ensureHeld()
      const { agentReceiptFiles } = await import('../core/agent/agentReceiptFiles')
      const files = await agentReceiptFiles(items, (request) =>
        this.host.readSessionOutput(agent.childSessionId ?? this.sessionId, request),
      )
      const receipt =
        this.host.info.kind === 'modelApi'
          ? (agent.agentEvidence?.attempts?.at(-1)?.receipt ??
            buildAgentReceipt(
              files,
              agent.agentEvidence,
              agent.result?.text ?? agent.result?.summary,
            ))
          : buildAgentReceipt(
              files,
              agent.agentEvidence,
              agent.result?.text ?? agent.result?.summary,
            )
      return `${UI_TEXT.agentReceipt}\n${agentStateText({ status: agent.status, controlStatus: agent.controlStatus, evidence: agent.agentEvidence }, Date.now())}\n${JSON.stringify({ ...receipt, attempts: agent.agentEvidence?.attempts ?? [] }, undefined, 2)}`
    }
    const title = action === 'continue' ? UI_TEXT.agentContinue : UI_TEXT.agentRetry
    let response: RequestPermissionResponse
    try {
      response = permissionResponse(
        await this.client.request(
          'session/request_permission',
          {
            sessionId: this.sessionId,
            toolCall: {
              toolCallId: randomUUID(),
              title: fill(UI_TEXT.agentRecoveryConfirm, {
                action: title,
                objective: agent.objective ?? id,
              }),
              kind: 'other',
              status: 'pending',
            },
            options: [
              { optionId: 'recover', name: title, kind: 'allow_once' },
              { optionId: 'deny', name: UI_TEXT.paidDeny, kind: 'reject_once' },
            ],
          },
          { cancellationSignal: preparing.abort.signal },
        ),
      )
    } catch (error: unknown) {
      // A cancelled preparation's withdrawn prompt is a denial, not a failure.
      if (!isCancelled()) throw error
      response = permissionResponse({ outcome: { outcome: 'cancelled' } })
    }
    this.ensureHeld()
    if (
      isCancelled() ||
      response.outcome.outcome !== 'selected' ||
      response.outcome.optionId !== 'recover'
    )
      return UI_TEXT.paidDeny
    // Re-read after the owner's prompt: a live update invalidates its authority.
    const currentHistory = await this.host.readSession(this.sessionId)
    const current = listedAgents(currentHistory.items).find((item) => listedAgentId(item) === id)
    this.ensureHeld()
    if (isCancelled()) return UI_TEXT.paidDeny
    if (current === undefined || recoveryStamp(current) !== recoveryStamp(agent))
      return UI_TEXT.agentContinueUnavailable
    // A listed entry with no subagent behind it (a background tool call, a
    // workflow child) is not a missing backend checkpoint: it has nothing to retry.
    if (agent.subagentId === undefined)
      return action === 'retry' ? UI_TEXT.agentRetryNoSubagent : UI_TEXT.agentContinueUnavailable
    try {
      await this.session.controlSubagent(id, action === 'continue' ? 'continue' : 'retry')
    } catch (error: unknown) {
      if (action === 'continue') return UI_TEXT.agentContinueUnavailable
      // Only the backend with no isolated worktree checkpoint says so (Muse
      // Code refuses every retry). Any other backend's refusal carries its
      // own cause: an unknown subagent, or this agent's missing checkpoint.
      return this.host.info.kind !== 'museCode' && error instanceof Error && error.message !== ''
        ? error.message
        : UI_TEXT.agentRetryUnavailable
    }
    const latest = await this.host.readSession(this.sessionId)
    return agentListingText(latest.items, Date.now())
  }

  private cancelPreparing(): boolean {
    const preparing = this.preparing
    if (preparing === undefined) return false
    preparing.isCancelled = true
    preparing.reportAbort?.abort()
    preparing.abandonElicitation?.()
    preparing.abort.abort()
    this.preparing = undefined
    return true
  }

  /**
  The conversation's Fast switch: the model's priority tier where the
  catalogue lists one. Off by default; the description says so and names
  the tier's own words.
  */
  private fastOption(): SessionConfigOption[] {
    const tier = this.models.find((model) => model.modelId === this.modelId)?.fastTier
    if (tier === undefined) return []
    return [
      {
        id: ACP_CONFIG_IDS.fast,
        name: tier.name,
        description: fill(UI_TEXT.planUi.fastDetail, { description: tier.description }),
        category: 'thought_level',
        type: 'boolean',
        currentValue: this.fast,
      },
    ]
  }

  /**
  The effort the model runs: the wanted tier where it serves it, else
  the model's own default, else the highest tier it serves.
  */
  private servedEffort(wanted: EffortLevel): EffortLevel {
    const levels = modelEffortLevels(this.models, this.modelId)
    if (levels.includes(wanted)) return wanted
    const fallback = this.models.find((model) => model.modelId === this.modelId)?.defaultEffort
    return (
      (fallback !== undefined && levels.includes(fallback) ? fallback : levels.at(-1)) ??
      DEFAULT_EFFORT
    )
  }

  private async askPaidQuestion(
    title: string,
    detail: string,
    canRemember: boolean,
    isOwnerCurrent: () => boolean,
    signal?: AbortSignal,
    request?: PaidUseRequest,
  ): Promise<PaidUseAnswer> {
    const isCurrent = () => !this.isDisposed && signal?.aborted !== true && isOwnerCurrent()
    if (!isCurrent()) return 'deny'
    // Unique for the client's lifetime: a session loaded again starts afresh.
    const toolCallId = `${ACP_PAID_TOOL_CALL_PREFIX}${randomUUID()}`
    const content = [{ type: 'content' as const, content: { type: 'text' as const, text: detail } }]
    this.send({
      sessionUpdate: 'tool_call',
      toolCallId,
      title,
      ...(request !== undefined && { name: request.feature }),
      kind: 'other',
      status: 'pending',
      content,
    })
    let answer: PaidUseAnswer = 'deny'
    // The session's boolean option can take "Allow always" off the table:
    // offering it would cost a stored grant the session refused to keep.
    const canOfferAlways = canRemember && this.rememberPaid
    try {
      await this.outbox
      if (!isCurrent()) {
        return 'deny'
      }
      const params: RequestPermissionRequest = {
        sessionId: this.sessionId,
        toolCall: {
          toolCallId,
          title,
          ...(request !== undefined && { name: request.feature }),
          status: 'pending',
          content,
        },
        options: paidUseOptions(
          canOfferAlways,
          request?.feature === 'scheduledPrompts' && request.schedule !== undefined,
        ),
      }
      // The companion's cancellation also cancels the editor's prompt: a
      // locally abandoned wait must not leave the editor's question open.
      // The turn's own stop cancels it too, sending `$/cancel_request`
      // for the waiting request (G04).
      const turnStop = this.clientStop?.signal
      const cancellationSignal =
        signal === undefined
          ? turnStop
          : turnStop === undefined
            ? signal
            : AbortSignal.any([signal, turnStop])
      const pendingPermission = this.client.request(
        'session/request_permission',
        params,
        cancellationSignal === undefined ? undefined : { cancellationSignal },
      )
      const response =
        signal === undefined
          ? await pendingPermission
          : await unlessAborted(pendingPermission, signal)
      // A session let go while the editor was asked is billed for nothing.
      answer =
        response !== undefined && isCurrent()
          ? paidUseAnswer(permissionResponse(response), canOfferAlways)
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

  public async askPaidUse(request: PaidUseRequest, canRemember: boolean): Promise<PaidUseAnswer> {
    const pending = this.pending
    const preparing = this.preparing
    const { title, detail } = await paidUseQuestion(request)
    return await this.askPaidQuestion(
      title,
      detail,
      canRemember,
      () => this.isCurrentPaidPrompt(pending, preparing),
      undefined,
      request,
    )
  }

  /**
  An "always" the session's answer gave but the store could not keep: said
  in the session, after the allowed use, so being asked again is expected.
  */
  public notePaidNotKept(text: string): void {
    this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
  }

  public async startAccounts(): Promise<void> {
    // Ordinary sessions never depend on accounts: a failing port leaves the
    // session working without accounts instead of failing adoption.
    try {
      await this.accounts?.start()
    } catch (error: unknown) {
      const accounts = this.accounts
      this.accounts = undefined
      this.deps.log.warn(`ACP accounts startup failed: ${failureForLog(error)}`)
      try {
        accounts?.dispose()
      } catch (error: unknown) {
        this.deps.log.warn(`ACP accounts cleanup failed: ${failureForLog(error)}`)
      }
    }
  }

  /** Broker-owned request; Bypass, tools and paid grants never enter this path. */
  public async askVaultUse(request: VaultApprovalRequest): Promise<VaultApprovalAnswer> {
    const pending = this.pending
    const preparing = this.preparing
    const generation = this.vaultGeneration
    const deny: VaultApprovalAnswer = {
      requestId: request.id,
      digest: request.digest,
      decision: 'deny',
    }
    // No expiry of our own (owner 2026-10-16): the editor's answer or its
    // loss ends the wait, never an invented kill.
    const isCurrent = () =>
      this.isCurrentPaidPrompt(pending, preparing) && generation === this.vaultGeneration
    if (!isCurrent()) return deny
    const toolCallId = `vault:${request.id}`
    const content = [
      {
        type: 'content' as const,
        content: { type: 'text' as const, text: vaultApprovalText(request) },
      },
    ]
    this.send({
      sessionUpdate: 'tool_call',
      toolCallId,
      title: UI_TEXT.vault.title,
      name: 'vault',
      kind: 'other',
      status: 'pending',
      content,
    })
    const controller = new AbortController()
    this.vaultRequests.add(controller)
    let answer = deny
    try {
      await this.outbox
      if (isCurrent()) {
        const cancelled = new Promise<RequestPermissionResponse>((resolve) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              resolve({ outcome: { outcome: 'cancelled' } })
            },
            { once: true },
          )
        })
        const response = await Promise.race([
          this.client.request(
            'session/request_permission',
            {
              sessionId: this.sessionId,
              toolCall: {
                toolCallId,
                title: UI_TEXT.vault.title,
                name: 'vault',
                status: 'pending',
                content,
              },
              options: vaultPermissionOptions(request),
            },
            { cancellationSignal: controller.signal },
          ),
          cancelled,
        ])
        if (isCurrent()) answer = vaultPermissionAnswer(request, permissionResponse(response))
      }
    } catch (error: unknown) {
      // A lost editor or malformed permission response is Deny: the kind is
      // recorded redacted, never remote text.
      this.deps.log.warn(
        `ACP session ${this.sessionId}: vault permission fell back to deny: ${failureForLog(error)}`,
      )
    } finally {
      controller.abort()
      this.vaultRequests.delete(controller)
      this.send({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: answer.decision === 'deny' ? 'failed' : 'completed',
      })
    }
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
    // Annotated so `type` stays the `'boolean'` literal the option union
    // discriminates on; an inline conditional spread would widen it.
    const paidAlways: SessionConfigOption | undefined = hasBooleanOptions(this.clientCapabilities)
      ? {
          id: ACP_CONFIG_IDS.paidAllowAlways,
          name: UI_TEXT.paidAllowAlways,
          type: 'boolean',
          currentValue: this.rememberPaid,
        }
      : undefined
    return [
      ...(this.accounts?.option() ?? []),
      {
        id: ACP_CONFIG_IDS.model,
        name: UI_TEXT.groupModel,
        category: 'model',
        type: 'select',
        currentValue: this.modelId,
        options: this.models.map((model) => ({
          value: model.modelId,
          name: model.displayLabel,
          ...(model.agentLimit !== undefined && { description: model.agentLimit }),
        })),
      },
      {
        id: ACP_CONFIG_IDS.effort,
        name: UI_TEXT.effortItem,
        category: 'thought_level',
        type: 'select',
        currentValue: this.effort,
        options: modelEffortLevels(this.models, this.modelId).map((level) => ({
          value: level,
          name: effortLabel(level),
        })),
      },
      ...this.fastOption(),
      // The same modes `session/set_mode` takes, as the category the
      // protocol prefers (G05): editors on config options stop needing
      // the dedicated method before it is removed.
      {
        id: ACP_CONFIG_IDS.mode,
        name: UI_TEXT.modesTitle,
        category: 'mode',
        type: 'select',
        currentValue: this.mode,
        options: availablePermissionModes(this.deps.options.canBypass).map((mode) => ({
          value: mode,
          name: UI_TEXT.permissionModes[mode],
          description: permissionModeDetail(mode, this.deps.backend.kind),
        })),
      },
      // The only boolean: offering "Allow always" costs a stored grant,
      // so a session can refuse to offer it (G06). Sent only where the
      // client says it renders booleans.
      ...(paidAlways === undefined ? [] : [paidAlways]),
    ]
  }

  /**
  A loaded or resumed session made to run as the agent advertises it.
  Everything shown comes from the backend's answer or an explicit set,
  never from what the handle holds: Muse Code's resumed handle holds the
  model the agent asked for, while the CLI keeps the one the session last
  ran on. The permission mode shown is set; the model is the one the
  backend reports active where the agent lists it, else the default, set
  (a contributor model the agent hides is left); the effort shown is set.
  */
  public async matchAdvertised(): Promise<void> {
    this.ensureHeld()
    await this.inModeOrder(() => this.syncRememberedMode())
    const reported = await this.host.listModels(this.sessionId)
    const active = reported.find((model) => model.isActive)
    if (active !== undefined && this.models.some((model) => model.modelId === active.modelId)) {
      this.modelId = active.modelId
    } else {
      const listed = startingModel(
        this.models,
        this.deps.backend.kind === 'modelApi' ? this.modelId : undefined,
        this.deps.backend.kind === 'modelApi',
      )
      this.ensureHeld()
      await this.session.setModel(listed)
      this.modelId = listed
    }
    await this.applyEffort(this.effort)
  }

  /** The session's standing effort, as the panel sets it on a new session. */
  public async applyEffort(effort: EffortLevel): Promise<void> {
    const served = this.servedEffort(effort)
    this.ensureHeld()
    const revision = this.effortChangeRevision
    if (
      effortLevelsFor(
        this.modelId,
        this.models.find((model) => model.modelId === this.modelId)?.effortLevels,
      ).length > 0
    )
      await this.session.setReasoningEffort(effortForThinking(served, true))
    if (this.effortChangeRevision === revision) {
      this.effort = served
    }
  }

  /** The model and effort the editor chose for this session, for a later load. */
  public currentChoice(): {
    readonly modelId: string
    readonly effort: EffortLevel
    readonly isEffortChosen: boolean
  } {
    return { modelId: this.modelId, effort: this.effort, isEffortChosen: this.isEffortChosen }
  }

  /**
  A loaded session made to run on the remembered choice (restart
  recovery): `session/resume` takes no model, so the choice is applied
  with `session/setModel` and read back with `model/list` before anything
  is replayed or run. What the editor is shown comes from the backend's
  answer: on a mismatch the load fails instead, so nothing runs on a
  model the editor was not told.
  */
  public async restoreChoice(
    modelId: string,
    effort: EffortLevel,
    isEffortChosen: boolean,
  ): Promise<void> {
    this.ensureHeld()
    await this.inModeOrder(() => this.syncRememberedMode())
    this.ensureHeld()
    // Muse resume needs an explicit selection; Model API's loaded model is
    // authoritative and an unchanged selection must not run switch hooks.
    if (this.host.info.kind === 'museCode' || this.session.modelId !== modelId) {
      await this.session.setModel(modelId)
    }
    const reported = await this.host.listModels(this.sessionId)
    const outcome = resolveResumedModel({
      wantedModelId: modelId,
      activeModelId: reported.find((model) => model.isActive)?.modelId,
    })
    if (!outcome.ok) {
      throw RequestError.internalError(
        undefined,
        fill(UI_TEXT.modelNotKeptAfterRestart, {
          active: outcome.activeModelId,
          wanted: outcome.wantedModelId,
        }),
      )
    }
    this.modelId = outcome.modelId
    this.isEffortChosen = isEffortChosen
    await this.applyEffort(effort)
  }

  /** The mode the client last set on this session. */
  public get permissionMode(): PermissionMode {
    return this.mode
  }

  public async setMode(modeId: string): Promise<void> {
    const mode = availablePermissionModes(this.deps.options.canBypass).find(
      (candidate) => candidate === modeId,
    )
    if (mode === undefined) {
      throw RequestError.invalidParams(undefined, modeId)
    }
    this.ensureHeld()
    await this.inModeOrder(async () => {
      try {
        await this.session.setApprovalMode(approvalModeFor(mode, true))
      } catch (error: unknown) {
        if (!isPermissionReviewerError(error) && !isModeKeptError(error)) throw error
        // The host runs another mode: show it so the editor agrees with the
        // host, then report the failure in the error's own true words.
        await this.showRunningMode(error, mode)
        throw error
      }
      this.mode = mode
    })
    // The set took: tell the editor, which otherwise keeps showing the old
    // mode (it learns it only from new/load responses and this notice).
    this.send({ sessionUpdate: 'current_mode_update', currentModeId: mode })
    await this.outbox
  }

  public async setConfigOption(configId: string, value: unknown): Promise<void> {
    if (configId === ACP_CONFIG_IDS.fast) {
      if (typeof value !== 'boolean') throw RequestError.invalidParams(undefined, configId)
      const tier = this.models.find((model) => model.modelId === this.modelId)?.fastTier
      if (value && tier === undefined) throw RequestError.invalidParams(undefined, configId)
      if (this.session.setServiceTier === undefined)
        throw RequestError.internalError(undefined, UI_TEXT.actionFailed)
      this.ensureHeld()
      await this.session.setServiceTier(value ? tier?.id : undefined)
      this.fast = value
      return
    }
    if (configId === ACP_CONFIG_IDS.paidAllowAlways) {
      if (typeof value !== 'boolean') {
        throw RequestError.invalidParams(undefined, configId)
      }
      this.rememberPaid = value
      return
    }
    if (configId === ACP_CONFIG_IDS.mode) {
      if (typeof value !== 'string') {
        throw RequestError.invalidParams(undefined, configId)
      }
      await this.setMode(value)
      return
    }
    if (typeof value !== 'string') {
      throw RequestError.invalidParams(undefined, configId)
    }
    if (configId === ACP_CONFIG_IDS.account) {
      if (this.accounts === undefined)
        throw RequestError.internalError(undefined, UI_TEXT.accounts.unavailable)
      if (this.pending !== undefined || this.preparing !== undefined)
        throw RequestError.invalidRequest(undefined, UI_TEXT.acpPromptBusy)
      try {
        await this.accounts.use(
          value,
          () => !this.isDisposed && this.pending === undefined && this.preparing === undefined,
        )
      } catch (error) {
        throw accountRequestError(error)
      }
      return
    }
    if (configId === ACP_CONFIG_IDS.model) {
      const chosen = this.models.find((model) => model.modelId === value)
      if (chosen === undefined) {
        throw RequestError.invalidParams(undefined, value)
      }
      // Refused in the protocol's own error with the limit's sentence
      // (F83): a plain backend error would reach the client as a bare
      // "Internal error" with the sentence buried in its data.
      if (chosen.agentLimit !== undefined) {
        throw RequestError.invalidParams(undefined, chosen.agentLimit)
      }
      this.ensureHeld()
      const revision = this.modelChangeRevision
      await this.session.setModel(value)
      // A backend event during the command is authoritative (for example a
      // canonicalized id); its editor update must survive the command ack.
      if (this.modelChangeRevision === revision) {
        this.modelId = value
      }
      // Fast never survives a model change: it is off by default, and the
      // new model may list no priority tier at all.
      this.fast = false
      await this.session.setServiceTier?.(undefined)
      const model = this.models.find((entry) => entry.modelId === this.modelId)
      await this.applyEffort(
        model?.defaultEffort === undefined
          ? this.effort
          : defaultEffortFor(
              this.models,
              this.modelId,
              this.isEffortChosen ? this.effort : undefined,
            ),
      )
      return
    }
    if (configId !== ACP_CONFIG_IDS.effort) {
      throw RequestError.invalidParams(undefined, configId)
    }
    if (!isEffortLevel(value) || !modelEffortLevels(this.models, this.modelId).includes(value)) {
      throw RequestError.invalidParams(undefined, effortRefusalData(this.models, this.modelId))
    }
    await this.applyEffort(value)
    this.isEffortChosen = true
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

  /**
  F91: the editor hears once per session, in words, that Muse Code's
  Linux sandbox cannot start on this machine. The host start already said
  it on stderr; the posture stands until the person turns it off.
  
  This is the harness speaking, never the model (that confusion is F82).
  Where the client advertises its session-notices capability
  (`ClientSessionCapabilities::notices`), it goes as that branch's
  separate notice update; otherwise it stays an `agent_message_chunk`
  carrying a `_meta` marker (the accountNotice precedent) a client can
  tell apart from model speech, which the schema prescribes when notices
  are not advertised.
  */
  public noteSandboxCannotStart(): void {
    if (this.hasSaidSandboxCannotStart || !this.sandboxCannotStart()) {
      return
    }
    this.hasSaidSandboxCannotStart = true
    if (this.clientCapabilities.session?.notices != null) {
      this.send({
        sessionUpdate: 'notice',
        severity: 'warning',
        title: UI_TEXT.sandboxCannotStartNotice,
        _meta: { sandboxCannotStartNotice: true },
      })
      return
    }
    this.send({
      sessionUpdate: 'agent_message_chunk',
      _meta: { sandboxCannotStartNotice: true },
      content: { type: 'text', text: UI_TEXT.sandboxCannotStartNotice },
    })
  }

  public async loadQuestions(): Promise<void> {
    await this.questionRegistry?.load()
    this.ensureHeld()
    this.unsubscribe = this.session.onEvent((event) => {
      this.onEvent(event)
    })
  }

  public async prompt(
    blocks: readonly ContentBlock[],
    onAccepted?: () => void,
  ): Promise<StopReason> {
    this.ensureHeld()
    if (this.deps.resources !== undefined) {
      const update = await acpResourceCommand(blocks, this.deps.resources)
      this.ensureHeld()
      if (update !== undefined) {
        this.send(update)
        await this.outbox
        return 'end_turn'
      }
    }
    const [first] = blocks
    if (
      blocks.length === 1 &&
      first?.type === 'text' &&
      /^\/agents(?:\s|$)/.test(first.text.trim())
    ) {
      const isReadOnly = /^\/agents(?:\s+receipt\s+\S+)?\s*$/.test(first.text.trim())
      if (this.preparing !== undefined || (!isReadOnly && this.pending !== undefined))
        throw RequestError.invalidRequest(undefined, UI_TEXT.acpPromptBusy)
      const preparing: PreparingPrompt = { isCancelled: false, abort: new AbortController() }
      this.preparing = preparing
      try {
        await this.announceCommands()
        const text = await this.agentCommand(first.text.trim(), preparing)
        if (!preparing.isCancelled && !this.isDisposed) this.questionNotice(text)
        await this.outbox
        return preparing.isCancelled ? 'cancelled' : 'end_turn'
      } finally {
        if (this.preparing === preparing) this.preparing = undefined
      }
    }
    if (
      this.questionRegistry !== undefined &&
      blocks.length === 1 &&
      first?.type === 'text' &&
      /^\/(?:questions|answer)(?:\s|$)/.test(first.text.trim())
    ) {
      await this.announceCommands()
      const notice = await this.getQuestions().command(first.text)
      this.questionNotice(notice)
      await this.outbox
      return 'end_turn'
    }
    const slash = first?.type === 'text' ? vaultSlash(first.text) : undefined
    if (slash !== 'lock' && (this.pending !== undefined || this.preparing !== undefined)) {
      throw RequestError.invalidRequest(undefined, UI_TEXT.acpPromptBusy)
    }
    if (slash !== undefined) {
      if (slash === 'invalid' || blocks.length !== 1)
        throw RequestError.invalidParams(undefined, UI_TEXT.vault.noAccess)
      if (this.deps.vault === undefined)
        throw RequestError.internalError(undefined, UI_TEXT.vault.brokerBlocked)
      const preparing: PreparingPrompt | undefined =
        slash === 'lock' ? undefined : { isCancelled: false, abort: new AbortController() }
      if (preparing === undefined) this.cancelVaultRequests()
      else this.preparing = preparing
      try {
        const text = await this.deps.vault.command(slash)
        if (this.isDisposed || preparing?.isCancelled === true) return 'cancelled'
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
        await this.outbox
        return 'end_turn'
      } catch (error: unknown) {
        this.deps.log.warn(
          `ACP session ${this.sessionId}: vault command failed: ${failureForLog(error)}`,
        )
        throw RequestError.internalError(undefined, UI_TEXT.vault.brokerBlocked)
      } finally {
        if (preparing !== undefined && this.preparing === preparing) this.preparing = undefined
      }
    }
    const reportArgs = acpReportArguments(blocks)
    if (reportArgs !== undefined) {
      const reportAbort = new AbortController()
      const preparing: PreparingPrompt = { isCancelled: false, reportAbort, abort: reportAbort }
      this.preparing = preparing
      try {
        await this.announceCommands()
        if (!this.isCurrentReport(preparing)) return 'cancelled'
        const text = await runAcpReport(reportArgs, this.deps.reports, {
          cwd: this.cwd,
          sessionId: this.sessionId,
          signal: reportAbort.signal,
        })
        if ('error' in preparing) throw preparing.error
        if (!this.isCurrentReport(preparing)) return 'cancelled'
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
        await this.outbox
        return 'end_turn'
      } finally {
        this.preparing = undefined
      }
    }
    const preparing: PreparingPrompt = { isCancelled: false, abort: new AbortController() }
    this.preparing = preparing
    let parsed: Awaited<ReturnType<typeof promptParts>>
    let isCompact: boolean
    let isPlayback: boolean
    let isUsage: boolean
    let lease: Awaited<ReturnType<AcpQuestionRegistry['peekQueued']>>
    let local: Awaited<ReturnType<typeof acpPlaybook>>
    try {
      if (await this.mediaCommand(blocks, preparing.abort.signal)) {
        await this.announceCommands()
        await this.outbox
        return preparing.isCancelled ? 'cancelled' : 'end_turn'
      }
      // `/playback` with anything beside it (D203): answered as usage from
      // the raw text blocks, before `promptParts()` converts any block. The
      // joined text is exactly what `promptParts()` decides on below, so the
      // answer matches its refusal — but no attachment is resolved for it:
      // a memory-only playback must never read a file it arrived with.
      if (
        blocks.length !== 1 &&
        parsePlaybackPrompt(
          slashCommandText(
            blocks
              .flatMap((block) => (block.type === 'text' ? block.text : []))
              .join(PART_SEPARATOR),
          ),
        ) !== undefined
      ) {
        return await this.answerPlaybackUsage(preparing)
      }
      if (await this.uploadsCommand(blocks, preparing.abort.signal)) {
        await this.announceCommands()
        await this.outbox
        return preparing.isCancelled ? 'cancelled' : 'end_turn'
      }
      // Only media links need the port: ordinary links stay mentions even
      // when the factory binds (M105 E2 review).
      const isNeedsMedia = blocks.some(
        (block) =>
          block.type === 'audio' ||
          (block.type === 'resource_link' && isMediaLink(block)) ||
          (block.type === 'resource' &&
            'blob' in block.resource &&
            !/^(?:image\/|application\/pdf$)/u.test(block.resource.mimeType ?? '')),
      )
      const media =
        isNeedsMedia && this.deps.media !== undefined ? await this.mediaPort() : undefined
      parsed = await promptParts(
        blocks,
        this.cwd,
        media,
        this.deps.backend.kind === 'modelApi',
        preparing.abort.signal,
      )
      if (!parsed.ok) throw RequestError.invalidParams(undefined, parsed.reason)
      // Every local command below is decided on this one text, the same one
      // the skill parser reads (withSkill). Matching the text as sent let
      // " /schedule list" pass the schedule refusal and still run a workspace
      // skill of that name, or start a model turn (RVCX1F F1).
      const typed = slashCommandText(parsed.displayText)
      if (/^\/estimate(?:\s|$)/.test(typed)) {
        const controller = preparing.abort
        try {
          await this.announceCommands()
          if ('error' in preparing) throw preparing.error
          if (this.wasEstimateCancelled(preparing)) return 'cancelled'
          let text =
            this.deps.estimate !== undefined &&
            this.deps.estimate.isAvailable !== false &&
            parsed.parts.length !== 1
              ? UI_TEXT.estimateUsage
              : UI_TEXT.estimateRuntimeUnavailable
          if (
            this.deps.estimate !== undefined &&
            this.deps.estimate.isAvailable !== false &&
            parsed.parts.length === 1
          )
            text = await this.deps.estimate.run(typed, this.cwd, controller.signal)
          if ('error' in preparing) throw preparing.error
          if (this.wasEstimateCancelled(preparing)) return 'cancelled'
          this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
          await this.outbox
          return 'end_turn'
        } catch (error: unknown) {
          this.deps.log.warn(
            `ACP session ${this.sessionId}: estimate failed: ${failureForLog(error)}`,
          )
          if (this.wasEstimateCancelled(preparing)) return 'cancelled'
          if ('error' in preparing) throw preparing.error
          this.send({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: estimateFailureText(error),
            },
          })
          await this.outbox
          return 'end_turn'
        } finally {
          this.preparing = undefined
        }
      }

      if (
        ['/legal', '/legal --offline'].includes(typed) &&
        this.deps.legalScan !== undefined &&
        parsed.parts.every((part) => part.type === 'text')
      )
        return await this.runLegalScan(this.deps.legalScan, typed === '/legal')
      const [part] = parsed.parts
      isCompact =
        parsed.parts.length === 1 &&
        part?.type === 'text' &&
        part.text.trim() === `/${ACP_COMPACT_COMMAND}`
      if (
        parsed.parts.length === 1 &&
        part?.type === 'text' &&
        part.text.trim() === `/${SLASH_COMMAND_NAMES.help}`
      ) {
        await this.announceCommands()
        if ('error' in preparing) throw preparing.error
        if (!preparing.isCancelled)
          this.send({
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: compactReference(this.availableCommands().map((command) => command.name)),
            },
          })
        await this.outbox
        return preparing.isCancelled ? 'cancelled' : 'end_turn'
      }
      // A reserved command, decided on the one typed text like the others:
      // anything after the name stays a local answer, never a skill or a
      // model turn (the reserved-command rule below). Attached files,
      // images or resources never ride along to the model: they are
      // refused instead of starting a billed turn (Codex on PR #212).
      if (/^\/whatsnew(?:\s|$)/.test(typed)) {
        if (parsed.parts.some((part) => part.type !== 'text'))
          throw RequestError.invalidParams(undefined, UI_TEXT.whatsNewAttachmentsRefused)
        await this.announceCommands()
        if ('error' in preparing) throw preparing.error
        if (!preparing.isCancelled)
          this.send({
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: this.whatsNewText() },
          })
        await this.outbox
        return preparing.isCancelled ? 'cancelled' : 'end_turn'
      }
      // `/playback` (D203): a memory-only turn, recognised on the command
      // text as every local command is. With anything after it, or any
      // other block or part beside it (an image, a resource, more text),
      // usage instead: a playback takes no arguments, and nothing it came
      // with may run as an ordinary turn with tools.
      const playbackCommand = parsePlaybackPrompt(typed)
      if (
        playbackCommand?.kind === 'usage' ||
        (playbackCommand !== undefined &&
          (blocks.length !== 1 || parsed.parts.length !== 1 || part?.type !== 'text'))
      ) {
        return await this.answerPlaybackUsage(preparing)
      }
      isPlayback = playbackCommand?.kind === 'run'
      local = await acpPlaybook(
        blocks,
        () => this.deps.playbookFor?.(this.cwd, this.sessionId),
        () => {
          const bundle = this.deps.playbookBundle?.()
          if (bundle === undefined) throw new Error(UI_TEXT.playbookUnavailable)
          return bundle
        },
      )
      if (local === undefined) await this.announceCommands()
      if (/^\/schedule(?:\s|$)/.test(typed)) {
        const result =
          this.deps.schedules === undefined ||
          this.deps.schedules.isAvailable === false ||
          !this.isScheduleHostAvailable
            ? UI_TEXT.scheduleV2.runtime.unavailable
            : await this.deps.schedules.run(typed, {
                cwd: this.cwd,
                sessionId: this.sessionId,
                backend: this.deps.backend.kind,
                ...this.deps.options.scheduleAuthorization,
              })
        if (preparing.isCancelled) return 'cancelled'
        if ('error' in preparing) throw preparing.error
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result } })
        await this.outbox
        return 'end_turn'
      }
      if (/^\/accounts(?:\s|$)/.test(typed)) {
        if (this.accounts === undefined)
          throw RequestError.internalError(undefined, UI_TEXT.accounts.unavailable)
        if (parsed.parts.length !== 1)
          throw RequestError.invalidParams(undefined, UI_TEXT.accounts.invalidAccount)
        let text: string | undefined
        try {
          text = await this.accounts.command(
            typed,
            () => !this.isDisposed && !preparing.isCancelled && !('error' in preparing),
          )
        } catch (error) {
          throw accountRequestError(error)
        }
        if (preparing.isCancelled || this.isDisposed) return 'cancelled'
        if (text !== undefined)
          this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
        await this.outbox
        return 'end_turn'
      }
      // Reserved local commands never become a skill or a model turn, even when
      // their runtime bridge has not been bound yet or their syntax is invalid.
      const sharingLocal = parseSkillInvocation(parsed.displayText, new Set(['share', 'prompt']))
      if (sharingLocal !== undefined) {
        if (blocks.length !== 1 || blocks[0]?.type !== 'text') {
          throw RequestError.invalidParams(undefined, UI_TEXT.promptFileInvalid)
        }
        const sharing = this.deps.sharing
        if (sharing === undefined) {
          throw RequestError.invalidRequest(
            undefined,
            fill(UI_TEXT.acpUnknownArgument, {
              argument: `/${sharingLocal.selector}`,
            }),
          )
        }
        const isActive = () =>
          !this.isDisposed &&
          this.preparing === preparing &&
          !preparing.isCancelled &&
          !('error' in preparing)
        if (!isActive()) return 'cancelled'
        const text = await unlessAborted(
          sharing.execute(parsed.displayText, {
            cwd: this.cwd,
            sessionId: this.sessionId,
            isActive,
            signal: preparing.abort.signal,
          }),
          preparing.abort.signal,
        )
        if ('error' in preparing) throw preparing.error
        if (text === undefined || !isActive()) return 'cancelled'
        this.send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
        await this.outbox
        return 'end_turn'
      }
      isUsage = await this.usageReply(blocks, preparing)
      if (!isUsage && !isCompact && !isPlayback && local === undefined)
        lease = await this.questionRegistry?.peekQueued()
    } catch (error: unknown) {
      // Peeking is the try's last step, so no answer lease is held here.
      if ('error' in preparing) throw preparing.error
      if (!preparing.isCancelled) throw error
      await this.outbox
      return 'cancelled'
    } finally {
      if (this.preparing === preparing) this.preparing = undefined
    }
    if ('error' in preparing) {
      if (lease !== undefined) await this.questionRegistry?.releaseQueued(lease.token)
      throw preparing.error
    }
    if (preparing.isCancelled) {
      if (lease !== undefined) await this.questionRegistry?.releaseQueued(lease.token)
      await this.outbox
      return 'cancelled'
    }
    if (local !== undefined) {
      this.send({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: local.text },
      })
      await this.outbox
      return 'end_turn'
    }
    if (isUsage) {
      await this.outbox
      return 'end_turn'
    }
    // Outcomes are values: a host exit before turn/start answers must not
    // reject a promise that the prompt has not yet reached (Node would exit).
    // Promise executors run synchronously; pending is assigned before sendTurn.
    let pending!: PendingPrompt
    const finished = new Promise<PromptOutcome>((resolve) => {
      pending = {
        resolve: (reason) => {
          resolve({ reason })
        },
        reject: (error: unknown) => {
          resolve({ error })
        },
        turnId: undefined,
        isCancelled: false,
        earlyAdmissions: new Set(),
        answerLease: lease,
      }
    })
    this.pending = pending
    // From here a cancel also stops the client's own waiting requests.
    this.clientStop = new AbortController()
    try {
      if (isCompact) {
        // The same AgentSession core serves interactive ACP and runExec. A
        // compact starts synchronously, so cancellation need not wait for it.
        // No answer lease is peeked for a compact: a queued answer stays queued.
        const outcome = await this.session.compact()
        this.finishCompaction(outcome.status)
      } else {
        // No answer lease is peeked for a playback: a queued answer stays
        // queued. No media rides one either: it answers from memory only.
        // The sandbox note rides an ordinary turn's tail only (F91), as on
        // the panel: a playback carries its own text alone.
        const mediaQueued = isPlayback ? [] : [...this.attachments]
        const sandboxNote = this.sandboxModelNote()
        const starting = isPlayback
          ? this.startPlaybackTurn()
          : this.session.sendTurn(
              [
                ...(pending.answerLease?.parts ?? []),
                ...this.withSkill([
                  ...parsed.parts,
                  ...mediaQueued.map((attachment) => attachment.part),
                ]),
                ...sandboxNote,
              ],
              parsed.displayText,
            )
        this.starting = starting
        const submission = await starting
        this.attachments.splice(0, mediaQueued.length)
        void finished
          .then(async () => {
            await Promise.all(
              mediaQueued.flatMap((attachment) =>
                attachment.dispose === undefined ? [] : [attachment.dispose()],
              ),
            )
          })
          .catch(() => {
            this.deps.log.warn('ACP media cleanup: cleanup_failed')
          })
        if (submission.userMessageId !== undefined) pending.userMessageId = submission.userMessageId
        const isAccepted =
          submission.disposition === 'started' || submission.disposition === 'queued'
        // The turn reached Muse Code, so an appended sandbox note rode with
        // it: only now is it marked as told to the model.
        if (isAccepted && sandboxNote.length > 0) {
          this.hasToldModelSandboxCannotStart = true
        }
        if (isAccepted) onAccepted?.()
        // Decide before noting the turn: a turn that already finished settles
        // the prompt there, which must not release the answers it delivered.
        if (
          isAccepted &&
          this.pending === pending &&
          (pending.userMessageId === undefined
            ? submission.disposition === 'started' ||
              this.activeTurnId === submission.turnId ||
              this.earlyFinishes.has(submission.turnId)
            : pending.earlyAdmissions.has(pending.userMessageId))
        ) {
          this.commitAnswers(pending)
        }
        this.noteTurnId(submission.turnId, submission.disposition)
        if (!isAccepted) {
          throw RequestError.internalError(undefined, UI_TEXT.answerNotAccepted)
        }
      }
    } catch (error: unknown) {
      await this.releaseAnswers(pending)
      if (this.pending === pending) this.pending = undefined
      if (this.isDisposed) {
        // Let go while starting: a close cancels; a host exit fails.
        const outcome = await finished
        if ('error' in outcome) {
          throw outcome.error
        }
        return outcome.reason
      }
      // M105 lane V R4 (RVCM1054C P3): no codec branch here. The real
      // Model API session never rejects sendTurn with a codec refusal:
      // submitTurn starts the turn detached and resolves, and the refusal
      // fails the turn as turnCompleted with the sentence as reason
      // (ModelApiHost.ts: reason = describe(error)), settled above at
      // settle. A raw error here keeps the SDK's shape unchanged.
      throw error
    } finally {
      this.starting = undefined
    }
    const outcome = await finished
    this.clientStop = undefined
    await pending.answerCommit
    if ('error' in outcome) {
      throw outcome.error
    }
    await this.outbox
    return outcome.reason
  }

  public async cancel(): Promise<void> {
    this.legalStop?.abort()
    this.clientStop?.abort()
    this.cancelVaultRequests()
    if (this.cancelPreparing()) {
      this.deps.log.info(`ACP session ${this.sessionId}: cancelled before its turn started`)
    }
    if (this.pending === undefined && this.activeTurnId === undefined) {
      return
    }
    if (this.pending === undefined) this.activeTurnId = undefined
    else this.pending.isCancelled = true
    void this.releaseAnswers()
    void this.endQuestions(true).catch(() => {
      this.questionStateNotSaved()
    })
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
      this.preparing.abandonElicitation?.()
      this.preparing.abort.abort()
      this.preparing.reportAbort?.abort()
    }
    this.pending?.reject(error)
    void this.releaseAnswers()
    this.pending = undefined
    this.clientStop?.abort()
    this.clientStop = undefined
    void this.endQuestions(false).catch(() => {
      this.questionStateNotSaved()
    })
  }

  public get isReleased(): boolean {
    return this.isDisposed
  }

  public async holdSchedules(): Promise<void> {
    if (this.deps.schedules?.isAvailable === false) return
    try {
      const release = await this.deps.schedules?.holdWorkspace?.(this.cwd, {
        agent: this.session,
        backend: this.deps.backend.kind,
        ...(this.activeTurnId !== undefined && { activeTurnId: this.activeTurnId }),
        row: (text) => {
          this.questionNotice(text)
        },
        deferQuestions: async (event, context) => {
          if (this.questionRegistry === undefined) throw new Error(UI_TEXT.questionAnswerFailed)
          await this.questionRegistry.register(event, {
            askedAt: Date.now(),
            turnId: this.activeTurnId ?? context.runId,
          })
          await this.questionRegistry.defer(event.userInputId)
        },
      })
      if (this.isDisposed) await release?.()
      else this.releaseSchedules = release
    } catch {
      this.isScheduleHostAvailable = false
      this.deps.log.warn('ACP schedule workspace startup failed')
      observeError(this.deps, 'scheduleHostStartFailed')
      this.send({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: UI_TEXT.scheduleV2.runtime.hostUnavailable },
      })
    }
  }

  /**
  Let go (closed, loaded again, or never set up). At once it stops
  following the backend, the editor's late answers decide nothing, and a
  prompt it was running ends cancelled. That turn is then stopped on the
  backend too, once it has started, as the editor was told; a turn left
  running would go on editing and billing with no one watching, and a
  session loaded again shares the backend session, so nothing else would
  stop it. Then the backend session is let go.
  */
  public async release(): Promise<void> {
    if (this.isDisposed) {
      return
    }
    this.isDisposed = true
    this.dictationStop.abort()
    await Promise.all([...this.dictationPages].map((page) => page.close()))
    this.dictationPages.clear()
    this.legalStop?.abort()
    this.clientStop?.abort()
    this.clientStop = undefined
    const releasingAnswers = this.releaseAnswers()
    this.questions?.dispose()
    if (this.questions === undefined) this.questionRegistry?.dispose()
    this.accounts?.dispose()
    this.cancelVaultRequests()
    this.cancelPreparing()
    const wasRunning = this.pending !== undefined || this.activeTurnId !== undefined
    this.pending?.resolve('cancelled')
    this.pending = undefined
    this.unsubscribe?.()
    this.unsubscribeResources?.()
    const releaseSchedules = this.releaseSchedules
    this.releaseSchedules = undefined
    // Start Stop first, independently of the optional workspace watcher.
    const stop = (async () => {
      // Stopped once its start is answered, even a start that failed: one
      // past its deadline (Muse Code's `turn/start`) may still start.
      if (wasRunning) {
        try {
          await this.starting
        } catch {
          // The prompt that started it has already ended cancelled.
        }
        await this.cancelTurn()
      }
      await releasingAnswers
      this.session.dispose()
    })()
    let deadline: ReturnType<typeof setTimeout> | undefined
    const cleanup = (async () => {
      try {
        await Promise.race([
          (async () => {
            await releaseSchedules?.()
          })(),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => {
              reject(new Error(UI_TEXT.scheduleV2.runtime.unavailable))
            }, SCHEDULE_ACP_RELEASE_TIMEOUT_MS)
          }),
        ])
      } catch {
        this.deps.log.warn('ACP schedule workspace release failed')
        observeError(this.deps, 'scheduleReleaseFailed')
      } finally {
        clearTimeout(deadline)
      }
    })()
    await Promise.all([stop, cleanup])
    await Promise.all(
      this.attachments
        .splice(0)
        .flatMap((attachment) => (attachment.dispose === undefined ? [] : [attachment.dispose()])),
    )
    // The registry lets go of what this session attached (RVMEDIAV 7).
    if (this.media === undefined) return
    let port: AcpMediaPort
    try {
      port = await this.media
    } catch {
      // A port that never loaded registered nothing.
      return
    }
    port.release()
  }
}

/** The agent's state across the connection: the client's capabilities and the live sessions. */
class AgentState {
  private readonly sessions = new Map<string, AcpSession>()
  /**
  The model and effort the editor chose per session: a load after the
  backend restarted re-applies them and reads them back, so the session
  keeps running on the chosen model instead of the CLI's default.
  */
  private readonly choices = new Map<string, ReturnType<AcpSession['currentChoice']>>()
  /** Sessions being set up (`adopt`), by id: a newer load or a close lets them go too. */
  private readonly adopting = new Map<string, AcpSession>()
  private readonly claims = new Map<string, SessionClaim>()
  /** Modes clients set (`session/set_mode`): a later load keeps them, not the initial mode. */
  private readonly sessionModes = new Map<string, PermissionMode>()
  /** Further workspace roots each session was opened with (G09), by id. */
  private readonly additionalRoots = new Map<string, readonly string[]>()
  /** Remains visible even when the session is no longer available for requests. */
  private readonly releasing = new Map<string, Promise<unknown>>()
  private readonly watchedHosts = new WeakSet<AgentHost>()
  private readonly exitedHosts = new WeakSet<AgentHost>()
  private clientCapabilities: ClientCapabilities = {}

  public constructor(private readonly deps: AcpAgentDeps) {}

  /**
  The sign-in: run by the client in a terminal where it can (the spec
  allows a terminal method only then), otherwise by the user, whose
  `authenticate` this checks.
  */
  private authMethod(method: SignInMethod): AuthMethod {
    const { id, name, description, args, command } = method
    // Registry clients may announce terminal support with the older `_meta`
    // `terminal-auth` flag instead of `auth.terminal`. Only a literal `true`
    // counts on either form; any other value is no announcement.
    const hasTerminal =
      this.clientCapabilities.auth?.terminal === true ||
      this.clientCapabilities._meta?.['terminal-auth'] === true
    return hasTerminal
      ? { type: 'terminal', id, name, description, args: [...args] }
      : { id, name, description: fill(UI_TEXT.acpSignInByHand, { command }) }
  }

  private async requireReady(
    isRecheck = false,
    isStoreDownAllowed = false,
  ): Promise<BackendReadiness> {
    const readiness = await this.deps.backend.readiness(isRecheck)
    if (readiness.state === 'signedOut' && !(isStoreDownAllowed && readiness.storeDown === true)) {
      throw RequestError.authRequired(undefined, readiness.message)
    }
    if (readiness.state === 'unavailable') {
      throw RequestError.internalError(undefined, readiness.message)
    }
    return readiness
  }

  private async openHost(
    cwd: string,
  ): Promise<{ readonly host: AgentHost; readonly models: readonly ModelSummary[] }> {
    if (!path.isAbsolute(cwd)) {
      throw RequestError.invalidParams(undefined, cwd)
    }
    // A dead credential store does not stop the session from opening: only
    // a step that needs a stored key refuses, in the store-down words.
    const readiness = await this.requireReady(false, true)
    const host = await this.deps.backend.hostFor(cwd)
    this.watch(host)
    let listed: readonly ModelSummary[]
    try {
      listed = await host.listModels()
    } catch (error: unknown) {
      // A providers file that cannot be read is the person's to fix: its own
      // sentence is the message the editor shows, as the readiness check's
      // is, never a bare "Internal error" with the sentence only in its data.
      if (isInvalidProvidersFileError(error))
        throw RequestError.internalError(undefined, error.message)
      if (!isCredentialStoreDown(error)) throw error
      throw RequestError.authRequired(undefined, UI_TEXT.acpStoreDown)
    }
    // No models without a readable store or key: the catalogue, the grant
    // and the key all need the store. Say so instead of offering no model.
    if (listed.length === 0 && readiness.state === 'signedOut' && readiness.storeDown === true)
      throw RequestError.authRequired(undefined, UI_TEXT.acpStoreDown)
    const models = this.deps.options.allowsContributorModels
      ? listed
      : listed.filter((model) => !isContributorModel(model.modelId))
    return { host, models }
  }

  /**
  A backend session the agent now owns (new, loaded or resumed), held only
  once `prepare` has set what the editor is shown: until then no request
  finds it, and if anything fails the backend session is let go and the
  request fails, so no session outlives a request that returned no id.
  */
  private async adopt(
    host: AgentHost,
    session: AgentSession,
    cwd: string,
    client: AgentContext,
    models: readonly ModelSummary[],
    claim: SessionClaim,
    prepare: (acp: AcpSession) => Promise<void>,
    isImported = false,
    activeTurnId?: string,
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
        adoptedMode(this.sessionModes.get(sessionId), this.deps.options.initialMode, isImported),
        session.modelId,
        activeTurnId,
        () => {
          // A replaced or released surface cannot overwrite its successor.
          if (
            acp !== undefined &&
            !acp.isReleased &&
            (this.sessions.get(sessionId) === acp || this.adopting.get(sessionId) === acp)
          ) {
            this.choices.set(sessionId, acp.currentChoice())
          }
        },
      )
      this.adopting.set(sessionId, acp)
      await acp.loadQuestions()
      await acp.holdSchedules()
      await prepare(acp)
      await acp.startAccounts()
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
    // F91: a newly adopted session hears once, in words, when Muse Code's
    // Linux sandbox cannot start on this machine.
    acp.noteSandboxCannotStart()
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
  Lets go of the session held for `sessionId` and one being set up, so no
  request finds either; resolves once each has stopped its turn and let
  its backend session go. False when there was neither.
  */
  private async releaseAll(sessionId: string): Promise<boolean> {
    const found = [this.sessions.get(sessionId), this.adopting.get(sessionId)].filter(
      (acp) => acp !== undefined,
    )
    this.sessions.delete(sessionId)
    this.adopting.delete(sessionId)
    this.additionalRoots.delete(sessionId)
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
  The editor's MCP servers for a session (M63c): passed to Muse Code when
  it granted `sessionMcp`; the Model API backend runs none. Only their
  names are logged, as headers and environments can hold secrets.
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
        promptCapabilities: { image: true, audio: true, embeddedContext: true },
        // Stdio servers every agent takes; HTTP ones Muse Code runs too (M63c).
        mcpCapabilities: { http: this.deps.backend.kind === 'museCode', sse: false },
        sessionCapabilities: {
          list: {},
          resume: {},
          close: {},
          // Deletion from `session/list`: the Model API backend removes the
          // session from its own store. A Muse Code host deletes only where
          // its CLI still serves `session/delete` (D26); the request then
          // refuses with the real cause instead.
          ...(this.deps.backend.kind === 'modelApi' && { delete: {} }),
          // New, load and resume take extra workspace roots, and listing
          // reports them (G09).
          additionalDirectories: {},
        },
        // The agent ends its authenticated state on `logout` (G03): held
        // sessions stop, and where it owns the credential (Model API) the
        // stored key goes too. The CLI's own sign-in is the user's to end.
        auth: { logout: {} },
      },
      authMethods: [this.deps.signIn, ...(this.deps.providerSignIns ?? [])].map((method) =>
        this.authMethod(method),
      ),
      agentInfo: { name: ACP_AGENT_NAME, title: ACP_AGENT_TITLE, version: this.deps.version },
    }
  }

  /** Confirms the sign-in took; the client asks again if not. */
  public async authenticate(methodId: string): Promise<Record<string, never>> {
    const provider = this.deps.providerSignIns?.find((method) => method.id === methodId)
    if (provider?.verify !== undefined) {
      const failure = await provider.verify()
      if (failure !== undefined) throw RequestError.authRequired(undefined, failure)
      return {}
    }
    if (methodId !== this.deps.signIn.id) throw RequestError.invalidParams()
    await this.requireReady(true)
    return {}
  }

  public async newSession(
    cwd: string,
    requestedMcp: readonly McpServer[] | undefined,
    client: AgentContext,
    additionalDirectories?: readonly string[],
  ) {
    const roots = parseAdditionalDirectories(additionalDirectories)
    const { host, models } = await this.openHost(cwd)
    const modelId = startingModel(
      models,
      this.deps.options.initialModelId,
      this.deps.backend.kind === 'modelApi',
    )
    const mcpServers = this.forwardedMcp(host, requestedMcp)
    // The start carries no account identity: a step that needs a stored key
    // refuses then, in the one store sentence, never at the open.
    const approvalMode = approvalModeFor(this.deps.options.initialMode, true)
    // Manual asks the person because the session reviews with `:ask-me`
    // instead of Muse Code's judge (Muse Code 1.4.7); Auto keeps the judge
    // its words describe. Omitted profiles keep the host default, which is
    // what every headless session starts with, as before.
    const permissionProfile = mspStartPermissionProfile(
      approvalMode,
      this.deps.options.isHeadless === true,
    )
    const session = await host.startSession({
      workspaceRoot: cwd,
      modelId,
      approvalMode,
      ...(permissionProfile !== undefined && { permissionProfile }),
      ...(mcpServers !== undefined && { mcpServers }),
    })
    // The mode and model went with the start; the effort is set here. A
    // plan model starts on its catalogue default unless the person chose one.
    const claim = this.claimSession(session.sessionId)
    const acp = await this.adopt(host, session, cwd, client, models, claim, (started) =>
      started.applyEffort(defaultEffortFor(models, modelId)),
    )
    // Keep what the editor is shown, including backend events during setup.
    this.choices.set(session.sessionId, acp.currentChoice())
    this.additionalRoots.set(session.sessionId, [...roots])
    return { sessionId: session.sessionId, modes: acp.modes(), configOptions: acp.configOptions() }
  }

  public async loadSession(
    sessionId: string,
    cwd: string,
    requestedMcp: readonly McpServer[] | undefined,
    client: AgentContext,
    isReplayed: boolean,
    additionalDirectories?: readonly string[],
  ) {
    // Claimed before backend I/O: a slow older resume cannot replace a
    // newer request, and a close can invalidate one still loading.
    const claim = this.claimSession(sessionId)
    // A non-empty list replaces the session's whole extra-root list, as the
    // protocol says; omitted or empty keeps it rootless.
    const roots = parseAdditionalDirectories(additionalDirectories)
    try {
      const { host, models } = await this.openHost(cwd)
      this.ensureClaim(claim, host)
      const loaded = await host.resumeSession(
        sessionId,
        startingModel(
          models,
          this.deps.options.initialModelId,
          this.deps.backend.kind === 'modelApi',
        ),
        this.forwardedMcp(host, requestedMcp),
      )
      // A session resumes on the approval mode, model and effort it last had,
      // which may differ from what the editor is told (a more permissive mode,
      // a hidden model): they are set before anything is replayed, as the
      // panel sets its own on a resume. Nothing is shown that does not run:
      // if the backend refuses, the load fails instead. Where the editor
      // chose a model and effort in this process, that choice is applied and
      // read back first, so a restart keeps running on it.
      const remembered = this.choices.get(sessionId)
      const acp = await this.adopt(
        host,
        loaded.session,
        cwd,
        client,
        models,
        claim,
        async (resumed) => {
          if (remembered === undefined) {
            await resumed.matchAdvertised()
          } else {
            await resumed.restoreChoice(
              remembered.modelId,
              remembered.effort,
              remembered.isEffortChosen,
            )
          }
          if (!isReplayed) {
            return
          }
          await resumed.replay([...loaded.history.items])
          resumed.sendPlan(loaded.history.todos)
        },
        loaded.record.imported === true,
        loaded.activeTurnId,
      )
      this.choices.set(sessionId, acp.currentChoice())
      this.additionalRoots.set(sessionId, [...roots])
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
      sessions: page.sessions.map((record) => {
        const roots = this.additionalRoots.get(record.sessionId)
        return {
          sessionId: record.sessionId,
          cwd: record.workspaceRoot ?? folder,
          // The panel's own label: the person's words, never the extension's
          // notes, quoted passages or attached files (sessionRecords.ts).
          title: sessionTitle(record),
          updatedAt: record.lastActivityAt ?? record.updatedAt,
          // What this agent opened the session with; stored sessions from
          // before report nothing, and omitted means none either way.
          ...(roots !== undefined && roots.length > 0 && { additionalDirectories: [...roots] }),
        }
      }),
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

  /** The mode the client set for a session, kept across later loads. */
  public async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.session(sessionId)
    await session.setMode(modeId)
    this.sessionModes.set(sessionId, session.permissionMode)
  }

  /** Remember the editor's latest model/effort choice for a later load. */
  public noteChoice(sessionId: string): void {
    const held = this.sessions.get(sessionId)
    if (held !== undefined) {
      this.choices.set(sessionId, held.currentChoice())
    }
  }

  /** The editor closes a session: the one held, or one still being set up. */
  public async closeSession(sessionId: string): Promise<void> {
    const wasClaimed = this.claims.delete(sessionId)
    // Close releases the live handle, not history or the client's selected mode.
    const wasReleased = await this.releaseAll(sessionId)
    this.choices.delete(sessionId)
    if (!wasClaimed && !wasReleased) {
      throw RequestError.resourceNotFound(sessionId)
    }
  }

  /**
  The editor deletes a listed session for good: a held copy is released
  first, so a running turn settles before the store goes, then the
  backend removes it through `AgentHost.deleteSession`. A host that
  cannot delete, and any failure, answers with the real cause.
  */
  public async deleteSession(sessionId: string): Promise<void> {
    const held = this.sessions.get(sessionId) ?? this.adopting.get(sessionId)
    let host: AgentHost | undefined = held?.host
    if (host === undefined) {
      const opened = await this.openHost(this.deps.defaultCwd)
      host = opened.host
    }
    // A host that cannot delete refuses before anything is released: the
    // held session and the editor's remembered choice stay usable.
    if (!host.info.canDeleteSessions) {
      throw RequestError.internalError(
        undefined,
        fill(UI_TEXT.sessionDeleteUnsupported, { version: host.info.serverVersion }),
      )
    }
    if (held !== undefined) {
      await this.releaseAll(sessionId)
      this.choices.delete(sessionId)
    }
    try {
      await host.deleteSession(sessionId)
    } catch (error: unknown) {
      // A refused delete answers with the failure's kind, never the raw
      // failure: names stay fixed-vocabulary on the wire.
      throw RequestError.internalError(undefined, failureForLog(error))
    }
  }

  /**
  The editor signs out (ACP-G03, stable 2026-05-22): every held session
  stops, and the credential the agent itself keeps (the Model API key)
  is removed, so the next turn asks to sign in again. The Muse Code
  CLI's own sign-in stays the user's to end, as its sign-in stays the
  user's to run.
  */
  public async logout(): Promise<void> {
    this.claims.clear()
    for (const sessionId of [...this.sessions.keys(), ...this.adopting.keys()]) {
      await this.releaseAll(sessionId)
    }
    await this.deps.signOut?.()
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

  /** An "always" the session's answer gave but the store could not keep. */
  public notePaidNotKept(sessionId: string, text: string): void {
    const acp = this.sessions.get(sessionId)
    if (acp === undefined) {
      this.deps.log.warn(
        `ACP session ${sessionId} is gone, so its not-kept paid choice stays only in the log`,
      )
      return
    }
    acp.notePaidNotKept(text)
  }

  public async askVaultUse(
    sessionId: string,
    request: VaultApprovalRequest,
  ): Promise<VaultApprovalAnswer> {
    const session = this.sessions.get(sessionId)
    return session === undefined
      ? { requestId: request.id, digest: request.digest, decision: 'deny' }
      : await session.askVaultUse(request)
  }
}

/** The agent: register it on a stream with `connect`. */
export function createAcpAgent(deps: AcpAgentDeps): AgentApp {
  const state = new AgentState(deps)
  deps.vault?.attach((sessionId, request) => state.askVaultUse(sessionId, request))
  deps.paid.attach((sessionId, request, canRemember) =>
    state.askPaidUse(sessionId, request, canRemember),
  )
  deps.paid.attachNotify((sessionId, text) => {
    state.notePaidNotKept(sessionId, text)
  })
  return acpAgent({ name: ACP_AGENT_NAME })
    .onRequest('initialize', (context) => {
      deps.onClientName?.(context.params.clientInfo?.name ?? 'ACP')
      return state.initialize(context.params.clientCapabilities)
    })
    .onRequest('authenticate', (context) => state.authenticate(context.params.methodId))
    .onRequest('logout', async () => {
      await state.logout()
      return {}
    })
    .onRequest('session/new', (context) =>
      state.newSession(
        context.params.cwd,
        context.params.mcpServers,
        context.client,
        context.params.additionalDirectories ?? undefined,
      ),
    )
    .onRequest('session/load', (context) => {
      const { sessionId, cwd, mcpServers } = context.params
      return state.loadSession(
        sessionId,
        cwd,
        mcpServers,
        context.client,
        true,
        context.params.additionalDirectories ?? undefined,
      )
    })
    .onRequest('session/resume', (context) => {
      const { sessionId, cwd, mcpServers } = context.params
      return state.loadSession(
        sessionId,
        cwd,
        mcpServers ?? undefined,
        context.client,
        false,
        context.params.additionalDirectories ?? undefined,
      )
    })
    .onRequest('session/list', (context) =>
      state.listSessions(context.params.cwd ?? undefined, context.params.cursor ?? undefined),
    )
    .onRequest('session/close', async (context) => {
      await state.closeSession(context.params.sessionId)
      return {}
    })
    .onRequest('session/delete', async (context) => {
      await state.deleteSession(context.params.sessionId)
      return {}
    })
    .onRequest('session/set_mode', async (context) => {
      await state.setSessionMode(context.params.sessionId, context.params.modeId)
      return {}
    })
    .onRequest('session/set_config_option', async (context) => {
      const session = state.session(context.params.sessionId)
      await session.setConfigOption(context.params.configId, context.params.value)
      state.noteChoice(context.params.sessionId)
      return { configOptions: session.configOptions() }
    })
    .onRequest('session/prompt', async (context) => {
      const session = state.session(context.params.sessionId)
      // `$/cancel_request` aborts this request's signal in the SDK's
      // JSON-RPC layer (G04): end the turn the way `session/cancel` does
      // and answer with the cancellation marker the protocol allows.
      const stop = context.signal
      if (stop.aborted) {
        await session.cancel()
        return { stopReason: 'cancelled' }
      }
      const onStop = (): void => {
        void session.cancel()
      }
      stop.addEventListener('abort', onStop, { once: true })
      try {
        return { stopReason: await session.prompt(context.params.prompt) }
      } finally {
        stop.removeEventListener('abort', onStop)
      }
    })
    .onNotification('session/cancel', async (context) => {
      // A notification has no answer: a cancel for a session already
      // closed, still being set up, or never held stops nothing.
      await state.held(context.params.sessionId)?.cancel()
    })
}
