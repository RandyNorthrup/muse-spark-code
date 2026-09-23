// One conversation per surface: owns the MSP session for that surface, turns
// webview requests into backend calls, and streams AgentEvents back. Also the
// source of truth for the composer settings that outlive a webview reload
// (permission mode, effort, thinking) and for the images waiting to be sent.

import path from 'node:path'
import { Buffer } from 'node:buffer'
import { AttachmentStore } from '../../core/attachments'
import {
  type AgentHost,
  type AgentSession,
  type BackendKind,
  type HostExit,
  type LoadedSession,
  PromptSettledError,
  type PromptSettledReason,
  type SessionHistoryOutcome,
  type SessionListEvent,
  type SessionMcpHttpServer,
  SessionNotLoadedError,
  type SessionRecord,
  type TurnPart,
  type TurnSubmission,
} from '../../core/agent/agentBackend'
import { toSessionRow } from '../../core/agent/sessionRows'
import {
  isProfileWorkspaceLimited,
  type ShellSandboxPosture,
} from '../../core/backends/musecode/sandbox'
import { chatReferenceText } from '../../core/chatReference'
import { type EditorContext, editorContextText } from '../../core/editorContext'
import type { DictationHandle, DictationStatus } from '../../core/voice/dictation'
import {
  ALLOWED_LINK_SCHEMES,
  AUTH_REQUIRED_ERROR_KIND,
  CONTRIBUTOR_MODEL_SUFFIX,
  DEFAULT_EFFORT,
  DEFAULT_MODEL_ID,
  type DictationAction,
  type EffortLevel,
  IDE_MCP_SERVER_NAME,
  IMAGE_EXTENSIONS,
  MENTION_RESULT_LIMIT,
  MSP_REQUESTED_CAPABILITIES,
  OUTPUT_DOCUMENT_MAX_PAGES,
  OUTPUT_PAGE_BYTES,
  OUTPUT_TAB_ID_LENGTH,
  PATCH_DOCUMENT_MAX_PAGES,
  type PermissionMode,
  SANDBOX_FAILURE_MARKER,
  SESSION_LIST_LIMIT,
  SESSION_LIST_MAX_PAGES,
  CHOICE_STEERING_NOTE,
  SESSION_RESTORE_WINDOW_MS,
  type SubagentAction,
  UI_TEXT,
} from '../../shared/constants'
import { effortForThinking, effortLevelsFor, isEffortLevel } from '../../shared/effort'
import type { AgentEvent, ApprovalChoice } from '../../shared/agentEvents'
import { parseSkillInvocation } from '../../shared/mentions'
import { approvalModeFor } from '../../shared/permissionModes'
import type {
  ChatReference,
  EditRef,
  HostAction,
  HostToWebviewMessage,
  LineRange,
  MentionItem,
  ModelOption,
  SkillOption,
} from '../../shared/protocol'
import type { AccountFacts, SubscriptionUsage, UsageInsights } from '../../shared/usage'
import type { AuthPort } from '../auth/authService'
import type { ReviewNotice } from '../editor/editReview'
import type { Logger } from '../logger'
import type { ChatSurface, ConversationMessage } from '../views/webviewSetup'
import type { DictationSetup } from '../voice/dictationHost'

/**
 * One subscription on the current host (list stream, usage stream),
 * replaced when the controller moves to another host, dropped when the host
 * dies (its listeners died with it).
 */
class HostWatch {
  private current: { readonly host: AgentHost; readonly unsubscribe: () => void } | undefined

  public ensure(host: AgentHost, subscribe: (host: AgentHost) => () => void): void {
    if (this.current?.host === host) {
      return
    }
    this.current?.unsubscribe()
    this.current = { host, unsubscribe: subscribe(host) }
  }

  public forget(): void {
    this.current = undefined
  }

  public dispose(): void {
    this.current?.unsubscribe()
    this.current = undefined
  }
}

export interface PickedFile {
  readonly name: string
  readonly fsPath: string
  /** Workspace-relative with forward slashes; undefined outside the workspace. */
  readonly relativePath: string | undefined
}

export interface FileAccess {
  /** Native open dialog; resolves to [] when cancelled. */
  showOpenDialog(): Promise<readonly PickedFile[]>
  readFile(fsPath: string): Promise<Uint8Array>
  /** QuickPick over the mention index; resolves to the chosen relative path. */
  pickMentionFile(): Promise<string | undefined>
  /** Relative path for a dropped `file:` URI; undefined outside the workspace. */
  toRelativePath(uri: string): string | undefined
}

export interface MentionSearch {
  search(query: string, limit: number): Promise<readonly MentionItem[]>
  /** Whether the file is in the index (excluded files share their path only). */
  contains(relativePath: string): Promise<boolean>
}

/** Edit review (M5): each call returns the notices to show in the transcript. */
export interface EditReviewActions {
  openDiff(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
  revert(itemId: string, patchJson: string): Promise<readonly ReviewNotice[]>
}

/** The last session a surface held, for the reopen-within-ten-minutes rule. */
export interface LastSession {
  readonly sessionId: string
  /** Epoch ms of its last activity as this extension saw it. */
  readonly at: number
}

/** Per-workspace memory behind the History dialog (`workspaceState`, M6). */
export interface SessionMemory {
  archivedIds(): readonly string[]
  setArchivedIds(ids: readonly string[]): Promise<void>
  lastSession(): LastSession | undefined
  setLastSession(last: LastSession | undefined): Promise<void>
}

/** Where the last subscription window lives between sessions (extension global state). */
export interface UsageCache {
  read(): SubscriptionUsage | undefined
  write(usage: SubscriptionUsage): Promise<void>
}

export interface ConversationDeps {
  readonly surface: ChatSurface
  readonly auth: AuthPort
  readonly ensureHost: () => Promise<AgentHost>
  readonly workspaceRoot: string | undefined
  readonly modelId: string
  readonly initialPermissionMode: PermissionMode
  /** False until the approval cards ship (M4); see shared/permissionModes.ts. */
  readonly hasApprovalUi: boolean
  readonly openExternal: (url: string) => void
  readonly mentions: MentionSearch
  readonly files: FileAccess
  /** The `allowDangerouslySkipPermissions` setting: whether Bypass is offered. */
  readonly isBypassAllowed: () => boolean
  /**
   * A remote window (`vscode.env.remoteName`): a dev container's settings can
   * switch Bypass on there, so it needs one explicit yes (PLAN.md D24).
   */
  readonly isRemoteWindow: boolean
  readonly confirmRemoteBypass: () => Promise<boolean>
  /** `museSpark.confidentialWorkspace`: contributor-tier models are blocked. */
  readonly isConfidentialWorkspace: () => boolean
  /** One explicit yes before a contributor-tier model is used (M7). */
  readonly confirmContributor: (modelId: string) => Promise<boolean>
  readonly runHostAction: (action: HostAction) => Promise<void>
  /** Code block "Copy": the system clipboard. */
  readonly copyText: (text: string) => Promise<void>
  /** Code block "Insert at cursor"; false when no text editor is active. */
  readonly insertCode: (text: string) => Promise<boolean>
  /** A shell tool reported the OS sandbox missing: the host offers the setup. */
  readonly onSandboxUnavailable: () => void
  readonly platform: NodeJS.Platform
  /** `%USERPROFILE%`; undefined off Windows (the sandbox notice, D12). */
  readonly userProfileDir: string | undefined
  /** The shell sandbox posture the host runs with (D12). */
  readonly shellSandbox: () => ShellSandboxPosture
  /** The active editor for the file chip (M5); undefined when none. */
  readonly editorContext: () => EditorContext | undefined
  /** `museSpark.autosave`: save dirty editors before every turn. */
  readonly isAutosaveEnabled: () => boolean
  readonly saveAll: () => Promise<void>
  /** Code block "Apply": replace the active editor's selection; false without an editor. */
  readonly applyCode: (text: string) => Promise<boolean>
  readonly editReview: EditReviewActions
  /** A tool output as a read-only editor tab named `title` (M15). */
  readonly openDocument: (title: string, content: string) => Promise<void>
  /** A file in an editor, `path` absolute or workspace-relative, the lines (1-based) selected (M16). */
  readonly openFile: (path: string, range: LineRange | undefined) => Promise<void>
  /** The subscription window the CLI last reported, kept across sessions (M16). */
  readonly usageCache: UsageCache
  /** The IDE tool server for `session/start`, when it is listening. */
  readonly ideMcpEndpoint: () => Promise<SessionMcpHttpServer | undefined>
  readonly newAttachmentId: () => string
  /** Session history (M6). */
  readonly sessions: SessionMemory
  /** The usage modal's Account section (M14). */
  readonly accountFacts: (backend: BackendKind) => Promise<AccountFacts>
  /** The usage modal's insights from the CLI's trace logs (M14); undefined without logs. */
  readonly usageInsights: () => Promise<UsageInsightsReport | undefined>
  /** Whether this surface resumes its last session when it reopens (the sidebar). */
  readonly isRestorable: boolean
  /** Voice dictation (M9): the platform's helper, or why there is none. */
  readonly dictation: DictationSetup
  readonly now: () => number
  readonly log: Logger
}

/** The day and the week windows of the usage insights (M14). */
export interface UsageInsightsReport {
  readonly day: UsageInsights
  readonly week: UsageInsights
}

export const NO_WORKSPACE_REASON = 'Open a folder first; Muse works inside a workspace.'
export const NOT_SIGNED_IN_REASON = 'Sign in before sending a message.'
export const NOTHING_TO_SEND_REASON = 'Type a message or attach an image first.'
const IDLE_STATUS = 'idle'
const NOOP_STATUS = 'noop'
const CANCELLED_STATUS = 'cancelled'
// `session/compact` rejects with this reason before the first turn has run
// (verified live 2026-09-21); it is "nothing to do", not a failure.
const MISSING_RUN_REASON = 'missing_run'
const NOTHING_TO_COMPACT = 'Nothing to compact yet.'
const BYPASS_MODE: PermissionMode = 'bypassPermissions'
const FALLBACK_MODE: PermissionMode = 'manual'
const EDIT_AUTOMATICALLY_MODE: PermissionMode = 'acceptEdits'
// Approval subjects that are a plain file write: the Model API's own, and
// Muse Code's `fileAccess` with write access (MSP `ApprovalSubject`).
const FILE_WRITE_SUBJECT = 'fileWrite'
const FILE_ACCESS_SUBJECT = 'fileAccess'
const WRITE_ACCESS = 'write'
const APPROVED_DECISION = 'approved'
const ONCE_SCOPE = 'once'
const [IDE_MCP_CAPABILITY] = MSP_REQUESTED_CAPABILITIES
const HISTORY_MODE_NONE = 'none'
const NOT_LOADED_STATUS = 'notLoaded'
// Events that mark a hidden surface unread (Claude Code's dot): the turn is
// done, or the agent is waiting on a decision or an answer.
const ATTENTION_EVENTS: ReadonlySet<AgentEvent['type']> = new Set([
  'turnCompleted',
  'approvalRequested',
  'questionRequested',
])
// A decision or answer that arrived after its prompt had moved (PLAN.md D26).
const PROMPT_SETTLED_TEXT: Readonly<Record<PromptSettledReason, string>> = {
  alreadySettled: UI_TEXT.promptAlreadySettled,
  movedOn: UI_TEXT.promptMovedOn,
  gone: UI_TEXT.promptGone,
}
const QUEUED_DISPOSITION = 'queued'
const STEERED_DISPOSITION = 'steered'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isContributorModel(modelId: string): boolean {
  return modelId.endsWith(CONTRIBUTOR_MODEL_SUFFIX)
}

export class ConversationController {
  private session: AgentSession | undefined
  private unsubscribe: (() => void) | undefined
  private models: readonly ModelOption[] | undefined
  private modelListing: Promise<void> | undefined
  private skills: readonly SkillOption[] | undefined
  private skillsRefresh: Promise<void> | undefined
  private readonly attachments: AttachmentStore
  private modelId: string
  private permissionMode: PermissionMode
  private effort: EffortLevel = DEFAULT_EFFORT
  private isThinkingEnabled = true
  private activeTurnId: string | undefined
  private hasWarnedSandbox = false
  /** The contributor model the user said yes to (once per conversation). */
  private confirmedContributor: string | undefined
  /** The workspace's stored sessions once the dialog asked for them (M6). */
  private sessionRecords: Map<string, SessionRecord> | undefined
  private readonly listWatch = new HostWatch()
  private readonly usageWatch = new HostWatch()
  /** The dictation driver, created on the first press (M9). */
  private dictation: DictationHandle | undefined
  private dictationStatus: DictationStatus = 'idle'
  /** Approvals "Edit automatically" answered itself (D24): their resolution is labelled so. */
  private readonly autoApproved = new Set<string>()
  /** The remote-window Bypass confirmation, given once per conversation (D24). */
  private hasConfirmedRemoteBypass = false
  /** Said once the surface is ready: why the conversation did not start as configured. */
  private startupNotice: string | undefined
  /** The backend kind of the attached session (a resume only goes to the same kind). */
  private sessionKind: BackendKind | undefined
  /** Stops listening for the host closing this session. */
  private closedWatch: (() => void) | undefined
  /** The session the next message resumes after a restart or a crash (PLAN.md D25). */
  private resumeTarget: { readonly sessionId: string; readonly kind: BackendKind } | undefined
  /** A session start in flight, shared by concurrent callers. */
  private sessionOpening: Promise<AgentSession> | undefined
  /** The surface closed: nothing started after this is kept. */
  private isDisposed = false
  /**
   * Turns this session has seen complete (D26): a submission's ack that
   * lands after its own turn finished must not mark that turn running again.
   */
  private readonly finishedTurns = new Set<string>()
  /** Whether the attached session's host renames and forks (D26: not Muse Code 1.3.0 on Windows). */
  private canEditSessions = true
  /** A transcript reload after a delivery gap, and the gaps heard so far. */
  private gapReload: Promise<void> | undefined
  private gapCount = 0

  public constructor(private readonly deps: ConversationDeps) {
    this.modelId = deps.modelId
    this.permissionMode = deps.initialPermissionMode
    if (this.permissionMode === BYPASS_MODE && !deps.isBypassAllowed()) {
      // The initial-mode setting alone cannot switch approvals off; the
      // explicit allow setting must be on too, as in Claude Code.
      deps.log.warn(
        'museSpark.initialPermissionMode is bypassPermissions but allowDangerouslySkipPermissions is off; starting in Manual',
      )
      this.permissionMode = FALLBACK_MODE
    } else if (this.permissionMode === BYPASS_MODE && deps.isRemoteWindow) {
      // A dev container can set both settings (D24): never start there without approvals.
      deps.log.warn('Bypass permissions requested in a remote window; starting in Manual')
      this.permissionMode = FALLBACK_MODE
      this.startupNotice = UI_TEXT.bypassRemoteStartedManual
    }
    this.attachments = new AttachmentStore(deps.newAttachmentId)
  }

  private post(message: HostToWebviewMessage): void {
    this.deps.surface.post(message)
  }

  private notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.post({ type: 'notice', level, text })
  }

  private contextLimitFor(modelId: string): number | undefined {
    return this.models?.find((model) => model.modelId === modelId)?.contextLimit
  }

  private postSessionInfo(modelId: string): void {
    const contextLimit = this.contextLimitFor(modelId)
    this.post({
      type: 'sessionInfo',
      modelId,
      ...(contextLimit !== undefined && { contextLimit }),
      ...(this.session !== undefined && { sessionId: this.session.sessionId }),
      // Said only where it is so (D26): the panel then offers neither.
      ...(!this.canEditSessions && { canEditSessions: false }),
    })
  }

  private postSessionList(): void {
    if (this.sessionRecords === undefined) {
      return
    }
    this.post({
      type: 'sessionList',
      sessions: Array.from(this.sessionRecords.values(), (record) => toSessionRow(record)),
      archivedIds: [...this.deps.sessions.archivedIds()],
    })
  }

  /** Remember when this surface's session was last active (the restore rule). */
  private noteActivity(): void {
    if (this.session === undefined) {
      return
    }
    void this.deps.sessions.setLastSession({
      sessionId: this.session.sessionId,
      at: this.deps.now(),
    })
  }

  private setTitle(name: string | undefined): void {
    this.deps.surface.setTitle(name ?? UI_TEXT.untitledConversation)
  }

  private postComposerState(): void {
    this.post({
      type: 'composerState',
      effort: this.effort,
      isThinkingEnabled: this.isThinkingEnabled,
      permissionMode: this.permissionMode,
    })
  }

  private postSkills(): void {
    if (this.skills !== undefined) {
      this.post({ type: 'skillList', skills: [...this.skills] })
    }
  }

  /** `turn/cancel` for a session being left: a refusal is only worth a log line. */
  private async cancelQuietly(session: AgentSession): Promise<void> {
    try {
      await session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel before leaving the session failed: ${describe(error)}`)
    }
  }

  /**
   * Lets go of the session. A turn still running is cancelled first unless
   * the caller says the host is already gone or has been told (PLAN.md D25):
   * a dropped turn would otherwise run on, unwatched and billed.
   */
  private dropSession(isTurnCancelled = true): void {
    const { session } = this
    if (isTurnCancelled && session !== undefined && this.activeTurnId !== undefined) {
      void this.cancelQuietly(session)
    }
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.closedWatch?.()
    this.closedWatch = undefined
    session?.dispose()
    this.session = undefined
    this.activeTurnId = undefined
    this.finishedTurns.clear()
  }

  /**
   * Ends the running turn in the webview when the host cannot say so any
   * more (it stopped, restarted or closed the session, D25): the reply stops
   * streaming and its cards go, as for a turn the host completed.
   */
  private endTurnLocally(terminal: 'cancelled' | 'failed', reason: string): void {
    const turnId = this.activeTurnId
    if (turnId === undefined) {
      return
    }
    this.activeTurnId = undefined
    this.forward({ type: 'turnCompleted', turnId, terminal, reason })
  }

  /** The session to pick up on the next message, on a host of the same kind. */
  private rememberForResume(session: AgentSession | undefined): void {
    this.resumeTarget =
      session === undefined || this.sessionKind === undefined
        ? undefined
        : { sessionId: session.sessionId, kind: this.sessionKind }
  }

  /** The host closed this panel's session (idle eviction, a lease lost): resume on the next message. */
  private sessionClosedByHost(reason: string): void {
    this.rememberForResume(this.session)
    this.endTurnLocally('failed', `${UI_TEXT.sessionClosedByHost} (${reason})`)
    this.dropSession(false)
    this.notice(
      'info',
      `${UI_TEXT.sessionClosedByHost} (${reason}). ${UI_TEXT.sessionResumesOnSend}`,
    )
  }

  /**
   * "Edit automatically" (PLAN.md D24): the allow-once choice for a plain
   * file write, which the controller answers itself; undefined for anything
   * the user must see (commands, protected writes, escalations, other modes).
   */
  private autoApprovalChoice(
    event: Extract<AgentEvent, { type: 'approvalRequested' }>,
  ): ApprovalChoice | undefined {
    if (
      this.permissionMode !== EDIT_AUTOMATICALLY_MODE ||
      event.isProtectedWrite ||
      event.isJudgeEscalated
    ) {
      return undefined
    }
    const { subject } = event
    const isFileWrite =
      subject.kind === FILE_WRITE_SUBJECT ||
      (subject.kind === FILE_ACCESS_SUBJECT && subject.access === WRITE_ACCESS)
    return isFileWrite && subject.stages === undefined
      ? event.availableChoices.find(
          (choice) => choice.decision === APPROVED_DECISION && choice.scope === ONCE_SCOPE,
        )
      : undefined
  }

  /** Answers an edit approval on the user's behalf; shows the card if the host refuses. */
  private async autoApprove(
    event: Extract<AgentEvent, { type: 'approvalRequested' }>,
    choice: ApprovalChoice,
  ): Promise<void> {
    const session = this.session
    if (session === undefined) {
      return
    }
    this.autoApproved.add(event.approvalId)
    try {
      await session.decideApproval({
        approvalId: event.approvalId,
        choiceId: choice.choiceId,
        requirementId: event.requirementId,
      })
    } catch (error: unknown) {
      this.autoApproved.delete(event.approvalId)
      this.deps.log.warn(`Edit automatically could not approve: ${describe(error)}`)
      this.forward(event)
    }
  }

  /** An event as the webview sees it, plus the unread mark. */
  private forward(event: AgentEvent): void {
    this.post({ type: 'agentEvent', event })
    if (ATTENTION_EVENTS.has(event.type)) {
      this.deps.surface.markUnread()
    }
  }

  /**
   * Live delivery dropped events (MSP `view/gap`, D26): the transcript is
   * re-read whole, once more if another gap arrived during the read.
   */
  private async reloadAfterGaps(): Promise<void> {
    let handled = -1
    while (handled !== this.gapCount) {
      handled = this.gapCount
      // The panel's session now: a gap is only ever heard from the attached one.
      const { session } = this
      if (session === undefined) {
        break
      }
      try {
        const host = await this.deps.ensureHost()
        const history = await host.readSession(session.sessionId)
        if (this.session === session) {
          this.postHistory(session.sessionId, history)
          this.notice('info', UI_TEXT.viewGapReloaded)
        }
      } catch (error: unknown) {
        this.notice('warning', `${UI_TEXT.viewGapReloadFailed}: ${describe(error)}`)
      }
    }
    this.gapReload = undefined
  }

  private onViewGap(): void {
    this.gapCount += 1
    this.gapReload ??= this.reloadAfterGaps()
  }

  private onEvent(event: AgentEvent): void {
    // The controller's own events (D26): never forwarded to the webview.
    if (event.type === 'viewGap') {
      this.onViewGap()
      return
    }
    if (event.type === 'backendNotice') {
      this.notice(event.level, event.text)
      return
    }
    if (event.type === 'approvalRequested') {
      const choice = this.autoApprovalChoice(event)
      if (choice !== undefined) {
        void this.autoApprove(event, choice)
        return
      }
    }
    if (event.type === 'approvalResolved' && this.autoApproved.delete(event.approvalId)) {
      this.forward({ ...event, resolvedBy: UI_TEXT.editAutomaticallyResolver })
      return
    }
    this.forward(event)
    this.track(event)
  }

  /** The controller's own bookkeeping for an event the webview was sent. */
  private track(event: AgentEvent): void {
    switch (event.type) {
      case 'turnStarted': {
        this.activeTurnId = event.turnId
        break
      }
      case 'turnCompleted': {
        this.finishedTurns.add(event.turnId)
        // A queued turn withdrawn (`turn/unqueued`) leaves the running one running.
        if (this.activeTurnId === event.turnId) {
          this.activeTurnId = undefined
        }
        this.noteActivity()
        if (event.terminal === 'failed' && event.errorKind === AUTH_REQUIRED_ERROR_KIND) {
          this.deps.auth.markAuthRequired(event.reason ?? AUTH_REQUIRED_ERROR_KIND)
        }
        break
      }
      case 'sessionNamed': {
        this.setTitle(event.name)
        break
      }
      case 'sessionStatus': {
        if (event.status === IDLE_STATUS) {
          this.activeTurnId = undefined
        }
        break
      }
      case 'effortChanged': {
        if (isEffortLevel(event.effort) && event.effort !== this.effort) {
          this.effort = event.effort
          this.postComposerState()
        }
        break
      }
      case 'skillsChanged': {
        if (this.session !== undefined) {
          void this.refreshSkills(this.session)
        }
        break
      }
      case 'itemUpdated':
      case 'itemCompleted': {
        this.noteSandboxFailure(event.item.failureReason)
        break
      }
      default: {
        break
      }
    }
  }

  /**
   * One notice per session about the shell sandbox (PLAN.md D12): `auto`
   * turned it off for a Windows profile workspace, or the user forced it on
   * where the CLI cannot run commands in the workspace.
   */
  private noteShellSandbox(workspaceRoot: string, serverVersion: string): void {
    const posture = this.deps.shellSandbox()
    if (posture.reason === 'profileWorkspace') {
      this.notice('info', UI_TEXT.sandboxOffProfileNotice)
      return
    }
    const isLimited = isProfileWorkspaceLimited({
      platform: this.deps.platform,
      workspaceRoot,
      userProfileDir: this.deps.userProfileDir,
      serverVersion,
    })
    if (isLimited && posture.isSandboxed) {
      this.notice('warning', UI_TEXT.sandboxProfileNotice)
    }
  }

  /** The shell tool's "sandbox not set up" failure gets one actionable notice. */
  private noteSandboxFailure(failureReason: string | undefined): void {
    if (this.hasWarnedSandbox || failureReason?.includes(SANDBOX_FAILURE_MARKER) !== true) {
      return
    }
    this.hasWarnedSandbox = true
    this.notice('warning', UI_TEXT.sandboxNotice)
    this.deps.onSandboxUnavailable()
  }

  private openLink(url: string): void {
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    if (!ALLOWED_LINK_SCHEMES.has(scheme)) {
      this.notice('warning', UI_TEXT.linkSchemeRefused)
      return
    }
    this.deps.openExternal(url)
  }

  private async decideApproval(
    message: Extract<ConversationMessage, { type: 'decideApproval' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.decideApproval({
        approvalId: message.approvalId,
        choiceId: message.choiceId,
        requirementId: message.requirementId,
        ...(message.feedback !== undefined && { feedback: message.feedback }),
      })
    } catch (error: unknown) {
      if (error instanceof PromptSettledError) {
        this.promptSettled(error, { approvalId: message.approvalId })
        return
      }
      // Muse Code 1.3.0 on Windows can fail the reply to `approval/decide`
      // on its own ledger write after applying the decision (the tool runs
      // on); the wording must not claim the decision was refused. The card
      // opens again: if the decision did apply, its resolve still closes it.
      this.notice('warning', `${UI_TEXT.decisionErrorNotice}: ${describe(error)}`)
      this.post({ type: 'approvalReopened', approvalId: message.approvalId })
    }
  }

  /**
   * A decision or answer that arrived after its prompt had moved (D26): the
   * user is told it was not needed, and a prompt the host no longer holds
   * loses its card (an answered or advanced one follows the host's events).
   */
  private promptSettled(
    error: PromptSettledError,
    prompt: { readonly approvalId: string } | { readonly userInputId: string },
  ): void {
    this.notice('info', PROMPT_SETTLED_TEXT[error.reason])
    if (error.reason === 'gone') {
      this.post({ type: 'promptDropped', ...prompt })
    }
  }

  /** The question card's Cancel: the prompt is declined and the model told (M16). */
  private async cancelQuestion(userInputId: string): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancelQuestions(userInputId)
    } catch (error: unknown) {
      if (error instanceof PromptSettledError) {
        this.promptSettled(error, { userInputId })
        return
      }
      this.notice('error', `${UI_TEXT.questionCancelFailed}: ${describe(error)}`)
    }
  }

  private async answerQuestion(
    message: Extract<ConversationMessage, { type: 'answerQuestion' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.answerQuestions(message.userInputId, message.answers)
    } catch (error: unknown) {
      if (error instanceof PromptSettledError) {
        this.promptSettled(error, { userInputId: message.userInputId })
        return
      }
      this.notice('error', `The answer was not accepted: ${describe(error)}`)
    }
  }

  private async readOutput(
    message: Extract<ConversationMessage, { type: 'readOutput' }>,
  ): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      const page = await this.session.readOutput({
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: message.offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      this.post({
        type: 'outputPage',
        itemId: message.itemId,
        outputRef: message.outputRef,
        offsetBytes: page.offsetBytes,
        byteLen: page.byteLen,
        content: page.content,
        eof: page.eof,
      })
    } catch (error: unknown) {
      this.notice('error', `Could not load the output: ${describe(error)}`)
    }
  }

  private async insertCode(text: string): Promise<void> {
    if (!(await this.deps.insertCode(text))) {
      this.notice('info', UI_TEXT.noEditorForInsert)
    }
  }

  private async applyCode(text: string): Promise<void> {
    if (!(await this.deps.applyCode(text))) {
      this.notice('info', UI_TEXT.noEditorForApply)
    }
  }

  /** The whole stored patch document (small; paged only in principle). */
  /** A tool row's path: the file in an editor, the changed lines selected when known (M16). */
  private async openFile(
    message: Extract<ConversationMessage, { type: 'openFile' }>,
  ): Promise<void> {
    try {
      await this.deps.openFile(
        message.path,
        message.startLine === undefined || message.endLine === undefined
          ? undefined
          : { startLine: message.startLine, endLine: message.endLine },
      )
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.openFileFailed}: ${describe(error)}`)
    }
  }

  /** A tool output as an editor tab: the stored output in full, else the transcript's copy (M15). */
  private async openOutput(
    message: Extract<ConversationMessage, { type: 'openOutput' }>,
  ): Promise<void> {
    const tabId = message.itemId.slice(-OUTPUT_TAB_ID_LENGTH)
    const title = `${message.label} ${UI_TEXT.toolOutputTitle} (${tabId})`
    try {
      const stored =
        message.outputRef === undefined
          ? undefined
          : await this.fetchPatch(message.itemId, message.outputRef, OUTPUT_DOCUMENT_MAX_PAGES)
      await this.deps.openDocument(title, stored ?? message.text)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.openOutputFailed}: ${describe(error)}`)
    }
  }

  private async fetchPatch(
    itemId: string,
    outputRef: string,
    maxPages = PATCH_DOCUMENT_MAX_PAGES,
  ): Promise<string | undefined> {
    if (this.session === undefined) {
      return undefined
    }
    let content = ''
    let offsetBytes = 0
    for (let page = 0; page < maxPages; page += 1) {
      const chunk = await this.session.readOutput({
        itemId,
        outputRef,
        offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
      content += chunk.content
      if (chunk.eof) {
        return content
      }
      offsetBytes = chunk.offsetBytes + chunk.byteLen
    }
    throw new Error(`stored output ${outputRef} is larger than expected`)
  }

  /** "Rewind code to here": the edits after a message, reverted newest first (M13). */
  private async rewindCode(edits: readonly EditRef[]): Promise<void> {
    if (edits.length === 0) {
      this.notice('info', UI_TEXT.rewindNothing)
      return
    }
    for (const edit of edits) {
      await this.reviewEdit('revert', edit.itemId, edit.outputRef)
    }
    this.notice(
      'info',
      `${UI_TEXT.rewindDone} (${String(edits.length)} ${edits.length === 1 ? 'edit' : 'edits'})`,
    )
  }

  private async reviewEdit(
    action: 'openDiff' | 'revert',
    itemId: string,
    outputRef: string,
  ): Promise<void> {
    try {
      const patch = await this.fetchPatch(itemId, outputRef)
      if (patch === undefined) {
        return
      }
      const notices = await this.deps.editReview[action](itemId, patch)
      for (const notice of notices) {
        this.notice(notice.level, notice.text)
      }
    } catch (error: unknown) {
      this.notice('error', `Could not review the edit: ${describe(error)}`)
    }
  }

  /** One `model/list` at a time: the warm-up and the first send may overlap (M15). */
  private async ensureModels(host: AgentHost): Promise<void> {
    if (this.models !== undefined) {
      return
    }
    this.modelListing ??= this.listModels(host)
    try {
      await this.modelListing
    } finally {
      this.modelListing = undefined
    }
  }

  private async listModels(host: AgentHost): Promise<void> {
    const listed = await host.listModels()
    const models = this.deps.isConfidentialWorkspace()
      ? listed.filter((model) => !isContributorModel(model.modelId))
      : listed
    this.models = models.map((model) => ({
      modelId: model.modelId,
      displayLabel: model.displayLabel,
      ...(model.contextLimit !== undefined && { contextLimit: model.contextLimit }),
      isDefault: model.isDefault,
    }))
    this.post({ type: 'modelList', models: [...this.models] })
  }

  private async applyEffort(session: AgentSession): Promise<void> {
    try {
      await session.setReasoningEffort(effortForThinking(this.effort, this.isThinkingEnabled))
    } catch (error: unknown) {
      this.deps.log.warn(`session/setReasoningEffort failed: ${describe(error)}`)
      this.notice('warning', `Reasoning effort could not be applied: ${describe(error)}`)
    }
  }

  private async loadSkills(session: AgentSession): Promise<void> {
    try {
      const skills = await session.listSkills()
      this.skills = skills.map((skill) => ({
        selector: skill.selector,
        displayName: skill.displayName,
        description: skill.description,
        ...(skill.argumentHint !== undefined && { argumentHint: skill.argumentHint }),
      }))
    } catch (error: unknown) {
      this.deps.log.warn(`skill/list failed: ${describe(error)}`)
      this.skills = []
    } finally {
      this.skillsRefresh = undefined
    }
    this.postSkills()
  }

  /** Re-list the skills; concurrent callers share the in-flight request. */
  private refreshSkills(session: AgentSession): Promise<void> {
    this.skillsRefresh ??= this.loadSkills(session)
    return this.skillsRefresh
  }

  /** The IDE tool server config for a new or resumed session, when granted. */
  private async mcpServersFor(
    host: AgentHost,
  ): Promise<Readonly<Record<string, SessionMcpHttpServer>> | undefined> {
    if (!host.info.grantedCapabilities.includes(IDE_MCP_CAPABILITY)) {
      return undefined
    }
    const ideEndpoint = await this.deps.ideMcpEndpoint()
    return ideEndpoint === undefined ? undefined : { [IDE_MCP_SERVER_NAME]: ideEndpoint }
  }

  /** Take a session as this surface's: events, composer state, skills. */
  private async attach(host: AgentHost, session: AgentSession): Promise<void> {
    this.session = session
    this.sessionKind = host.info.kind
    this.canEditSessions = host.info.canEditSessions
    this.unsubscribe = session.onEvent((event) => {
      this.onEvent(event)
    })
    // The host closing this very session is heard here (D25), not only in History.
    this.closedWatch = host.onSessionListEvent((event) => {
      if (
        event.type === 'closed' &&
        event.sessionId === session.sessionId &&
        this.session === session
      ) {
        this.sessionClosedByHost(event.reason)
      }
    })
    this.postSessionInfo(this.modelId)
    this.noteActivity()
    await this.applyEffort(session)
    void this.refreshSkills(session)
  }

  /**
   * The session for the next message. Concurrent callers (two quick sends, a
   * send racing a restore) share one start, so no second session is created
   * and left listening (D25).
   */
  private ensureSession(workspaceRoot: string): Promise<AgentSession> {
    if (this.session !== undefined) {
      return Promise.resolve(this.session)
    }
    this.sessionOpening ??= this.openSessionOnce(workspaceRoot)
    return this.sessionOpening
  }

  /** `openSession`, forgetting the shared start once it settles. */
  private async openSessionOnce(workspaceRoot: string): Promise<AgentSession> {
    try {
      return await this.openSession(workspaceRoot)
    } finally {
      this.sessionOpening = undefined
    }
  }

  private async openSession(workspaceRoot: string): Promise<AgentSession> {
    const host = await this.deps.ensureHost()
    await this.ensureModels(host)
    const resumed = await this.resumeAfterRestart(host)
    if (resumed !== undefined) {
      return resumed
    }
    const mcpServers = await this.mcpServersFor(host)
    const session = await host.startSession({
      workspaceRoot,
      modelId: this.modelId,
      approvalMode: approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
      ...(mcpServers !== undefined && { mcpServers }),
    })
    if (this.isDisposed) {
      // The surface closed while the session was starting: nobody would listen.
      session.dispose()
      throw new Error(UI_TEXT.surfaceClosed)
    }
    this.modelId = session.modelId
    await this.attach(host, session)
    if (host.info.kind === 'modelApi') {
      this.notice('info', UI_TEXT.modelApiBackendNotice)
    } else {
      this.noteShellSandbox(workspaceRoot, host.info.serverVersion)
    }
    return session
  }

  /**
   * After a restart, a crash or the host closing the session, the next
   * message continues the same conversation (D25) rather than starting one
   * with no context. The webview kept its transcript, so nothing is
   * replayed. If the session cannot be resumed the user is told and a new
   * one starts.
   */
  private async resumeAfterRestart(host: AgentHost): Promise<AgentSession | undefined> {
    const target = this.resumeTarget
    this.resumeTarget = undefined
    if (target?.kind !== host.info.kind) {
      return undefined
    }
    let loaded: LoadedSession
    try {
      loaded = await host.resumeSession(
        target.sessionId,
        this.modelId,
        await this.mcpServersFor(host),
      )
    } catch (error: unknown) {
      this.notice('warning', `${UI_TEXT.sessionNotContinued}: ${describe(error)}`)
      return undefined
    }
    if (this.isDisposed) {
      loaded.session.dispose()
      throw new Error(UI_TEXT.surfaceClosed)
    }
    this.activeTurnId = loaded.activeTurnId
    await this.attach(host, loaded.session)
    try {
      await loaded.session.setApprovalMode(
        approvalModeFor(this.permissionMode, this.deps.hasApprovalUi),
      )
    } catch (error: unknown) {
      this.notice('warning', `Could not apply the permission mode: ${describe(error)}`)
    }
    this.notice('info', UI_TEXT.sessionContinued)
    return loaded.session
  }

  /** Why a user action cannot run now (signed out / no folder), posted as asked. */
  private refuseAction(localId?: string): string | undefined {
    const isSignedIn = this.deps.auth.current.status === 'signedIn'
    const reason = isSignedIn ? undefined : NOT_SIGNED_IN_REASON
    if (reason === undefined && this.deps.workspaceRoot !== undefined) {
      return undefined
    }
    const text = reason ?? NO_WORKSPACE_REASON
    // A refused message's images were never used: the composer gets them back.
    this.post(
      localId === undefined
        ? { type: 'notice', level: 'warning', text }
        : { type: 'sendFailed', localId, reason: text, attachmentsKept: true },
    )
    return text
  }

  /** The session for a user action, or undefined (with the reason posted). */
  private async sessionForAction(localId?: string): Promise<AgentSession | undefined> {
    const refusal = this.refuseAction(localId)
    if (refusal !== undefined || this.deps.workspaceRoot === undefined) {
      return undefined
    }
    const session = await this.ensureSession(this.deps.workspaceRoot)
    return session
  }

  // --- Session history (M6) ---

  /** Follow `session/listChanged` / `session/closed` on the current host. */
  private watchList(host: AgentHost): void {
    this.listWatch.ensure(host, (watched) =>
      watched.onSessionListEvent((event) => {
        this.onListEvent(event)
      }),
    )
  }

  private onListEvent(event: SessionListEvent): void {
    if (this.sessionRecords === undefined) {
      return
    }
    if (event.type === 'changed') {
      if (event.record.workspaceRoot !== this.deps.workspaceRoot) {
        return
      }
      this.sessionRecords.set(event.record.sessionId, event.record)
    } else {
      const record = this.sessionRecords.get(event.sessionId)
      if (record === undefined) {
        return
      }
      this.sessionRecords.set(event.sessionId, { ...record, status: NOT_LOADED_STATUS })
    }
    this.postSessionList()
  }

  private async listSessions(): Promise<void> {
    if (this.deps.workspaceRoot === undefined) {
      this.notice('warning', NO_WORKSPACE_REASON)
      return
    }
    try {
      const host = await this.deps.ensureHost()
      this.watchList(host)
      const records: SessionRecord[] = []
      let cursor: string | undefined
      for (let page = 0; page < SESSION_LIST_MAX_PAGES; page += 1) {
        const result = await host.listSessions({
          workspaceRoot: this.deps.workspaceRoot,
          limit: SESSION_LIST_LIMIT,
          ...(cursor !== undefined && { cursor }),
        })
        records.push(...result.sessions)
        cursor = result.nextCursor
        if (cursor === undefined) {
          break
        }
      }
      this.sessionRecords = new Map(records.map((record) => [record.sessionId, record]))
      this.postSessionList()
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.historyUnavailable}: ${describe(error)}`)
    }
  }

  /** The webview's transcript replaced by a session's served history. */
  private postHistory(sessionId: string, history: SessionHistoryOutcome): void {
    this.post({
      type: 'historyLoaded',
      sessionId,
      items: [...history.items],
      ...(history.name !== undefined && { name: history.name }),
      todos: [...history.todos],
    })
  }

  /**
   * Make a resumed or forked session this surface's: the transcript is
   * rebuilt from its history, the model comes from the catalogue's active
   * row (never the record's `modelId`, PLAN.md M6), and this surface's
   * composer settings are applied to it.
   */
  private async adopt(host: AgentHost, loaded: LoadedSession, notice: string): Promise<void> {
    this.dropSession()
    const models = await host.listModels(loaded.session.sessionId)
    const active = models.find((model) => model.isActive)
    if (active !== undefined) {
      this.modelId = active.modelId
    }
    // A session saved on a contributor-tier model gets the same yes (or the
    // confidential-workspace block) as choosing one (D24).
    if (!(await this.allowsModel(this.modelId))) {
      const fallback =
        models.find((model) => model.isDefault && !isContributorModel(model.modelId)) ??
        models.find((model) => !isContributorModel(model.modelId))
      const fallbackId = fallback?.modelId ?? DEFAULT_MODEL_ID
      try {
        await loaded.session.setModel(fallbackId)
      } catch (error: unknown) {
        // Never keep a session on the model the user refused.
        loaded.session.dispose()
        throw error
      }
      this.modelId = fallbackId
      this.notice('info', `${UI_TEXT.contributorResumeFallback} ${fallbackId}.`)
    }
    this.postHistory(loaded.session.sessionId, loaded.history)
    this.setTitle(loaded.history.name)
    this.notice('info', `${notice} ${loaded.history.name ?? toSessionRow(loaded.record).title}`)
    if (loaded.history.mode === HISTORY_MODE_NONE) {
      this.notice('warning', UI_TEXT.historyNotServed)
    }
    if (this.isDisposed) {
      loaded.session.dispose()
      return
    }
    // Before attaching: the events held for this surface may end that turn (D26).
    this.activeTurnId = loaded.activeTurnId
    await this.attach(host, loaded.session)
    const target = approvalModeFor(this.permissionMode, this.deps.hasApprovalUi)
    try {
      await loaded.session.setApprovalMode(target)
    } catch (error: unknown) {
      this.notice('warning', `Could not apply the permission mode: ${describe(error)}`)
    }
  }

  private async resumeSession(sessionId: string): Promise<void> {
    if (this.refuseAction() !== undefined || this.session?.sessionId === sessionId) {
      return
    }
    try {
      const host = await this.deps.ensureHost()
      await this.ensureModels(host)
      this.watchList(host)
      const loaded = await host.resumeSession(
        sessionId,
        this.modelId,
        await this.mcpServersFor(host),
      )
      await this.adopt(host, loaded, UI_TEXT.resumedNotice)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.resumeFailed}: ${describe(error)}`)
    }
  }

  private async forkSession(lastTurnId: string | undefined): Promise<void> {
    if (this.session === undefined) {
      this.notice('info', UI_TEXT.sessionRequired)
      return
    }
    try {
      const host = await this.deps.ensureHost()
      if (!host.info.canEditSessions) {
        this.notice('info', UI_TEXT.sessionEditsUnsupported)
        return
      }
      const loaded = await host.forkSession(this.session.sessionId, this.modelId, lastTurnId)
      await this.adopt(host, loaded, UI_TEXT.forkedNotice)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.forkFailed}: ${describe(error)}`)
    }
  }

  private async renameSession(name: string): Promise<void> {
    const trimmed = name.trim()
    const { session } = this
    if (trimmed === '' || session === undefined) {
      return
    }
    try {
      const host = await this.deps.ensureHost()
      if (!host.info.canEditSessions) {
        this.notice('info', UI_TEXT.sessionEditsUnsupported)
        return
      }
      const canonical = await session.rename(trimmed)
      if (canonical !== undefined) {
        this.setTitle(canonical)
        this.post({ type: 'agentEvent', event: { type: 'sessionNamed', name: canonical } })
      }
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.renameFailed}: ${describe(error)}`)
    }
  }

  private async setSessionArchived(sessionId: string, isArchived: boolean): Promise<void> {
    const others = this.deps.sessions.archivedIds().filter((id) => id !== sessionId)
    await this.deps.sessions.setArchivedIds(isArchived ? [...others, sessionId] : others)
    this.postSessionList()
  }

  private buildParts(text: string, attachmentIds: readonly string[]): readonly TurnPart[] {
    const images = this.attachments.partsFor(attachmentIds)
    const trimmed = text.trim()
    const skill = parseSkillInvocation(
      trimmed,
      new Set((this.skills ?? []).map((entry) => entry.selector)),
    )
    if (skill !== undefined) {
      return [
        {
          type: 'skill',
          selector: skill.selector,
          ...(skill.arguments !== undefined && { arguments: skill.arguments }),
        },
        ...images,
      ]
    }
    return trimmed === '' ? images : [{ type: 'text', text }, ...images]
  }

  private async submit(
    session: AgentSession,
    parts: readonly TurnPart[],
    displayText: string | undefined,
  ): Promise<TurnSubmission> {
    if (this.activeTurnId !== undefined) {
      try {
        return {
          turnId: await session.steer(this.activeTurnId, parts),
          disposition: STEERED_DISPOSITION,
        }
      } catch (error: unknown) {
        this.deps.log.warn(`turn/steer failed (${describe(error)}); submitting as a new turn`)
      }
    }
    return await session.sendTurn(parts, displayText)
  }

  /**
   * The editor-context part for this message (Claude Code's IDE reminder).
   * A file the mention index does not list (gitignored / excluded) shares
   * its path but not its text.
   */
  private async contextPart(context: EditorContext | undefined): Promise<TurnPart | undefined> {
    if (context === undefined) {
      return undefined
    }
    const isShareable =
      context.selectedText !== undefined &&
      (await this.deps.mentions.contains(context.relativePath))
    return {
      type: 'text',
      text: editorContextText({
        ...context,
        selectedText: isShareable ? context.selectedText : undefined,
      }),
    }
  }

  private async autosave(): Promise<void> {
    if (!this.deps.isAutosaveEnabled()) {
      return
    }
    try {
      await this.deps.saveAll()
    } catch (error: unknown) {
      this.deps.log.warn(`Autosave before the turn failed: ${describe(error)}`)
    }
  }

  private async send(
    localId: string,
    text: string,
    attachmentIds: readonly string[],
    isEditorContextIncluded: boolean,
    reference: ChatReference | undefined,
  ): Promise<void> {
    try {
      const session = await this.sessionForAction(localId)
      if (session === undefined) {
        return
      }
      await this.autosave()
      const typed = this.buildParts(text, attachmentIds)
      if (typed.length === 0) {
        this.post({
          type: 'sendFailed',
          localId,
          reason: NOTHING_TO_SEND_REASON,
          attachmentsKept: true,
        })
        return
      }
      // A reply to an output or a quoted passage rides as its own part (M17),
      // before the editor context, like the ide_selection part of M5.
      const referenced: readonly TurnPart[] =
        reference === undefined ? [] : [{ type: 'text', text: chatReferenceText(reference) }]
      const context = await this.contextPart(
        isEditorContextIncluded ? this.deps.editorContext() : undefined,
      )
      // The CLI backend also gets the choice-steering note (M14); the Model
      // API backend carries it in its system prompt.
      const host = await this.deps.ensureHost()
      const note: readonly TurnPart[] =
        host.info.kind === 'museCode' ? [{ type: 'text', text: CHOICE_STEERING_NOTE }] : []
      const parts = [...typed, ...referenced, ...(context === undefined ? [] : [context]), ...note]
      // With extra parts the durable transcript keeps the typed text only.
      const displayText = parts.length === typed.length ? undefined : text
      const submission = await this.submitResuming(host, session, parts, displayText)
      // The images go only once the host has the message (D26).
      this.attachments.release(attachmentIds)
      if (this.isDisposed) {
        return
      }
      const { turnId } = submission
      // A queued turn is not the running one, and an ack that lands after its
      // own turn completed must not mark it running again (D26).
      if (submission.disposition !== QUEUED_DISPOSITION && !this.finishedTurns.has(turnId)) {
        this.activeTurnId = turnId
      }
      this.post({ type: 'turnAccepted', localId, turnId })
      this.noteActivity()
    } catch (error: unknown) {
      const reason = describe(error)
      this.deps.log.error(`sendMessage failed: ${reason}`)
      // Nothing was released: the composer gets the images back for another try.
      this.post({ type: 'sendFailed', localId, reason, attachmentsKept: true })
    }
  }

  /**
   * `submit`, once more on the resumed session when the host says it no
   * longer holds this one (MSP `sessionNotLoaded`: evicted or closed, D25).
   */
  private async submitResuming(
    host: AgentHost,
    session: AgentSession,
    parts: readonly TurnPart[],
    displayText: string | undefined,
  ): Promise<TurnSubmission> {
    try {
      return await this.submit(session, parts, displayText)
    } catch (error: unknown) {
      if (!(error instanceof SessionNotLoadedError) || this.deps.workspaceRoot === undefined) {
        throw error
      }
      this.deps.log.info(`Session ${error.sessionId} was not loaded; resuming it`)
      this.resumeTarget = { sessionId: error.sessionId, kind: host.info.kind }
      this.dropSession(false)
      const resumed = await this.ensureSession(this.deps.workspaceRoot)
      return await this.submit(resumed, parts, displayText)
    }
  }

  private async cancel(): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.cancel()
    } catch (error: unknown) {
      this.deps.log.warn(`turn/cancel failed: ${describe(error)}`)
    }
  }

  /** Whether a contributor-tier model may be used here: blocked, or confirmed once. */
  private async allowsModel(modelId: string): Promise<boolean> {
    if (!isContributorModel(modelId) || this.confirmedContributor === modelId) {
      return true
    }
    if (this.deps.isConfidentialWorkspace()) {
      this.notice('warning', UI_TEXT.contributorBlocked)
      return false
    }
    if (!(await this.deps.confirmContributor(modelId))) {
      return false
    }
    this.confirmedContributor = modelId
    return true
  }

  private async setModel(modelId: string): Promise<void> {
    if (!(await this.allowsModel(modelId))) {
      this.postSessionInfo(this.modelId)
      return
    }
    const previous = this.modelId
    this.modelId = modelId
    if (this.session !== undefined) {
      try {
        await this.session.setModel(modelId)
      } catch (error: unknown) {
        this.modelId = previous
        this.notice('error', `Could not switch model: ${describe(error)}`)
        return
      }
    }
    this.postSessionInfo(modelId)
    // A tier the new model does not serve would fail its turns with a 400
    // (muse-spark-1.2 has no `max`); drop to the highest tier it does serve.
    const levels = effortLevelsFor(modelId)
    if (!levels.includes(this.effort)) {
      await this.updateEffort(levels.at(-1) ?? DEFAULT_EFFORT, this.isThinkingEnabled)
    }
  }

  private async updateEffort(effort: EffortLevel, isThinkingEnabled: boolean): Promise<void> {
    this.effort = effort
    this.isThinkingEnabled = isThinkingEnabled
    if (this.session !== undefined) {
      await this.applyEffort(this.session)
    }
    this.postComposerState()
  }

  /** Whether the user may enter Bypass now: the setting, and in a remote window one yes (D24). */
  private async mayBypass(): Promise<boolean> {
    if (!this.deps.isBypassAllowed()) {
      this.notice('warning', UI_TEXT.bypassNotAllowed)
      return false
    }
    if (!this.deps.isRemoteWindow || this.hasConfirmedRemoteBypass) {
      return true
    }
    this.hasConfirmedRemoteBypass = await this.deps.confirmRemoteBypass()
    return this.hasConfirmedRemoteBypass
  }

  private async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode === BYPASS_MODE && !(await this.mayBypass())) {
      this.postComposerState()
      return
    }
    const previous = this.permissionMode
    this.permissionMode = mode
    const target = approvalModeFor(mode, this.deps.hasApprovalUi)
    if (
      this.session !== undefined &&
      target !== approvalModeFor(previous, this.deps.hasApprovalUi)
    ) {
      try {
        await this.session.setApprovalMode(target)
      } catch (error: unknown) {
        this.permissionMode = previous
        this.notice('error', `Could not change the permission mode: ${describe(error)}`)
      }
    }
    this.postComposerState()
  }

  private clear(): void {
    this.dropSession()
    // A new conversation is new: the session a restart or crash left to
    // resume is not picked up by its first message (D25).
    this.resumeTarget = undefined
    // The webview drops its transcript too, whoever asked: the panel's own
    // New Conversation (it spends the echo) or a keybinding (M25, D28).
    this.post({ type: 'conversationCleared' })
    this.attachments.clear()
    this.setTitle(undefined)
    // No session any more: the webview forgets the id it keeps for the
    // reload serializer (D15).
    this.postSessionInfo(this.modelId)
    void this.deps.sessions.setLastSession(undefined)
    this.post({ type: 'attachmentsCleared' })
  }

  private async compact(): Promise<void> {
    const session = await this.sessionForAction()
    if (session === undefined) {
      return
    }
    try {
      const outcome = await session.compact()
      if (outcome.status === NOOP_STATUS) {
        this.notice('info', `Nothing to compact (${outcome.reason ?? NOOP_STATUS}).`)
      } else if (outcome.status === CANCELLED_STATUS) {
        this.notice('info', UI_TEXT.compactionStoppedNotice)
      }
    } catch (error: unknown) {
      const reason = describe(error)
      if (reason.includes(MISSING_RUN_REASON)) {
        this.notice('info', NOTHING_TO_COMPACT)
      } else {
        this.notice('error', `Compaction failed: ${reason}`)
      }
    }
  }

  private async listSkills(): Promise<void> {
    if (this.skills !== undefined) {
      this.postSkills()
      return
    }
    const session = await this.sessionForAction()
    if (session !== undefined) {
      await this.refreshSkills(session)
    }
  }

  private async searchMentions(requestId: number, query: string): Promise<void> {
    try {
      const items = await this.deps.mentions.search(query, MENTION_RESULT_LIMIT)
      this.post({ type: 'mentionResults', requestId, items: [...items] })
    } catch (error: unknown) {
      this.deps.log.warn(`mention search failed: ${describe(error)}`)
      this.post({ type: 'mentionResults', requestId, items: [] })
    }
  }

  private addImage(name: string, bytes: Uint8Array): void {
    const result = this.attachments.add(name, bytes)
    if (result.ok) {
      this.post({ type: 'attachmentAdded', attachment: result.attachment })
    } else {
      this.post({ type: 'attachmentRejected', name, reason: result.reason })
    }
  }

  private insertMention(relativePath: string): void {
    this.post({ type: 'insertText', text: `@${relativePath} ` })
  }

  private async pickFile(): Promise<void> {
    const picked = await this.deps.files.showOpenDialog()
    for (const file of picked) {
      const extension = path.extname(file.name).toLowerCase()
      if (Object.hasOwn(IMAGE_EXTENSIONS, extension)) {
        this.addImage(file.name, await this.deps.files.readFile(file.fsPath))
      } else {
        this.insertMention(file.relativePath ?? file.fsPath.replaceAll('\\', '/'))
      }
    }
  }

  private async pickMentionFile(): Promise<void> {
    const relativePath = await this.deps.files.pickMentionFile()
    if (relativePath !== undefined) {
      this.insertMention(relativePath)
    }
  }

  private droppedUris(uris: readonly string[]): void {
    const mentions = uris
      .map((uri) => this.deps.files.toRelativePath(uri))
      .filter((relativePath) => relativePath !== undefined)
      .map((relativePath) => `@${relativePath} `)
    if (mentions.length > 0) {
      this.post({ type: 'insertText', text: mentions.join('') })
    }
  }

  private async runHostAction(action: HostAction): Promise<void> {
    if (action === 'reload') {
      // The webview's error boundary asked for a fresh document (M11).
      this.deps.surface.reload()
      return
    }
    try {
      await this.deps.runHostAction(action)
    } catch (error: unknown) {
      this.notice('error', `${action} failed: ${describe(error)}`)
    }
  }

  /** Called when the webview has mounted: replay the state it needs. */
  // --- Account & usage (M8) ---

  /**
   * Answer the dialog with the backend and the subscription window the host
   * last observed, and keep answering while `usage/changed` arrives.
   */
  private async readUsage(): Promise<void> {
    try {
      const host = await this.deps.ensureHost()
      this.usageWatch.ensure(host, (watched) =>
        watched.onUsageChanged((usage) => {
          void this.postUsage(watched, usage)
        }),
      )
      await this.postUsage(host, await host.readUsage())
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.usageUnavailable}: ${describe(error)}`)
    }
  }

  private async postUsage(
    host: AgentHost,
    subscription: SubscriptionUsage | undefined,
  ): Promise<void> {
    const account = await this.deps.accountFacts(host.info.kind)
    const insights = host.info.kind === 'museCode' ? await this.deps.usageInsights() : undefined
    // The CLI reports a window only after it has seen a reply (M8, re-probed
    // 2026-09-22: `usage/read` is empty after a host and even a session
    // start). Until then the dialog shows the last window it ever reported,
    // dated by its own `observedAtMs` (M16).
    if (subscription !== undefined) {
      await this.deps.usageCache.write(subscription)
    }
    const shown =
      subscription ?? (host.info.kind === 'museCode' ? this.deps.usageCache.read() : undefined)
    this.post({
      type: 'usageReport',
      backend: host.info.kind,
      account,
      ...(shown !== undefined && { subscription: shown }),
      ...(insights !== undefined && { insights }),
    })
  }

  /** An owner command on a subagent from the Agent map (M18); the CLI's item updates carry the outcome. */
  private async controlSubagent(subagentId: string, action: SubagentAction): Promise<void> {
    if (this.session === undefined) {
      return
    }
    try {
      await this.session.controlSubagent(subagentId, action)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`)
    }
  }

  private async messageSubagent(
    subagentId: string,
    body: string,
    isFollowup: boolean,
  ): Promise<void> {
    if (this.session === undefined || body.trim() === '') {
      return
    }
    try {
      await this.session.messageSubagent(subagentId, body.trim(), isFollowup)
    } catch (error: unknown) {
      this.notice('error', `${UI_TEXT.agentControlFailed}: ${describe(error)}`)
    }
  }

  /** The Agent map asked for a subagent's own transcript (M14). */
  private async readChildSession(sessionId: string): Promise<void> {
    try {
      const host = await this.deps.ensureHost()
      const history = await host.readSession(sessionId)
      this.post({
        type: 'childTranscript',
        sessionId,
        ...(history.name !== undefined && { name: history.name }),
        items: [...history.items],
      })
    } catch (error: unknown) {
      this.notice('warning', `${UI_TEXT.agentTranscriptFailed}: ${describe(error)}`)
    }
  }

  // --- Voice dictation (M9) ---

  private postDictationState(): void {
    const { dictation } = this.deps
    this.post(
      dictation.isAvailable
        ? { type: 'dictationState', status: this.dictationStatus }
        : { type: 'dictationState', status: 'unavailable', reason: dictation.reason },
    )
  }

  private dictationDriver(): DictationHandle | undefined {
    const { dictation } = this.deps
    if (!dictation.isAvailable) {
      return undefined
    }
    this.dictation ??= dictation.create({
      onStatus: (status) => {
        this.dictationStatus = status
        this.postDictationState()
      },
      // Phrases land at the caret, each followed by a space so the next one
      // (or typing) does not run into it.
      onText: (text) => {
        this.post({ type: 'insertText', text: `${text} ` })
      },
      onError: (reason) => {
        this.notice('error', `${UI_TEXT.dictationFailed}: ${reason}`)
      },
    })
    return this.dictation
  }

  private handleDictation(action: DictationAction): void {
    const driver = this.dictationDriver()
    if (driver === undefined) {
      // The button is disabled with the reason; a stray press re-sends it.
      this.postDictationState()
      return
    }
    if (action === 'start') {
      driver.start()
    } else {
      driver.stop()
    }
  }

  /**
   * List the models as soon as the panel is open (M15). Until then only a
   * send, a resume or the pill's skill listing started the host and listed
   * the models, so the pill read "Starting Muse Code…" until the first
   * click. Starting the host and listing its models makes no model call.
   */
  private async warmModels(): Promise<void> {
    if (this.deps.auth.current.status !== 'signedIn') {
      return
    }
    try {
      if (this.models === undefined) {
        const host = await this.deps.ensureHost()
        await this.ensureModels(host)
      }
      // The pill reads the session's model; before any session it reads the
      // one the first send will use (M16).
      if (this.session === undefined) {
        this.postSessionInfo(this.modelId)
      }
    } catch (error: unknown) {
      this.deps.log.warn(`model warm-up failed: ${describe(error)}`)
      this.notice('warning', `${UI_TEXT.hostStartFailed}: ${describe(error)}`)
    }
  }

  /** Why the conversation did not start as configured (D24), said once. */
  private postStartupNotice(): void {
    if (this.startupNotice === undefined) {
      return
    }
    this.notice('warning', this.startupNotice)
    this.startupNotice = undefined
  }

  public surfaceReady(): void {
    // First, so a reloaded webview keeps the conversation it saved only when
    // that session is still the live one here, with its running turn (M25, D28).
    this.post({
      type: 'surfaceState',
      ...(this.session !== undefined && { sessionId: this.session.sessionId }),
      ...(this.activeTurnId !== undefined && { activeTurnId: this.activeTurnId }),
    })
    this.post(this.deps.auth.toMessage())
    this.postComposerState()
    this.postDictationState()
    if (this.models !== undefined) {
      this.post({ type: 'modelList', models: [...this.models] })
    }
    if (this.session !== undefined) {
      this.postSessionInfo(this.session.modelId)
    }
    this.postSkills()
    for (const attachment of this.attachments.list()) {
      this.post({ type: 'attachmentAdded', attachment })
    }
    void this.warmModels()
    this.postStartupNotice()
  }

  public async handle(message: ConversationMessage): Promise<void> {
    switch (message.type) {
      case 'sendMessage': {
        await this.send(
          message.localId,
          message.text,
          message.attachmentIds,
          message.includeEditorContext === true,
          message.reference,
        )
        break
      }
      case 'cancelTurn': {
        await this.cancel()
        break
      }
      case 'signIn': {
        await this.deps.auth.signIn(message.method)
        void this.warmModels()
        break
      }
      case 'signOut': {
        this.dropSession()
        await this.deps.auth.signOut()
        break
      }
      case 'retryBackend': {
        this.dropSession()
        await this.deps.auth.refresh()
        break
      }
      case 'openExternal': {
        this.openLink(message.url)
        break
      }
      case 'decideApproval': {
        await this.decideApproval(message)
        break
      }
      case 'answerQuestion': {
        await this.answerQuestion(message)
        break
      }
      case 'cancelQuestion': {
        await this.cancelQuestion(message.userInputId)
        break
      }
      case 'readOutput': {
        await this.readOutput(message)
        break
      }
      case 'openOutput': {
        await this.openOutput(message)
        break
      }
      case 'copyText': {
        await this.deps.copyText(message.text)
        break
      }
      case 'insertCode': {
        await this.insertCode(message.text)
        break
      }
      case 'applyCode': {
        await this.applyCode(message.text)
        break
      }
      case 'openEditDiff': {
        await this.reviewEdit('openDiff', message.itemId, message.outputRef)
        break
      }
      case 'openFile': {
        await this.openFile(message)
        break
      }
      case 'rewindCode': {
        await this.rewindCode(message.edits)
        break
      }
      case 'setModel': {
        await this.setModel(message.modelId)
        break
      }
      case 'setEffort': {
        await this.updateEffort(message.effort, this.isThinkingEnabled)
        break
      }
      case 'setThinking': {
        await this.updateEffort(this.effort, message.enabled)
        break
      }
      case 'setPermissionMode': {
        await this.setPermissionMode(message.mode)
        break
      }
      case 'clearConversation': {
        this.clear()
        break
      }
      case 'compact': {
        await this.compact()
        break
      }
      case 'listSkills': {
        await this.listSkills()
        break
      }
      case 'searchMentions': {
        await this.searchMentions(message.requestId, message.query)
        break
      }
      case 'pickFile': {
        await this.pickFile()
        break
      }
      case 'pickMentionFile': {
        await this.pickMentionFile()
        break
      }
      case 'attachImageData': {
        this.addImage(message.name, new Uint8Array(Buffer.from(message.base64, 'base64')))
        break
      }
      case 'removeAttachment': {
        this.attachments.remove(message.id)
        break
      }
      case 'droppedUris': {
        this.droppedUris(message.uris)
        break
      }
      case 'hostAction': {
        await this.runHostAction(message.action)
        break
      }
      case 'listSessions': {
        await this.listSessions()
        break
      }
      case 'readChildSession': {
        await this.readChildSession(message.sessionId)
        break
      }
      case 'subagentControl': {
        await this.controlSubagent(message.subagentId, message.action)
        break
      }
      case 'subagentMessage': {
        await this.messageSubagent(message.subagentId, message.body, message.isFollowup)
        break
      }
      case 'resumeSession': {
        await this.resumeSession(message.sessionId)
        break
      }
      case 'setSessionArchived': {
        await this.setSessionArchived(message.sessionId, message.isArchived)
        break
      }
      case 'forkSession': {
        await this.forkSession(message.lastTurnId)
        break
      }
      case 'renameSession': {
        await this.renameSession(message.name)
        break
      }
      case 'dictation': {
        this.handleDictation(message.action)
        break
      }
      case 'readUsage': {
        await this.readUsage()
        break
      }
    }
  }

  /**
   * The Claude Code sidebar rule: a surface that reopens within ten minutes
   * of its last session's activity picks that session up again; otherwise
   * it starts empty and the History dialog has it.
   */
  public async restoreRecentSession(): Promise<void> {
    const last = this.deps.sessions.lastSession()
    if (
      last === undefined ||
      this.session !== undefined ||
      !this.deps.isRestorable ||
      this.deps.workspaceRoot === undefined ||
      this.deps.auth.current.status !== 'signedIn'
    ) {
      return
    }
    if (this.deps.now() - last.at > SESSION_RESTORE_WINDOW_MS) {
      await this.deps.sessions.setLastSession(undefined)
      return
    }
    await this.resumeSession(last.sessionId)
  }

  /**
   * A panel VS Code rebuilt after a window reload held this session (D15):
   * resume it once the surface is signed in, unless a session is live.
   */
  public async restoreSession(sessionId: string): Promise<void> {
    if (
      this.session !== undefined ||
      this.deps.workspaceRoot === undefined ||
      this.deps.auth.current.status !== 'signedIn'
    ) {
      return
    }
    await this.resumeSession(sessionId)
  }

  /**
   * The Bypass setting was turned off (D24): a conversation in Bypass drops
   * to Manual. If the host refuses the change, the session goes too, so no
   * turn runs without approvals under a setting that says otherwise.
   */
  public async revokeBypass(): Promise<void> {
    if (this.permissionMode !== BYPASS_MODE) {
      return
    }
    this.permissionMode = FALLBACK_MODE
    if (this.session !== undefined) {
      try {
        await this.session.setApprovalMode(approvalModeFor(FALLBACK_MODE, this.deps.hasApprovalUi))
      } catch (error: unknown) {
        this.deps.log.warn(`Bypass revocation: the mode change failed (${describe(error)})`)
        this.dropSession()
      }
    }
    this.notice('warning', UI_TEXT.bypassRevoked)
    this.postComposerState()
  }

  /** Alt+T: flip the Thinking toggle for this conversation. */
  public async toggleThinking(): Promise<void> {
    await this.updateEffort(this.effort, !this.isThinkingEnabled)
  }

  /**
   * The extension is about to stop the hosts (a restart for a setting, trust
   * granted, a sign-in or sign-out; PLAN.md D25). A running turn is
   * cancelled and ended in the webview; unless the conversations end (sign
   * out, shutdown), the session is resumed by the next message.
   */
  public async backendStopping(isConversationEnding: boolean): Promise<void> {
    const { session } = this
    if (session !== undefined && this.activeTurnId !== undefined) {
      try {
        await session.cancel()
      } catch (error: unknown) {
        this.deps.log.warn(`turn/cancel before the restart failed: ${describe(error)}`)
      }
      this.endTurnLocally('cancelled', UI_TEXT.turnStoppedByRestart)
    }
    this.rememberForResume(isConversationEnding ? undefined : session)
    this.dropSession(false)
    this.listWatch.forget()
    this.usageWatch.forget()
  }

  /**
   * The host process ended. The extension's own close is not news; a crash
   * ends the running turn and is resumed by the next message, unless the
   * process refuses to run as configured, which the sign-in gate reports.
   */
  public hostExited(exit: HostExit): void {
    if (exit.isExpected) {
      return
    }
    const didHaveSession = this.session !== undefined
    this.rememberForResume(this.session)
    this.endTurnLocally('failed', `${UI_TEXT.hostExited} (${exit.description})`)
    this.dropSession(false)
    this.listWatch.forget()
    this.usageWatch.forget()
    if (exit.isPersistent) {
      this.deps.auth.markBackendError(`${UI_TEXT.hostExited} (${exit.description})`)
    } else if (didHaveSession) {
      this.notice(
        'warning',
        `${UI_TEXT.hostExited} (${exit.description}). ${UI_TEXT.hostRestartsOnSend}`,
      )
    }
  }

  public dispose(): void {
    this.isDisposed = true
    this.dropSession()
    this.listWatch.dispose()
    this.usageWatch.dispose()
    this.dictation?.dispose()
    this.dictation = undefined
  }
}
