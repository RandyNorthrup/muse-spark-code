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
 * Paged endpoints, read leniently (RVCM1136B P2): elements are validated
 * one by one so a single unparseable record is skipped with its reason
 * while the other rows stay; a failed page fetch keeps the rows already
 * read with the fetch reason. Anything that is not a `ReportNetworkFailure`
 * (an abort, a deadline) is rethrown, never converted into rows.
 */
async function readElements<T>(
  query: ReportNetworkQuery,
  pageSize: number,
  element: z.ZodMiniType<T>,
  unparseable: string,
  urlFor: (page: number) => string,
): Promise<{ rows: T[]; reasons: string[]; fetchFailed: string | null }> {
  const rows: T[] = []
  const reasons: string[] = []
  let fetchFailed: string | null = null
  for (let page = 1; ; page += 1) {
    let batch: unknown[]
    try {
      batch = await query({ url: urlFor(page) }, z.array(z.unknown()))
    } catch (error: unknown) {
      if (!(error instanceof ReportNetworkFailure)) throw error
      fetchFailed = error.message
      break
    }
    for (const item of batch) {
      const parsed = element.safeParse(item)
      if (parsed.success) rows.push(parsed.data)
      else reasons.push(unparseable)
    }
    if (batch.length < pageSize) break
  }
  return { rows, reasons, fetchFailed }
}

/**
 * The captured workflow/release reader: release tags to commits, final
 * releases with their asset names, and release-workflow runs as
 * `release-tag` CI facts. Anything outside the captured shapes is skipped
 * with its own reason; nothing is normalized from a guess.
 */
export function githubWorkflowReleasesPort(): ReportGitHubAdditionalPort {
  return {
    async read(_context, query, repository) {
      const base = endpoint(repository)
      const tagPages = await readElements(
        query,
        GITHUB_TAGS_PAGE_SIZE,
        tagSchema,
        'tag-response-invalid',
        (page) => `${base}/tags?per_page=${String(GITHUB_TAGS_PAGE_SIZE)}&page=${String(page)}`,
      )
      // Tags are only a join key, with no row of their own: a failed tag
      // read still throws with the fetch reason, exactly as before, because
      // no fact has been parsed yet. An unparseable tag element surfaces on
      // the release row that then names no commit.
      if (tagPages.fetchFailed !== null) throw new ReportNetworkFailure(tagPages.fetchFailed)
      const commits = new Map(tagPages.rows.map((tag) => [tag.name, tag.commit.sha]))
      const releasePages = await readElements(
        query,
        GITHUB_RELEASES_PAGE_SIZE,
        releaseSchema,
        'release-response-invalid',
        (page) =>
          `${base}/releases?per_page=${String(GITHUB_RELEASES_PAGE_SIZE)}&page=${String(page)}`,
      )
      const reasons = [...releasePages.reasons]
      if (releasePages.fetchFailed !== null) reasons.push(releasePages.fetchFailed)
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
      // A failed runs read keeps the releases above with the fetch reason.
      // Each run is validated on its own so one unparseable run is skipped
      // with its reason while the other runs stay.
      const collected: z.infer<typeof runSchema>[] = []
      let runsFailed: string | null = null
      for (let page = 1; ; page += 1) {
        let envelope: { workflow_runs: unknown[] }
        try {
          envelope = await query(
            {
              url: `${base}/actions/workflows/${RELEASE_WORKFLOW_FILE}/runs?per_page=${String(GITHUB_WORKFLOW_RUNS_PAGE_SIZE)}&page=${String(page)}`,
            },
            z.looseObject({ workflow_runs: z.array(z.unknown()) }),
          )
        } catch (error: unknown) {
          if (!(error instanceof ReportNetworkFailure)) throw error
          runsFailed = error.message
          break
        }
        for (const item of envelope.workflow_runs) {
          const parsed = runSchema.safeParse(item)
          if (parsed.success) collected.push(parsed.data)
          else reasons.push('run-response-invalid')
        }
        if (envelope.workflow_runs.length < GITHUB_WORKFLOW_RUNS_PAGE_SIZE) break
      }
      if (runsFailed !== null) reasons.push(runsFailed)
      const runs = []
      for (const run of collected) {
        if (run.conclusion === null) {
          reasons.push('run-conclusion-required')
          continue
        }
        if (!commits.has(run.head_branch)) {
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
