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
// and a release whose tag names no commit (`release-commit-required`). Those
// shapes were not captured; they are owed captures (see the lane's
// certification record), not normalized facts.
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
const runsEnvelopeSchema = z.looseObject({ workflow_runs: z.array(runSchema) })

function endpoint(repository: GitHubRepository): string {
  return `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
}

/** Bare-array endpoints (`/tags`, `/releases`): page by number to a short page. */
async function readArrayPages<T>(
  query: ReportNetworkQuery,
  pageSize: number,
  schema: z.ZodMiniType<T[]>,
  urlFor: (page: number) => string,
): Promise<T[]> {
  const rows: T[] = []
  for (let page = 1; ; page += 1) {
    const batch = await query({ url: urlFor(page) }, schema)
    rows.push(...batch)
    if (batch.length < pageSize) break
  }
  return rows
}

/**
 * The captured workflow/release reader: release tags to commits, final
 * releases with their asset names, and release-workflow runs as
 * `release-tag` CI facts. Anything outside the captured shapes refuses
 * with its own reason; nothing is normalized from a guess.
 */
export function githubWorkflowReleasesPort(): ReportGitHubAdditionalPort {
  return {
    async read(_context, query, repository) {
      const base = endpoint(repository)
      const tags = await readArrayPages(
        query,
        GITHUB_TAGS_PAGE_SIZE,
        z.array(tagSchema),
        (page) => `${base}/tags?per_page=${String(GITHUB_TAGS_PAGE_SIZE)}&page=${String(page)}`,
      )
      const commits = new Map(tags.map((tag) => [tag.name, tag.commit.sha]))
      const releases = await readArrayPages(
        query,
        GITHUB_RELEASES_PAGE_SIZE,
        z.array(releaseSchema),
        (page) =>
          `${base}/releases?per_page=${String(GITHUB_RELEASES_PAGE_SIZE)}&page=${String(page)}`,
      )
      const normalizedReleases = releases.map((release) => {
        if (release.draft) throw new ReportNetworkFailure('release-draft-refused')
        if (release.prerelease) throw new ReportNetworkFailure('release-prerelease-refused')
        const commit = commits.get(release.tag_name)
        if (commit === undefined) throw new ReportNetworkFailure('release-commit-required')
        return {
          version: release.tag_name,
          commit,
          at: release.published_at,
          assets: release.assets.map((asset) => asset.name),
        }
      })
      // The runs envelope carries its own count; like every fixed request
      // here it is paged by number to a short page, never via Link headers.
      const collected: z.infer<typeof runSchema>[] = []
      for (let page = 1; ; page += 1) {
        const envelope = await query(
          {
            url: `${base}/actions/workflows/${RELEASE_WORKFLOW_FILE}/runs?per_page=${String(GITHUB_WORKFLOW_RUNS_PAGE_SIZE)}&page=${String(page)}`,
          },
          runsEnvelopeSchema,
        )
        collected.push(...envelope.workflow_runs)
        if (envelope.workflow_runs.length < GITHUB_WORKFLOW_RUNS_PAGE_SIZE) break
      }
      const runs = collected.map((run) => {
        if (run.conclusion === null) throw new ReportNetworkFailure('run-conclusion-required')
        if (!commits.has(run.head_branch))
          throw new ReportNetworkFailure('run-release-tag-required')
        return {
          ref: { kind: 'release-tag', name: run.head_branch } as const,
          sha: run.head_sha,
          workflow: run.name,
          conclusion: run.conclusion,
          url: run.html_url,
        }
      })
      return { runs, releases: normalizedReleases }
    },
  }
}
