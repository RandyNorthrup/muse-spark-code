// The runtime conversation Git adapter (M123 lane G, PLAN.md D104):
// `createRuntimeGit(surface, deps): ConversationGitPort` beside the VS
// Code adapter, for every editor outside VS Code (and a VS Code-family
// host without `vscode.git`). The Git half runs natively through
// `./service`; the pull request half answers explicitly until lane P
// lands it, and the sign-in card until lanes A and L land the sources.
//
// - `openCommit` posts the commit form; `commit` validates, rechecks the
//   form's stamp, and commits (hooks and signers run). The caller's form
//   press is the confirmation: lane U's panel shows the message and the
//   files first, as the VS Code confirm modal does there.
// - `push` plans with M71's push plan (same refusals, one shared table
//   test) and pushes in the user's own Git environment. A failed push
//   names the remote and opens the same command in the editor's terminal
//   (the runtime has no modal to offer it in).
// - The linked pull request shows from the runtime link store; its status
//   and checks, the pull request form, creation and trust arrive with
//   lane P. Until then those actions answer `gitHubSignInDeclined` (no
//   sign-in was given, so nothing was sent) or `gitHeld`, never an empty
//   success.
// - Draft prompts for a commit message read the native diff; generations
//   settle as the VS Code adapter's do.

import { constants as fsConstants } from 'node:fs'
import { open as openFile } from 'node:fs/promises'
import { canonicalPath } from '../../../host/canonicalPath'
import type {
  ConversationGitPort,
  GitSurface,
} from '../../../host/conversation/conversationController'
import { redactSecrets } from '../../../core/redact'
import {
  commitMessageFrom,
  commitMessagePrompt,
  gitDraftContract,
  newFileDiff,
  pullRequestTextFrom,
  structuredGitDraft,
  type GitDraftOutputPort,
} from '../../../core/git/gitText'
import type { PushPlan } from '../../../core/git/pushPlan'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'
import type { NativeStatusSnapshot } from '../../../core/git/status'
import { fill } from '../../../shared/l10n/text'
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
  NativeGitService,
  nativePushTerminalCommand,
  refusalOf,
  statusStamp,
  type NativeGitServiceOptions,
} from './service'

const AGENT_MESSAGE_KIND = 'agentMessage'
const COMPLETED_TERMINAL = 'completed'
const EMPTY_STATE_JSON = '{}'

/** Git's words for the panel: redacted, capped, never a credential. */
function nativeFailureText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return redactSecrets(text.slice(-STDERR_SHOWN_CHARS))
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
      return UI_TEXT.gitPushDeclined
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
  private draft: PendingDraft | undefined
  private draftEpoch = 0
  private readonly turnsSeen = new Map<
    string,
    { text: string | undefined; terminal: string | undefined }
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
    return this.deps.isTrusted() ? undefined : UI_TEXT.gitOperationChanged
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

  /** A consent belongs to this conversation and trust state, never to a later one. */
  private activityCheck(): () => void {
    const watched = { epoch: this.operationEpoch, session: this.surface.sessionId() }
    return () => {
      if (this.isDisposed) {
        throw new Error(UI_TEXT.gitOperationChanged)
      }
      if (watched.epoch !== this.operationEpoch || watched.session !== this.surface.sessionId()) {
        throw new Error(UI_TEXT.gitOperationChanged)
      }
      const reason = this.unavailableReason()
      if (reason !== undefined) {
        throw new Error(reason)
      }
    }
  }

  private checkCurrent(): void {
    this.checkOperation?.()
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

  private async openCommitForm(): Promise<void> {
    this.resetForm()
    if (!this.usable()) {
      return
    }
    let snapshot: NativeStatusSnapshot
    try {
      ;({ snapshot } = await this.service.status())
      this.checkCurrent()
    } catch (error: unknown) {
      if (this.canPost()) {
        this.surface.say('warning', nativeFailureText(error))
      }
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
    this.commitStamp = statusStamp(snapshot)
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

  private async pushAction(): Promise<void> {
    if (!this.usable()) {
      return
    }
    let plan: PushPlan
    try {
      plan = await this.service.planPush()
      this.checkCurrent()
    } catch (error: unknown) {
      this.noticeFailure(error)
      return
    }
    if (!plan.ok) {
      this.surface.notice(plan.refusal === 'upToDate' ? 'info' : 'warning', pushRefusalText(plan))
      return
    }
    try {
      await this.service.push(plan)
      this.checkCurrent()
    } catch (error: unknown) {
      if (refusalOf(error) === 'closed' || this.deps.signal.aborted) {
        return
      }
      if (refusalOf(error) === 'refused') {
        this.surface.notice('warning', UI_TEXT.gitPushUnsafeName)
        return
      }
      // The push failed with the remote named; the same command opens in
      // the editor's terminal for the user to finish (D104).
      this.deps.log.warn('Push failed')
      if (this.canPost()) {
        this.surface.say('error', `${UI_TEXT.gitPushFailed}: ${nativeFailureText(error)}`)
      }
      await this.deps.openInTerminal(nativePushTerminalCommand(plan), this.deps.repositoryRoot)
      this.checkCurrent()
      return
    }
    this.surface.notice(
      'info',
      fill(UI_TEXT.gitPushed, { branch: plan.branch, remote: plan.remote }),
    )
  }

  /** A refusal in the panel's words; anything else is git's (redacted). */
  private noticeFailure(error: unknown): void {
    if (!this.canPost()) {
      return
    }
    const refusal = refusalOf(error)
    if (refusal === 'closed' || this.deps.signal.aborted) {
      return
    }
    if (refusal === 'untrusted' || refusal === 'changed') {
      this.surface.notice('warning', UI_TEXT.gitOperationChanged)
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

  private async commitNow(message: string, isUnstagedIncluded: boolean): Promise<void> {
    if (!this.usable()) {
      this.answerCommit(false)
      return
    }
    try {
      const committed = await this.service.commit(message, isUnstagedIncluded, this.commitStamp)
      this.checkCurrent()
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
      if (refusalOf(error) === 'closed' || this.deps.signal.aborted) {
        this.answerCommit(false)
        return
      }
      if (refusalOf(error) !== undefined) {
        this.noticeFailure(error)
        this.answerCommit(false)
        return
      }
      this.checkCurrent()
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
    operation: () => Promise<void>,
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
      await operation()
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

  /**
   * One new file's start for the prompt, as a diff would show it, or
   * undefined for a link, a folder, or anything unreadable: those stay a
   * file-list entry. Never follows a link (O_NOFOLLOW).
   */
  private async untrackedFilePart(
    fsPath: string,
    label: string,
    maxBytes: number,
    check: () => void,
  ): Promise<{ readonly part: string; readonly used: number } | undefined> {
    let fd: Awaited<ReturnType<typeof openFile>>
    try {
      fd = await openFile(fsPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    } catch {
      return undefined
    }
    try {
      const stat = await fd.stat()
      check()
      const capacity = Math.min(maxBytes, stat.size)
      const bytes = Buffer.alloc(capacity)
      let filled = 0
      while (filled < capacity) {
        const chunk = await fd.read(bytes, filled, capacity - filled, filled)
        if (chunk.bytesRead === 0) {
          break
        }
        filled += chunk.bytesRead
      }
      check()
      return { part: newFileDiff(label, bytes.subarray(0, filled), stat.size), used: filled }
    } catch {
      return undefined
    } finally {
      await fd.close()
    }
  }

  private async appendFilePart(
    parts: string[],
    file: { readonly fsPath: string; readonly label: string },
    room: number,
    check: () => void,
  ): Promise<number> {
    check()
    const read = await this.untrackedFilePart(file.fsPath, file.label, room, check)
    check()
    if (read === undefined) {
      return room
    }
    parts.push(read.part)
    return room - read.used
  }

  /** New files' bytes for the prompt, as a diff would show them, within budget. */
  private async untrackedContents(
    files: readonly { readonly fsPath: string; readonly label: string }[],
    maxBytes: number,
    check: () => void,
  ): Promise<string> {
    const snippets: string[] = []
    let remaining = maxBytes
    for (const file of files) {
      if (remaining <= 0) {
        return snippets.join('\n')
      }
      remaining = await this.appendFilePart(snippets, file, remaining, check)
    }
    return snippets.join('\n')
  }

  private seen(turnId: string): { text: string | undefined; terminal: string | undefined } {
    const known = this.turnsSeen.get(turnId)
    if (known !== undefined) {
      return known
    }
    const fresh: { text: string | undefined; terminal: string | undefined } = {
      text: undefined,
      terminal: undefined,
    }
    this.turnsSeen.set(turnId, fresh)
    return fresh
  }

  /** The new files' bytes appended to the diff, within the prompt's budget. */
  private async withNewFiles(
    diff: string,
    untracked: readonly string[],
    cwd: string,
    room: number,
    check: () => void,
  ): Promise<string> {
    if (room <= 0 || untracked.length === 0) {
      return diff
    }
    const added = await this.untrackedContents(
      untracked.map((file) => ({ fsPath: `${cwd}/${file}`, label: file })),
      room,
      check,
    )
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
    const reply = seen.terminal === COMPLETED_TERMINAL ? seen.text : undefined
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
      const root = await canonicalPath(this.deps.repositoryRoot)
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
      openCommit: () => this.exclusively(() => this.openCommitForm()),
      push: () => this.exclusively(() => this.pushAction()),
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
        this.operationEpoch += 1
        this.resetForm()
        this.generationFailed()
      },
    }
    await handlers[action]()
  }

  public async commit(message: string, isUnstagedIncluded: boolean): Promise<void> {
    const operation = (): Promise<void> => this.commitNow(message, isUnstagedIncluded)
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
    const check = this.activityCheck()
    check()
    const reason = this.unavailableReason()
    if (reason !== undefined) {
      throw new Error(reason)
    }
    if (kind === 'pullRequest') {
      // The pull request form (lane P) names the branches first.
      throw new Error(UI_TEXT.gitOpenPullRequestFirst)
    }
    let snapshot: NativeStatusSnapshot
    try {
      ;({ snapshot } = await this.service.status())
      check()
    } catch (error: unknown) {
      this.deps.log.warn('A draft diff could not be read')
      throw new Error(nativeFailureText(error), { cause: error })
    }
    const isStaged = snapshot.staged.length > 0
    const changes = isStaged ? snapshot.staged : [...snapshot.unstaged, ...snapshot.untracked]
    if (changes.length === 0) {
      throw new Error(UI_TEXT.gitNothingToCommit)
    }
    let diff: string
    try {
      const staged = await this.service.diff(isStaged, GIT_PROMPT_DIFF_MAX_CHARS)
      check()
      diff = staged.bytes.toString('utf8')
      if (!isStaged) {
        // `git diff` leaves new files out; their bytes come from the files
        // themselves, so a crafted link is never followed (O_NOFOLLOW).
        const cwd = await this.service.resolveRoot()
        check()
        diff = await this.withNewFiles(
          diff,
          snapshot.untracked,
          cwd,
          GIT_PROMPT_DIFF_MAX_CHARS - diff.length,
          check,
        )
        check()
      }
    } catch (error: unknown) {
      this.deps.log.warn('A draft diff could not be read')
      throw new Error(nativeFailureText(error), { cause: error })
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
      this.seen(event.turnId).terminal = event.terminal
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
      this.operationEpoch += 1
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
    this.operationEpoch += 1
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
