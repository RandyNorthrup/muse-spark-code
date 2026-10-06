// Git and pull requests above the composer (M71, PLAN.md D49): the card of
// a window held on someone else's pull request, the worktree the window is
// on, the pull request this conversation opened with its status and checks,
// and the commit and pull request forms. The forms are the confirmation:
// they show everything that goes out, all of it editable, and nothing is
// committed or sent until their button is pressed. A draft is written by
// the model only when the user presses "Write with Muse", as their own
// message in the conversation.

import type { SubmitEvent } from 'react'
import {
  PULL_REQUEST_BODY_MAX_CHARS,
  PULL_REQUEST_TITLE_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import type { GitAction, GitDraftKind, PullRequestView } from '../../shared/git'
import { fill, formatDateTime, plural } from '../../shared/l10n/text'
import type { GitFormEdit, GitFormState, GitUiState } from '../state/gitState'

export interface GitPanelProps {
  readonly git: GitUiState
  /** Behind a modal (M25). */
  readonly isInert: boolean
  /** Signed in with no turn running: a draft can be asked for. */
  readonly canGenerate: boolean
  readonly onAction: (action: GitAction) => void
  readonly onEdit: (edit: GitFormEdit) => void
  readonly onClose: () => void
  readonly onCommit: () => void
  readonly onCreatePullRequest: () => void
  readonly onGenerate: (kind: GitDraftKind) => void
  readonly onOpenLink: (url: string) => void
}

type PanelActions = Pick<
  GitPanelProps,
  | 'onAction'
  | 'onEdit'
  | 'onClose'
  | 'onCommit'
  | 'onCreatePullRequest'
  | 'onGenerate'
  | 'onOpenLink'
  | 'canGenerate'
>

/** The pull request's state in words: GitHub's own word when it is one the capture did not show. */
function stateLabel(view: PullRequestView): string | undefined {
  if (view.state === undefined) {
    return undefined
  }
  if (view.isMerged === true) {
    return UI_TEXT.gitStateMerged
  }
  if (view.state === 'closed') {
    return UI_TEXT.gitStateClosed
  }
  if (view.state === 'open') {
    return view.isDraft === true ? UI_TEXT.gitStateDraft : UI_TEXT.gitStateOpen
  }
  return view.state
}

function checksLabel(view: PullRequestView): string | undefined {
  const { checks } = view
  if (checks === undefined) {
    return undefined
  }
  const parts = [
    ...(checks.failed > 0 ? [plural(UI_TEXT.gitChecksFailed, checks.failed)] : []),
    ...(checks.running > 0 ? [plural(UI_TEXT.gitChecksRunning, checks.running)] : []),
    ...(checks.passed > 0 ? [plural(UI_TEXT.gitChecksPassed, checks.passed)] : []),
    ...(checks.skipped > 0 ? [plural(UI_TEXT.gitChecksSkipped, checks.skipped)] : []),
    ...(checks.cancelled > 0 ? [plural(UI_TEXT.gitChecksCancelled, checks.cancelled)] : []),
    ...checks.other,
    ...(checks.notRead > 0 ? [plural(UI_TEXT.gitChecksNotRead, checks.notRead)] : []),
  ]
  return parts.length === 0 ? UI_TEXT.gitChecksNone : parts.join(' · ')
}

/**
 * The status dot, as a tool row's: failed, running, or done; always beside
 * words. A check in a state not counted, or one not read, is not known to
 * have passed: the dot stays neutral.
 */
function dotClass(view: PullRequestView): string {
  const { checks } = view
  if (checks === undefined) {
    return 'tool-dot'
  }
  if (checks.failed > 0) {
    return 'tool-dot tool-dot-failed'
  }
  if (checks.running > 0) {
    return 'tool-dot tool-dot-running'
  }
  return checks.other.length > 0 || checks.notRead > 0 ? 'tool-dot' : 'tool-dot tool-dot-ok'
}

function HoldCard({
  git,
  onAction,
  onOpenLink,
}: Pick<GitPanelProps, 'git' | 'onAction' | 'onOpenLink'>) {
  const { hold } = git.state
  if (hold === undefined) {
    return null
  }
  const pullRequest = hold.pullRequest
  return (
    <section className="git-hold" aria-label={UI_TEXT.worktreeHoldLabel}>
      <div className="git-row">
        <strong>
          {pullRequest === undefined
            ? UI_TEXT.worktreeHoldTitle
            : fill(UI_TEXT.worktreeHoldPullRequest, {
                number: pullRequest.number,
                author: pullRequest.author,
              })}
        </strong>
      </div>
      {pullRequest === undefined ? null : (
        <div className="git-muted" dir="auto">
          {pullRequest.title}
        </div>
      )}
      <p className="git-text">{UI_TEXT.worktreeHoldDetail}</p>
      {hold.isRestricted ? <p className="git-text">{UI_TEXT.worktreeHoldRestricted}</p> : null}
      <p className="git-text git-muted">{UI_TEXT.worktreeHoldOtherExtensions}</p>
      <div className="git-actions">
        <button
          type="button"
          className="tool-more"
          onClick={() => {
            onAction('trustWorktree')
          }}
        >
          {UI_TEXT.worktreeTrustButton}
        </button>
        {pullRequest === undefined ? null : (
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onOpenLink(pullRequest.url)
            }}
          >
            {UI_TEXT.gitOpenOnGitHub}
          </button>
        )}
      </div>
    </section>
  )
}

function PullRequestStrip({
  view,
  onAction,
  onOpenLink,
}: {
  readonly view: PullRequestView
  readonly onAction: (action: GitAction) => void
  readonly onOpenLink: (url: string) => void
}) {
  const state = stateLabel(view)
  const checks = checksLabel(view)
  const failed = view.checks?.failedNames ?? []
  return (
    <section className="git-pr" aria-label={UI_TEXT.gitPullRequestLabel}>
      <div className="git-row">
        <span className={dotClass(view)} aria-hidden="true" />
        <button
          type="button"
          className="tool-more git-pr-title"
          title={UI_TEXT.gitOpenOnGitHub}
          onClick={() => {
            onOpenLink(view.url)
          }}
        >
          <span dir="auto">
            {fill(UI_TEXT.gitPullRequestName, { number: view.number, title: view.title })}
          </span>
        </button>
        {state === undefined ? null : <span className="git-pr-state">{state}</span>}
      </div>
      <div className="git-row git-muted">
        {checks === undefined ? null : (
          <span title={failed.length === 0 ? undefined : failed.join('\n')}>
            {fill(UI_TEXT.gitChecksLine, { checks })}
          </span>
        )}
        {view.problem === undefined ? null : <span>{view.problem}</span>}
        {view.needsSignIn === true && view.problem === undefined ? (
          <span>{UI_TEXT.gitStatusNeedsSignIn}</span>
        ) : null}
        {view.checkedAt === undefined ? null : (
          <span>{fill(UI_TEXT.gitCheckedAt, { time: formatDateTime(view.checkedAt) })}</span>
        )}
        <span className="git-actions git-actions-end">
          {view.needsSignIn === true ? (
            <button
              type="button"
              className="tool-more"
              onClick={() => {
                onAction('signInGitHub')
              }}
            >
              {UI_TEXT.gitSignInGitHub}
            </button>
          ) : (
            <button
              type="button"
              className="tool-more"
              onClick={() => {
                onAction('refreshPullRequest')
              }}
            >
              {UI_TEXT.gitRefresh}
            </button>
          )}
        </span>
      </div>
    </section>
  )
}

function GenerateButton({
  kind,
  form,
  canGenerate,
  onGenerate,
}: {
  readonly kind: GitDraftKind
  readonly form: GitFormState
  readonly canGenerate: boolean
  readonly onGenerate: (kind: GitDraftKind) => void
}) {
  const isWriting = form.generation !== undefined
  return (
    <button
      type="button"
      className="tool-more"
      title={UI_TEXT.gitGenerateTitle}
      disabled={!canGenerate || isWriting || form.isBusy}
      onClick={() => {
        onGenerate(kind)
      }}
    >
      {isWriting ? UI_TEXT.gitGenerating : UI_TEXT.gitGenerate}
    </button>
  )
}

function CommitForm({
  form,
  canGenerate,
  onEdit,
  onClose,
  onCommit,
  onGenerate,
}: Omit<PanelActions, 'onAction' | 'onCreatePullRequest' | 'onOpenLink'> & {
  readonly form: Extract<GitFormState, { kind: 'commit' }>
}) {
  const { facts } = form
  const hasSomething = facts.staged > 0 || (form.includeUnstaged && facts.unstaged > 0)
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (hasSomething && !form.isBusy && form.message.trim() !== '') {
      onCommit()
    }
  }
  return (
    <form className="git-form" aria-label={UI_TEXT.gitCommitFormLabel} onSubmit={submit}>
      <div className="git-row">
        <strong>{UI_TEXT.gitCommitTitle}</strong>
        {facts.branch === undefined ? null : (
          <span className="git-muted">{fill(UI_TEXT.gitOnBranch, { branch: facts.branch })}</span>
        )}
      </div>
      <details className="git-files">
        <summary>
          {fill(UI_TEXT.gitChangeCounts, {
            staged: plural(UI_TEXT.gitStagedCount, facts.staged),
            unstaged: plural(UI_TEXT.gitUnstagedCount, facts.unstaged),
          })}
        </summary>
        <ul className="git-file-list">
          {facts.files.map((file) => (
            <li key={`${file.isStaged ? 's' : 'u'}:${file.path}`}>
              <code dir="auto">{file.path}</code>
              <span className="git-muted">
                {file.isStaged ? UI_TEXT.gitFileStaged : UI_TEXT.gitFileUnstaged}
              </span>
            </li>
          ))}
        </ul>
        {facts.moreFiles > 0 ? (
          <div className="git-muted">{plural(UI_TEXT.gitMoreFiles, facts.moreFiles)}</div>
        ) : null}
      </details>
      <label className="git-field">
        <span>{UI_TEXT.gitMessageLabel}</span>
        <textarea
          className="question-input git-textarea"
          dir="auto"
          rows={4}
          disabled={form.isBusy}
          // Muse's draft replaces the message: nothing typed meanwhile is lost.
          readOnly={form.generation !== undefined}
          value={form.message}
          onChange={(event) => {
            onEdit({ field: 'message', value: event.target.value })
          }}
        />
      </label>
      <label className="git-check">
        <input
          type="checkbox"
          checked={form.includeUnstaged}
          disabled={form.isBusy || facts.unstaged === 0}
          onChange={(event) => {
            onEdit({ field: 'includeUnstaged', value: event.target.checked })
          }}
        />
        <span>{UI_TEXT.gitIncludeUnstaged}</span>
      </label>
      <p className="git-text git-muted">{UI_TEXT.gitCommandConsequences}</p>
      <div className="git-actions">
        <GenerateButton
          kind="commitMessage"
          form={form}
          canGenerate={canGenerate}
          onGenerate={onGenerate}
        />
        <button
          type="submit"
          className="tool-more"
          disabled={form.isBusy || form.message.trim() === '' || !hasSomething}
        >
          {form.isBusy ? UI_TEXT.gitCommitting : UI_TEXT.gitCommitAction}
        </button>
        <button type="button" className="tool-more" onClick={onClose}>
          {UI_TEXT.gitCancel}
        </button>
      </div>
    </form>
  )
}

function pushNote(form: Extract<GitFormState, { kind: 'pullRequest' }>): string | undefined {
  const { facts } = form
  if (facts.push === 'needed') {
    return facts.commits === undefined
      ? fill(UI_TEXT.gitPrPushFirst, { remote: facts.remote })
      : plural(UI_TEXT.gitPrPushCommits, facts.commits, { remote: facts.remote })
  }
  return facts.push === 'behind' ? UI_TEXT.gitPrBehind : undefined
}

function PullRequestForm({
  form,
  canGenerate,
  onEdit,
  onClose,
  onCreatePullRequest,
  onGenerate,
}: Omit<PanelActions, 'onAction' | 'onCommit' | 'onOpenLink'> & {
  readonly form: Extract<GitFormState, { kind: 'pullRequest' }>
}) {
  const { facts } = form
  const note = pushNote(form)
  const canCreate = !form.isBusy && form.title.trim() !== '' && form.base.trim() !== ''
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (canCreate) {
      onCreatePullRequest()
    }
  }
  const head =
    facts.headRepository === undefined ? facts.head : `${facts.headRepository}:${facts.head}`
  return (
    <form className="git-form" aria-label={UI_TEXT.gitPullRequestFormLabel} onSubmit={submit}>
      <div className="git-row">
        <strong>{fill(UI_TEXT.gitPrTitle, { repository: facts.repository })}</strong>
      </div>
      <dl className="git-facts">
        <dt>{UI_TEXT.gitPrRemote}</dt>
        <dd>
          <code dir="auto">{`${facts.remote} ${facts.remoteUrl}`}</code>
        </dd>
        <dt>{UI_TEXT.gitPrHead}</dt>
        <dd>
          <code dir="auto">{head}</code>
        </dd>
      </dl>
      {note === undefined ? null : <p className="git-text git-muted">{note}</p>}
      <label className="git-field">
        <span>{UI_TEXT.gitPrBase}</span>
        <input
          className="question-input"
          type="text"
          dir="auto"
          value={form.base}
          disabled={form.isBusy}
          onChange={(event) => {
            onEdit({ field: 'base', value: event.target.value })
          }}
        />
      </label>
      <label className="git-field">
        <span>{UI_TEXT.gitPrTitleLabel}</span>
        <input
          className="question-input"
          type="text"
          dir="auto"
          maxLength={PULL_REQUEST_TITLE_MAX_CHARS}
          value={form.title}
          disabled={form.isBusy}
          readOnly={form.generation !== undefined}
          onChange={(event) => {
            onEdit({ field: 'title', value: event.target.value })
          }}
        />
      </label>
      <label className="git-field">
        <span>{UI_TEXT.gitPrBodyLabel}</span>
        <textarea
          className="question-input git-textarea"
          dir="auto"
          rows={6}
          maxLength={PULL_REQUEST_BODY_MAX_CHARS}
          value={form.body}
          disabled={form.isBusy}
          readOnly={form.generation !== undefined}
          onChange={(event) => {
            onEdit({ field: 'body', value: event.target.value })
          }}
        />
      </label>
      <label className="git-check">
        <input
          type="checkbox"
          checked={form.isDraft}
          disabled={form.isBusy}
          onChange={(event) => {
            onEdit({ field: 'isDraft', value: event.target.checked })
          }}
        />
        <span>{UI_TEXT.gitPrDraft}</span>
      </label>
      <p className="git-text git-muted">{UI_TEXT.gitPrMasked}</p>
      <div className="git-actions">
        <GenerateButton
          kind="pullRequest"
          form={form}
          canGenerate={canGenerate}
          onGenerate={onGenerate}
        />
        <button type="submit" className="tool-more" disabled={!canCreate}>
          {form.isDraft ? UI_TEXT.gitPrCreateDraft : UI_TEXT.gitPrCreate}
        </button>
        <button type="button" className="tool-more" onClick={onClose}>
          {UI_TEXT.gitCancel}
        </button>
      </div>
    </form>
  )
}

export function GitPanel(props: GitPanelProps) {
  const { git, isInert } = props
  const { worktree, pullRequest } = git.state
  const { form } = git
  if (
    form === undefined &&
    worktree === undefined &&
    pullRequest === undefined &&
    git.state.hold === undefined
  ) {
    return null
  }
  return (
    <div className="git-panel" inert={isInert}>
      <HoldCard git={git} onAction={props.onAction} onOpenLink={props.onOpenLink} />
      {worktree === undefined ? null : (
        <div className="git-worktree git-muted">
          {worktree.pullRequestNumber === undefined
            ? fill(UI_TEXT.gitWorktreeBranch, {
                branch: worktree.branch ?? '',
                repository: worktree.repositoryRoot,
              })
            : fill(UI_TEXT.gitWorktreePullRequest, {
                number: worktree.pullRequestNumber,
                repository: worktree.repositoryRoot,
              })}
        </div>
      )}
      {pullRequest === undefined ? null : (
        <PullRequestStrip
          view={pullRequest}
          onAction={props.onAction}
          onOpenLink={props.onOpenLink}
        />
      )}
      {form?.kind === 'commit' ? <CommitForm {...props} form={form} /> : null}
      {form?.kind === 'pullRequest' ? <PullRequestForm {...props} form={form} /> : null}
    </div>
  )
}
