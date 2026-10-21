// The GitHub Actions workflow-runs and releases reader for the github
// report source (M113 lane C-M113-6): the `additional` port, bound only
// after the lead's N-captures handoff.
//
// Wire provenance (AGENTS.md rule 14): 2026-10-11 captures in
// `test/fixtures/m113/stores/github-*/`, byte-exact beside their receipts.
// Observed only:
// - Release workflow runs (`actions/workflows/release.yml/runs`): every run
//   carries `name`, `head_branch`, `head_sha`, `event`, `status`,
//   `conclusion` and `html_url`. A tag-triggered Release run has `event:
//   "push"` with `head_branch` equal to the tag name and `head_sha` the
//   tagged commit. Observed `status` is always `completed`; observed
//   `conclusion` is `success` or `failure`.
// - Releases (`/releases`, a bare array; `/releases/latest` equals page 1's
//   first element): every record carries `tag_name`, `target_commitish:
//   "main"` (a branch name, never the commit), `draft: false`,
//   `prerelease: false`, `published_at` and `assets[]` of `{name, ...}`.
//   The row's commit comes from `/tags` (`name` to `commit.sha`).
// - Pagination is by page number on every endpoint; a page is exhausted by
//   a short page, and anything past the reader's page bound refuses as
//   `page-bound` instead of truncating.
//
// Refusals, each with its own reason and never a guessed row: a run with a
// null conclusion (`run-conclusion-required`), a release-workflow run on
// something that is not a known tag (`run-release-tag-required`), a draft
// release (`release-draft-refused`), a prerelease (`release-prerelease-refused`)
// and a release whose tag names no commit (`release-commit-required`). A
// record that does not even parse as its shape (`release-response-invalid`,
// `run-response-invalid`) is refused the same way. Those shapes were not
// captured; they are owed captures (see the lane's certification record),
// not normalized facts.
//
// RVCM1136B P2: every refusal above is per row, never a throw. A refused or
// unparseable release or workflow run is skipped with its reason while the
// other rows stay; a failed page fetch keeps the rows already read with the
// fetch reason. The port returns its distinct reasons beside the surviving
// rows so the github source can report them without dropping a fact.
//
// RVCM1136D: redesigned, not patched. Every request inside the read (each
// tag page, each release page, each run page) returns its own result — rows
// or a refusal with its own paged reason (`tags-page-2: http-500`) — and the
// assembly never throws because one of them failed. Rows from the requests
// that succeeded stay; a failed page ends only its own endpoint's
// pagination (later pages are unknown, never probed). An unparseable tag is
// skipped with `tag-response-invalid` and never blamed on another record: a
// release or run whose tag element was corrupt is skipped silently, its
// reason already recorded.
import * as z from 'zod/mini'
import {
  GITHUB_API_BASE_URL,
  GITHUB_RELEASES_PAGE_SIZE,
  GITHUB_TAGS_PAGE_SIZE,
  GITHUB_WORKFLOW_RUNS_PAGE_SIZE,
} from '../../../shared/constants'
import type { GitHubRepository } from '../../git/githubRemote'
import { ReportNetworkFailure, type ReportNetworkQuery } from './cache'
import type { ReportGitHubAdditionalPort } from './github'

// The release workflow this repository publishes from, as captured. Other
// repositories name their own file; nothing here discovers it.
const RELEASE_WORKFLOW_FILE = 'release.yml'

const tagSchema = z.looseObject({
  name: z.string(),
  commit: z.looseObject({ sha: z.string() }),
})
const releaseSchema = z.looseObject({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string(),
  assets: z.array(z.looseObject({ name: z.string() })),
})
const runSchema = z.looseObject({
  name: z.string(),
  head_branch: z.string(),
  head_sha: z.string(),
  conclusion: z.nullable(z.string()),
  html_url: z.string(),
})

function endpoint(repository: GitHubRepository): string {
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
}

/**
Reads the `name` off a tag-shaped value without guessing: only a string
`name` counts, so a corrupt element beside it can be tied to the releases
and runs that named it instead of blaming those records.
*/
function tagNameOf(item: unknown): string | null {
  const parsed = z.looseObject({ name: z.string() }).safeParse(item)
  return parsed.success ? parsed.data.name : null
}

/**
Validate each page and record independently. A failed page ends this
endpoint, preserving its accepted rows and every other endpoint's request
allowance. Body, decode and adapter failures all name the failed page.
*/
async function readElements<T>(
  query: ReportNetworkQuery,
  pageSize: number,
  element: z.ZodMiniType<T>,
  unparseable: string,
  pageName: string,
  urlFor: (page: number) => string,
  select: (body: unknown) => unknown[] | null,
  nameOf?: (item: unknown) => string | null,
): Promise<{ rows: T[]; invalidNames: string[]; reasons: string[]; didFetchFail: boolean }> {
  const rows: T[] = []
  const invalidNames: string[] = []
  const reasons: string[] = []
  let didFetchFail = false
  for (let page = 1; ; page += 1) {
    let batch: unknown[] | null
    try {
      // The reader bounds, decodes and scrubs the unknown wire body;
      // this endpoint owns all failures and validates every record below.
      batch = select(await query({ url: urlFor(page) }, z.unknown()))
    } catch (error: unknown) {
      reasons.push(
        `${pageName}-${String(page)}: ${error instanceof ReportNetworkFailure ? error.message : unparseable}`,
      )
      didFetchFail = true
      break
    }
    if (batch === null) {
      reasons.push(`${pageName}-${String(page)}: ${unparseable}`)
      didFetchFail = true
      break
    }
    if (batch.length > pageSize) {
      reasons.push(`${pageName}-${String(page)}: page-row-bound`)
      didFetchFail = true
    }
    for (const item of batch.slice(0, pageSize)) {
      const parsed = element.safeParse(item)
      if (parsed.success) {
        rows.push(parsed.data)
      } else {
        reasons.push(unparseable)
        const name = nameOf?.(item) ?? null
        if (name !== null) invalidNames.push(name)
        // A nameless refused tag makes missing joins uncertain, just like
        // a failed tag page; never blame a release/run for that absence.
        else if (nameOf !== undefined) didFetchFail = true
      }
    }
    if (batch.length !== pageSize) break
  }
  return { rows, invalidNames, reasons, didFetchFail }
}

/** A bare paged array: tags and releases. */
function selectArrayBodies(body: unknown): unknown[] | null {
  const parsed = z.array(z.unknown()).safeParse(body)
  return parsed.success ? parsed.data : null
}

/**
The captured workflow/release reader: release tags to commits, final
releases with their asset names, and release-workflow runs as
`release-tag` CI facts. Anything outside the captured shapes is skipped
with its own reason; nothing is normalized from a guess.
*/
export function githubWorkflowReleasesPort(): ReportGitHubAdditionalPort {
  return {
    async read(_context, query, repository) {
      const base = endpoint(repository)
      // Tags are only a join key, with no row of their own: their reasons
      // still join the port's own, so a corrupt tag is never silent and a
      // failed tag page never blanks the releases and runs read after it.
      const tagPages = await readElements(
        query,
        GITHUB_TAGS_PAGE_SIZE,
        tagSchema,
        'tag-response-invalid',
        'tags-page',
        (page) => `${base}/tags?per_page=${String(GITHUB_TAGS_PAGE_SIZE)}&page=${String(page)}`,
        selectArrayBodies,
        tagNameOf,
      )
      const reasons = [...tagPages.reasons]
      const invalidTags = new Set(tagPages.invalidNames)
      const commits = new Map(tagPages.rows.map((tag) => [tag.name, tag.commit.sha]))
      const releasePages = await readElements(
        query,
        GITHUB_RELEASES_PAGE_SIZE,
        releaseSchema,
        'release-response-invalid',
        'releases-page',
        (page) =>
          `${base}/releases?per_page=${String(GITHUB_RELEASES_PAGE_SIZE)}&page=${String(page)}`,
        selectArrayBodies,
      )
      reasons.push(...releasePages.reasons)
      const normalizedReleases = []
      for (const release of releasePages.rows) {
        if (release.draft) {
          reasons.push('release-draft-refused')
          continue
        }
        if (release.prerelease) {
          reasons.push('release-prerelease-refused')
          continue
        }
        const commit = commits.get(release.tag_name)
        if (commit === undefined) {
          // The tag element was corrupt (`tag-response-invalid` is already
          // recorded) or its page never arrived (the paged refusal is
          // already recorded): either way the release record itself is not
          // blamed for another request's failure.
          if (!invalidTags.has(release.tag_name) && !tagPages.didFetchFail)
            reasons.push('release-commit-required')
          continue
        }
        normalizedReleases.push({
          version: release.tag_name,
          commit,
          at: release.published_at,
          assets: release.assets.map((asset) => asset.name),
        })
      }
      // The runs envelope carries its own count; like every fixed request
      // here it is paged by number to a short page, never via Link headers.
      // A failed runs page keeps the releases above with its paged reason.
      // Each run is validated on its own so one unparseable run is skipped
      // with its reason while the other runs stay.
      const runPages = await readElements(
        query,
        GITHUB_WORKFLOW_RUNS_PAGE_SIZE,
        runSchema,
        'run-response-invalid',
        'runs-page',
        (page) =>
          `${base}/actions/workflows/${RELEASE_WORKFLOW_FILE}/runs?per_page=${String(GITHUB_WORKFLOW_RUNS_PAGE_SIZE)}&page=${String(page)}`,
        (body) => {
          const parsed = z.looseObject({ workflow_runs: z.array(z.unknown()) }).safeParse(body)
          return parsed.success ? parsed.data.workflow_runs : null
        },
      )
      reasons.push(...runPages.reasons)
      const runs = []
      for (const run of runPages.rows) {
        if (run.conclusion === null) {
          reasons.push('run-conclusion-required')
          continue
        }
        if (!commits.has(run.head_branch)) {
          // Same rule as releases above: a corrupt or missing tag page is
          // already named, so the run record is not blamed for it.
          if (!invalidTags.has(run.head_branch) && !tagPages.didFetchFail)
            reasons.push('run-release-tag-required')
          continue
        }
        runs.push({
          ref: { kind: 'release-tag', name: run.head_branch } as const,
          sha: run.head_sha,
          workflow: run.name,
          conclusion: run.conclusion,
          url: run.html_url,
        })
      }
      return { runs, releases: normalizedReleases, reasons: [...new Set(reasons)] }
    },
  }
}
