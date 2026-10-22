// GitHub's REST API: the calls M71 makes (PLAN.md D49) — who is signed
// in, a repository's default branch, a pull request, the open pull request
// for a branch, creating one, and a commit's checks — and the calls M115w's
// watchdog makes: an issue, the issue list, an issue's comments, issue
// search, posting a comment, adding labels and closing an issue. Every
// response is parsed with a schema written from a capture (the 2026-09-28
// capture in test/unit/helpers/githubCapture.ts, docs/certification/m71.md,
// and the 2026-10-22 issue captures in test/fixtures/m115w/github-issues/;
// AGENTS.md rule 13), and only the fields read here are kept. A creation
// reply is the same object its GET returns (docs.github.com/rest/pulls and
// .../rest/issues, API version 2022-11-28): the POST and PATCH answers are
// parsed with the captured GET schemas, and anything else-shaped refuses
// out loud rather than corrupting the watchdog's records.
//
// The token comes from the person's GitHub sign-in for each call and is
// never logged, stored or returned. Pure: `fetch` is injected (VS Code's
// proxy-aware one in the extension, the runtime's in the agent).

import * as z from 'zod/mini'
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_CHECKS_PAGE_SIZE,
  GITHUB_ISSUES_PAGE_SIZE,
  GITHUB_MEDIA_TYPE,
  GITHUB_REQUEST_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { CoreLogger } from '../logging'
import { networkFailureMessage } from '../networkFailure'
import type { GitHubRepository } from './githubRemote'
import type { GitHubCredential } from './tokenSource'

const userSchema = z.object({ login: z.string(), id: z.number() })

const pullRequestSchema = z.object({
  number: z.number(),
  html_url: z.string(),
  /** `open` or `closed` as captured; any other word is shown as it came. */
  state: z.string(),
  title: z.string(),
  draft: z.boolean(),
  merged_at: z.nullable(z.string()),
  user: userSchema,
  head: z.object({
    ref: z.string(),
    sha: z.string(),
    // GitHub documents `null` for a fork that was deleted since.
    repo: z.nullable(z.object({ full_name: z.string() })),
  }),
  base: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }) }),
})

const repositorySchema = z.object({
  full_name: z.string(),
  default_branch: z.string(),
  // A fork names the repository it came from (captured on a fork, 2026-09-28).
  parent: z.optional(z.object({ full_name: z.string(), default_branch: z.string() })),
})

const checkRunsSchema = z.object({
  total_count: z.number(),
  check_runs: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.nullable(z.string()),
    }),
  ),
})

const combinedStatusSchema = z.object({
  state: z.string(),
  total_count: z.number(),
  statuses: z.array(z.object({ state: z.string(), context: z.string() })),
})

// M115w's shapes, from the 2026-10-22 captures
// (test/fixtures/m115w/github-issues/). `body` reads nullable although no
// capture shows null: GitHub documents it nullable
// (docs.github.com/rest/issues/issues), and a null body reads as empty,
// never as a refusal to watch the issue.
const issueLabelSchema = z.object({
  id: z.number(),
  name: z.string(),
  color: z.string(),
  description: z.nullable(z.string()),
  default: z.boolean(),
})

const issueSchema = z.object({
  id: z.number(),
  number: z.number(),
  html_url: z.string(),
  /** `open` or `closed` as captured; any other word is shown as it came. */
  state: z.string(),
  title: z.string(),
  user: userSchema,
  labels: z.array(issueLabelSchema),
  locked: z.boolean(),
  comments: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.nullable(z.string()),
  body: z.nullable(z.string()),
  author_association: z.string(),
  /** Present on pull requests only; the watchdog watches issues, not these. */
  pull_request: z.optional(z.unknown()),
})

const issueCommentSchema = z.object({
  id: z.number(),
  html_url: z.string(),
  user: userSchema,
  created_at: z.string(),
  updated_at: z.string(),
  body: z.nullable(z.string()),
  author_association: z.string(),
})

const issueSearchSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(issueSchema),
})

const errorSchema = z.object({
  message: z.string(),
  errors: z.optional(
    z.array(
      z.object({
        code: z.optional(z.string()),
        field: z.optional(z.string()),
        message: z.optional(z.string()),
      }),
    ),
  ),
})

export interface GitHubUser {
  readonly login: string
  readonly id: number
}

export interface PullRequest {
  readonly number: number
  readonly url: string
  readonly state: string
  readonly title: string
  readonly isDraft: boolean
  readonly isMerged: boolean
  readonly author: GitHubUser
  readonly headRef: string
  readonly headSha: string
  /** `owner/name` of the head's repository; undefined when its fork is gone. */
  readonly headRepository: string | undefined
  readonly baseRef: string
  readonly baseRepository: string
}

/** What a commit's checks came to, counted from the captured values only. */
export interface ChecksSummary {
  readonly passed: number
  readonly failed: number
  readonly running: number
  readonly skipped: number
  readonly cancelled: number
  /** The failed checks by name, for the strip's tooltip. */
  readonly failedNames: readonly string[]
  /** Any check in a state the capture did not show, as `name: state` (D36). */
  readonly other: readonly string[]
}

/** An issue as the watchdog reads it. `body` is empty when GitHub sent null. */
export interface GitHubIssue {
  readonly id: number
  readonly number: number
  readonly url: string
  readonly state: string
  readonly title: string
  readonly author: GitHubUser
  readonly labels: readonly string[]
  readonly isLocked: boolean
  readonly commentCount: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly closedAt: string | undefined
  readonly body: string
  readonly association: string
  readonly isPullRequest: boolean
}

export interface GitHubIssueComment {
  readonly id: number
  readonly url: string
  readonly author: GitHubUser
  readonly createdAt: string
  readonly updatedAt: string
  readonly body: string
  readonly association: string
}

export interface GitHubIssueLabel {
  readonly id: number
  readonly name: string
  readonly color: string
  readonly description: string | undefined
  readonly isDefault: boolean
}

export interface GitHubIssueSearch {
  readonly totalCount: number
  readonly incompleteResults: boolean
  readonly issues: readonly GitHubIssue[]
}

/** A repository's default branch, and for a fork the repository it came from. */
export interface RepositoryFacts {
  readonly defaultBranch: string
  readonly parent:
    { readonly repository: GitHubRepository; readonly defaultBranch: string } | undefined
}

export interface NewPullRequest {
  readonly title: string
  readonly body: string
  /** The branch name, or `owner:branch` for a branch in another repository. */
  readonly head: string
  readonly base: string
  readonly isDraft: boolean
}

export type GitHubFailureKind =
  'signIn' | 'notFound' | 'invalid' | 'rateLimited' | 'server' | 'network' | 'response'

/**
A call GitHub refused or that never reached it. `message` is for the user
(GitHub's own words where it gave them); the log gets `kind` and `status`.
*/
export class GitHubError extends Error {
  public constructor(
    message: string,
    public readonly kind: GitHubFailureKind,
    public readonly status: number | undefined,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'GitHubError'
  }
}

/**
A 401 drops the credential at its source (M123, PLAN.md D104), so the
user signs in again. True when `error` was GitHub's sign-in refusal.
Here, beside the error it reads, so the token sources (which the
terminal's sign-in loads) never carry the REST client.
*/
export async function didDropRejectedCredential(
  signIn: { rejected(credential: GitHubCredential): Promise<void> },
  credential: GitHubCredential,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof GitHubError && error.kind === 'signIn')) {
    return false
  }
  await signIn.rejected(credential)
  return true
}

export interface GitHubClientDeps {
  readonly fetch: typeof fetch
  /** `muse-spark-code/<version>`: GitHub refuses a request without one. */
  readonly userAgent: string
  readonly log: CoreLogger
  /** The base URL; the constant unless a test points it elsewhere. */
  readonly baseUrl?: string
  readonly timeoutMs?: number
}

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_UNPROCESSABLE = 422
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500
const RATE_LIMIT_REMAINING = 'x-ratelimit-remaining'
// A commit id as GitHub writes it: SHA-1, or SHA-256 in a repository that uses it.
const SHA = /^[\da-f]{40}(?:[\da-f]{24})?$/
// The check-run values the capture showed, and what each counts as.
const CHECK_COMPLETED = 'completed'
const CHECK_IN_PROGRESS = 'in_progress'
const CONCLUSION_COUNTS = {
  success: 'passed',
  failure: 'failed',
  skipped: 'skipped',
  cancelled: 'cancelled',
} as const
// A commit status's captured states; a count of 0 with `pending` means none.
const STATUS_COUNTS = { success: 'passed', failure: 'failed' } as const

type CountKey = 'passed' | 'failed' | 'running' | 'skipped' | 'cancelled'

function isKnownKey<T extends object>(table: T, key: string): key is Extract<keyof T, string> {
  return Object.hasOwn(table, key)
}

function kindOf(response: Response): GitHubFailureKind {
  if (response.status === HTTP_UNAUTHORIZED) {
    return 'signIn'
  }
  if (
    response.status === HTTP_TOO_MANY_REQUESTS ||
    (response.status === HTTP_FORBIDDEN && response.headers.get(RATE_LIMIT_REMAINING) === '0')
  ) {
    return 'rateLimited'
  }
  if (response.status === HTTP_NOT_FOUND) {
    return 'notFound'
  }
  if (response.status === HTTP_UNPROCESSABLE) {
    return 'invalid'
  }
  return response.status >= HTTP_SERVER_ERROR ? 'server' : 'invalid'
}

/** GitHub's message and each error's own words: "Validation Failed: A pull request already exists…". */
function errorMessage(body: unknown, status: number): string {
  const parsed = errorSchema.safeParse(body)
  if (!parsed.success) {
    return fill(UI_TEXT.gitHubAnswered, { status: String(status) })
  }
  const details = (parsed.data.errors ?? []).flatMap((error) => {
    if (error.message !== undefined) {
      return error.message
    }
    return error.field === undefined || error.code === undefined
      ? []
      : `${error.field} ${error.code}`
  })
  return details.length === 0
    ? parsed.data.message
    : `${parsed.data.message}: ${details.join('; ')}`
}

function toGitHubIssue(raw: z.infer<typeof issueSchema>): GitHubIssue {
  return {
    id: raw.id,
    number: raw.number,
    url: raw.html_url,
    state: raw.state,
    title: raw.title,
    author: raw.user,
    labels: raw.labels.map((label) => label.name),
    isLocked: raw.locked,
    commentCount: raw.comments,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at ?? undefined,
    body: raw.body ?? '',
    association: raw.author_association,
    isPullRequest: raw.pull_request !== undefined,
  }
}

function toGitHubComment(raw: z.infer<typeof issueCommentSchema>): GitHubIssueComment {
  return {
    id: raw.id,
    url: raw.html_url,
    author: raw.user,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    body: raw.body ?? '',
    association: raw.author_association,
  }
}

function toPullRequest(raw: z.infer<typeof pullRequestSchema>): PullRequest {
  return {
    number: raw.number,
    url: raw.html_url,
    state: raw.state,
    title: raw.title,
    isDraft: raw.draft,
    isMerged: raw.merged_at !== null,
    author: raw.user,
    headRef: raw.head.ref,
    headSha: raw.head.sha,
    headRepository: raw.head.repo?.full_name,
    baseRef: raw.base.ref,
    baseRepository: raw.base.repo.full_name,
  }
}

/** `owner/name` as GitHub writes it, split; undefined for anything else. */
export function repositoryFromFullName(fullName: string): GitHubRepository | undefined {
  const [owner, name, ...rest] = fullName.split('/')
  return owner === undefined || name === undefined || owner === '' || name === '' || rest.length > 0
    ? undefined
    : { owner, name }
}

/** Whether `value` is a whole commit id, nothing a path or an option could hide in. */
export function isCommitSha(value: string): boolean {
  return SHA.test(value)
}

function repositoryPath(repository: GitHubRepository): string {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
}

/** Counts check runs and commit statuses into one summary. */
function summarizeChecks(
  runs: readonly z.infer<typeof checkRunsSchema>['check_runs'][number][],
  statuses: readonly z.infer<typeof combinedStatusSchema>['statuses'][number][],
): ChecksSummary {
  const counts: Record<CountKey, number> = {
    passed: 0,
    failed: 0,
    running: 0,
    skipped: 0,
    cancelled: 0,
  }
  const failedNames: string[] = []
  const other: string[] = []
  const count = (key: CountKey, name: string) => {
    counts[key] += 1
    if (key === 'failed') {
      failedNames.push(name)
    }
  }
  for (const run of runs) {
    const { conclusion } = run
    if (run.status === CHECK_IN_PROGRESS) {
      count('running', run.name)
    } else if (
      conclusion !== null &&
      run.status === CHECK_COMPLETED &&
      isKnownKey(CONCLUSION_COUNTS, conclusion)
    ) {
      count(CONCLUSION_COUNTS[conclusion], run.name)
    } else {
      other.push(`${run.name}: ${conclusion ?? run.status}`)
    }
  }
  for (const status of statuses) {
    if (isKnownKey(STATUS_COUNTS, status.state)) {
      count(STATUS_COUNTS[status.state], status.context)
    } else {
      other.push(`${status.context}: ${status.state}`)
    }
  }
  return {
    ...counts,
    failedNames,
    other,
  }
}

export class GitHubClient {
  public constructor(private readonly deps: GitHubClientDeps) {}

  /**
  One call: JSON in and out, the token in the header, a deadline,
  GitHub's refusals as `GitHubError`. An operation's signal joins the
  deadline, so Cancel stops pull-request discovery at once (Codex on PR
  #227); without one the deadline stands alone as before.
  */
  private async request(
    token: string,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const url = `${this.deps.baseUrl ?? GITHUB_API_BASE_URL}${path}`
    const deadline = AbortSignal.timeout(this.deps.timeoutMs ?? GITHUB_REQUEST_TIMEOUT_MS)
    let response: Response
    try {
      response = await this.deps.fetch(url, {
        method,
        headers: {
          Accept: GITHUB_MEDIA_TYPE,
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': this.deps.userAgent,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: signal === undefined ? deadline : AbortSignal.any([deadline, signal]),
      })
    } catch (error: unknown) {
      this.deps.log.warn(`GitHub ${method} did not reach GitHub`)
      throw new GitHubError(
        networkFailureMessage(error).replaceAll(token, '[redacted]'),
        'network',
        undefined,
        { cause: error },
      )
    }
    let json: unknown
    try {
      json = await response.json()
    } catch {
      // Not JSON: a proxy's page, or a body cut short.
      json = undefined
    }
    if (!response.ok) {
      const kind = kindOf(response)
      this.deps.log.warn(`GitHub ${method} answered ${String(response.status)} (${kind})`)
      throw new GitHubError(
        errorMessage(json, response.status).replaceAll(token, '[redacted]'),
        kind,
        response.status,
      )
    }
    return json
  }

  private parse<T>(schema: z.ZodMiniType<T>, value: unknown, what: string): T {
    const parsed = schema.safeParse(value)
    if (!parsed.success) {
      this.deps.log.warn(`GitHub's ${what} did not have the expected shape`)
      throw new GitHubError(UI_TEXT.gitHubResponseInvalid, 'response', undefined)
    }
    return parsed.data
  }

  public async currentUser(token: string): Promise<GitHubUser> {
    return this.parse(userSchema, await this.request(token, 'GET', '/user'), 'account')
  }

  /** The repository's default branch, a pull request's usual base, and a fork's parent. */
  public async repositoryFacts(
    token: string,
    repository: GitHubRepository,
    signal?: AbortSignal,
  ): Promise<RepositoryFacts> {
    const parsed = this.parse(
      repositorySchema,
      await this.request(token, 'GET', repositoryPath(repository), undefined, signal),
      'repository',
    )
    const parent =
      parsed.parent === undefined ? undefined : repositoryFromFullName(parsed.parent.full_name)
    return {
      defaultBranch: parsed.default_branch,
      parent:
        parent === undefined || parsed.parent === undefined
          ? undefined
          : { repository: parent, defaultBranch: parsed.parent.default_branch },
    }
  }

  public async pullRequest(
    token: string,
    repository: GitHubRepository,
    number: number,
  ): Promise<PullRequest> {
    const raw = await this.request(
      token,
      'GET',
      `${repositoryPath(repository)}/pulls/${String(number)}`,
    )
    return toPullRequest(this.parse(pullRequestSchema, raw, 'pull request'))
  }

  /** The open pull request whose head is `headOwner:branch`, if any. */
  public async openPullRequestFor(
    token: string,
    repository: GitHubRepository,
    headOwner: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<PullRequest | undefined> {
    const query = new URLSearchParams({
      head: `${headOwner}:${branch}`,
      state: 'open',
      per_page: '1',
    })
    const raw = await this.request(
      token,
      'GET',
      `${repositoryPath(repository)}/pulls?${query.toString()}`,
      undefined,
      signal,
    )
    const [first] = this.parse(z.array(pullRequestSchema), raw, 'pull request list')
    return first === undefined ? undefined : toPullRequest(first)
  }

  public async createPullRequest(
    token: string,
    repository: GitHubRepository,
    request: NewPullRequest,
  ): Promise<PullRequest> {
    const raw = await this.request(token, 'POST', `${repositoryPath(repository)}/pulls`, {
      title: request.title,
      body: request.body,
      head: request.head,
      base: request.base,
      draft: request.isDraft,
    })
    return toPullRequest(this.parse(pullRequestSchema, raw, 'new pull request'))
  }

  /** The check runs and commit statuses on `sha`, every page of each, counted. */
  public async checks(
    token: string,
    repository: GitHubRepository,
    sha: string,
  ): Promise<ChecksSummary> {
    if (!isCommitSha(sha)) {
      throw new GitHubError(fill(UI_TEXT.gitHubCommitInvalid, { sha }), 'invalid', undefined)
    }
    const commit = `${repositoryPath(repository)}/commits/${sha}`
    const runs: z.infer<typeof checkRunsSchema>['check_runs'] = []
    for (let page = 1; ; page += 1) {
      const parsed = this.parse(
        checkRunsSchema,
        await this.request(
          token,
          'GET',
          `${commit}/check-runs?per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
        ),
        'check runs',
      )
      runs.push(...parsed.check_runs)
      if (
        page * GITHUB_CHECKS_PAGE_SIZE >= parsed.total_count ||
        parsed.check_runs.length < GITHUB_CHECKS_PAGE_SIZE
      )
        break
    }
    const statuses: z.infer<typeof combinedStatusSchema>['statuses'] = []
    for (let page = 1; ; page += 1) {
      const parsed = this.parse(
        combinedStatusSchema,
        await this.request(
          token,
          'GET',
          `${commit}/status?per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
        ),
        'commit status',
      )
      statuses.push(...parsed.statuses)
      if (
        page * GITHUB_CHECKS_PAGE_SIZE >= parsed.total_count ||
        parsed.statuses.length < GITHUB_CHECKS_PAGE_SIZE
      )
        break
    }
    return summarizeChecks(runs, statuses)
  }

  /** One issue by number. Pull requests arrive with `isPullRequest` set. */
  public async issue(
    token: string,
    repository: GitHubRepository,
    number: number,
  ): Promise<GitHubIssue> {
    const raw = await this.request(
      token,
      'GET',
      `${repositoryPath(repository)}/issues/${String(number)}`,
    )
    return toGitHubIssue(this.parse(issueSchema, raw, 'issue'))
  }

  /** Every issue page, newest first, until a short page ends the list. */
  public async listIssues(
    token: string,
    repository: GitHubRepository,
    signal?: AbortSignal,
  ): Promise<GitHubIssue[]> {
    const issues: GitHubIssue[] = []
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        state: 'all',
        sort: 'updated',
        direction: 'desc',
        per_page: String(GITHUB_ISSUES_PAGE_SIZE),
        page: String(page),
      })
      const parsed = this.parse(
        z.array(issueSchema),
        await this.request(
          token,
          'GET',
          `${repositoryPath(repository)}/issues?${query.toString()}`,
          undefined,
          signal,
        ),
        'issue list',
      )
      issues.push(...parsed.map((item) => toGitHubIssue(item)))
      if (parsed.length < GITHUB_ISSUES_PAGE_SIZE) break
    }
    return issues
  }

  /** An issue's comments, oldest first, until a short page ends the list. */
  public async issueComments(
    token: string,
    repository: GitHubRepository,
    number: number,
  ): Promise<GitHubIssueComment[]> {
    const comments: GitHubIssueComment[] = []
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        per_page: String(GITHUB_ISSUES_PAGE_SIZE),
        page: String(page),
      })
      const parsed = this.parse(
        z.array(issueCommentSchema),
        await this.request(
          token,
          'GET',
          `${repositoryPath(repository)}/issues/${String(number)}/comments?${query.toString()}`,
        ),
        'issue comments',
      )
      comments.push(...parsed.map((item) => toGitHubComment(item)))
      if (parsed.length < GITHUB_ISSUES_PAGE_SIZE) break
    }
    return comments
  }

  /** The repository's labels, every page until a short one ends the list. */
  public async issueLabels(
    token: string,
    repository: GitHubRepository,
  ): Promise<GitHubIssueLabel[]> {
    const labels: GitHubIssueLabel[] = []
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        per_page: String(GITHUB_ISSUES_PAGE_SIZE),
        page: String(page),
      })
      const parsed = this.parse(
        z.array(issueLabelSchema),
        await this.request(
          token,
          'GET',
          `${repositoryPath(repository)}/labels?${query.toString()}`,
        ),
        'label list',
      )
      labels.push(
        ...parsed.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
          description: label.description ?? undefined,
          isDefault: label.default,
        })),
      )
      if (parsed.length < GITHUB_ISSUES_PAGE_SIZE) break
    }
    return labels
  }

  /** Issue search, first page. The caller passes the whole `q`. */
  public async searchIssues(token: string, query: string): Promise<GitHubIssueSearch> {
    const search = new URLSearchParams({
      q: query,
      per_page: String(GITHUB_ISSUES_PAGE_SIZE),
    })
    const parsed = this.parse(
      issueSearchSchema,
      await this.request(token, 'GET', `/search/issues?${search.toString()}`),
      'issue search',
    )
    return {
      totalCount: parsed.total_count,
      incompleteResults: parsed.incomplete_results,
      issues: parsed.items.map((item) => toGitHubIssue(item)),
    }
  }

  /** Posts a comment as the signed-in person. The answer parses as the
  comment it created (docs.github.com/rest/issues/comments), anything
  else-shaped refusing out loud. */
  public async postIssueComment(
    token: string,
    repository: GitHubRepository,
    number: number,
    body: string,
  ): Promise<GitHubIssueComment> {
    const raw = await this.request(
      token,
      'POST',
      `${repositoryPath(repository)}/issues/${String(number)}/comments`,
      { body },
    )
    return toGitHubComment(this.parse(issueCommentSchema, raw, 'new issue comment'))
  }

  /** Adds labels; GitHub answers the issue's whole label list. */
  public async addIssueLabels(
    token: string,
    repository: GitHubRepository,
    number: number,
    labels: readonly string[],
  ): Promise<readonly string[]> {
    const parsed = this.parse(
      z.array(issueLabelSchema),
      await this.request(
        token,
        'POST',
        `${repositoryPath(repository)}/issues/${String(number)}/labels`,
        {
          labels: [...labels],
        },
      ),
      'issue labels',
    )
    return parsed.map((label) => label.name)
  }

  /** Closes an issue. The answer parses as the issue it closed. */
  public async closeIssue(
    token: string,
    repository: GitHubRepository,
    number: number,
  ): Promise<GitHubIssue> {
    const raw = await this.request(
      token,
      'PATCH',
      `${repositoryPath(repository)}/issues/${String(number)}`,
      { state: 'closed' },
    )
    return toGitHubIssue(this.parse(issueSchema, raw, 'closed issue'))
  }
}
