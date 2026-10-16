// NOLIMITS4 B25: checks() pages through every page of check runs and commit
// statuses. Through the real GitHubClient over the repo's captured-shape
// harness: page one holds 100 passing runs, page two 5 failing ones; every
// run is counted and none is left "not read".
import { describe, expect, it } from 'vitest'
import { GitHubClient } from '../../src/core/git/github'
import type { CoreLogger } from '../../src/core/logging'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'

const quiet = () => undefined
const log: CoreLogger = { trace: quiet, info: quiet, warn: quiet, error: quiet }
const SHA = 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5'
const BASE = `/repos/RandyNorthrup/muse-spark-code/commits/${SHA}`

function run(index: number, conclusion: string) {
  return { name: `job-${String(index)}`, status: 'completed', conclusion }
}

describe('GitHubClient.checks pages through all check runs', () => {
  it('counts runs past the first hundred with no remainder', async () => {
    const github = fakeGitHub()
    github.answer('GET', `${BASE}/check-runs`, (request) => ({
      status: 200,
      body: {
        total_count: 105,
        check_runs: request.path.includes('page=2')
          ? [100, 101, 102, 103, 104].map((index) => run(index, 'failure'))
          : Array.from({ length: 100 }, (_, index) => run(index, 'success')),
      },
    }))
    const client = new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log,
      baseUrl: FAKE_GITHUB_BASE,
    })
    const summary = await client.checks(
      FAKE_GITHUB_TOKEN,
      { owner: 'RandyNorthrup', name: 'muse-spark-code' },
      SHA,
    )
    expect(summary.passed).toBe(100)
    expect(summary.failed).toBe(5)
    expect(summary.failedNames).toHaveLength(5)
    expect(summary).not.toHaveProperty('notRead')
  })
})
