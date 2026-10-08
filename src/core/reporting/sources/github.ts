import { type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { execResourceFile } from '../../resources/admission'
import * as z from 'zod/mini'
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_CHECKS_PAGE_SIZE,
  GITHUB_MEDIA_TYPE,
  REPORT_MAX_ROWS,
  REPORT_SOURCE_TIMEOUT_MS,
  UI_TEXT,
} from '../../../shared/constants'
import { withoutCredentials } from '../../credentialEnvironment'
import { resolveExecutable, type ExecutableProbe } from '../../executables'
import { redactSecrets } from '../../redact'
import { githubRepositoryOf, type GitHubRepository } from '../../git/githubRemote'
import { isCommitSha } from '../../git/github'
import {
  reportCiRunSchema,
  type ReportSourcePayloads,
  type ReportSourcePort,
  type SourceReadContext,
} from './types'
import type { ReportKind } from '../../../shared/reportSchema'
import { reportKindSchema } from '../../../shared/reportSchema'
import { isReportNetworkAllowed, type ReportNetworkPolicy } from './cache'
import {
  ReportNetworkFailure,
  type ReportNetworkQuery,
  type ReportNetworkReader,
  type ReportNetworkTransport,
  unavailableReportSource,
} from './cache'

// M71's 2026-09-28 gh-api capture (githubCapture.ts), not new wire guesses.
const namedRepository = z.object({ full_name: z.string() })
const pullsSchema = z
  .array(
    z.object({
      number: z.number(),
      html_url: z.url(),
      state: z.string(),
      title: z.string(),
      draft: z.boolean(),
      merged_at: z.nullable(z.string()),
      user: z.object({ login: z.string(), id: z.number() }),
      head: z.object({ ref: z.string(), sha: z.string(), repo: z.nullable(namedRepository) }),
      base: z.object({ ref: z.string(), repo: namedRepository }),
    }),
  )
  .check(z.maxLength(GITHUB_CHECKS_PAGE_SIZE))
const checksSchema = z.object({
  total_count: z.number().check(z.int(), z.nonnegative()),
  check_runs: z
    .array(
      z.object({
        name: z.string(),
        head_sha: z.string(),
        conclusion: z.nullable(z.string()),
        html_url: z.url(),
      }),
    )
    .check(z.maxLength(GITHUB_CHECKS_PAGE_SIZE)),
})
type GitHubFacts = ReportSourcePayloads['github']
const additionalSchema = z.strictObject({
  runs: z.array(reportCiRunSchema).check(z.maxLength(REPORT_MAX_ROWS)),
  releases: z
    .array(
      z.strictObject({
        version: z.string(),
        commit: z.string(),
        at: z.iso.datetime({ offset: true }),
        assets: z.array(z.string()),
      }),
    )
    .check(z.maxLength(REPORT_MAX_ROWS)),
})
const githubFactsSchema = z.strictObject({
  pullRequests: z.array(
    z.pipe(
      z.strictObject({
        number: z.number(),
        url: z.url(),
        state: z.string(),
        title: z.string(),
        isDraft: z.boolean(),
        isMerged: z.boolean(),
        author: z.strictObject({ login: z.string(), id: z.number() }),
        headRef: z.string(),
        headSha: z.string(),
        headRepository: z.union([z.string(), z.undefined()]),
        baseRef: z.string(),
        baseRepository: z.string(),
      }),
      z.transform((pull) => ({ ...pull, headRepository: pull.headRepository })),
    ),
  ),
  ...additionalSchema.shape,
})

/** N-captures: bind workflow/release readers only after approved wire captures. */
export interface ReportGitHubAdditionalPort {
  read(
    context: SourceReadContext,
    query: ReportNetworkQuery,
    repository: GitHubRepository,
  ): Promise<unknown>
}
export interface ReportGitHubOptions {
  readonly reader: ReportNetworkReader
  readonly remote: string
  readonly headSha: string
  readonly defaultBranch: string
  readonly releaseTag?: string
  readonly additional?: ReportGitHubAdditionalPort
}

function endpoint(repository: GitHubRepository): string {
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
}
function compare(a: string, b: string): number {
  return Number(a > b) - Number(a < b)
}
function orderedFacts<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const sorted = rows.toSorted((a, b) => compare(key(a), key(b)))
  return sorted.filter((row, index) => {
    const previous = sorted[index - 1]
    if (previous === undefined || key(previous) !== key(row)) return true
    if (JSON.stringify(previous) !== JSON.stringify(row))
      throw new ReportNetworkFailure('github-conflicting-fact')
    return false
  })
}

async function readScopedChecks(
  query: ReportNetworkQuery,
  base: string,
  ref: z.infer<typeof reportCiRunSchema>['ref'],
  runs: GitHubFacts['runs'][number][],
): Promise<void> {
  for (let page = 1; ; page += 1) {
    const raw = await query(
      {
        url: `${base}/commits/${encodeURIComponent(ref.name)}/check-runs?per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
      },
      checksSchema,
    )
    if (ref.kind === 'head' && raw.check_runs.some((run) => run.head_sha !== ref.name))
      throw new ReportNetworkFailure('ci-ref-mismatch')
    runs.push(
      ...raw.check_runs.map((run) =>
        reportCiRunSchema.parse({
          ref,
          sha: run.head_sha,
          workflow: run.name,
          conclusion: run.conclusion,
          url: run.html_url,
        }),
      ),
    )
    if (
      page * GITHUB_CHECKS_PAGE_SIZE >= raw.total_count ||
      raw.check_runs.length < GITHUB_CHECKS_PAGE_SIZE
    )
      break
  }
}

export function githubReportSource(options: ReportGitHubOptions): ReportSourcePort<'github'> {
  return {
    kind: 'github',
    id: 'github',
    async read(context) {
      if (!options.reader.allowed(context))
        return unavailableReportSource('github', UI_TEXT.reportUi.networkOff)
      const repository = githubRepositoryOf(options.remote)
      if (repository === undefined)
        return unavailableReportSource(
          'github',
          `${UI_TEXT.reportUi.generationFailed} (github-remote-required)`,
          'notApplicable',
        )
      if (!options.reader.allowed(context, 'api.github.com'))
        return unavailableReportSource('github', UI_TEXT.reportUi.signInRequired)
      if (!isCommitSha(options.headSha) || options.defaultBranch.trim() === '')
        return unavailableReportSource(
          'github',
          `${UI_TEXT.reportUi.generationFailed} (git-ref-required)`,
        )
      return await options.reader.read<GitHubFacts>(
        context,
        'github',
        githubFactsSchema,
        async (query) => {
          const pullRequests: GitHubFacts['pullRequests'][number][] = []
          const runs: GitHubFacts['runs'][number][] = []
          let releases: GitHubFacts['releases'] = []
          const reasons: string[] = []
          const base = endpoint(repository)
          // Fixed requests only: never follow an untrusted Link header.
          try {
            for (let page = 1; ; page += 1) {
              const raw = await query(
                {
                  url: `${base}/pulls?state=all&per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
                },
                pullsSchema,
              )
              pullRequests.push(
                ...raw.map((pull) => ({
                  number: pull.number,
                  url: pull.html_url,
                  state: pull.state,
                  title: pull.title,
                  isDraft: pull.draft,
                  isMerged: pull.merged_at !== null,
                  author: pull.user,
                  headRef: pull.head.ref,
                  headSha: pull.head.sha,
                  headRepository: pull.head.repo?.full_name,
                  baseRef: pull.base.ref,
                  baseRepository: pull.base.repo.full_name,
                })),
              )
              if (raw.length < GITHUB_CHECKS_PAGE_SIZE) break
            }
          } catch (error: unknown) {
            reasons.push(
              error instanceof ReportNetworkFailure ? error.message : 'pulls-unavailable',
            )
          }
          const refs: z.infer<typeof reportCiRunSchema>['ref'][] = [
            { kind: 'head', name: options.headSha },
            { kind: 'default-branch', name: options.defaultBranch },
            ...(options.releaseTag === undefined
              ? []
              : [
                  { kind: 'release-tag', name: options.releaseTag } satisfies z.infer<
                    typeof reportCiRunSchema
                  >['ref'],
                ]),
          ]
          for (const ref of refs) {
            try {
              await readScopedChecks(query, base, ref, runs)
            } catch (error: unknown) {
              reasons.push(
                `${ref.kind}: ${error instanceof ReportNetworkFailure ? error.message : 'checks-unavailable'}`,
              )
            }
          }
          if (options.additional === undefined) reasons.push('workflow-release-capture-required')
          else {
            try {
              const additional = additionalSchema.parse(
                await options.additional.read(context, query, repository),
              )
              runs.push(...additional.runs)
              releases = additional.releases
            } catch {
              reasons.push('workflow-releases-unavailable')
            }
          }
          return {
            data: {
              pullRequests: orderedFacts(pullRequests, (pull) => String(pull.number)),
              runs: orderedFacts(
                runs,
                (run) => `${run.ref.kind}/${run.ref.name}/${run.workflow}/${run.url}`,
              ),
              releases: orderedFacts(
                releases.map((release) => ({
                  ...release,
                  assets: release.assets.toSorted(compare),
                })),
                (release) => release.version,
              ),
            },
            reason: reasons.length === 0 ? null : reasons.join('; '),
          }
        },
      )
    },
  }
}

const exec = execResourceFile
const commandResultSchema = z.object({ stdout: z.string(), stderr: z.string() })
export interface ReportGhOptions {
  readonly environment: NodeJS.ProcessEnv
  readonly maxBytes: number
  /** Host file probe; the existing D24 resolver excludes workspace PATH entries. */
  readonly probe: ExecutableProbe
  /** Tests inject the actual child-process boundary, not an authentication fake. */
  readonly run?: (
    file: string,
    args: readonly string[],
    options: ExecFileOptionsWithStringEncoding,
  ) => Promise<{ stdout: string; stderr: string }>
}

/** gh owns its login. No credential variable, token argument or shell reaches it. */
export function ghReportTransport(options: ReportGhOptions): ReportNetworkTransport {
  return async (request, etag, signal) => {
    const url = new URL(request.url)
    if (
      redactSecrets(request.url) !== request.url ||
      (etag !== null && redactSecrets(etag) !== etag)
    )
      throw new ReportNetworkFailure('gh-secret-refused')
    if (
      url.origin !== GITHUB_API_BASE_URL ||
      (request.method ?? 'GET') !== 'GET' ||
      request.body !== undefined
    )
      throw new ReportNetworkFailure('gh-endpoint-refused')
    const file = resolveExecutable('gh', options.probe)
    if (file === undefined) throw new ReportNetworkFailure('gh-not-found')
    const args = [
      'api',
      '--hostname',
      'github.com',
      '--method',
      'GET',
      '--include',
      `${url.pathname}${url.search}`,
      '-H',
      `Accept: ${GITHUB_MEDIA_TYPE}`,
      '-H',
      `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`,
      ...(etag === null ? [] : ['-H', `If-None-Match: ${etag}`]),
    ]
    let raw: unknown
    try {
      raw = await (options.run ?? exec)(file, args, {
        encoding: 'utf8',
        env: withoutCredentials(options.environment),
        signal,
        timeout: REPORT_SOURCE_TIMEOUT_MS,
        maxBuffer: options.maxBytes,
        windowsHide: true,
      })
    } catch (error: unknown) {
      raw = error
    }
    const parsed = commandResultSchema.safeParse(raw)
    if (!parsed.success) throw new ReportNetworkFailure('gh-failed')
    const result = parsed.data
    if (Buffer.byteLength(result.stdout) > options.maxBytes)
      throw new ReportNetworkFailure('gh-output-bound')
    // gh --include writes an HTTP status/header block followed by JSON. This
    // is HTTP syntax, not a new upstream JSON shape. stderr is never used.
    const output = result.stdout.replaceAll('\r\n', '\n')
    const boundary = output.indexOf('\n\n')
    const [statusLine, ...headers] = output.slice(0, boundary).split('\n')
    const status = /^HTTP\/[\d.]+\s+(\d{3})(?:\s|$)/.exec(statusLine ?? '')?.[1]
    if (boundary === -1 || status === undefined)
      throw new ReportNetworkFailure('gh-response-invalid')
    const responseHeaders = new Headers()
    for (const header of headers) {
      const colon = header.indexOf(':')
      if (colon <= 0) throw new ReportNetworkFailure('gh-response-invalid')
      responseHeaders.append(header.slice(0, colon), header.slice(colon + 1).trim())
    }
    const body = output.slice(boundary + '\n\n'.length)
    return new Response(body === '' ? null : body, {
      status: Number(status),
      headers: responseHeaders,
    })
  }
}

const postTargetSchema = z
  .strictObject({
    repository: z.string(),
    number: z.number().check(z.int(), z.positive()),
    kind: z.enum(['pull-request-comment', 'issue-comment', 'pinned-status-issue']),
  })
  .check(
    z.refine(
      (target) => githubRepositoryOf(`https://github.com/${target.repository}`) !== undefined,
    ),
  )
type PostTarget = z.infer<typeof postTargetSchema>
const reportPostGrantSchema = z.strictObject({
  action: z.literal('post-report'),
  kind: reportKindSchema,
  target: postTargetSchema,
})
type PostScheduleGrant = z.infer<typeof reportPostGrantSchema>
export interface ReportPostPreview {
  readonly kind: ReportKind
  readonly target: PostTarget
  readonly body: string
}
export interface ReportPostingDeps {
  readonly policy: ReportNetworkPolicy
  readonly scrub: (text: string) => string
  /** Per kind and exact repository/number/target kind; never a session rule. */
  readonly enabled: (kind: ReportKind, target: PostTarget) => Promise<boolean>
  readonly previewed: (kind: ReportKind, target: PostTarget) => Promise<boolean>
  /** Q verifies the active occurrence/creator/workspace grant independently
   * of the caller's fields. A prior target preview is not scheduler authority. */
  readonly authorizeSchedule: (
    context: SourceReadContext,
    grant: PostScheduleGrant,
  ) => Promise<boolean>
  readonly rememberPreview: (kind: ReportKind, target: PostTarget) => Promise<void>
  readonly confirm: (preview: ReportPostPreview, signal: AbortSignal) => Promise<'post' | 'cancel'>
  /** Captured adapter uses the user's D95.13 identity, no token in this module. */
  readonly send: (
    request: ReportPostPreview & {
      readonly method: 'comment' | 'updateIssue'
      readonly signal: AbortSignal
    },
  ) => Promise<unknown>
}
export type ReportPostResult =
  | { readonly status: 'posted'; readonly url: string }
  | {
      readonly status: 'refused' | 'failed' | 'uncertain'
      readonly reason: string
    }

/**
 * A manual invocation previews the entire exact scrubbed post. Unattended
 * posting needs a previously previewed target and a schedule grant naming it.
 * A pinned status issue is edited in place; retries never create new issues.
 */
function isPostingAllowed(deps: ReportPostingDeps, context: SourceReadContext): boolean {
  return isReportNetworkAllowed(deps.policy, context) && deps.policy.githubSignedIn
}

export async function postReport(
  deps: ReportPostingDeps,
  context: SourceReadContext,
  input: { readonly kind: ReportKind; readonly target: PostTarget; readonly body: string },
  schedule?: unknown,
): Promise<ReportPostResult> {
  if (!isPostingAllowed(deps, context))
    return { status: 'refused', reason: UI_TEXT.reportUi.networkOff }
  const kind = reportKindSchema.parse(input.kind)
  const target = postTargetSchema.parse(input.target)
  if (!(await deps.enabled(kind, target)))
    return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
  const body = deps.scrub(`${deps.scrub(input.body)}\n\n${UI_TEXT.reportUi.automatedNote}\n`)
  const preview: ReportPostPreview = { kind, target, body }
  let scheduleGrant: PostScheduleGrant | undefined
  if (schedule !== undefined) {
    const targetKey = JSON.stringify(target)
    const grant = reportPostGrantSchema.safeParse(schedule)
    if (
      !grant.success ||
      grant.data.kind !== kind ||
      JSON.stringify(grant.data.target) !== targetKey ||
      !(await deps.previewed(kind, target)) ||
      !(await deps.authorizeSchedule(context, grant.data))
    )
      return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
    scheduleGrant = grant.data
  } else if ((await deps.confirm(structuredClone(preview), context.signal)) !== 'post')
    return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
  if (
    deps.scrub(body) !== body ||
    !isPostingAllowed(deps, context) ||
    !(await deps.enabled(kind, target))
  )
    return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
  const url = `https://api.github.com/repos/${target.repository}/issues/${String(target.number)}`
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const dispatch = { hasStarted: false }
  let listener: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      reject(new ReportNetworkFailure('post-deadline'))
    }
    signal.addEventListener('abort', listener, { once: true })
    if (signal.aborted) listener()
  })
  const timer = setTimeout(() => {
    controller.abort()
  }, REPORT_SOURCE_TIMEOUT_MS)
  const work = async (): Promise<ReportPostResult> => {
    if (!(await deps.policy.allowEgress(url, signal)))
      return { status: 'refused', reason: UI_TEXT.reportUi.networkOff }
    if (scheduleGrant !== undefined && !(await deps.authorizeSchedule(context, scheduleGrant)))
      return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
    if (!isPostingAllowed(deps, context) || !(await deps.enabled(kind, target)))
      return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
    if (deps.scrub(body) !== body || !isPostingAllowed(deps, context))
      return { status: 'refused', reason: UI_TEXT.reportUi.previewPost }
    signal.throwIfAborted()
    dispatch.hasStarted = true
    const receipt = z.strictObject({ url: z.url() }).parse(
      await deps.send({
        ...preview,
        method: target.kind === 'pinned-status-issue' ? 'updateIssue' : 'comment',
        signal,
      }),
    )
    const postedUrl = new URL(receipt.url)
    const expected = target.kind === 'pull-request-comment' ? 'pull' : 'issues'
    if (
      postedUrl.origin !== 'https://github.com' ||
      postedUrl.pathname !== `/${target.repository}/${expected}/${String(target.number)}` ||
      postedUrl.search !== '' ||
      postedUrl.username !== '' ||
      postedUrl.password !== '' ||
      deps.scrub(receipt.url) !== receipt.url
    )
      throw new ReportNetworkFailure('post-receipt-invalid')
    signal.throwIfAborted()
    await deps.rememberPreview(kind, target)
    return { status: 'posted', url: receipt.url }
  }
  try {
    return await Promise.race([work(), aborted])
  } catch {
    return {
      status: dispatch.hasStarted ? 'uncertain' : 'failed',
      reason: UI_TEXT.reportUi.generationFailed,
    }
  } finally {
    clearTimeout(timer)
    if (listener !== undefined) signal.removeEventListener('abort', listener)
    controller.abort()
  }
}
