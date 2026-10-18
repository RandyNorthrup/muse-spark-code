import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import type { CoreLogger } from '../../src/core/logging'

const logged: string[] = []
const quiet: CoreLogger = {
  trace: (message) => {
    logged.push(message)
  },
  info: (message) => {
    logged.push(message)
  },
  warn: (message) => {
    logged.push(message)
  },
  error: (message) => {
    logged.push(message)
  },
}

describe('GitHubClient network failure', () => {
  it('raises a network GitHubError carrying the fetch failure', async () => {
    const refused = new TypeError('fetch failed')
    const client = new GitHubClient({
      fetch: () => Promise.reject(refused),
      userAgent: 'muse-spark-code/test',
      log: quiet,
    })
    let failure: unknown
    try {
      await client.currentUser('not-a-real-token')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('network')
    expect((failure as GitHubError).cause).toBe(refused)
  })
})
