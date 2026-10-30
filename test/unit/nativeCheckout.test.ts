// The pull request checkout's failure paths, proved with real git and a
// real records store: a closed port stands in for the unreachable API,
// refused connections and exit errors are git's own, and taken folders,
// failed cleanups and dead batch children are arranged on the real file
// system. The credential is test input the service never validates.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BlobAnswers } from '../../src/core/git/heldCheckoutCore'
import { lstatIdentitySync, identityOf } from '../../src/core/fs/fileIdentity'
import type { CoreLogger } from '../../src/core/logging'
import type { PullRequest } from '../../src/core/git/github'
import { GitHubSignIn } from '../../src/core/git/githubSignIn'
import {
  HeldFolderTakenError,
  HeldWriters,
  PullRequestCheckoutProtocol,
  RuntimePullRequestCheckout,
  createNodePullRequestCheckoutGit,
  runBatchChild,
  type CheckoutProtocolDeps,
  type MadeFolder,
  type RuntimeCheckoutDeps,
} from '../../src/runtime/panel/pullRequests/checkout'
import { createMemoryPullRequestLinkStore } from '../../src/core/git/pullRequestLinksStore'
import { createFileWorktreeRecordStore } from '../../src/runtime/panel/pullRequests/records'
import { createMemoryWorktreeRecordStore } from '../../src/runtime/panel/pullRequests/records'
import { UI_TEXT } from '../../src/shared/constants'
import {
  isolatedGitEnv,
  neverCalled,
  testCredentialSource,
  testGit,
} from './helpers/nativeGitHarness'

const quiet = (): void => undefined

const root = mkdtempSync(path.join(tmpdir(), 'm123-native-checkout-'))
const shells = testGit(root)
/** A port nothing listens on: the refused connection is the unreachable GitHub. */
const UNREACHABLE_BASE_URL = 'http://127.0.0.1:9/'

function makeRepository(): { repo: string; sha: string } {
  return shells.makeRepository()
}

interface Harness {
  readonly protocol: PullRequestCheckoutProtocol
  readonly service: RuntimePullRequestCheckout
  readonly git: ReturnType<typeof createNodePullRequestCheckoutGit>
  readonly warnings: string[]
  revokeTrust: () => void
}

function harness(repositoryRoot: string): Harness {
  const warnings: string[] = []
  const testLog: CoreLogger = {
    trace: quiet,
    info: quiet,
    warn: (message: string) => {
      warnings.push(message)
    },
    error: quiet,
  }
  let isTrusted = true
  const dataFolder = mkdtempSync(path.join(root, 'data-'))
  const gitEnv = isolatedGitEnv(root)
  const git = createNodePullRequestCheckoutGit({
    gitPath: shells.git,
    userEnv: gitEnv,
    quietEnv: gitEnv,
    platform: process.platform,
    signal: new AbortController().signal,
    log: testLog,
  })
  const protocolDeps: CheckoutProtocolDeps = {
    records: createFileWorktreeRecordStore(dataFolder, process.platform, testLog),
    git,
    pathExists: existsSync,
    isTrusted: () => isTrusted,
    signal: new AbortController().signal,
    log: testLog,
    now: () => Date.now(),
    confirm: () => Promise.resolve(true),
    openFolder: neverCalled('openFolder'),
    repositoryRoot,
  }
  const serviceDeps: RuntimeCheckoutDeps = {
    ...protocolDeps,
    gitPath: shells.git,
    links: createMemoryPullRequestLinkStore(),
    confirmPush: neverCalled('confirmPush'),
    pickRemote: neverCalled('pickRemote'),
    userEnvironment: neverCalled('userEnvironment'),
    openInTerminal: neverCalled('openInTerminal'),
    openExternal: neverCalled('openExternal'),
    dataFolder,
    userAgent: 'native-checkout-test',
    platform: process.platform,
    baseUrl: UNREACHABLE_BASE_URL,
    heldRoots: [],
    worktreeState: () => ({}),
    confirmWorktreeTrust: () => Promise.resolve(),
    github: new GitHubSignIn({
      sources: () => [testCredentialSource],
      now: () => Date.now(),
      login: () => Promise.resolve(undefined),
      log: testLog,
    }),
  }
  return {
    protocol: new PullRequestCheckoutProtocol(protocolDeps),
    service: new RuntimePullRequestCheckout(serviceDeps),
    git,
    warnings,
    revokeTrust: () => {
      isTrusted = false
    },
  }
}

/** The trust gate passes: these folders are the test's own. */
function gatePasses(): void {
  // Nothing to check: the test owns every folder it passes.
}

function pullRequestFor(sha: string): PullRequest {
  return {
    number: 7,
    url: 'https://github.com/octocat/hello-world/pull/7',
    state: 'open',
    title: 'Title',
    isDraft: false,
    isMerged: false,
    author: { login: 'octocat', id: 1 },
    headRef: 'feature',
    headSha: sha,
    headRepository: undefined,
    baseRef: 'main',
    baseRepository: 'octocat/hello-world',
  }
}

const remote = { name: 'origin', repository: { owner: 'octocat', name: 'hello-world' } }

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('RuntimePullRequestCheckout opening', () => {
  it('reports the unreachable GitHub instead of throwing', async () => {
    const { repo } = makeRepository()
    const { service } = harness(repo)
    const result = await service.open(
      'https://github.com/octocat/hello-world/pull/7',
      [remote],
      undefined,
    )
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('the unreachable open reported success')
    }
    expect(result.reason.startsWith(UI_TEXT.gitHubFailed)).toBe(true)
  })

  it('refuses to open when untrusted', async () => {
    const { repo } = makeRepository()
    const built = harness(repo)
    built.revokeTrust()
    const result = await built.service.open(
      'https://github.com/octocat/hello-world/pull/7',
      [remote],
      undefined,
    )
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
  })

  it('shows no ticket without a record', async () => {
    const { repo } = makeRepository()
    const { service } = harness(repo)
    await expect(service.trustTicket(path.join(root, 'absent-folder'))).resolves.toBeUndefined()
  })

  it('refuses the hold release when untrusted', async () => {
    const { repo } = makeRepository()
    const built = harness(repo)
    built.revokeTrust()
    const result = await built.service.releaseHold({
      folder: path.join(root, 'absent-folder'),
      checkoutId: 'checkout',
      revision: 0,
      fence: undefined,
      headSha: 'a'.repeat(40),
      folderIdentity: 'identity',
      pullRequest: {
        repository: 'octocat/hello-world',
        number: 7,
        url: 'https://github.com/octocat/hello-world/pull/7',
        title: 'Title',
        author: 'octocat',
        headSha: 'a'.repeat(40),
        isAuthoredByUser: false,
      },
    })
    expect(result).toEqual({ ok: false, reason: UI_TEXT.gitRestricted })
  })
})

describe('PullRequestCheckoutProtocol folders', () => {
  it('refuses a taken folder with its name in the reason', async () => {
    const { repo } = makeRepository()
    const { git } = harness(repo)
    const taken = path.join(root, 'taken-folder')
    mkdirSync(taken)
    let seen: unknown
    try {
      await git.claimFolder(taken)
    } catch (error: unknown) {
      seen = error
    }
    expect(seen).toBeInstanceOf(HeldFolderTakenError)
    if (!(seen instanceof HeldFolderTakenError)) throw seen
    expect(seen.message).toContain(taken)
  })

  it('answers the failed worktree add and removes what it made', async () => {
    const { repo } = makeRepository()
    const { protocol } = harness(repo)
    const folder = path.join(root, 'failed-add')
    const result = await protocol.reserveAndCheckout(
      folder,
      remote,
      7,
      pullRequestFor('f'.repeat(40)),
      true,
    )
    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('the failed add reported success')
    }
    expect(result.reason.startsWith(UI_TEXT.worktreeAddFailed)).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })

  it('keeps a folder it did not make and says so', async () => {
    const { repo } = makeRepository()
    const built = harness(repo)
    const folder = path.join(root, 'foreign-filled')
    mkdirSync(folder)
    writeFileSync(path.join(folder, 'foreign.txt'), 'not ours\n')
    const stats = lstatIdentitySync(folder)
    const made: MadeFolder = {
      folder,
      identity: identityOf(stats),
      bornNs: stats.birthtimeNs,
      hasAdded: false,
    }
    await expect(built.git.removeMade(repo, made, gatePasses)).resolves.toBe(false)
    expect(built.warnings.some((warning) => warning.includes('was left after it failed'))).toBe(
      true,
    )
    expect(existsSync(path.join(folder, 'foreign.txt'))).toBe(true)
  })

  it('warns when git cannot remove and still finishes', async () => {
    const { repo } = makeRepository()
    const built = harness(repo)
    const folder = path.join(repo, 'not-a-worktree')
    mkdirSync(folder)
    const stats = lstatIdentitySync(folder)
    const made: MadeFolder = {
      folder,
      identity: identityOf(stats),
      bornNs: stats.birthtimeNs,
      hasAdded: true,
    }
    await expect(built.git.removeMade(repo, made, gatePasses)).resolves.toBe(true)
    expect(built.warnings.some((warning) => warning.includes('was not removed by git'))).toBe(true)
    expect(existsSync(folder)).toBe(false)
  })
})

/** No answers arrive in these runs: the child dies before writing any. */
function ignoreWrite(): Promise<void> {
  return Promise.resolve()
}

function batchAnswers(): BlobAnswers {
  return new BlobAnswers([], ignoreWrite, () => new Error('unreadable answers'))
}

function batchOptions(
  signal?: AbortSignal,
  deadlineMs = 10_000,
): Parameters<typeof runBatchChild>[2] {
  return {
    deadlineMs,
    killGraceMs: 2000,
    drainGraceMs: 2000,
    platform: process.platform,
    signal: signal ?? new AbortController().signal,
    writers: new HeldWriters(),
  }
}

describe('runBatchChild', () => {
  it('rejects a child with no answers to read', async () => {
    const child = spawn(process.execPath, ['-e', ''], {
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    await expect(runBatchChild(child, batchAnswers(), batchOptions())).rejects.toThrow(
      UI_TEXT.openPullRequestUnreadable,
    )
  })

  it('rejects a child that exits uncleanly', async () => {
    const child = spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'pipe' })
    await expect(runBatchChild(child, batchAnswers(), batchOptions())).rejects.toThrow(
      UI_TEXT.openPullRequestUnreadable,
    )
  })

  it('rejects when the batch is cancelled', async () => {
    const abort = new AbortController()
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'pipe',
      signal: abort.signal,
    })
    const pending = runBatchChild(child, batchAnswers(), batchOptions(abort.signal))
    abort.abort()
    await expect(pending).rejects.toThrow()
  })

  it('fails with the launcher refusal instead of an unreadable batch', async () => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'pipe' })
    const refusal = new Error('refused at Windows GO for the test batch')
    await expect(
      runBatchChild(child, batchAnswers(), {
        ...batchOptions(),
        outcome: () => Promise.reject(refusal),
      }),
    ).rejects.toThrow('refused at Windows GO for the test batch')
  })

  // Safety limit (D121 clarification, RLF-SAFELIMITS): a batch child
  // slower than its own deadline ends the checkout with words instead of
  // running until Cancel, while a child inside its deadline runs free.
  it('ends a batch child slower than its own deadline with words', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'pipe',
    })
    await expect(
      runBatchChild(child, batchAnswers(), batchOptions(undefined, 500)),
    ).rejects.toThrow(UI_TEXT.openPullRequestUnreadable)
  })

  it('runs a batch child inside its deadline to its end', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], {
      stdio: 'pipe',
    })
    await expect(runBatchChild(child, batchAnswers(), batchOptions())).resolves.toBeUndefined()
  })
})

describe('worktree record claims', () => {
  it('keeps the maker failure on the failed claim', async () => {
    const store = createMemoryWorktreeRecordStore(process.platform)
    const folder = path.join(root, 'claimed-folder')
    const blocker = path.join(root, 'blocker-file')
    writeFileSync(blocker, 'in the way\n')
    const reserved = await store.reserve({
      folder,
      repositoryRoot: root,
      createdAt: Date.now(),
      checkoutId: 'checkout',
      pendingOwner: undefined,
      pullRequest: {
        repository: 'octocat/hello-world',
        number: 7,
        url: 'https://github.com/octocat/hello-world/pull/7',
        title: 'Title',
        author: 'octocat',
        headSha: 'a'.repeat(40),
        isAuthoredByUser: false,
      },
      isHeld: true,
      isCheckoutPending: true,
    })
    if (!reserved.ok) {
      throw new Error('the reservation did not land')
    }
    const claimed = await store.claim(reserved.reservation, () => mkdir(blocker))
    expect(claimed.status).toBe('failed')
    if (claimed.status !== 'failed') throw new Error('the claim did not fail')
    const failure = claimed.error
    expect(
      typeof failure === 'object' && failure !== null && 'code' in failure
        ? failure.code
        : undefined,
    ).toBe('EEXIST')
  })
})
