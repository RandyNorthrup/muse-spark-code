import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  conversationGitLoader,
  isConversationGitBundle,
} from '../../src/host/git/conversationGitBundle'
import { CONVERSATION_GIT_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import { GitHubError } from '../../src/core/git/github'
import { GitUnavailableError } from '../../src/host/git/gitExtension'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { fakeGitWindow } from './helpers/fakeGit'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const built = { folder: '', file: '' }

beforeAll(async () => {
  built.folder = mkdtempSync(path.join(tmpdir(), 'muse-git-bundle-'))
  built.file = path.join(built.folder, CONVERSATION_GIT_BUNDLE_FILE)
  const vscodeFolder = path.join(built.folder, 'node_modules', 'vscode')
  mkdirSync(vscodeFolder, { recursive: true })
  writeFileSync(path.join(vscodeFolder, 'index.js'), 'module.exports = {}\n')
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

describe('conversation Git bundle', () => {
  it('refuses missing or malformed factories and retries a repaired module', () => {
    for (const value of [undefined, null, {}, { createConversationGit: true }]) {
      expect(isConversationGitBundle(value)).toBe(false)
    }
    const module = { createConversationGit: vi.fn() }
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

  it('ships the factory as a CommonJS module', () => {
    expect(readFileSync(built.file, 'utf8')).toContain('createConversationGit')
    const load = conversationGitLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })
    expect(typeof load().createConversationGit).toBe('function')
  })

  it('preserves sign-in errors thrown by the activation-side GitHub client', async () => {
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
})
