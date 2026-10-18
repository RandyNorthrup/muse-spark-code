// Pull requests in the runtime, in every editor (M123, PLAN.md D104):
// draft and open a pull request after the user confirms, read its status
// and checks, all through M71's REST client (src/core/git/github.ts,
// api.github.com, API version 2022-11-28, schema-checked against captures)
// with a credential from lane 0's token-source port. Forks open on the
// parent. Nothing posts without an explicit confirm. The bearer travels
// only in the `Authorization` header and is never logged, returned or
// shown: every outward string passes the redactor.
//
// The panel (lane U) posts these results; this service only computes them.
// Git reads and pushes arrive with lane G; until then the branch facts the
// service needs (the remote's repository, the head branch, the base) are
// passed in, and checkout's git runs through the injected port in
// checkout.ts.

import { UI_TEXT } from '../../../shared/constants'
import type { PullRequestView } from '../../../shared/git'
import { fill } from '../../../shared/l10n/text'
import {
  didDropRejectedCredential,
  GitHubClient,
  GitHubError,
  repositoryFromFullName,
  type PullRequest,
} from '../../../core/git/github'
import {
  type GitHubRepository,
  githubRepositoryOf,
  maskRemoteUrl,
  repositoryLabel,
} from '../../../core/git/githubRemote'
import { hasCredentialShapes } from '../../../core/git/gitText'
import { pullRequestFormProblem } from '../../../core/git/pullRequestRef'
import { isPlainRefName } from '../../../core/git/pushPlan'
import { redactSecrets } from '../../../core/redact'
import type { GitHubCredential } from '../../../core/git/tokenSource'
import type { RuntimeGitDeps } from '../../../core/git/runtimeGit'

/** A refusal in words for the user; the log gets the kind, never a secret. */
export class PullRequestServiceError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'PullRequestServiceError'
  }
}

export interface RuntimePullRequestDeps extends RuntimeGitDeps {
  readonly platform: NodeJS.Platform
  readonly now: () => number
  /** The REST client's base URL; api.github.com unless a test points it elsewhere. */
  readonly baseUrl?: string
}

/** Where a pull request opens: the remote's repository, or its parent for a fork. */
export interface PullRequestDestination {
  /** The remote's repository, before parent resolution. */
  readonly targetRepository: GitHubRepository
  readonly repository: GitHubRepository
  readonly defaultBase: string
  /** The branch as GitHub's API takes it: `branch`, or `owner:branch` from a fork. */
  readonly apiHead: string
  /** The fork the branch is in, when it is not `repository`. */
  readonly headRepository: string | undefined
  readonly remote: string
  /** The remote's URL, credentials masked. */
  readonly remoteUrl: string
  /** The branch as the remote names it. */
  readonly head: string
}

export interface PreparePullRequestInput {
  readonly repository: GitHubRepository
  readonly head: string
  readonly remote: string
  /** The remote's configured URL, as read from git. */
  readonly remoteUrl: string
  readonly base?: string
  readonly sessionId?: string
  /**
   * The running operation's own stop: Cancel, a session change and disposal
   * abort the discovery and skip the link, instead of persisting a link for
   * a stale session (Codex on PR #227).
   */
  readonly signal?: AbortSignal
}

/** A refusal; a 401 also asks the user to sign in again. */
interface PullRequestFailure {
  readonly ok: false
  readonly reason: string
  readonly needsSignIn?: true
}

export type PreparePullRequestResult =
  | PullRequestFailure
  | {
      readonly ok: true
      readonly destination: PullRequestDestination
      /** An open pull request for the branch is linked instead of a second one. */
      readonly existing?: PullRequest
    }

export interface CreatePullRequestInput {
  readonly destination: PullRequestDestination
  readonly title: string
  readonly body: string
  readonly base: string
  readonly isDraft: boolean
  readonly sessionId?: string
}

export type CreatePullRequestResult =
  | {
      readonly ok: true
      readonly number: number
      readonly url: string
      readonly title: string
    }
  | {
      readonly ok: false
      readonly reason: string
      readonly needsSignIn?: true
      /** What goes back to the form, credentials masked, when shapes stopped it. */
      readonly masked?: { readonly title: string; readonly body: string }
    }

export type PullRequestStatusResult =
  PullRequestFailure | { readonly ok: true; readonly view: PullRequestView }

function refused(reason: string): PullRequestServiceError {
  return new PullRequestServiceError(reason)
}

/** The runtime's pull requests: M123's native route (dist/nativeGit.js) runs them. */
export class RuntimePullRequests {
  public constructor(private readonly deps: RuntimePullRequestDeps) {}

  private checkTrust(): void {
    if (!this.deps.isTrusted()) {
      throw refused(UI_TEXT.gitRestricted)
    }
    this.deps.signal.throwIfAborted()
  }

  private clientFor(credential: GitHubCredential): GitHubClient {
    return new GitHubClient({
      fetch: credential.fetch,
      userAgent: this.deps.userAgent,
      log: this.deps.log,
      ...(this.deps.baseUrl !== undefined && { baseUrl: this.deps.baseUrl }),
    })
  }

  private async credential(
    mode: 'ask' | 'silent',
    signal: AbortSignal = this.deps.signal,
  ): Promise<GitHubCredential | undefined> {
    this.checkTrust()
    signal.throwIfAborted()
    const found = await this.deps.github.credential(mode, signal)
    this.checkTrust()
    signal.throwIfAborted()
    return found
  }

  /** GitHub's refusal in words, never carrying a secret. */
  private failureText(error: unknown): string {
    return redactSecrets(error instanceof GitHubError ? error.message : String(error))
  }

  /** GitHub's refusal; a 401 drops the stored credential, so the user signs in again. */
  private async failure(credential: GitHubCredential, error: unknown): Promise<PullRequestFailure> {
    const isSignIn = await didDropRejectedCredential(this.deps.github, credential, error)
    return { ok: false, reason: this.failureText(error), ...(isSignIn && { needsSignIn: true }) }
  }

  /**
   * Where the pull request opens: the remote's repository, or for a fork
   * the repository it came from, with the branch named `owner:branch`
   * there. Reuses the REST client's repository facts, never a guess.
   */
  private async destinationOf(
    client: GitHubClient,
    bearer: string,
    target: Pick<PullRequestDestination, 'targetRepository' | 'remote' | 'remoteUrl' | 'head'>,
    signal?: AbortSignal,
  ): Promise<Omit<PullRequestDestination, 'targetRepository' | 'remote' | 'remoteUrl' | 'head'>> {
    const facts = await client.repositoryFacts(bearer, target.targetRepository, signal)
    this.checkTrust()
    const { parent } = facts
    return parent === undefined
      ? {
          repository: target.targetRepository,
          defaultBase: facts.defaultBranch,
          apiHead: target.head,
          headRepository: undefined,
        }
      : {
          repository: parent.repository,
          defaultBase: parent.defaultBranch,
          apiHead: `${target.targetRepository.owner}:${target.head}`,
          headRepository: repositoryLabel(target.targetRepository),
        }
  }

  private async link(
    sessionId: string | undefined,
    repository: string,
    pullRequest: Pick<PullRequest, 'number' | 'url' | 'title'>,
  ): Promise<void> {
    if (sessionId === undefined) {
      return
    }
    // The POST completed: report its external write even if Cancel arrived.
    // Ownership loss stops linking, never changes success.
    try {
      this.checkTrust()
    } catch {
      return
    }
    try {
      await this.deps.links.set(this.deps.repositoryRoot, sessionId, {
        repository,
        number: pullRequest.number,
        url: pullRequest.url,
        title: pullRequest.title,
        linkedAt: this.deps.now(),
      })
    } catch (error: unknown) {
      // The pull request exists: a full or unavailable store must not turn
      // its creation into an apparent failure and a retried duplicate. The
      // number and URL go back with the success; only the log names the
      // missing link.
      this.deps.log.warn(
        `The pull request link could not be kept: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      )
    }
  }

  /**
   * The pull request form's facts: where it would open, and the open pull
   * request for the branch when one already exists (linked instead of a
   * second one). Reads only; posts nothing.
   */
  public async prepare(input: PreparePullRequestInput): Promise<PreparePullRequestResult> {
    // The window's lifetime joins the operation's own stop: either aborts
    // the discovery below, and a stop also skips the link (Codex on PR #227).
    const signal =
      input.signal === undefined
        ? this.deps.signal
        : AbortSignal.any([this.deps.signal, input.signal])
    try {
      this.checkTrust()
      signal.throwIfAborted()
    } catch (error: unknown) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    if (!isPlainRefName(input.head)) {
      return { ok: false, reason: UI_TEXT.gitPushUnsafeName }
    }
    const github = githubRepositoryOf(input.remoteUrl)
    if (github === undefined || !isPlainRefName(input.remote)) {
      return {
        ok: false,
        reason:
          github === undefined
            ? fill(UI_TEXT.gitHubOnly, { remote: input.remote })
            : UI_TEXT.gitPushUnsafeName,
      }
    }
    const credential = await this.credential('silent', signal)
    if (credential === undefined) {
      return { ok: false, reason: UI_TEXT.gitHubSignInDeclined, needsSignIn: true }
    }
    const client = this.clientFor(credential)
    try {
      const target = {
        targetRepository: input.repository,
        remote: input.remote,
        remoteUrl: maskRemoteUrl(input.remoteUrl),
        head: input.head,
      }
      const destination = {
        ...target,
        ...(await this.destinationOf(client, credential.bearer, target, signal)),
      }
      const existing = await client.openPullRequestFor(
        credential.bearer,
        destination.repository,
        input.repository.owner,
        input.head,
        signal,
      )
      this.checkTrust()
      // A stop that landed during the discovery leaves no link for the old
      // session: the adapter's epoch check would refuse it next, after the
      // write already landed.
      signal.throwIfAborted()
      if (existing !== undefined) {
        await this.link(input.sessionId, repositoryLabel(destination.repository), existing)
        return { ok: true, destination, existing }
      }
      return {
        ok: true,
        destination: {
          ...destination,
          defaultBase: input.base ?? destination.defaultBase,
        },
      }
    } catch (error: unknown) {
      return await this.failure(credential, error)
    }
  }

  /**
   * Open the pull request, as a draft or ready, after the user confirms
   * what goes out. The confirmation is the form here: it shows the title,
   * the description, the repository, the branches and the draft state.
   */
  public async create(input: CreatePullRequestInput): Promise<CreatePullRequestResult> {
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    const title = input.title.trim()
    const base = input.base.trim()
    const problem = pullRequestFormProblem(title, input.body, base)
    if (problem !== undefined) {
      return { ok: false, reason: problem }
    }
    if (hasCredentialShapes(title) || hasCredentialShapes(input.body)) {
      // What goes out is what the user saw: the masked text goes back, nothing is sent.
      return {
        ok: false,
        reason: UI_TEXT.gitCredentialMasked,
        masked: { title: redactSecrets(title), body: redactSecrets(input.body) },
      }
    }
    // GitHub first (the sign-in, where it opens), so a declined sign-in or
    // an unreachable GitHub leaves nothing pushed. Lane G pushes the branch
    // after this same confirmation; until then the branch must be up already.
    const credential = await this.credential('ask')
    if (credential === undefined) {
      return { ok: false, reason: UI_TEXT.gitHubSignInDeclined, needsSignIn: true }
    }
    const client = this.clientFor(credential)
    let destination: PullRequestDestination
    try {
      const resolved = await this.destinationOf(client, credential.bearer, input.destination)
      this.checkTrust()
      destination = { ...input.destination, ...resolved }
      if (
        repositoryLabel(destination.repository) !== repositoryLabel(input.destination.repository) ||
        destination.apiHead !== input.destination.apiHead ||
        destination.head !== input.destination.head
      ) {
        return { ok: false, reason: UI_TEXT.gitOperationChanged }
      }
    } catch (error: unknown) {
      return await this.failure(credential, error)
    }
    const detail = [
      title,
      input.body,
      fill(UI_TEXT.openPullRequestRepository, {
        repository: repositoryLabel(destination.repository),
      }),
      fill(UI_TEXT.openPullRequestBranches, { head: destination.apiHead, base }),
      input.isDraft ? UI_TEXT.gitStateDraft : UI_TEXT.gitPullRequestFormLabel,
    ].join('\n')
    const isConfirmed = await this.deps.confirm(
      UI_TEXT.gitPullRequestItem,
      redactSecrets(detail),
      UI_TEXT.openPullRequestAction,
    )
    this.checkTrust()
    if (!isConfirmed) {
      return { ok: false, reason: UI_TEXT.gitPushDeclined }
    }
    try {
      const created = await client.createPullRequest(credential.bearer, destination.repository, {
        title,
        body: input.body,
        head: destination.apiHead,
        base,
        isDraft: input.isDraft,
      })
      await this.link(input.sessionId, repositoryLabel(destination.repository), created)
      this.deps.log.info(
        `Opened pull request #${String(created.number)}${input.isDraft ? ' as a draft' : ''}`,
      )
      return { ok: true, number: created.number, url: created.url, title: created.title }
    } catch (error: unknown) {
      return await this.failure(credential, error)
    }
  }

  /**
   * The linked pull request's state and checks from GitHub; `ask` may show
   * the source's own sign-in. Reads only.
   */
  public async status(
    link: {
      readonly repository: string
      readonly number: number
      readonly title: string
      readonly url: string
    },
    mode: 'silent' | 'ask',
  ): Promise<PullRequestStatusResult> {
    try {
      this.checkTrust()
    } catch (error: unknown) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
    const repository = repositoryFromFullName(link.repository)
    if (repository === undefined) {
      return { ok: false, reason: UI_TEXT.gitHubFailed }
    }
    const credential = await this.credential(mode)
    if (credential === undefined) {
      return {
        ok: true,
        view: { ...link, needsSignIn: true },
      }
    }
    const client = this.clientFor(credential)
    try {
      const pullRequest = await client.pullRequest(credential.bearer, repository, link.number)
      this.checkTrust()
      const checks = await client.checks(credential.bearer, repository, pullRequest.headSha)
      this.checkTrust()
      return {
        ok: true,
        view: {
          repository: link.repository,
          number: link.number,
          title: pullRequest.title,
          url: link.url,
          state: pullRequest.state,
          isDraft: pullRequest.isDraft,
          isMerged: pullRequest.isMerged,
          checks: { ...checks, failedNames: [...checks.failedNames], other: [...checks.other] },
          checkedAt: this.deps.now(),
        },
      }
    } catch (error: unknown) {
      const { reason, needsSignIn } = await this.failure(credential, error)
      return {
        ok: true,
        view: { ...link, problem: reason, ...(needsSignIn && { needsSignIn }) },
      }
    }
  }
}
