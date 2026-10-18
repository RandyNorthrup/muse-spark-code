// Pull-request discovery stops on Cancel (Codex on PR #227): the real
// service with a pre-stopped operation refuses before any sign-in, network
// or link write. The in-flight abort itself is proven at the REST client
// (githubClientAbort.test.ts); the adapter hands the operation's signal in.
import { describe, expect, it } from 'vitest'
import { GitHubSignIn } from '../../src/core/git/githubSignIn'
import { createMemoryPullRequestLinkStore } from '../../src/core/git/pullRequestLinksStore'
import type { CoreLogger } from '../../src/core/logging'
import { RuntimePullRequests } from '../../src/runtime/panel/pullRequests/pullRequests'

const silent = (): undefined => undefined
const log: CoreLogger = { trace: silent, info: silent, warn: silent, error: silent }

describe('pull-request discovery cancellation', () => {
  it('refuses a stopped operation before sign-in, network or a link write', async () => {
    const links = createMemoryPullRequestLinkStore()
    const service = new RuntimePullRequests({
      repositoryRoot: '/repo',
      gitPath: '/usr/bin/git',
      // Never reached: the stopped signal refuses first.
      github: new GitHubSignIn({
        sources: () => [],
        now: () => Date.now(),
        login: () => Promise.resolve(undefined),
        log,
      }),
      links,
      isTrusted: () => true,
      worktreeState: () => ({}),
      confirmWorktreeTrust: () => Promise.resolve(),
      confirmPush: () => Promise.resolve(false),
      confirm: () => Promise.resolve(false),
      pickRemote: () => Promise.resolve(undefined),
      userEnvironment: () => ({}),
      openInTerminal: () => Promise.resolve(),
      openFolder: () => Promise.resolve(),
      openExternal: () => Promise.resolve(),
      dataFolder: '/data',
      userAgent: 'muse-spark-code/test',
      signal: new AbortController().signal,
      log,
      platform: 'linux',
      now: () => Date.now(),
      baseUrl: 'http://127.0.0.1:1',
    })
    const stopped = new AbortController()
    stopped.abort()
    const prepared = await service.prepare({
      repository: { owner: 'octo', name: 'hello' },
      head: 'feature',
      remote: 'origin',
      remoteUrl: 'https://github.com/octo/hello.git',
      sessionId: 'session-1',
      signal: stopped.signal,
    })
    expect(prepared.ok).toBe(false)
    // No link for the stopped session: ordinary calls link nothing alike.
    await expect(links.get('/repo', 'session-1')).resolves.toBeUndefined()
  })
})
