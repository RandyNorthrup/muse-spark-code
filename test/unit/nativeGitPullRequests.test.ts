// The runtime pull request service's failure paths, proved without touching
// GitHub: an unreachable REST endpoint is a closed port (nothing answers),
// and the credential is test input the service never validates or sends
// anywhere observable. Trust, Cancel and sign-in need no network at all.

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createMemoryPullRequestLinkStore } from '../../src/core/git/pullRequestLinksStore'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'
import type { GitHubCredential, GitHubTokenSource } from '../../src/core/git/tokenSource'
import type { CoreLogger } from '../../src/core/logging'
import {
  RuntimePullRequests,
  type RuntimePullRequestDeps,
} from '../../src/runtime/panel/pullRequests/pullRequests'
import { UI_TEXT } from '../../src/shared/constants'

const quiet = (): void => undefined
const testLog: CoreLogger = { trace: quiet, info: quiet, warn: quiet, error: quiet }

const root = mkdtempSync(path.join(tmpdir(), 'm123-native-prs-'))
/** A port nothing listens on: the refused connection is the unreachable GitHub. */
const UNREACHABLE_BASE_URL = 'http://127.0.0.1:9/'

const credential: GitHubCredential = {
  source: 'ghLogin',
  bearer: 'untransmitted-test-bearer',
  fetch,
  expiresAt: undefined,
}

const source: GitHubTokenSource = {
  kind: 'ghLogin',
  credential: () => Promise.resolve(credential),
  rejected: () => Promise.resolve(),
  signOut: () => Promise.resolve(),
}

function never(name: string): () => never {
  return () => {
    throw new Error(`must not be called: ${name}`)
  }
}

function depsFor(options?: {
  isTrusted?: () => boolean
  signal?: AbortSignal
  tokenSources?: readonly GitHubTokenSource[]
}): RuntimePullRequestDeps {
  const gitDeps: RuntimeGitDeps = {
    repositoryRoot: root,
    gitPath: 'git',
    tokenSources: options?.tokenSources ?? [source],
    links: createMemoryPullRequestLinkStore(),
    isTrusted: options?.isTrusted ?? (() => true),
    confirmPush: never('confirmPush'),
    pickRemote: never('pickRemote'),
    userEnvironment: never('userEnvironment'),
    openInTerminal: never('openInTerminal'),
    openFolder: never('openFolder'),
    openExternal: never('openExternal'),
    dataFolder: root,
    userAgent: 'native-pull-requests-test',
    signal: options?.signal ?? new AbortController().signal,
    log: testLog,
  }
  return {
    ...gitDeps,
    platform: process.platform,
    now: () => Date.now(),
    confirm: () => Promise.resolve(true),
    baseUrl: UNREACHABLE_BASE_URL,
  }
}

const repository = { owner: 'octocat', name: 'hello-world' }
const remoteUrl = 'https://github.com/octocat/hello-world'

describe('RuntimePullRequests trust', () => {
  it('refuses to prepare when untrusted', async () => {
    const service = new RuntimePullRequests(depsFor({ isTrusted: () => false }))
    const result = await service.prepare({
      repository,
      head: 'feature',
      remote: 'origin',
      remoteUrl,
    })
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
  })

  it('refuses to create when untrusted', async () => {
    const service = new RuntimePullRequests(depsFor({ isTrusted: () => false }))
    const result = await service.create({
      destination: {
        targetRepository: repository,
        repository,
        defaultBase: 'main',
        apiHead: 'feature',
        headRepository: undefined,
        remote: 'origin',
        remoteUrl,
        head: 'feature',
      },
      title: 'Title',
      body: 'Body',
      base: 'main',
      isDraft: true,
    })
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
  })

  it('refuses to read status when untrusted', async () => {
    const service = new RuntimePullRequests(depsFor({ isTrusted: () => false }))
    const result = await service.status(
      {
        repository: 'octocat/hello-world',
        number: 1,
        title: 'Title',
        url: 'https://github.com/octocat/hello-world/pull/1',
      },
      'silent',
    )
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
  })

  it('answers a cancelled prepare instead of throwing', async () => {
    const abort = new AbortController()
    abort.abort()
    const service = new RuntimePullRequests(depsFor({ signal: abort.signal }))
    const result = await service.prepare({
      repository,
      head: 'feature',
      remote: 'origin',
      remoteUrl,
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('the cancelled prepare reported success')
    }
    expect(typeof result.reason).toBe('string')
  })
})

describe('RuntimePullRequests sign-in', () => {
  it('asks for sign-in to prepare with no credential', async () => {
    const service = new RuntimePullRequests(depsFor({ tokenSources: [] }))
    const result = await service.prepare({
      repository,
      head: 'feature',
      remote: 'origin',
      remoteUrl,
    })
    expect(result).toEqual({
      ok: false,
      reason: UI_TEXT.gitHubSignInDeclined,
      needsSignIn: true,
    })
  })
})

describe('RuntimePullRequests unreachable GitHub', () => {
  it('reports the unreachable destination when preparing', async () => {
    const service = new RuntimePullRequests(depsFor())
    const result = await service.prepare({
      repository,
      head: 'feature',
      remote: 'origin',
      remoteUrl,
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('the unreachable prepare reported success')
    }
    expect(result.needsSignIn).toBeUndefined()
    expect(result.reason.length > 0).toBe(true)
  })

  it('reports the unreachable destination when resolving the create target', async () => {
    const service = new RuntimePullRequests(depsFor())
    const result = await service.create({
      destination: {
        targetRepository: repository,
        repository,
        defaultBase: 'main',
        apiHead: 'feature',
        headRepository: undefined,
        remote: 'origin',
        remoteUrl,
        head: 'feature',
      },
      title: 'Title',
      body: 'Body',
      base: 'main',
      isDraft: true,
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('the unreachable create reported success')
    }
    expect(result.needsSignIn).toBeUndefined()
    expect(result.reason.length > 0).toBe(true)
  })

  it('keeps the link readable with the problem when status cannot be read', async () => {
    const service = new RuntimePullRequests(depsFor())
    const result = await service.status(
      {
        repository: 'octocat/hello-world',
        number: 1,
        title: 'Title',
        url: 'https://github.com/octocat/hello-world/pull/1',
      },
      'silent',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('the unreachable status reported failure')
    }
    expect(result.view.number).toBe(1)
    expect(typeof result.view.problem).toBe('string')
  })
})
