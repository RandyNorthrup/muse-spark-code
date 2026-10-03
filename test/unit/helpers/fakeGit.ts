// A fake of VS Code's git extension API (the part M71 calls,
// src/host/git/gitExtension.ts) and a GitWindow over it and the fake
// GitHub, for the M71 tests. Every call the extension makes is recorded;
// `push` records exactly the arguments it was given, so a fourth (a force
// mode) would show.

import { GitHubClient } from '../../../src/core/git/github'
import type { WorktreeHold, WorktreeRecord } from '../../../src/core/worktreeConversations'
import type {
  CommitConfirmation,
  GitWindow,
  PushConfirmation,
} from '../../../src/host/git/conversationGit'
import type {
  GitBranch,
  GitChange,
  GitCommit,
  GitRemote,
  GitRepository,
} from '../../../src/host/git/gitExtension'
import { PullRequestLinks } from '../../../src/host/git/pullRequestLinks'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, type FakeGitHub, fakeGitHub } from './fakeGitHub'
import { FakeLogOutputChannel } from './fakes'

export const REPO_ROOT = '/repo'

export interface FakeRepositoryState {
  HEAD: GitBranch | undefined
  remotes: GitRemote[]
  indexChanges: GitChange[]
  workingTreeChanges: GitChange[]
  untrackedChanges: GitChange[]
}

export interface RecordedGitCall {
  readonly method: string
  readonly args: readonly unknown[]
}

export interface FakeRepository extends GitRepository {
  readonly state: FakeRepositoryState
  readonly calls: RecordedGitCall[]
  /** Makes the next call of `method` reject with `error`. */
  failNext(method: string, error: Error): void
  diffText: string
  logEntries: GitCommit[]
}

export function change(relative: string): GitChange {
  return { uri: { fsPath: `${REPO_ROOT}/${relative}` } }
}

export const ORIGIN: GitRemote = {
  name: 'origin',
  fetchUrl: 'https://github.com/RandyNorthrup/muse-spark-code.git',
}

export function fakeRepository(state: Partial<FakeRepositoryState> = {}): FakeRepository {
  const failures = new Map<string, Error>()
  const calls: RecordedGitCall[] = []
  const full: FakeRepositoryState = {
    HEAD: { name: 'docs/how-its-built' },
    remotes: [ORIGIN],
    indexChanges: [],
    workingTreeChanges: [],
    untrackedChanges: [],
    ...state,
  }
  const run = <T>(method: string, args: readonly unknown[], result: T): Promise<T> => {
    calls.push({ method, args })
    const failure = failures.get(method)
    return failure !== undefined && failures.delete(method)
      ? Promise.reject(failure)
      : Promise.resolve(result)
  }
  const repository: FakeRepository = {
    rootUri: { fsPath: REPO_ROOT },
    state: full,
    calls,
    diffText: 'diff --git a/src/a.ts b/src/a.ts\n+export const a = 1\n',
    logEntries: [{ hash: '1'.repeat(40), message: 'Add the parser\n\nbody' }],
    failNext: (method, error) => {
      failures.set(method, error)
    },
    status: () => run('status', [], undefined),
    diff: (cached) => run('diff', [cached], repository.diffText),
    commit: (message, options) => run('commit', [message, options], undefined),
    // Rest parameters: whatever the caller passes is recorded, a force mode included.
    push: (...args: readonly unknown[]) => run('push', args, undefined),
    fetch: (options) => run('fetch', [options], undefined),
    log: (options) => run('log', [options], repository.logEntries),
    diffBetween: (ref1, ref2) =>
      run('diffBetween', [ref1, ref2], [change('src/parser.ts')] as readonly GitChange[]),
  }
  return repository
}

/** A `vscode.Memento` in memory. */
export function memoryMemento() {
  const values = new Map<string, unknown>()
  return {
    values,
    get: (key: string) => values.get(key),
    update: (key: string, value: unknown) => {
      values.set(key, value)
      return Promise.resolve()
    },
  }
}

/** Native checkout fixtures retain every shown failure for their assertions. */
export function checkoutNotices(errors: string[]) {
  return {
    showInformation: () => undefined,
    showWarning: (message: string) => {
      errors.push(message)
    },
    showError: (message: string) => {
      errors.push(message)
    },
    showFailure: (message: string, detail: string) => {
      errors.push(`${message}: ${detail}`)
    },
  }
}

export interface FakeGitWindowOptions {
  readonly repository?: FakeRepository
  readonly isTrusted?: boolean
  readonly hold?: WorktreeHold
  readonly worktree?: WorktreeRecord
  /** The push modal's answer; every confirmation is recorded. */
  readonly confirmsPush?: boolean
  readonly confirmsCommit?: boolean
  /** No GitHub sign-in: `ask` is declined, `silent` finds none. */
  readonly isSignedOut?: boolean
  readonly pickRemote?: string
  readonly github?: FakeGitHub
  /** The window refuses to admit a process that may write the workspace, with this reason. */
  readonly refusesAdmission?: string
}

export function fakeGitWindow(options: FakeGitWindowOptions = {}) {
  const repository = options.repository ?? fakeRepository()
  const github = options.github ?? fakeGitHub()
  const log = new FakeLogOutputChannel()
  const pushConfirmations: PushConfirmation[] = []
  const commitConfirmations: CommitConfirmation[] = []
  const tokenRequests: ('ask' | 'silent')[] = []
  let admissions = 0
  let trustRequests = 0
  let clock = 1000
  const window: GitWindow = {
    workspaceRoot: REPO_ROOT,
    platform: 'linux',
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    hold: () => options.hold,
    worktree: () => options.worktree,
    repository: () => Promise.resolve(repository),
    // Virtual paths: real directory identity is covered by native ownership fixtures.
    captureGitOwner: (root, check) => {
      check()
      return Promise.resolve({ cwd: root, isCurrent: () => true })
    },
    admit: (start) => {
      admissions += 1
      return options.refusesAdmission === undefined
        ? start()
        : Promise.reject(new Error(options.refusesAdmission))
    },
    githubToken: (mode) => {
      tokenRequests.push(mode)
      return Promise.resolve(options.isSignedOut === true ? undefined : FAKE_GITHUB_TOKEN)
    },
    github: new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log,
      baseUrl: FAKE_GITHUB_BASE,
    }),
    links: new PullRequestLinks(memoryMemento()),
    confirmPush: (confirmation) => {
      pushConfirmations.push(confirmation)
      return Promise.resolve(options.confirmsPush ?? true)
    },
    confirmCommit: (confirmation) => {
      commitConfirmations.push(confirmation)
      return Promise.resolve(options.confirmsCommit ?? true)
    },
    // Byte-level behavior has its own real-file-system suite; tracked diffs
    // must not also change this independent new-file fingerprint.
    untrackedFingerprint: () => Promise.resolve('fake-untracked-fingerprint'),
    // New files' contents are read from real files in gitWindowFileSystem.test.ts.
    untrackedDiff: () => Promise.resolve(''),
    pickRemote: () => Promise.resolve(options.pickRemote),
    confirmWorktreeTrust: () => {
      trustRequests += 1
      return Promise.resolve()
    },
    now: () => (clock += 1),
    log,
  }
  return {
    window,
    repository,
    github,
    log,
    pushConfirmations,
    commitConfirmations,
    tokenRequests,
    admissions: () => admissions,
    trustRequests: () => trustRequests,
  }
}
