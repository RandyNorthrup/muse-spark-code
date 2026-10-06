import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  conversationGitFactory,
  conversationGitLoader,
  gitFeaturesLoader,
  isConversationGitBundle,
  openPullRequestInConversation,
} from '../../src/host/git/conversationGitBundle'
import type { GitFeaturesDeps, GitWindowFeatures } from '../../src/host/git/gitWindow'
import { WindowHold, WorktreeRegistry } from '../../src/host/git/worktreeRegistry'
import {
  CONVERSATION_GIT_BUNDLE_FILE,
  UI_TEXT,
  WORKSPACE_STATE_KEYS,
} from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { GitHubError } from '../../src/core/git/github'
import { GitUnavailableError } from '../../src/host/git/gitExtension'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { fakeGitWindow, memoryMemento } from './helpers/fakeGit'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }

// The bundle's VS Code: a trusted workspace and a GitHub session, nothing else.
const VSCODE_STUB = `module.exports = {
  workspace: { isTrusted: true },
  authentication: { getSession: async () => ({ accessToken: 'marker-token' }) },
}
`

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-git-bundle-'))
  built.file = path.join(built.folder, CONVERSATION_GIT_BUNDLE_FILE)
  const vscodeFolder = path.join(built.folder, 'node_modules', 'vscode')
  mkdirSync(vscodeFolder, { recursive: true })
  writeFileSync(path.join(vscodeFolder, 'index.js'), VSCODE_STUB)
  await build({
    entryPoints: ['src/host/git/conversationGitEntry.ts'],
    outfile: built.file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    target: 'node20.18',
    logLevel: 'silent',
  })
})

afterAll(() => removeFolder(built.folder))

/** No git runs in these tests. */
function unused(): Promise<never> {
  return Promise.reject(new Error('not in this test'))
}

/** Activation's primitives as `createGitFeatures` takes them, over a fake GitHub answer. */
function featuresDeps(fetch: GitFeaturesDeps['fetch']): GitFeaturesDeps {
  return {
    workspaceRoot: '/repo',
    storageRoot: '/storage',
    hold: new WindowHold(undefined),
    registry: new WorktreeRegistry(memoryMemento(), 'linux', () => true),
    workspaceState: memoryMemento(),
    fetch,
    userAgent: 'muse-spark-code/test',
    runGit: unused,
    gitProcess: unused,
    env: {},
    isCurrent: () => true,
    admit: (start) => start(),
    restartBackends: () => Promise.resolve(),
    holdReleased: () => undefined,
    log: new FakeLogOutputChannel(),
  }
}

describe('conversation Git bundle', () => {
  it('refuses missing or malformed factories and retries a repaired module', () => {
    for (const value of [
      undefined,
      null,
      {},
      { createConversationGit: true },
      // The window's features ship in the same bundle: an adapter alone is not it.
      { createConversationGit: vi.fn() },
      { createConversationGit: vi.fn(), createGitFeatures: true },
    ]) {
      expect(isConversationGitBundle(value)).toBe(false)
    }
    const module = { createConversationGit: vi.fn(), createGitFeatures: vi.fn() }
    const loadBundle = vi.fn<() => unknown>()
    loadBundle.mockImplementationOnce(() => {
      throw new Error('Missing module')
    })
    loadBundle.mockReturnValueOnce({})
    loadBundle.mockReturnValue(module)
    const load = conversationGitLoader({
      bundlePath: '/dist/conversationGit.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(() => load()).toThrow(UI_TEXT.gitUnavailable)
    expect(() => load()).toThrow(UI_TEXT.gitUnavailable)
    expect(load()).toBe(module)
    expect(load()).toBe(module)
    expect(loadBundle).toHaveBeenCalledTimes(3)
  })

  it('constructs the shipped adapter with its handed language and preserves restricted-mode refusal', async () => {
    const load = conversationGitLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    const t = fakeGitWindow({ isTrusted: false })
    const notice = vi.fn()
    const git = load().createConversationGit(
      t.window,
      { post: vi.fn(), notice, say: notice, sessionId: () => 'session' },
      { ...UI_TEXT, gitRestricted: 'Marker restricted.' },
      uiLocale(),
      { GitHubError, GitUnavailableError },
    )
    await git.handleAction('openCommit')
    expect(notice).toHaveBeenCalledWith('warning', 'Marker restricted.')
    expect(t.repository.calls).toEqual([])
    expect(t.tokenRequests).toEqual([])
    git.dispose()
  })

  it('ships both factories as a CommonJS module', () => {
    const text = readFileSync(built.file, 'utf8')
    expect(text).toContain('createConversationGit')
    expect(text).toContain('createGitFeatures')
    const load = conversationGitLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    expect(typeof load().createConversationGit).toBe('function')
    expect(typeof load().createGitFeatures).toBe('function')
  })

  it('preserves sign-in errors of a window built from another module copy when handed its constructors', async () => {
    const t = fakeGitWindow()
    await t.window.links.set('session', {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 1,
      url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/1',
      title: 'PR',
      linkedAt: 1,
    })
    vi.spyOn(t.window.github, 'pullRequest').mockRejectedValue(
      new GitHubError('Marker sign-in.', 'signIn', undefined),
    )
    const posted: HostToWebviewMessage[] = []
    const git = conversationGitLoader({
      bundlePath: built.file,
      log: t.log,
    })().createConversationGit(
      t.window,
      {
        post: (message) => {
          posted.push(message)
        },
        notice: vi.fn(),
        say: vi.fn(),
        sessionId: () => 'session',
      },
      UI_TEXT,
      uiLocale(),
      { GitHubError, GitUnavailableError },
    )
    git.sessionChanged('session')
    await git.handleAction('refreshPullRequest')
    expect(
      posted.findLast((message) => message.type === 'gitState')?.state.pullRequest,
    ).toMatchObject({ problem: 'Marker sign-in.', needsSignIn: true })
    git.dispose()
  })

  it("recognises the sign-in errors of the bundle's own GitHub client through activation's wiring", async () => {
    const fetch = vi.fn<GitFeaturesDeps['fetch']>(() =>
      Promise.resolve(Response.json({ message: 'Marker bad credentials' }, { status: 401 })),
    )
    const deps = featuresDeps(fetch)
    await deps.workspaceState.update(WORKSPACE_STATE_KEYS.pullRequestLinks, {
      session: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 1,
        url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/1',
        title: 'PR',
        linkedAt: 1,
      },
    })
    const load = conversationGitLoader({ bundlePath: built.file, log: deps.log })
    const posted: HostToWebviewMessage[] = []
    const git = conversationGitFactory(
      load,
      gitFeaturesLoader(load, deps),
    )({
      post: (message) => {
        posted.push(message)
      },
      notice: vi.fn(),
      say: vi.fn(),
      sessionId: () => 'session',
    })
    git.sessionChanged('session')
    await git.handleAction('refreshPullRequest')
    expect(fetch).toHaveBeenCalled()
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/RandyNorthrup/muse-spark-code/pulls/1',
    )
    expect(
      posted.findLast((message) => message.type === 'gitState')?.state.pullRequest,
    ).toMatchObject({ problem: 'Marker bad credentials', needsSignIn: true })
    git.dispose()
  })

  it('makes the window features once, in the installed language, and tries a failed load again', () => {
    const features = { window: fakeGitWindow().window } as unknown as GitWindowFeatures
    const createGitFeatures = vi.fn(() => features)
    const bundle = vi.fn()
    bundle.mockImplementationOnce(() => {
      throw new Error(UI_TEXT.gitUnavailable)
    })
    bundle.mockReturnValue({ createConversationGit: vi.fn(), createGitFeatures })
    const deps = featuresDeps(vi.fn())
    const load = gitFeaturesLoader(bundle, deps)
    expect(bundle).not.toHaveBeenCalled()
    expect(() => load()).toThrow(UI_TEXT.gitUnavailable)
    expect(load()).toBe(features)
    expect(load()).toBe(features)
    expect(createGitFeatures).toHaveBeenCalledTimes(1)
    expect(createGitFeatures).toHaveBeenCalledWith(deps, UI_TEXT, uiLocale())
  })

  it('refuses the pull request command with Git’s unavailable error when the bundle cannot load', async () => {
    const showError = vi.fn()
    await expect(
      openPullRequestInConversation(() => {
        throw new Error(UI_TEXT.gitUnavailable)
      }, showError),
    ).resolves.toBeUndefined()
    expect(showError).toHaveBeenCalledExactlyOnceWith(UI_TEXT.gitUnavailable)
    const open = vi.fn(() => Promise.resolve())
    await openPullRequestInConversation(
      () => ({ window: fakeGitWindow().window, openPullRequestInConversation: open }),
      showError,
    )
    expect(open).toHaveBeenCalledOnce()
    expect(showError).toHaveBeenCalledOnce()
  })
})
