import * as z from 'zod/mini'
import {
  GITHUB_API_BASE_URL,
  GITHUB_API_VERSION,
  GITHUB_CHECKS_PAGE_SIZE,
  GITHUB_MEDIA_TYPE,
  REPORT_MAX_ROWS,
} from '../../../shared/constants'
import {
  reportCiRunSchema,
  type ReportSourcePayloads,
  type ReportSourcePort,
  type SourceReadContext,
} from './types'
import type { ReportKind } from '../../../shared/reportSchema'
import {
  ReportNetworkFailure,
  type ReportNetworkQuery,
  type ReportNetworkReader,
  type ReportNetworkTransport,
  unavailableReportSource,
} from './cache'
import { type ExecutableProbe } from '../../executables'
import { resolveExecutable } from '../../execGuard'
import { type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { execResourceFile } from '../../resources/launcher'
import { withoutCredentials } from '../../credentialEnvironment'
import { redactSecrets } from '../../redact'
import { githubRepositoryOf, type GitHubRepository } from '../../git/githubRemote'
import { isCommitSha } from '../../git/github'
import { reportKindSchema } from '../../../shared/reportSchema'
import { isReportNetworkAllowed, type ReportNetworkPolicy } from './cache'

// M71's 2026-09-28 gh-api capture (githubCapture.ts), not new wire guesses.
const namedRepository = z.object({ full_name: z.string() })
const pullSchema = z.object({
  number: z.number(),
  html_url: z.url(),
  state: z.string(),
  title: z.string(),
  draft: z.boolean(),
  merged_at: z.nullable(z.string()),
  user: z.object({ login: z.string(), id: z.number() }),
  head: z.object({ ref: z.string(), sha: z.string(), repo: z.nullable(namedRepository) }),
  base: z.object({ ref: z.string(), repo: namedRepository }),
})
const checkSchema = z.object({
  name: z.string(),
  head_sha: z.string(),
  conclusion: z.nullable(z.string()),
  html_url: z.url(),
})
const pageRowsSchema = z.array(z.unknown())
const checksSchema = z.looseObject({ total_count: z.unknown(), check_runs: pageRowsSchema })
const checkCountSchema = z.number().check(z.int(), z.nonnegative())
type GitHubFacts = ReportSourcePayloads['github']
const githubReleaseSchema = z.strictObject({
  version: z.string(),
  commit: z.string(),
  at: z.iso.datetime({ offset: true }),
  assets: z.array(z.string()),
})
const additionalSchema = z.strictObject({
  runs: z.array(reportCiRunSchema).check(z.maxLength(REPORT_MAX_ROWS)),
  releases: z.array(githubReleaseSchema).check(z.maxLength(REPORT_MAX_ROWS)),
})
const githubPullSchema = z.pipe(
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
)
const githubFactsSchema = z.strictObject({
  pullRequests: z.array(githubPullSchema).check(z.maxLength(REPORT_MAX_ROWS)),
  ...additionalSchema.shape,
})

/**
N-captures: bind workflow/release readers only after approved wire captures.
A port returns its facts as `{ runs, releases }` (validated below) and may
return `reasons: string[]` naming the rows it skipped per row (RVCM1136B
P2): those reasons join the source's own partial reason while the
surviving rows stay.
*/
export interface ReportGitHubAdditionalPort {
  read(
    context: SourceReadContext,
    query: ReportNetworkQuery,
    repository: GitHubRepository,
  ): Promise<unknown>
}
const additionalPortEnvelopeSchema = z.looseObject({
  runs: z.optional(z.unknown()),
  releases: z.optional(z.unknown()),
  reasons: z.optional(z.unknown()),
})
const additionalReasonsSchema = z.string()
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
function orderedFacts<T>(rows: readonly T[], key: (row: T) => string, reasons: string[]): T[] {
  const sorted = rows.toSorted((a, b) => compare(key(a), key(b)))
  return sorted.filter((row, index) => {
    const previous = sorted[index - 1]
    if (previous === undefined || key(previous) !== key(row)) return true
    if (JSON.stringify(previous) !== JSON.stringify(row)) reasons.push('github-conflicting-fact')
    return false
  })
}

/** Admission owns strict validation and bounds, before final source validation. */
function admitFact<T>(
  rows: T[],
  value: unknown,
  schema: z.ZodMiniType<T>,
  invalid: string,
  bound: string,
  reasons: string[],
): void {
  const parsed = schema.safeParse(value)
  if (!parsed.success) reasons.push(invalid)
  else if (rows.length >= REPORT_MAX_ROWS) reasons.push(bound)
  else rows.push(parsed.data)
}

async function readScopedChecks(
  query: ReportNetworkQuery,
  base: string,
  ref: z.infer<typeof reportCiRunSchema>['ref'],
  runs: GitHubFacts['runs'][number][],
  reasons: string[],
): Promise<{ readonly hasValidatedPage: boolean }> {
  let hasValidatedPage = false
  for (let page = 1; ; page += 1) {
    const pageName = `${ref.kind}-page-${String(page)}`
    let body: unknown
    try {
      body = await query(
        {
          url: `${base}/commits/${encodeURIComponent(ref.name)}/check-runs?per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
        },
        z.unknown(),
      )
    } catch (error: unknown) {
      reasons.push(
        `${pageName}: ${error instanceof ReportNetworkFailure ? error.message : 'check-response-invalid'}`,
      )
      break
    }
    const raw = checksSchema.safeParse(body)
    if (!raw.success) {
      reasons.push(`${pageName}: check-response-invalid`)
      break
    }
    hasValidatedPage = true
    if (raw.data.check_runs.length > GITHUB_CHECKS_PAGE_SIZE)
      reasons.push(`${pageName}: page-row-bound`)
    for (const item of raw.data.check_runs.slice(0, GITHUB_CHECKS_PAGE_SIZE)) {
      const run = checkSchema.safeParse(item)
      if (!run.success) {
        reasons.push('check-response-invalid')
        continue
      }
      if (ref.kind === 'head' && run.data.head_sha !== ref.name) {
        reasons.push('ci-ref-mismatch')
        continue
      }
      admitFact(
        runs,
        {
          ref,
          sha: run.data.head_sha,
          workflow: run.data.name,
          conclusion: run.data.conclusion,
          url: run.data.html_url,
        },
        reportCiRunSchema,
        'check-response-invalid',
        'runs-row-bound',
        reasons,
      )
    }
    const count = checkCountSchema.safeParse(raw.data.total_count)
    if (!count.success) {
      reasons.push(`${pageName}: check-response-invalid`)
      break
    }
    if (
      page * GITHUB_CHECKS_PAGE_SIZE >= count.data ||
      raw.data.check_runs.length !== GITHUB_CHECKS_PAGE_SIZE
    )
      break
  }
  return { hasValidatedPage }
}

export function githubReportSource(options: ReportGitHubOptions): ReportSourcePort<'github'> {
  return {
    kind: 'github',
    id: 'github',
    async read(context) {
      if (!options.reader.allowed(context))
        return unavailableReportSource('github', context.reportText.reportUi.networkOff)
      const repository = githubRepositoryOf(options.remote)
      if (repository === undefined)
        return unavailableReportSource(
          'github',
          `${context.reportText.reportUi.generationFailed} (github-remote-required)`,
          'notApplicable',
        )
      if (!options.reader.allowed(context, 'api.github.com'))
        return unavailableReportSource('github', context.reportText.reportUi.signInRequired)
      if (!isCommitSha(options.headSha) || options.defaultBranch.trim() === '')
        return unavailableReportSource(
          'github',
          `${context.reportText.reportUi.generationFailed} (git-ref-required)`,
        )
      return await options.reader.read<GitHubFacts>(
        context,
        'github',
        githubFactsSchema,
        async (query) => {
          const pullRequests: GitHubFacts['pullRequests'][number][] = []
          const runs: GitHubFacts['runs'][number][] = []
          const releases: GitHubFacts['releases'][number][] = []
          const reasons: string[] = []
          let hasValidatedPage = false
          const base = endpoint(repository)
          // Fixed requests only: never follow an untrusted Link header.
          for (let page = 1; ; page += 1) {
            const pageName = `pulls-page-${String(page)}`
            let body: unknown
            try {
              body = await query(
                {
                  url: `${base}/pulls?state=all&per_page=${String(GITHUB_CHECKS_PAGE_SIZE)}&page=${String(page)}`,
                },
                z.unknown(),
              )
            } catch (error: unknown) {
              reasons.push(
                `${pageName}: ${error instanceof ReportNetworkFailure ? error.message : 'pull-response-invalid'}`,
              )
              break
            }
            const raw = pageRowsSchema.safeParse(body)
            if (!raw.success) {
              reasons.push(`${pageName}: pull-response-invalid`)
              break
            }
            hasValidatedPage = true
            if (raw.data.length > GITHUB_CHECKS_PAGE_SIZE)
              reasons.push(`${pageName}: page-row-bound`)
            for (const item of raw.data.slice(0, GITHUB_CHECKS_PAGE_SIZE)) {
              const pull = pullSchema.safeParse(item)
              if (!pull.success) {
                reasons.push('pull-response-invalid')
                continue
              }
              admitFact(
                pullRequests,
                {
                  number: pull.data.number,
                  url: pull.data.html_url,
                  state: pull.data.state,
                  title: pull.data.title,
                  isDraft: pull.data.draft,
                  isMerged: pull.data.merged_at !== null,
                  author: pull.data.user,
                  headRef: pull.data.head.ref,
                  headSha: pull.data.head.sha,
                  headRepository: pull.data.head.repo?.full_name,
                  baseRef: pull.data.base.ref,
                  baseRepository: pull.data.base.repo.full_name,
                },
                githubPullSchema,
                'pull-response-invalid',
                'pulls-row-bound',
                reasons,
              )
            }
            if (raw.data.length !== GITHUB_CHECKS_PAGE_SIZE) break
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
            const observation = await readScopedChecks(query, base, ref, runs, reasons)
            hasValidatedPage ||= observation.hasValidatedPage
          }
          if (options.additional === undefined) reasons.push('workflow-release-capture-required')
          else {
            try {
              const envelope = additionalPortEnvelopeSchema.safeParse(
                await options.additional.read(context, query, repository),
              )
              if (!envelope.success) throw new ReportNetworkFailure('workflow-releases-unavailable')
              // Facets and reasons are independent: a missing/malformed facet
              // cannot discard accepted facts or the adapter's other reasons.
              if (Array.isArray(envelope.data.reasons)) {
                for (const reason of envelope.data.reasons) {
                  const parsed = additionalReasonsSchema.safeParse(reason)
                  reasons.push(parsed.success ? parsed.data : 'workflow-release-reason-invalid')
                }
              } else if (Object.hasOwn(envelope.data, 'reasons'))
                reasons.push('workflow-release-reason-invalid')
              if (Array.isArray(envelope.data.runs)) {
                hasValidatedPage = true
                for (const run of envelope.data.runs)
                  admitFact(
                    runs,
                    run,
                    reportCiRunSchema,
                    'run-response-invalid',
                    'runs-row-bound',
                    reasons,
                  )
              } else reasons.push('workflow-runs-unavailable')
              if (Array.isArray(envelope.data.releases)) {
                hasValidatedPage = true
                for (const release of envelope.data.releases)
                  admitFact(
                    releases,
                    release,
                    githubReleaseSchema,
                    'release-response-invalid',
                    'releases-row-bound',
                    reasons,
                  )
              } else reasons.push('releases-unavailable')
            } catch (error: unknown) {
              // A refused wire shape keeps its own reason (C-M113-6: a null
              // run conclusion, a draft or prerelease release, a release tag
              // without a commit); only an unshaped failure stays generic.
              reasons.push(
                error instanceof ReportNetworkFailure
                  ? error.message
                  : 'workflow-releases-unavailable',
              )
            }
          }
          if (
            !hasValidatedPage &&
            pullRequests.length === 0 &&
            runs.length === 0 &&
            releases.length === 0
          )
            throw new ReportNetworkFailure([...new Set(reasons)].join('; '))
          return {
            data: {
              pullRequests: orderedFacts(pullRequests, (pull) => String(pull.number), reasons),
              runs: orderedFacts(
                runs,
                (run) => JSON.stringify([run.ref.kind, run.ref.name, run.workflow, run.url]),
                reasons,
              ),
              releases: orderedFacts(
                releases.map((release) => ({
                  ...release,
                  assets: release.assets.toSorted(compare),
                })),
                (release) => release.version,
                reasons,
              ),
            },
            reason: reasons.length === 0 ? null : [...new Set(reasons)].join('; '),
          }
        },
      )
    },
  }
}

const exec = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding & { readonly workspaceRoot?: string | undefined },
) => execResourceFile('probe', file, args, options)
const commandResultSchema = z.object({ stdout: z.string(), stderr: z.string() })
export interface ReportGhOptions {
  readonly environment: NodeJS.ProcessEnv
  readonly maxBytes: number
  /**
  The workspace the report reads for: `gh` never resolves to a file
  inside it (resolved through links), and the probe's scope must exclude
  this same root. REQUIRED.
  */
  readonly workspaceRoot: string
  /** Host file probe; the existing D24 resolver excludes workspace PATH entries. */
  readonly probe: ExecutableProbe
  /** Tests inject the actual child-process boundary, not an authentication fake. */
  readonly run?: (
    file: string,
    args: readonly string[],
    options: ExecFileOptionsWithStringEncoding & { readonly workspaceRoot?: string | undefined },
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
        // No deadline of ours (D121/D208): gh's own exit or the caller's
        // signal ends the request.
        timeout: Infinity,
        maxBuffer: options.maxBytes,
        windowsHide: true,
        workspaceRoot: options.workspaceRoot,
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
    const [statusLine = '', ...headers] = output.slice(0, boundary).split('\n')
    const status = /^HTTP\/[\d.]+\s+(\d{3})(?:\s|$)/.exec(statusLine)?.[1]
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
  of the caller's fields. A prior target preview is not scheduler authority. */
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
A manual invocation previews the entire exact scrubbed post. Unattended
posting needs a previously previewed target and a schedule grant naming it.
A pinned status issue is edited in place; retries never create new issues.
*/
function isPostingAllowed(deps: ReportPostingDeps, context: SourceReadContext): boolean {
  return isReportNetworkAllowed(deps.policy, context) && deps.policy.githubSignedIn
}

/** @unwired M113 report posting to GitHub */
export async function postReport(
  deps: ReportPostingDeps,
  context: SourceReadContext,
  input: { readonly kind: ReportKind; readonly target: PostTarget; readonly body: string },
  schedule?: unknown,
): Promise<ReportPostResult> {
  if (!isPostingAllowed(deps, context))
    return { status: 'refused', reason: context.reportText.reportUi.networkOff }
  const kind = reportKindSchema.parse(input.kind)
  const target = postTargetSchema.parse(input.target)
  if (!(await deps.enabled(kind, target)))
    return { status: 'refused', reason: context.reportText.reportUi.previewPost }
  const body = deps.scrub(
    `${deps.scrub(input.body)}\n\n${context.reportText.reportUi.automatedNote}\n`,
  )
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
      return { status: 'refused', reason: context.reportText.reportUi.previewPost }
    scheduleGrant = grant.data
  } else if ((await deps.confirm(structuredClone(preview), context.signal)) !== 'post')
    return { status: 'refused', reason: context.reportText.reportUi.previewPost }
  if (
    deps.scrub(body) !== body ||
    !isPostingAllowed(deps, context) ||
    !(await deps.enabled(kind, target))
  )
    return { status: 'refused', reason: context.reportText.reportUi.previewPost }
  const url = `https://api.github.com/repos/${target.repository}/issues/${String(target.number)}`
  const controller = new AbortController()
  const signal = AbortSignal.any([context.signal, controller.signal])
  const dispatch = { hasStarted: false }
  let listener: (() => void) | undefined
  // Only the caller's signal (the person's cancel) ends the post: no
  // deadline of ours abandons it (D121/D208). A post already dispatched
  // when it fires stays uncertain, never retried.
  const aborted = new Promise<never>((_resolve, reject) => {
    listener = () => {
      reject(new ReportNetworkFailure('post-cancelled'))
    }
    signal.addEventListener('abort', listener, { once: true })
    if (signal.aborted) listener()
  })
  const work = async (): Promise<ReportPostResult> => {
    if (!(await deps.policy.allowEgress(url, signal)))
      return { status: 'refused', reason: context.reportText.reportUi.networkOff }
    if (scheduleGrant !== undefined && !(await deps.authorizeSchedule(context, scheduleGrant)))
      return { status: 'refused', reason: context.reportText.reportUi.previewPost }
    if (!isPostingAllowed(deps, context) || !(await deps.enabled(kind, target)))
      return { status: 'refused', reason: context.reportText.reportUi.previewPost }
    if (deps.scrub(body) !== body || !isPostingAllowed(deps, context))
      return { status: 'refused', reason: context.reportText.reportUi.previewPost }
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
      reason: context.reportText.reportUi.generationFailed,
    }
  } finally {
    if (listener !== undefined) signal.removeEventListener('abort', listener)
    controller.abort()
  }
}
