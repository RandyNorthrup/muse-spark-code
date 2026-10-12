// The runtime conversation Git adapter (M123 lane G, PLAN.md D104):
// `createRuntimeGit(surface, deps): ConversationGitPort` beside the VS
// Code adapter, for every editor outside VS Code (and a VS Code-family
// host without `vscode.git`). The Git half runs natively through
// `./service`; the pull request half answers explicitly until lane P
// lands it, and the sign-in card until lanes A and L land the sources.
//
// - `openCommit` posts the commit form with its stamp (the status records,
//   the index's object names among them, and the working tree's bytes);
//   `commit` validates, rechecks that stamp inside the repository's lock,
//   and commits (hooks and signers run). The caller's form press is the
//   confirmation: lane U's panel shows the message and the files first, as
//   the VS Code confirm modal does there.
// - `push` plans with M71's push plan (same refusals, one shared table
//   test), asks which remote when git cannot tell (`pickRemote`), and asks
//   before anything goes (`confirmPush`: the remote and every URL git
//   pushes it to, rewrites applied and masked, the branch and its target,
//   the commits). The service revalidates the confirmed plan after every
//   wait and pushes it in the user's own Git environment. Only git's own
//   failure of that push names the remote and opens the same command in
//   the editor's terminal, and only in the same repository with the plan
//   still the one confirmed; a refusal, a lost trust or owner, or Cancel
//   never does.
// - Cancel, a session change and disposal abort the running operation's
//   signal: pending git stops, and nothing new starts.
// - The linked pull request shows from the runtime link store; its status
//   and checks, the pull request form, creation and trust arrive with
//   lane P. Until then those actions answer `gitHubSignInDeclined` (no
//   sign-in was given, so nothing was sent) or `gitHeld`, never an empty
//   success.
// - Draft prompts for a commit message read the native diff and new files
//   confined to the bound root; generations settle as the VS Code
//   adapter's do.
// - Git's words reach the panel redacted first, then cut to size.

import type {
  ConversationGitPort,
  GitSurface,
} from '../../../host/conversation/conversationController'
import { isGitExitError } from '../../../host/git'
import { redactSecrets } from '../../../core/redact'
import { maskRemoteUrl } from '../../../core/git/githubRemote'
import {
  commitMessageFrom,
  commitMessagePrompt,
  gitDraftContract,
  pullRequestTextFrom,
  structuredGitDraft,
  type GitDraftOutputPort,
} from '../../../core/git/gitText'
import type { PushPlan } from '../../../core/git/pushPlan'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import type { NativeStatusSnapshot } from '../../../core/git/status'
import { fill } from '../../../shared/l10n/text'
import { replyIfUsable } from '../../../core/turns/usableReply'
import type { AgentEvent } from '../../../shared/agentEvents'
import {
  GIT_FORM_FILES_SHOWN,
  GIT_PROMPT_DIFF_MAX_CHARS,
  STDERR_SHOWN_CHARS,
  UI_TEXT,
} from '../../../shared/constants'
import type {
  CommitFormFacts,
  GitAction,
  GitDraftKind,
  GitState,
  PullRequestView,
} from '../../../shared/git'
import {
  CommitRefusedError,
  NativeGitRefusalError,
  NativeGitService,
  nativePushTerminalCommand,
  refusalOf,
  type NativeGitOperation,
  type NativeGitServiceOptions,
  type NativePushPlan,
  type NativePushPlanResult,
} from './service'

const AGENT_MESSAGE_KIND = 'agentMessage'
/** Between the URLs of a remote with several push URLs (git pushes to each). */
const PUSH_URL_SEPARATOR = ', '
const EMPTY_STATE_JSON = '{}'

/**
 * Git's words for the panel: the whole text redacted first, then cut to
 * size, so a cut can never strip the name that marks a credential and
 * leave its value.
 */
function nativeFailureText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return redactSecrets(text).slice(-STDERR_SHOWN_CHARS)
}

function pushRefusalText(plan: Extract<PushPlan, { ok: false }>): string {
  switch (plan.refusal) {
    case 'detached': {
      return UI_TEXT.gitPushDetached
    }
    case 'unsafeName': {
      return UI_TEXT.gitPushUnsafeName
    }
    case 'behind': {
      return UI_TEXT.gitPushBehind
    }
    case 'upToDate': {
      return UI_TEXT.gitPushUpToDate
    }
    case 'noRemote': {
      return UI_TEXT.gitPushNoRemote
    }
    case 'chooseRemote': {
      // Only after the user dismissed the remote pick.
      return UI_TEXT.gitPushDeclined
    }
  }
}

/** A refusal the panel words: Cancel and disposal stay silent. */
function refusalNotice(refusal: ReturnType<typeof refusalOf>): string | undefined {
  switch (refusal) {
    case 'untrusted': {
      return UI_TEXT.gitRestricted
    }
    case 'changed': {
      return UI_TEXT.gitOperationChanged
    }
    case 'refused': {
      return UI_TEXT.gitPushUnsafeName
    }
    case 'closed':
    case undefined: {
      return undefined
    }
  }
}

interface PendingDraft {
  readonly id: number
  readonly formEpoch: number
  readonly kind: GitDraftKind
  turnId: string | undefined
  readonly output?:
    | {
        readonly port: GitDraftOutputPort
        readonly abort: AbortController
        readonly signal: AbortSignal
      }
    | undefined
  settling?: boolean
}

/**
 * The runtime Git adapter. Owns one conversation's forms, drafts and
 * link display; the service owns git itself. Trust, session and lifetime
 * are rechecked after every await, as the VS Code adapter does.
 */
export class RuntimeGit implements ConversationGitPort {
  private readonly service: NativeGitService
  private operationEpoch = 0
  private observedSessionId: string | undefined
  private formEpoch = 0
  private formAbort = new AbortController()
  private commitStamp: string | undefined
  private view: PullRequestView | undefined
  private statusEpoch = 0
  private lastPostedJson = EMPTY_STATE_JSON
  private isOperating = false
  private isDisposed = false
  private checkOperation: (() => void) | undefined
  /** The running operation's own stop: Cancel, a session change and disposal abort it. */
  private operationAbort = new AbortController()
  private draft: PendingDraft | undefined
  private draftEpoch = 0
  private readonly turnsSeen = new Map<
    string,
    { text: string | undefined; terminal: string | undefined; errorKind: string | undefined }
  >()

  public constructor(
    private readonly surface: GitSurface,
    private readonly deps: RuntimeGitDeps,
    options: NativeGitServiceOptions = {},
  ) {
    this.service = new NativeGitService(deps, options)
  }

  private currentState(): GitState {
    return this.view === undefined ? {} : { pullRequest: this.view }
  }

  private unavailableReason(): string | undefined {
    if (this.deps.repositoryRoot === '') {
      return UI_TEXT.noWorkspaceReason
    }
    return this.deps.isTrusted() ? undefined : UI_TEXT.gitRestricted
  }

  /** Notices when git cannot run here; true when it can. */
  private usable(): boolean {
    const reason = this.unavailableReason()
    if (reason === undefined) {
      return true
    }
    this.surface.notice('warning', reason)
    return false
  }

  /**
   * A consent belongs to this conversation and trust state, never to a
   * later one. The service runs this after every await and at the spawn.
   */
  private activityCheck(): () => void {
    const watched = { epoch: this.operationEpoch, session: this.surface.sessionId() }
    return () => {
      if (this.isDisposed) {
        throw new NativeGitRefusalError('closed')
      }
      if (
        watched.epoch !== this.operationEpoch ||
        watched.session !== this.surface.sessionId() ||
        this.deps.repositoryRoot === ''
      ) {
        throw new NativeGitRefusalError('changed')
      }
      if (!this.deps.isTrusted()) {
        throw new NativeGitRefusalError('untrusted')
      }
    }
  }

  private checkCurrent(): void {
    this.checkOperation?.()
  }

  /** Whether the running operation is still this conversation's, trusted and unstopped. */
  private isStillCurrent(): boolean {
    try {
      this.checkCurrent()
    } catch {
      return false
    }
    return !this.operationAbort.signal.aborted && !this.deps.signal.aborted
  }

  /** The running operation as the service takes it: its stop and its owner check. */
  private operation(): NativeGitOperation {
    return {
      signal: this.operationAbort.signal,
      check: () => {
        this.checkCurrent()
      },
    }
  }

  /** Stops the running operation's pending git: Cancel, a session change, disposal. */
  private stopOperation(): void {
    this.operationEpoch += 1
    this.operationAbort.abort()
    this.operationAbort = new AbortController()
  }

  private canPost(): boolean {
    return !this.isDisposed
  }

  /** Answers a form's press, so its buttons come back. */
  private answerForm(form: 'commit' | 'pullRequest', isOk: boolean): void {
    if (this.canPost()) {
      this.surface.post({ type: 'gitDone', form, ok: isOk })
    }
  }

  /** A second press is ignored, so a running form's press fails instead. */
  private refuseForm(form: 'commit' | 'pullRequest'): void {
    this.answerForm(form, false)
  }

  private answerCommit(isOk: boolean): void {
    this.answerForm('commit', isOk)
  }

  /** A new form epoch: pending form work stops, and the old stamp dies with it. */
  private resetForm(): void {
    this.formAbort.abort()
    this.formAbort = new AbortController()
    this.formEpoch += 1
    this.commitStamp = undefined
  }

  private async openCommitForm(operation: NativeGitOperation): Promise<void> {
    this.resetForm()
    if (!this.usable()) {
      return
    }
    let snapshot: NativeStatusSnapshot
    let stamp: string
    try {
      ;({ snapshot, stamp } = await this.service.formStatus(operation))
      this.checkCurrent()
    } catch (error: unknown) {
      this.noticeFailure(error)
      return
    }
    const files: CommitFormFacts['files'] = [
      ...snapshot.staged.map((file) => ({ path: file, isStaged: true })),
      ...[...snapshot.unstaged, ...snapshot.untracked].map((file) => ({
        path: file,
        isStaged: false,
      })),
    ]
    if (files.length === 0) {
      this.surface.notice('info', UI_TEXT.gitNothingToCommit)
      return
    }
    this.commitStamp = stamp
    this.checkCurrent()
    this.surface.post({
      type: 'gitCommitForm',
      form: {
        ...(snapshot.branch !== undefined && { branch: snapshot.branch }),
        staged: snapshot.staged.length,
        unstaged: snapshot.unstaged.length + snapshot.untracked.length,
        files: files.slice(0, GIT_FORM_FILES_SHOWN),
        moreFiles: Math.max(files.length - GIT_FORM_FILES_SHOWN, 0),
      },
    })
  }

  /** The push for the current branch, asking which remote when git cannot tell (M71's pick). */
  private async pushPlanFor(
    operation: NativeGitOperation,
  ): Promise<NativePushPlanResult | undefined> {
    const plan = await this.service.planPush(undefined, operation)
    this.checkCurrent()
    if (plan.ok || plan.refusal !== 'chooseRemote') {
      return plan
    }
    const names = plan.remotes ?? []
    const chosen = await this.deps.pickRemote(names)
    this.checkCurrent()
    if (chosen === undefined || !names.includes(chosen)) {
      this.surface.notice('info', UI_TEXT.gitPushDeclined)
      return undefined
    }
    const picked = await this.service.planPush(chosen, operation)
    this.checkCurrent()
    return picked
  }

  private async pushAction(operation: NativeGitOperation): Promise<void> {
    if (!this.usable()) {
      return
    }
    let plan: NativePushPlanResult | undefined
    try {
      plan = await this.pushPlanFor(operation)
    } catch (error: unknown) {
      this.noticeFailure(error)
      return
    }
    if (plan === undefined) {
      return
    }
    if (!plan.ok) {
      this.surface.notice(plan.refusal === 'upToDate' ? 'info' : 'warning', pushRefusalText(plan))
      return
    }
    // Nothing goes before the user saw where, what and how many (D104,
    // M71's push modal): the remote and every URL git pushes it to (its
    // rewrites applied, masked), the target, the commits.
    const isConfirmed = await this.deps.confirmPush({
      remote: plan.remote,
      remoteUrl:
        plan.pushUrls.length === 0
          ? undefined
          : plan.pushUrls.map((url) => maskRemoteUrl(url)).join(PUSH_URL_SEPARATOR),
      branch: plan.branch,
      target: plan.target,
      commits: plan.commits,
    })
    this.checkCurrent()
    if (!isConfirmed) {
      this.surface.notice('info', UI_TEXT.gitPushDeclined)
      return
    }
    try {
      await this.service.push(plan, operation)
    } catch (error: unknown) {
      await this.pushFailed(plan, error, operation)
      return
    }
    // The push went through: said as such even when Cancel came after it.
    if (this.canPost()) {
      this.surface.notice(
        'info',
        fill(UI_TEXT.gitPushed, { branch: plan.branch, remote: plan.remote }),
      )
    }
  }

  /**
   * Only git's own failure of the confirmed push, while this conversation
   * still owns a trusted operation, names the remote and offers the same
   * command (the same `git`, the bound root) in the editor's terminal
   * (D104). A refusal, a lost trust or owner, Cancel or a timeout never does.
   */
  private async pushFailed(
    plan: NativePushPlan,
    error: unknown,
    operation: NativeGitOperation,
  ): Promise<void> {
    const isGitsOwn =
      refusalOf(error) === undefined && operation.signal?.aborted !== true && isGitExitError(error)
    if (!isGitsOwn) {
      this.noticeFailure(error)
      return
    }
    this.deps.log.warn('Push failed')
    if (this.canPost()) {
      this.surface.say('error', `${UI_TEXT.gitPushFailed}: ${nativeFailureText(error)}`)
    }
    if (!this.isStillCurrent()) {
      return
    }
    // The terminal starts git itself: only in the same bound repository,
    // verified again, with the plan still exactly the one confirmed (R5).
    let root: string
    try {
      root = await this.service.confirmedPushRoot(plan, operation)
    } catch (error_: unknown) {
      this.noticeFailure(error_)
      return
    }
    if (!this.isStillCurrent()) {
      return
    }
    await this.deps.openInTerminal(nativePushTerminalCommand(plan, this.deps.gitPath), root)
  }

  /** A refusal in the panel's words; anything else is git's (redacted, then cut). */
  private noticeFailure(error: unknown): void {
    if (!this.canPost()) {
      return
    }
    const refusal = refusalOf(error)
    if (refusal === 'closed' || this.deps.signal.aborted) {
      return
    }
    const notice = refusalNotice(refusal)
    if (notice !== undefined) {
      this.surface.notice('warning', notice)
      return
    }
    this.surface.say('warning', nativeFailureText(error))
  }

  private answerCommitRefusal(problem: CommitRefusedError['problem'], trimmed: string): void {
    switch (problem) {
      case 'empty': {
        this.surface.notice('warning', UI_TEXT.gitCommitMessageEmpty)
        break
      }
      case 'credentialShaped': {
        // The form gets the masked text back; the user sees it before anything is kept.
        this.surface.post({
          type: 'gitDraft',
          draft: { kind: 'commitMessage', message: redactSecrets(trimmed) },
        })
        this.surface.notice('warning', UI_TEXT.gitCredentialMasked)
        break
      }
      case 'nothingStaged': {
        this.surface.notice('warning', UI_TEXT.gitNothingStaged)
        break
      }
      case 'nothingToCommit': {
        this.surface.notice('warning', UI_TEXT.gitNothingToCommit)
        break
      }
    }
  }

  private async commitNow(
    message: string,
    isUnstagedIncluded: boolean,
    operation: NativeGitOperation,
  ): Promise<void> {
    if (!this.usable()) {
      this.answerCommit(false)
      return
    }
    const stamp = this.commitStamp
    if (stamp === undefined) {
      // No open form (Cancel or a session change closed it): nothing to confirm.
      this.surface.notice('warning', UI_TEXT.gitOperationChanged)
      this.answerCommit(false)
      return
    }
    try {
      const committed = await this.service.commit(message, isUnstagedIncluded, stamp, operation)
      this.resetForm()
      this.draft?.output?.abort.abort()
      this.draft = undefined
      this.turnsSeen.clear()
      this.surface.notice(
        'info',
        fill(UI_TEXT.gitCommitted, { subject: committed.subject, branch: committed.branch }),
      )
      this.answerCommit(true)
    } catch (error: unknown) {
      if (error instanceof CommitRefusedError) {
        this.answerCommitRefusal(error.problem, error.trimmed)
        this.answerCommit(false)
        return
      }
      if (operation.signal?.aborted === true) {
        // Cancel, a session change or disposal stopped it: no failure to say.
        this.answerCommit(false)
        return
      }
      if (refusalOf(error) !== undefined) {
        this.noticeFailure(error)
        this.answerCommit(false)
        return
      }
      this.deps.log.warn('Commit failed')
      if (this.canPost()) {
        this.surface.say('error', `${UI_TEXT.gitCommitFailed}: ${nativeFailureText(error)}`)
      }
      this.answerCommit(false)
    }
  }

  /**
   * Runs `operation` unless another commit, push or pull request operation
   * is running for this conversation: a second press is ignored, and a
   * form's press is answered as failed, so its buttons come back.
   */
  private async exclusively(
    operation: (running: NativeGitOperation) => Promise<void>,
    form?: 'commit' | 'pullRequest',
  ): Promise<void> {
    if (this.isDisposed || this.isOperating) {
      this.deps.log.info('A git operation is already running here; the second press is ignored')
      if (form !== undefined) {
        this.refuseForm(form)
      }
      return
    }
    this.isOperating = true
    this.checkOperation = this.activityCheck()
    try {
      this.checkCurrent()
      // This operation's own stop, taken now: a later Cancel aborts it.
      await operation(this.operation())
    } catch (error: unknown) {
      this.noticeFailure(error)
      if (form !== undefined) {
        this.refuseForm(form)
      }
    } finally {
      this.checkOperation = undefined
      this.isOperating = false
    }
  }

  /** Lane P replaces this with the REST flow; the notice stays honest either way. */
  private githubUnavailable(form?: 'pullRequest'): void {
    this.surface.notice('warning', UI_TEXT.gitHubSignInDeclined)
    if (form !== undefined) {
      this.refuseForm(form)
    }
  }

  private seen(turnId: string): {
    text: string | undefined
    terminal: string | undefined
    errorKind: string | undefined
  } {
    const known = this.turnsSeen.get(turnId)
    if (known !== undefined) {
      return known
    }
    const fresh: {
      text: string | undefined
      terminal: string | undefined
      errorKind: string | undefined
    } = {
      text: undefined,
      terminal: undefined,
      errorKind: undefined,
    }
    this.turnsSeen.set(turnId, fresh)
    return fresh
  }

  /**
   * The new files' bytes appended to the diff, within the prompt's budget,
   * each read confined to the bound root by the identity of every
   * directory on its way (never through a swapped link or junction).
   */
  private async withNewFiles(
    diff: string,
    untracked: readonly string[],
    room: number,
    operation: NativeGitOperation,
  ): Promise<string> {
    if (room <= 0 || untracked.length === 0) {
      return diff
    }
    const added = await this.service.newFileParts(untracked, room, operation)
    if (added === '') {
      return diff
    }
    return diff === '' || diff.endsWith('\n') ? `${diff}${added}` : `${diff}\n${added}`
  }

  /** A failed draft: the form's Generate button comes back. */
  private failDraft(kind: GitDraftKind): void {
    this.surface.post({ type: 'gitDraft', draft: { kind: 'failed', forKind: kind } })
  }

  /** A settled plain reply, posted as the form's draft. */
  private settlePlainDraft(kind: GitDraftKind, reply: string | undefined): void {
    if (kind === 'commitMessage') {
      const message = reply === undefined ? undefined : commitMessageFrom(reply)
      if (message === undefined) {
        this.failDraft(kind)
        return
      }
      this.surface.post({ type: 'gitDraft', draft: { kind: 'commitMessage', message } })
      return
    }
    const text = reply === undefined ? undefined : pullRequestTextFrom(reply)
    if (text === undefined) {
      this.failDraft(kind)
      return
    }
    this.surface.post({ type: 'gitDraft', draft: { kind: 'pullRequest', ...text } })
  }

  private async settleStructuredDraft(draft: PendingDraft, reply: string): Promise<void> {
    const output = draft.output
    if (output === undefined) {
      return
    }
    try {
      const settled = await structuredGitDraft(
        draft.kind,
        reply,
        output.port.formats(),
        output.port,
        output.signal,
        (text) => {
          if (this.isGenerationCurrent(draft.id)) {
            this.surface.notice('warning', text)
          }
        },
      )
      if (!this.isGenerationCurrent(draft.id)) {
        return
      }
      if (typeof settled === 'string' && draft.kind === 'commitMessage') {
        this.surface.post({ type: 'gitDraft', draft: { kind: 'commitMessage', message: settled } })
      } else if (typeof settled === 'object' && draft.kind === 'pullRequest') {
        this.surface.post({ type: 'gitDraft', draft: { kind: 'pullRequest', ...settled } })
      } else {
        this.generationFailed(draft.id)
        this.surface.notice('warning', UI_TEXT.gitDraftFailed)
      }
    } catch {
      if (this.isGenerationCurrent(draft.id)) {
        this.generationFailed(draft.id)
      }
    } finally {
      if (this.draft === draft) {
        this.draft = undefined
        this.turnsSeen.clear()
      }
    }
  }

  /** Once the generation's turn has ended: its last reply, read as a draft. */
  private settleDraft(): void {
    const draft = this.draft
    const seen = draft?.turnId === undefined ? undefined : this.turnsSeen.get(draft.turnId)
    if (draft === undefined || seen?.terminal === undefined) {
      return
    }
    if (draft.formEpoch !== this.formEpoch) {
      draft.output?.abort.abort()
      this.draft = undefined
      this.turnsSeen.clear()
      return
    }
    // A capped turn's summary is never a draft: only a turn that completed
    // without a limit answers what was asked.
    const reply = replyIfUsable({ terminal: seen.terminal, errorKind: seen.errorKind }, seen.text)
    if (reply !== undefined && draft.output !== undefined) {
      if (draft.settling === true) {
        return
      }
      draft.settling = true
      void this.settleStructuredDraft(draft, reply)
      return
    }
    this.draft = undefined
    this.turnsSeen.clear()
    this.settlePlainDraft(draft.kind, reply)
  }

  /** Reads the session's linked pull request for the strip. */
  private async refreshLink(sessionId: string, epoch: number): Promise<void> {
    try {
      // The store's key is the root the service bound to.
      const root = await this.service.boundRoot()
      const link = await this.deps.links.get(root, sessionId)
      if (this.statusEpoch !== epoch || this.isDisposed) {
        return
      }
      this.view =
        link === undefined
          ? undefined
          : {
              repository: link.repository,
              number: link.number,
              title: link.title,
              url: link.url,
            }
      this.postState()
    } catch {
      this.deps.log.warn('The pull request link could not be read')
    }
  }

  public async handleAction(action: GitAction): Promise<void> {
    const handlers: Record<GitAction, () => Promise<void> | void> = {
      openCommit: () => this.exclusively((running) => this.openCommitForm(running)),
      push: () => this.exclusively((running) => this.pushAction(running)),
      openPullRequest: () => {
        this.githubUnavailable()
      },
      refreshPullRequest: () => {
        this.githubUnavailable()
      },
      signInGitHub: () => {
        this.githubUnavailable()
      },
      trustWorktree: () => {
        this.surface.notice('warning', UI_TEXT.gitHeld)
      },
      cancel: () => {
        // Pending git stops: the running operation's signal aborts.
        this.stopOperation()
        this.resetForm()
        this.generationFailed()
      },
    }
    await handlers[action]()
  }

  public async commit(message: string, isUnstagedIncluded: boolean): Promise<void> {
    const operation = (running: NativeGitOperation): Promise<void> =>
      this.commitNow(message, isUnstagedIncluded, running)
    await this.exclusively(operation, 'commit')
  }

  public async createPullRequest(): Promise<void> {
    const operation = (): Promise<void> => {
      this.githubUnavailable('pullRequest')
      return Promise.resolve()
    }
    await this.exclusively(operation, 'pullRequest')
  }

  /**
   * What the model needs beside the user's own message asking for `kind`.
   * Throws with the reason in words when it cannot be built.
   */
  public async promptFor(kind: GitDraftKind): Promise<string> {
    const reason = this.unavailableReason()
    if (reason !== undefined) {
      throw new Error(reason)
    }
    const check = this.activityCheck()
    check()
    if (kind === 'pullRequest') {
      // The pull request form (lane P) names the branches first.
      throw new Error(UI_TEXT.gitOpenPullRequestFirst)
    }
    // The form's stop: Cancel or a session change ends the reads.
    const operation: NativeGitOperation = { signal: this.formAbort.signal, check }
    const failed = (error: unknown): Error => {
      this.deps.log.warn('A draft diff could not be read')
      return new Error(refusalNotice(refusalOf(error)) ?? nativeFailureText(error), {
        cause: error,
      })
    }
    let snapshot: NativeStatusSnapshot
    try {
      ;({ snapshot } = await this.service.status(operation))
    } catch (error: unknown) {
      throw failed(error)
    }
    const isStaged = snapshot.staged.length > 0
    const changes = isStaged ? snapshot.staged : [...snapshot.unstaged, ...snapshot.untracked]
    if (changes.length === 0) {
      throw new Error(UI_TEXT.gitNothingToCommit)
    }
    let diff: string
    try {
      const read = await this.service.diff(isStaged, GIT_PROMPT_DIFF_MAX_CHARS, operation)
      diff = read.bytes.toString('utf8')
      if (!isStaged) {
        // `git diff` leaves new files out; their bytes come from the files
        // themselves, confined to the bound root.
        diff = await this.withNewFiles(
          diff,
          snapshot.untracked,
          GIT_PROMPT_DIFF_MAX_CHARS - diff.length,
          operation,
        )
      }
    } catch (error: unknown) {
      throw failed(error)
    }
    check()
    return commitMessagePrompt({
      branch: snapshot.branch,
      scope: isStaged ? 'staged' : 'all',
      files: changes,
      diff,
    })
  }

  /** The user's generation message is about to go: its reply is the draft. */
  public generationStarting(kind: GitDraftKind): number {
    this.draft?.output?.abort.abort()
    this.draftEpoch += 1
    const port = this.surface.draftOutput?.()
    const abort = new AbortController()
    const signal = AbortSignal.any([abort.signal, this.formAbort.signal])
    if (port !== undefined) {
      port.prepare(kind, gitDraftContract(kind, port.formats()), signal)
    }
    this.draft = {
      id: this.draftEpoch,
      formEpoch: this.formEpoch,
      kind,
      turnId: undefined,
      ...(port !== undefined && {
        output: { port, abort, signal },
      }),
    }
    this.turnsSeen.clear()
    return this.draftEpoch
  }

  public isGenerationCurrent(id: number): boolean {
    return this.draft?.id === id && this.draft.formEpoch === this.formEpoch && this.canPost()
  }

  /** The message was accepted as `turnId`. */
  public generationSubmitted(turnId: string, id?: number): void {
    if (this.draft === undefined || (id !== undefined && !this.isGenerationCurrent(id))) {
      return
    }
    this.draft.turnId = turnId
    this.settleDraft()
  }

  /** The message did not go: the form's Generate button comes back. */
  public generationFailed(id?: number): void {
    if (id !== undefined && !this.isGenerationCurrent(id)) {
      return
    }
    const kind = this.draft?.kind
    this.draft?.output?.abort.abort()
    this.draft = undefined
    this.turnsSeen.clear()
    if (kind !== undefined) {
      this.failDraft(kind)
    }
  }

  /** The conversation's events, while a generation waits for its reply. */
  public onEvent(event: AgentEvent): void {
    const draft = this.draft
    if (draft === undefined) {
      return
    }
    // Before the acceptance names the turn, every turn is kept (at most the
    // few that end while it is in flight); after, only that one.
    if (event.type === 'turnCompleted') {
      if (draft.turnId !== undefined && draft.turnId !== event.turnId) {
        return
      }
      const seen = this.seen(event.turnId)
      seen.terminal = event.terminal
      seen.errorKind = event.errorKind
      this.settleDraft()
      return
    }
    if (event.type !== 'itemCompleted' || event.item.kind !== AGENT_MESSAGE_KIND) {
      return
    }
    const turnId = event.item.turnId
    if (turnId === undefined || (draft.turnId !== undefined && draft.turnId !== turnId)) {
      return
    }
    this.seen(turnId).text = event.item.text
  }

  /**
   * The hold card and the pull request strip, sent when they change;
   * `isSurfaceReady` for a surface that starts with none of them. Lane G
   * shows the linked pull request; the hold and the worktree line arrive
   * with lane P.
   */
  public postState(isSurfaceReady = false): void {
    if (this.isDisposed) {
      return
    }
    const json = JSON.stringify(this.currentState())
    const posted = isSurfaceReady ? EMPTY_STATE_JSON : this.lastPostedJson
    this.lastPostedJson = json
    if (json !== posted) {
      this.surface.post({ type: 'gitState', state: this.currentState() })
    }
  }

  /** The conversation now holds `sessionId` (or none): its linked pull request shows. */
  public sessionChanged(sessionId: string | undefined): void {
    // Clear/switch invalidates the form; first attachment must preserve it.
    if (
      sessionId === undefined ||
      (this.observedSessionId !== undefined && this.observedSessionId !== sessionId)
    ) {
      // The old session's pending git stops with it.
      this.stopOperation()
      this.resetForm()
      this.generationFailed()
    }
    this.observedSessionId = sessionId
    if (sessionId === undefined) {
      this.view = undefined
      this.draft = undefined
      this.turnsSeen.clear()
    }
    this.statusEpoch += 1
    this.postState()
    if (sessionId === undefined) {
      return
    }
    void this.refreshLink(sessionId, this.statusEpoch)
  }

  public dispose(): void {
    this.isDisposed = true
    this.stopOperation()
    this.statusEpoch += 1
    this.resetForm()
    this.draft?.output?.abort.abort()
    this.draft = undefined
    this.turnsSeen.clear()
  }
}

/**
 * The runtime Git adapter behind lane 0's `RuntimeGitDeps`: status, the
 * commit form, commit, push and commit-message drafts in every editor.
 * `options.run` only for tests; production runs the user's own `git`
 * through the bounded runner.
 */
export function createRuntimeGit(
  surface: GitSurface,
  deps: RuntimeGitDeps,
  options: NativeGitServiceOptions = {},
): ConversationGitPort {
  return new RuntimeGit(surface, deps, options)
}
