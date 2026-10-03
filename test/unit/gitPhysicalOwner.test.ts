import { existsSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitHubClient } from '../../src/core/git/github'
import { worktreeFolder } from '../../src/core/worktrees'
import { processGitProcess, processGitRunner } from '../../src/host/git'
import { ConversationGit } from '../../src/host/git/conversationGit'
import { captureGitOwner, type GitRepository } from '../../src/host/git/gitExtension'
import { createHeldCheckout } from '../../src/host/git/heldCheckout'
import { openPullRequestInConversation } from '../../src/host/git/pullRequestCheckout'
import { untrustedGitRunner } from '../../src/host/git/untrustedGit'
import { WorktreeRegistry } from '../../src/host/git/worktreeRegistry'
import { UI_TEXT } from '../../src/shared/constants'
import { checkoutNotices, fakeGitWindow, fakeRepository, memoryMemento } from './helpers/fakeGit'
import { fakeGitHub, FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK, CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const REAL_GIT_TIMEOUT_MS = 60_000
const noChange = () => undefined
const fixture = { base: '', origin: '', first: '', foreign: '', head: '' }
const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
}
const git = processGitRunner({ env: gitEnv })
const safeGit = untrustedGitRunner(gitEnv)

async function link(target: string, selected: string) {
  await symlink(target, selected, process.platform === 'win32' ? 'junction' : 'dir')
}

async function retarget(selected: string) {
  await rename(selected, `${selected}-original`)
  await link(fixture.foreign, selected)
}

beforeAll(async () => {
  fixture.base = realpathSync.native(await mkdtemp(path.join(tmpdir(), 'muse-m71-owner-')))
  fixture.origin = path.join(fixture.base, 'origin')
  fixture.first = path.join(fixture.base, 'first')
  fixture.foreign = path.join(fixture.base, 'foreign')
  await mkdir(fixture.origin)
  await git(['init', '-b', 'main'], fixture.origin)
  await git(['config', 'user.name', 'Owned offline test'], fixture.origin)
  await git(['config', 'user.email', 'offline@example.invalid'], fixture.origin)
  await git(['config', 'commit.gpgSign', 'false'], fixture.origin)
  await writeFile(path.join(fixture.origin, 'a.txt'), 'same captured bytes\n')
  await git(['add', 'a.txt'], fixture.origin)
  await git(['commit', '-m', 'owned baseline'], fixture.origin)
  const head = await git(['rev-parse', 'HEAD'], fixture.origin)
  fixture.head = head.trim()
  await git(['update-ref', 'refs/pull/51/head', fixture.head], fixture.origin)
  await git(['clone', fixture.origin, fixture.first], fixture.base)
  await git(['clone', fixture.origin, fixture.foreign], fixture.base)
}, REAL_GIT_TIMEOUT_MS)

afterAll(async () => {
  await removeFolder(fixture.base)
})

async function checkoutThroughAlias(
  label: string,
  changeAt: 'consent' | 'native' | 'none',
  isOwn = false,
) {
  const selected = path.join(fixture.base, label)
  await link(fixture.first, selected)
  const repository: GitRepository = {
    ...fakeRepository(),
    rootUri: { fsPath: selected },
    fetch: async ({ remote, ref }) => {
      await git(['fetch', remote, ref], selected)
    },
  }
  const github = fakeGitHub()
  github.answer('GET', '/repos/RandyNorthrup/muse-spark-code/pulls/51', {
    status: 200,
    body: {
      ...CAPTURED_PULL_FORK,
      ...(isOwn && { user: CAPTURED_PULL_OWN.user }),
      head: { ...CAPTURED_PULL_FORK.head, sha: fixture.head },
    },
  })
  const opened: string[] = []
  const errors: string[] = []
  const calls: string[] = []
  const registry = new WorktreeRegistry(memoryMemento(), process.platform, existsSync)
  const observe =
    (run: typeof git, isNativeCheckout: boolean): typeof git =>
    async (args, cwd, timeout, beforeRun) => {
      calls.push(realpathSync.native(cwd))
      if (isNativeCheckout && changeAt === 'native') {
        await retarget(selected)
      }
      return await run(args, cwd, timeout, beforeRun)
    }
  await openPullRequestInConversation({
    workspaceRoot: selected,
    platform: process.platform,
    isWorkspaceTrusted: () => true,
    isHeld: () => false,
    storageRoot: path.join(fixture.base, `${label}-storage`),
    repository: () => Promise.resolve(repository),
    captureGitOwner,
    runGit: observe(git, false),
    checkOutHeld: createHeldCheckout({
      platform: process.platform,
      runGit: observe(safeGit, true),
      gitProcess: processGitProcess(),
      env: gitEnv,
      log: new FakeLogOutputChannel(),
    }),
    admit: (start) => start(),
    githubToken: () => Promise.resolve(FAKE_GITHUB_TOKEN),
    github: new GitHubClient({
      fetch: github.fetch,
      baseUrl: FAKE_GITHUB_BASE,
      userAgent: 'owned-offline-witness',
      log: new FakeLogOutputChannel(),
    }),
    registry,
    askPullRequest: () => Promise.resolve('51'),
    confirm: async () => {
      if (changeAt === 'consent') {
        await retarget(selected)
      }
      return true
    },
    pathExists: existsSync,
    openFolder: (folder) => {
      opened.push(folder)
      return Promise.resolve()
    },
    ...checkoutNotices(errors),
    now: () => 0,
    log: new FakeLogOutputChannel(),
  })
  return { opened, errors, calls, registry, selected }
}

describe('physical Git ownership (M71)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it.each(['consent', 'native'] as const)(
    'refuses a real junction retarget during %s with identical cached HEAD/remotes',
    async (changeAt) => {
      const result = await checkoutThroughAlias(`retarget-${changeAt}`, changeAt)
      expect(result.opened).toEqual([])
      expect(result.errors.join('\n')).toContain(UI_TEXT.gitOperationChanged)
      expect(result.calls.every((cwd) => cwd === fixture.first)).toBe(true)
      expect(existsSync(path.join(fixture.foreign, '.git', 'FETCH_HEAD'))).toBe(false)
      if (changeAt === 'consent') {
        expect(result.calls).toEqual([])
      }
    },
  )

  it('fetches and opens from an unchanged real alias using canonical native cwd', async () => {
    const result = await checkoutThroughAlias('unchanged', 'none')
    expect(result.errors).toEqual([])
    expect(result.opened).toHaveLength(1)
    const opened = result.opened[0] ?? ''
    // The head check, the listing and the add run in the repository; only the index is filled in the worktree.
    expect(result.calls).toEqual([
      fixture.first,
      fixture.first,
      fixture.first,
      realpathSync.native(opened),
    ])
    const head = await git(['rev-parse', 'HEAD'], opened)
    expect(head.trim()).toBe(fixture.head)
  })

  it('keeps own-PR alias folder and record names while executing Git at the canonical root', async () => {
    const result = await checkoutThroughAlias('own-alias', 'none', true)
    const destination = worktreeFolder(result.selected, 'pr-51', process.platform)
    expect(result.errors).toEqual([])
    expect(result.opened).toEqual([destination])
    expect(result.calls).toEqual([fixture.first, fixture.first])
    expect(result.registry.recordFor(destination)).toMatchObject({
      repositoryRoot: result.selected,
      isHeld: false,
      pullRequest: { number: 51, isAuthoredByUser: true },
    })
    const head = await git(['rev-parse', 'HEAD'], destination)
    expect(head.trim()).toBe(fixture.head)
  })

  it('never revives ownership after an observed alias loss and restoration', async () => {
    const selected = path.join(fixture.base, 'sticky')
    await link(fixture.first, selected)
    const owner = await captureGitOwner(selected, noChange)
    expect(owner.isCurrent()).toBe(true)
    await retarget(selected)
    expect(owner.isCurrent()).toBe(false)
    await rm(selected, { force: true })
    await rename(`${selected}-original`, selected)
    expect(realpathSync.native(selected)).toBe(fixture.first)
    expect(owner.isCurrent()).toBe(false)
  })

  it.each(['commit', 'push'] as const)(
    'refuses API %s after its real root alias changes during consent',
    async (action) => {
      const selected = path.join(fixture.base, `api-${action}`)
      await link(fixture.first, selected)
      const repository = {
        ...fakeRepository({
          HEAD: {
            name: 'main',
            commit: fixture.head,
            upstream: { remote: 'origin', name: 'main' },
            ahead: 1,
            behind: 0,
          },
          indexChanges: [{ uri: { fsPath: path.join(selected, 'a.txt') } }],
        }),
        rootUri: { fsPath: selected },
      }
      const { window } = fakeGitWindow({ repository })
      const isConfirmed = async () => {
        await retarget(selected)
        return true
      }
      const conversation = new ConversationGit(
        {
          ...window,
          workspaceRoot: selected,
          platform: process.platform,
          captureGitOwner,
          confirmCommit: isConfirmed,
          confirmPush: isConfirmed,
        },
        { sessionId: () => 'owned', post: noChange, notice: noChange, say: noChange },
      )
      try {
        if (action === 'commit') {
          await conversation.commit('Owned commit', false)
        } else {
          await conversation.handleAction('push')
        }
        expect(repository.calls.some((call) => call.method === action)).toBe(false)
        expect(realpathSync.native(selected)).toBe(fixture.foreign)
      } finally {
        conversation.dispose()
      }
    },
  )
})
