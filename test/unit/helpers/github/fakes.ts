// In-memory stand-ins for M123's contracts (PLAN.md D104), for the lanes
// that build on them: a token source that hands out a test's canary, the
// runtime's pull request link store, the fake `gh` and a RuntimeGitDeps
// with every editor call recorded.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'
import { resolveExecutable } from '../../../../src/core/executables'
import { PULL_REQUEST_LINKS_KEPT } from '../../../../src/shared/constants'
import type {
  PullRequestLinkRecord,
  PullRequestLinkStore,
  RuntimeGitDeps,
  RuntimePushConfirmation,
} from '../../../../src/core/git/runtimeGit'
import type {
  GitHubCredential,
  GitHubTokenSource,
  GitHubTokenSourceKind,
} from '../../../../src/core/git/tokenSource'

export interface FakeTokenSource extends GitHubTokenSource {
  /** The modes each `credential` call came with, in order. */
  readonly asked: ('ask' | 'silent')[]
  readonly rejectedBearers: string[]
  signedOut: boolean
}

/**
 * A source that has `bearer` on `silent` when `isSignedIn`, and on `ask`
 * always (the user signs in). `expiresAt` is passed through.
 */
export function fakeTokenSource(
  kind: GitHubTokenSourceKind,
  options: {
    readonly bearer: string
    readonly isSignedIn: boolean
    readonly expiresAt?: number
    readonly fetch?: typeof fetch
  },
): FakeTokenSource {
  let isSignedIn = options.isSignedIn
  const source: FakeTokenSource = {
    kind,
    asked: [],
    rejectedBearers: [],
    signedOut: false,
    credential: (mode) => {
      source.asked.push(mode)
      if (mode === 'ask') {
        isSignedIn = true
      }
      const credential: GitHubCredential = {
        source: kind,
        bearer: options.bearer,
        fetch: options.fetch ?? fetch,
        expiresAt: options.expiresAt,
      }
      return Promise.resolve(isSignedIn ? credential : undefined)
    },
    rejected: (credential) => {
      source.rejectedBearers.push(credential.bearer)
      isSignedIn = false
      return Promise.resolve()
    },
    signOut: () => {
      source.signedOut = true
      isSignedIn = false
      return Promise.resolve()
    },
  }
  return source
}

/** The link store's contract in memory: per repository root, the newest PULL_REQUEST_LINKS_KEPT. */
export function fakePullRequestLinkStore(): PullRequestLinkStore {
  const roots = new Map<string, Map<string, PullRequestLinkRecord>>()
  return {
    get: (root, sessionId) => Promise.resolve(roots.get(root)?.get(sessionId)),
    set: (root, sessionId, link) => {
      const links = new Map(roots.get(root))
      links.set(sessionId, link)
      roots.set(
        root,
        new Map(
          [...links]
            .toSorted(([, left], [, right]) => right.linkedAt - left.linkedAt)
            .slice(0, PULL_REQUEST_LINKS_KEPT),
        ),
      )
      return Promise.resolve()
    },
  }
}

/**
 * How a test starts the fake `gh`: Node with the script, since a `.mjs`
 * is not executable on Windows. The source under test takes the resolved
 * command and its leading arguments from the test.
 */
export function fakeGhInvocation(): { readonly command: string; readonly args: readonly string[] } {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL('../../../fixtures/github/fake-gh.mjs', import.meta.url))],
  }
}

/** The fake `gh`'s FAKE_GH_STATE for these accounts, `active` signed in. */
export function fakeGhState(accounts: Readonly<Record<string, string>>, active?: string): string {
  return JSON.stringify({ accounts, ...(active !== undefined && { active }) })
}

function quiet(): void {
  // The fake adapter's log keeps nothing.
}

export interface EditorCalls {
  readonly terminals: { readonly command: readonly string[]; readonly cwd: string }[]
  readonly folders: string[]
  readonly externals: string[]
  /** Every push modal shown, in order; the fake answers yes unless a test overrides it. */
  readonly confirmations: RuntimePushConfirmation[]
  /** Every remote pick shown, with its choices. */
  readonly remotePicks: (readonly string[])[]
}

/** RuntimeGitDeps for `repositoryRoot`, every editor call recorded in `calls`. */
export function fakeRuntimeGitDeps(
  repositoryRoot: string,
  overrides: Partial<RuntimeGitDeps> = {},
): { readonly deps: RuntimeGitDeps; readonly calls: EditorCalls } {
  const calls: EditorCalls = {
    terminals: [],
    folders: [],
    externals: [],
    confirmations: [],
    remotePicks: [],
  }
  const deps: RuntimeGitDeps = {
    repositoryRoot,
    // Found on PATH by the child process; a test that checks resolution passes its own.
    gitPath: 'git',
    tokenSources: [],
    links: fakePullRequestLinkStore(),
    isTrusted: () => true,
    confirmPush: (confirmation) => {
      calls.confirmations.push(confirmation)
      return Promise.resolve(true)
    },
    pickRemote: (names) => {
      calls.remotePicks.push(names)
      return Promise.resolve(undefined)
    },
    userEnvironment: () => process.env,
    openInTerminal: (command, cwd) => {
      calls.terminals.push({ command, cwd })
      return Promise.resolve()
    },
    openFolder: (folder) => {
      calls.folders.push(folder)
      return Promise.resolve()
    },
    openExternal: (url) => {
      calls.externals.push(url)
      return Promise.resolve()
    },
    dataFolder: `${repositoryRoot}/.fake-runtime-data`,
    userAgent: 'muse-spark-code/0.0.0-test',
    signal: new AbortController().signal,
    log: { trace: quiet, info: quiet, warn: quiet, error: quiet },
    ...overrides,
  }
  return { deps, calls }
}

/** One scratch home per test process, removed when it exits. */
const isolated: { home?: string } = {}

/** The identity every native Git test commits as (RVM123G2 R12). */
export const TEST_GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
} as const

/**
 * Makes this process's Git, which the service reads from `process.env`,
 * the test's own (RVM123G2 R12): its identity, an empty global
 * configuration, no system one, and a scratch home, so nothing depends on
 * the machine's Git. Undo with `vi.unstubAllEnvs()`.
 */
export function isolateGitEnvironment(): void {
  if (isolated.home === undefined) {
    const made = mkdtempSync(path.join(tmpdir(), 'm123-git-home-'))
    writeFileSync(path.join(made, 'gitconfig'), '')
    process.once('exit', () => {
      rmSync(made, { recursive: true, force: true })
    })
    isolated.home = made
  }
  const home = isolated.home
  const variables = {
    ...TEST_GIT_IDENTITY,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, 'gitconfig'),
    HOME: home,
    XDG_CONFIG_HOME: home,
  }
  for (const [name, value] of Object.entries(variables)) {
    vi.stubEnv(name, value)
  }
}

/** The host's git, resolved absolutely: the only git a native test runs. */
export function hostGitPath(): string {
  const found = resolveExecutable('git', {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
  if (found === undefined) {
    throw new Error('the tests need git on PATH')
  }
  return found
}

/**
 * A scratch repository with `a.txt` committed (`Add a`) and changed since,
 * unstaged; its git runs as the test's own identity.
 */
export function dirtyScratchRepository(prefix: string): {
  readonly dir: string
  readonly cleanup: () => void
} {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  const env = { ...process.env, ...TEST_GIT_IDENTITY, GIT_CONFIG_NOSYSTEM: '1' }
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, env })
  }
  git('init', '-q', '-b', 'main')
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  git('add', 'a.txt')
  git('commit', '-q', '-m', 'Add a')
  writeFileSync(path.join(dir, 'a.txt'), 'two\n')
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
