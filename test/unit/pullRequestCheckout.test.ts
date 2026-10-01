import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../../src/core/git/github'
import {
  heldWorktreeFolder,
  heldWorktreesRoot,
  holdFor,
} from '../../src/core/worktreeConversations'
import {
  confirmWorktreeTrust,
  openPullRequestInConversation,
  type PullRequestCheckoutDeps,
} from '../../src/host/git/pullRequestCheckout'
import { WindowHold, WorktreeRegistry } from '../../src/host/git/worktreeRegistry'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeRepository, type FakeRepository, memoryMemento } from './helpers/fakeGit'
import { FAKE_GITHUB_BASE, FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'
import { CAPTURED_PULL_FORK, CAPTURED_PULL_OWN } from './helpers/githubCapture'
import { GLOBAL_STATE_KEYS, UI_TEXT } from '../../src/shared/constants'
import { parseWorktreeRegistry } from '../../src/core/worktreeConversations'

const ROOT = '/repos/muse'
const STORAGE = '/home/me/.config/Code/User/globalStorage/ext'
const REPOSITORY = { owner: 'RandyNorthrup', name: 'muse-spark-code' }

interface Options {
  readonly typed?: string | undefined
  readonly confirms?: readonly boolean[]
  readonly isTrusted?: boolean
  readonly isHeld?: boolean
  readonly isSignedOut?: boolean
  readonly existing?: readonly string[]
  readonly repository?: FakeRepository
  readonly failGit?: (args: readonly string[]) => boolean
}

function setup(options: Options = {}) {
  const github = fakeGitHub()
  const repository = { ...(options.repository ?? fakeRepository()), rootUri: { fsPath: ROOT } }
  const memento = memoryMemento()
  const created = new Set<string>(options.existing)
  const registry = new WorktreeRegistry(memento, 'linux', (folder) => created.has(folder))
  const gitCalls: (readonly string[])[] = []
  const confirmations: [string, string, string][] = []
  const opened: string[] = []
  const messages: [string, string][] = []
  const recordsAtAdd: unknown[] = []
  const confirms = [...(options.confirms ?? [true])]
  const deps: PullRequestCheckoutDeps = {
    workspaceRoot: ROOT,
    platform: 'linux',
    isWorkspaceTrusted: () => options.isTrusted ?? true,
    isHeld: () => options.isHeld ?? false,
    storageRoot: STORAGE,
    repository: () => Promise.resolve(repository),
    // This virtual API fixture has no real directory; native tests capture real owners.
    captureGitOwner: (root, check) => {
      check()
      return Promise.resolve({ cwd: root, isCurrent: () => true })
    },
    runGit: (args) => {
      gitCalls.push(args)
      if (options.failGit?.(args) === true) {
        return Promise.reject(new Error(`fatal: ${args[0] ?? ''} failed`))
      }
      if (args.includes('worktree')) {
        recordsAtAdd.push(memento.values.get('museSpark.worktreeConversations'))
        created.add(String(args[5]))
      }
      const pull = options.typed?.endsWith('/56') === true ? CAPTURED_PULL_OWN : CAPTURED_PULL_FORK
      return Promise.resolve(args[0] === 'rev-parse' ? pull.head.sha : '')
    },
    githubToken: () =>
      Promise.resolve(options.isSignedOut === true ? undefined : FAKE_GITHUB_TOKEN),
    runUntrustedGit: (...args) => deps.runGit(...args),
    admit: (start) => start(),
    github: new GitHubClient({
      fetch: github.fetch,
      userAgent: 'muse-spark-code/test',
      log: new FakeLogOutputChannel(),
      baseUrl: FAKE_GITHUB_BASE,
    }),
    registry,
    askPullRequest: (validate) => {
      const typed = 'typed' in options ? options.typed : '51'
      if (typed !== undefined) {
        expect(validate(typed)).toBeUndefined()
      }
      expect(validate('not a pull request')).toBeDefined()
      return Promise.resolve(typed)
    },
    confirm: (message, detail, action) => {
      confirmations.push([message, detail, action])
      return Promise.resolve(confirms.shift() ?? false)
    },
    pathExists: (folder) => created.has(folder),
    openFolder: (folder) => {
      opened.push(folder)
      return Promise.resolve()
    },
    showInformation: (message) => {
      messages.push(['info', message])
    },
    showWarning: (message) => {
      messages.push(['warning', message])
    },
    showError: (message) => {
      messages.push(['error', message])
    },
    showFailure: (message, detail) => {
      messages.push(['error', `${message}: ${detail}`])
    },
    now: () => 42,
    log: new FakeLogOutputChannel(),
  }
  return {
    deps,
    github,
    repository,
    registry,
    memento,
    gitCalls,
    confirmations,
    opened,
    messages,
    recordsAtAdd,
    created,
  }
}

const HELD_FOLDER = heldWorktreeFolder(STORAGE, REPOSITORY, 51, 'linux')

describe('Open a pull request in a conversation (M71)', () => {
  it('admits fetch and checkout before their writer entries', async () => {
    const t = setup()
    let isAdmitted = false
    const admit = vi.spyOn(t.deps, 'admit').mockImplementation(async (start) => {
      isAdmitted = true
      try {
        return await start()
      } finally {
        isAdmitted = false
      }
    })
    const fetch = t.repository.fetch
    vi.spyOn(t.repository, 'fetch').mockImplementation((options) => {
      expect(isAdmitted).toBe(true)
      return fetch(options)
    })
    const run = t.deps.runUntrustedGit
    vi.spyOn(t.deps, 'runUntrustedGit').mockImplementation((...args) => {
      expect(isAdmitted).toBe(true)
      return run(...args)
    })
    await openPullRequestInConversation(t.deps)
    expect(admit).toHaveBeenCalledTimes(2)
    expect(t.opened).toHaveLength(1)
  })

  it.each([1, 2])('refuses the writer after trust ends in admission %i', async (stopAt) => {
    const t = setup()
    let entries = 0
    vi.spyOn(t.deps, 'admit').mockImplementation((start) => {
      entries += 1
      if (entries === stopAt) {
        vi.spyOn(t.deps, 'isWorkspaceTrusted').mockReturnValue(false)
      }
      return start()
    })
    await openPullRequestInConversation(t.deps)
    expect(t.repository.calls.filter((call) => call.method === 'fetch')).toHaveLength(stopAt - 1)
    expect(t.gitCalls.some((args) => args.includes('worktree'))).toBe(false)
    expect(t.opened).toEqual([])
    expect(
      parseWorktreeRegistry(t.memento.values.get(GLOBAL_STATE_KEYS.worktreeConversations)),
    ).toEqual([])
    expect(t.messages.at(-1)?.[1]).toContain(UI_TEXT.gitRestricted)
  })

  it('refuses checkout after its captured owner is lost in admission', async () => {
    const t = setup()
    let isOwned = true
    let entries = 0
    vi.spyOn(t.deps, 'captureGitOwner').mockImplementation((root) =>
      Promise.resolve({ cwd: root, isCurrent: () => isOwned }),
    )
    vi.spyOn(t.deps, 'admit').mockImplementation((start) => {
      entries += 1
      if (entries === 2) isOwned = false
      return start()
    })
    await openPullRequestInConversation(t.deps)
    expect(t.repository.calls.filter((call) => call.method === 'fetch')).toHaveLength(1)
    expect(t.gitCalls.some((args) => args.includes('worktree'))).toBe(false)
    expect(t.opened).toEqual([])
    expect(t.messages.at(-1)?.[1]).toContain(UI_TEXT.gitOperationChanged)
  })

  it('serializes registry updates before a held memento publication without losing either pending record', async () => {
    const memento = memoryMemento()
    const entered = Promise.withResolvers<undefined>()
    const published = Promise.withResolvers<undefined>()
    let writes = 0
    const registry = new WorktreeRegistry(
      {
        get: memento.get,
        update: async (key, value) => {
          writes += 1
          if (writes === 1) {
            entered.resolve(undefined)
            await published.promise
          }
          await memento.update(key, value)
        },
      },
      'linux',
      () => false,
    )
    const first = registry.put({
      folder: '/pending/pr',
      repositoryRoot: ROOT,
      createdAt: 1,
      isHeld: true,
    })
    await entered.promise
    const second = registry.put({
      folder: '/pending/topic',
      repositoryRoot: ROOT,
      createdAt: 2,
      isHeld: false,
    })
    try {
      await Promise.resolve()
      expect(writes).toBe(1)
    } finally {
      published.resolve(undefined)
      await Promise.all([first, second])
    }
    expect(
      parseWorktreeRegistry(memento.get(GLOBAL_STATE_KEYS.worktreeConversations)).map(
        (record) => record.folder,
      ),
    ).toEqual(['/pending/pr', '/pending/topic'])
    expect(registry.records()).toEqual([])
    await registry.remove('/pending/topic')
    expect(
      parseWorktreeRegistry(memento.get(GLOBAL_STATE_KEYS.worktreeConversations)),
    ).toMatchObject([{ folder: '/pending/pr', isHeld: true }])
  })

  it.each([false, true])(
    'preserves a pending PR record across a concurrent ordinary-worktree put; checkout failure=%s',
    async (isFailed) => {
      const t = setup()
      const held = Promise.withResolvers<undefined>()
      const started = Promise.withResolvers<undefined>()
      const ordinary = '/repos/muse.worktrees/topic'
      const running = openPullRequestInConversation({
        ...t.deps,
        runUntrustedGit: async (...args) => {
          started.resolve(undefined)
          await held.promise
          if (isFailed) throw new Error('Owned checkout failed')
          return await t.deps.runUntrustedGit(...args)
        },
      })
      await started.promise
      expect(t.registry.records()).toEqual([])
      t.created.add(ordinary)
      await t.registry.put({
        folder: ordinary,
        repositoryRoot: ROOT,
        branch: 'topic',
        createdAt: 43,
        isHeld: false,
      })
      const pending = parseWorktreeRegistry(t.memento.get(GLOBAL_STATE_KEYS.worktreeConversations))
      expect(pending.map((record) => record.folder)).toEqual([HELD_FOLDER, ordinary])
      expect(
        holdFor([HELD_FOLDER], [heldWorktreesRoot(STORAGE, 'linux')], pending, 'linux'),
      ).toMatchObject({
        folder: HELD_FOLDER,
        pullRequest: { number: 51 },
      })
      held.resolve(undefined)
      await running
      expect(t.registry.recordFor(ordinary)?.branch).toBe('topic')
      if (isFailed) {
        expect(
          parseWorktreeRegistry(t.memento.get(GLOBAL_STATE_KEYS.worktreeConversations)),
        ).toHaveLength(1)
        expect(t.opened).toEqual([])
      } else {
        expect(t.registry.recordFor(HELD_FOLDER)).toMatchObject({
          isHeld: true,
          pullRequest: { number: 51 },
        })
        expect(
          holdFor(
            [HELD_FOLDER],
            [heldWorktreesRoot(STORAGE, 'linux')],
            t.registry.records(),
            'linux',
          ),
        ).toBeDefined()
        expect(t.confirmations[0]?.[1]).toContain(UI_TEXT.openPullRequestUnfilteredDetail)
      }
    },
  )

  it('refuses a different fetched head even when the approved commit might already exist', async () => {
    const t = setup()
    let adds = 0
    await openPullRequestInConversation({
      ...t.deps,
      runGit: (args) => {
        if (args.includes('worktree')) {
          adds += 1
        }
        return Promise.resolve('1'.repeat(40))
      },
    })
    expect(adds).toBe(0)
    expect(t.registry.records()).toEqual([])
    expect(t.opened).toEqual([])
    expect(t.messages.at(-1)?.[1]).toContain('could not be fetched')
  })

  it('runs no fetch when trust or its remote changes while the checkout modal waits', async () => {
    for (const changed of ['trust', 'remote']) {
      const t = setup()
      let isTrusted = true
      await openPullRequestInConversation({
        ...t.deps,
        isWorkspaceTrusted: () => isTrusted,
        confirm: () => {
          if (changed === 'trust') {
            isTrusted = false
          } else {
            t.repository.state.remotes = [
              { name: 'origin', fetchUrl: 'https://github.com/other/repo.git' },
            ]
          }
          return Promise.resolve(true)
        },
      })
      expect(t.repository.calls.some((call) => call.method === 'fetch')).toBe(false)
      expect(t.gitCalls).toEqual([])
      expect(t.opened).toEqual([])
    }
  })

  it("checks someone else's pull request out under the extension's storage, held, in a new window", async () => {
    const t = setup()
    await openPullRequestInConversation(t.deps)
    expect(t.confirmations[0]?.[0]).toBe('Open pull request #51 in a new window?')
    expect(t.confirmations[0]?.[1]).toContain('By Piangpi1997')
    expect(t.confirmations[0]?.[1]).toContain(
      'From Piangpi1997/muse-spark-code:android-termux-p0-tests into main',
    )
    expect(t.confirmations[0]?.[1]).toContain('Plan mode')
    // Fetched through VS Code's git extension, so the user's credentials apply.
    expect(t.repository.calls.find((call) => call.method === 'fetch')?.args).toEqual([
      { remote: 'origin', ref: 'pull/51/head' },
    ])
    expect(t.gitCalls).toEqual([
      ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'],
      [
        '-c',
        'core.hooksPath=/dev/null',
        'worktree',
        'add',
        '--detach',
        HELD_FOLDER,
        CAPTURED_PULL_FORK.head.sha,
      ],
    ])
    expect(HELD_FOLDER.startsWith(`${STORAGE}/pr-worktrees/`)).toBe(true)
    const record = t.registry.recordFor(HELD_FOLDER)
    expect(record).toMatchObject({
      folder: HELD_FOLDER,
      repositoryRoot: ROOT,
      isHeld: true,
      pullRequest: {
        repository: 'RandyNorthrup/muse-spark-code',
        number: 51,
        author: 'Piangpi1997',
        headSha: CAPTURED_PULL_FORK.head.sha,
        isAuthoredByUser: false,
      },
    })
    expect(record?.trustConfirmedAt).toBeUndefined()
    // Recorded before the folder exists: no window ever opens on it unrecorded.
    expect(t.recordsAtAdd[0]).toEqual([record])
    expect(t.opened).toEqual([HELD_FOLDER])
    expect(t.messages.at(-1)?.[1]).toContain('held until you trust it')
    // The window that opens there is held, whatever VS Code trusts.
    expect(
      holdFor([HELD_FOLDER], [heldWorktreesRoot(STORAGE, 'linux')], t.registry.records(), 'linux'),
    ).toBeDefined()
  })

  it('checks the user’s own pull request out beside the repository, not held', async () => {
    const t = setup({ typed: 'https://github.com/RandyNorthrup/muse-spark-code/pull/56' })
    await openPullRequestInConversation(t.deps)
    const folder = path.posix.join('/repos', 'muse.worktrees', 'pr-56')
    expect(t.gitCalls.at(-1)).toEqual([
      '-c',
      'core.hooksPath=/dev/null',
      'worktree',
      'add',
      '--detach',
      folder,
      CAPTURED_PULL_OWN.head.sha,
    ])
    expect(t.registry.recordFor(folder)).toMatchObject({
      isHeld: false,
      pullRequest: { number: 56, isAuthoredByUser: true },
    })
    expect(t.confirmations[0]?.[1]).toContain('Your own pull request')
  })

  it('does nothing past a declined confirmation, a dismissed box or a declined sign-in', async () => {
    const declined = setup({ confirms: [false] })
    await openPullRequestInConversation(declined.deps)
    const dismissed = setup({ typed: undefined })
    await openPullRequestInConversation(dismissed.deps)
    const signedOut = setup({ isSignedOut: true })
    await openPullRequestInConversation(signedOut.deps)
    for (const t of [declined, dismissed, signedOut]) {
      expect(t.gitCalls).toEqual([])
      expect(t.repository.calls.some((call) => call.method === 'fetch')).toBe(false)
      expect(t.registry.records()).toEqual([])
      expect(t.opened).toEqual([])
    }
    expect(dismissed.github.requests).toEqual([])
    expect(signedOut.github.requests).toEqual([])
  })

  it('is unavailable in Restricted Mode and in a held window, and says why', async () => {
    const restricted = setup({ isTrusted: false })
    await openPullRequestInConversation(restricted.deps)
    const held = setup({ isHeld: true })
    await openPullRequestInConversation(held.deps)
    for (const t of [restricted, held]) {
      expect(t.repository.calls).toEqual([])
      expect(t.github.requests).toEqual([])
      expect(t.messages[0]?.[0]).toBe('warning')
    }
    expect(restricted.messages[0]?.[1]).toContain('Restricted Mode')
  })

  it('refuses a page of a repository no remote points at', async () => {
    const t = setup({ typed: 'https://github.com/microsoft/vscode/pull/1' })
    await openPullRequestInConversation(t.deps)
    expect(t.messages).toEqual([
      ['warning', 'No remote of this repository points at microsoft/vscode.'],
    ])
    expect(t.github.requests).toEqual([])
  })

  it('keeps no record when the fetch or the checkout fails', async () => {
    const fetchFails = setup({ failGit: (args) => args[0] === 'rev-parse' })
    await openPullRequestInConversation(fetchFails.deps)
    expect(fetchFails.messages.at(-1)?.[1]).toContain('could not be fetched')
    expect(fetchFails.registry.records()).toEqual([])
    const checkoutFails = setup({ failGit: (args) => args.includes('worktree') })
    await openPullRequestInConversation(checkoutFails.deps)
    expect(checkoutFails.messages.at(-1)?.[1]).toContain('could not create the worktree')
    expect(checkoutFails.registry.records()).toEqual([])
    expect(checkoutFails.opened).toEqual([])
  })

  it('offers a pull request checked out before, and never takes over a folder it did not make', async () => {
    const t = setup()
    await openPullRequestInConversation(t.deps)
    const again = { ...t.deps, confirm: () => Promise.resolve(true) }
    await openPullRequestInConversation(again)
    expect(t.opened).toEqual([HELD_FOLDER, HELD_FOLDER])
    expect(t.gitCalls.filter((args) => args.includes('worktree'))).toHaveLength(1)
    const stranger = setup({ existing: [HELD_FOLDER] })
    await openPullRequestInConversation(stranger.deps)
    expect(stranger.opened).toEqual([])
    expect(stranger.messages.at(-1)).toEqual([
      'error',
      `That folder already exists: ${HELD_FOLDER}`,
    ])
  })
})

/** A held window, a pull request checked out, and the card's question answered `isTrusted`. */
function trustSetup(isTrusted: boolean) {
  const t = setup()
  const hold = new WindowHold({ folder: HELD_FOLDER, pullRequest: undefined })
  let restarts = 0
  let released = 0
  const run = async () => {
    await openPullRequestInConversation(t.deps)
    await confirmWorktreeTrust({
      hold,
      registry: t.registry,
      workspaceRoot: HELD_FOLDER,
      confirm: (message, detail) => {
        t.confirmations.push([message, detail, ''])
        return Promise.resolve(isTrusted)
      },
      restartBackends: () => {
        restarts += 1
        return Promise.resolve()
      },
      holdReleased: () => {
        released += 1
      },
      now: () => 99,
      log: new FakeLogOutputChannel(),
    })
  }
  return { t, hold, run, restarts: () => restarts, released: () => released }
}

describe("the held card's trust confirmation (M71)", () => {
  it('keeps project configuration off while held even when VS Code trusts the folder', () => {
    const hold = new WindowHold({ folder: HELD_FOLDER, pullRequest: undefined })
    expect(hold.allowsProjectConfiguration(true)).toBe(false)
    expect(hold.allowsProjectConfiguration(false)).toBe(false)
    hold.release()
    expect(hold.allowsProjectConfiguration(false)).toBe(false)
    expect(hold.allowsProjectConfiguration(true)).toBe(true)
  })

  it('asks, then records the trust, lets the hold go and restarts the backends', async () => {
    const s = trustSetup(true)
    await s.run()
    expect(s.t.confirmations.at(-1)?.[1]).toContain('Other extensions follow VS Code')
    expect(s.hold.isHeld).toBe(false)
    expect(s.t.registry.recordFor(HELD_FOLDER)).toMatchObject({
      isHeld: false,
      trustConfirmedAt: 99,
    })
    expect(s.restarts()).toBe(1)
    expect(s.released()).toBe(1)
    expect(
      holdFor(
        [HELD_FOLDER],
        [heldWorktreesRoot(STORAGE, 'linux')],
        s.t.registry.records(),
        'linux',
      ),
    ).toBeUndefined()
  })

  it('keeps everything held when the user says no', async () => {
    const s = trustSetup(false)
    await s.run()
    expect(s.hold.isHeld).toBe(true)
    expect(s.t.registry.recordFor(HELD_FOLDER)?.trustConfirmedAt).toBeUndefined()
    expect(s.restarts()).toBe(0)
    expect(s.released()).toBe(0)
  })
})
