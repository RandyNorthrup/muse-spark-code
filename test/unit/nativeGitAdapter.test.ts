// The panel adapter's failure paths, proved on real repositories behind a
// recording surface: every failure reaches the person in the panel's own
// words (git's words redacted first), and every form comes back answered.
// The surface records what the person would see; it answers nothing, so
// every failure below is the real service and the real git failing.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GitSurface } from '../../src/host/conversation/conversationController'
import { createMemoryPullRequestLinkStore } from '../../src/core/git/pullRequestLinksStore'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'
import type { CoreLogger } from '../../src/core/logging'
import { RuntimeGit } from '../../src/runtime/panel/git/adapter'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { neverCalled, testGit } from './helpers/nativeGitHarness'

const quiet = (): void => undefined

const root = mkdtempSync(path.join(tmpdir(), 'm123-native-adapter-'))
const dataFolder = mkdtempSync(path.join(root, 'data-'))
const git = testGit(root)

function makeRepository(): string {
  return git.makeRepository().repo
}

/** What the person would see: notices, panel speech and posted state. */
class RecordingSurface implements GitSurface {
  readonly notices: { level: string; text: string }[] = []
  readonly said: { level: string; text: string }[] = []
  readonly posts: HostToWebviewMessage[] = []
  post(message: HostToWebviewMessage): void {
    this.posts.push(message)
  }
  notice(level: 'info' | 'warning' | 'error', text: string): void {
    this.notices.push({ level, text })
  }
  say(level: 'warning' | 'error', text: string): void {
    this.said.push({ level, text })
  }
  sessionId(): string | undefined {
    return undefined
  }
}

interface Harness {
  readonly adapter: RuntimeGit
  readonly surface: RecordingSurface
  readonly terminals: { command: readonly string[]; cwd: string }[]
  revokeTrust: () => void
}

function harness(
  repositoryRoot: string,
  shouldConfirm: () => Promise<boolean>,
  onWarn: (message: string) => void = quiet,
): Harness {
  const surface = new RecordingSurface()
  const terminals: Harness['terminals'] = []
  let isTrusted = true
  const testLog: CoreLogger = {
    trace: quiet,
    info: quiet,
    warn: (message: string) => {
      onWarn(message)
    },
    error: quiet,
  }
  const deps: RuntimeGitDeps = {
    repositoryRoot,
    gitPath: git.git,
    tokenSources: [],
    links: createMemoryPullRequestLinkStore(),
    isTrusted: () => isTrusted,
    confirmPush: () => shouldConfirm(),
    pickRemote: neverCalled('pickRemote'),
    userEnvironment: () => process.env,
    openInTerminal: (command, cwd) => {
      terminals.push({ command, cwd })
      return Promise.resolve()
    },
    openFolder: neverCalled('openFolder'),
    openExternal: neverCalled('openExternal'),
    dataFolder,
    userAgent: 'native-git-adapter-test',
    signal: new AbortController().signal,
    log: testLog,
  }
  return {
    adapter: new RuntimeGit(surface, deps),
    surface,
    terminals,
    revokeTrust: () => {
      isTrusted = false
    },
  }
}

function noticesOf(surface: RecordingSurface, level: string): string[] {
  return surface.notices.filter((notice) => notice.level === level).map((notice) => notice.text)
}

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('RuntimeGit form failures', () => {
  it('says the repository changed when the form opens on a swept root', async () => {
    const repo = makeRepository()
    const { adapter, surface } = harness(repo, () => Promise.resolve(false))
    rmSync(repo, { recursive: true, force: true })
    await adapter.handleAction('openCommit')
    expect(noticesOf(surface, 'warning')).toContain(UI_TEXT.gitOperationChanged)
  })

  it('answers the commit as failed when the root is swept after the form opens', async () => {
    const repo = makeRepository()
    writeFileSync(path.join(repo, 'note.txt'), 'pending\n')
    const { adapter, surface } = harness(repo, () => Promise.resolve(false))
    await adapter.handleAction('openCommit')
    expect(surface.posts.some((post) => post.type === 'gitCommitForm')).toBe(true)
    rmSync(repo, { recursive: true, force: true })
    await adapter.commit('Swept root commit', false)
    expect(noticesOf(surface, 'warning')).toContain(UI_TEXT.gitOperationChanged)
    expect(surface.posts.some((post) => post.type === 'gitDone' && !post.ok)).toBe(true)
  })

  it('says the repository changed when the push plans on a swept root', async () => {
    const repo = makeRepository()
    const { adapter, surface } = harness(repo, () => Promise.resolve(false))
    rmSync(repo, { recursive: true, force: true })
    await adapter.handleAction('push')
    expect(noticesOf(surface, 'warning')).toContain(UI_TEXT.gitOperationChanged)
  })
})

/** A local clone one commit ahead of a remote with that branch checked out. */
function aheadOfCheckedOut(): string {
  const remote = makeRepository()
  const parent = mkdtempSync(path.join(root, 'clone-'))
  const local = path.join(parent, 'local')
  git.run(root, 'clone', '-q', remote, local)
  git.run(
    local,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Ahead',
  )
  return local
}

describe('RuntimeGit push failures', () => {
  it('offers the same command in a terminal when the push itself fails', async () => {
    const repo = aheadOfCheckedOut()
    let isConfirmed = false
    const { adapter, surface, terminals } = harness(repo, () => {
      isConfirmed = true
      return Promise.resolve(true)
    })
    await adapter.handleAction('push')
    expect(isConfirmed).toBe(true)
    expect(surface.said.some((said) => said.text.startsWith(UI_TEXT.gitPushFailed))).toBe(true)
    expect(terminals.length).toBe(1)
    const [terminal] = terminals
    expect(terminal?.command).toContain(git.git)
    expect(terminal?.cwd).toBe(repo)
  })

  it('withholds the terminal when trust is revoked with the failure', async () => {
    const repo = aheadOfCheckedOut()
    const box: { revoke?: () => void } = {}
    const built = harness(
      repo,
      () => Promise.resolve(true),
      (message) => {
        // Trust revoked exactly as the real push fails: the terminal offer
        // must be withheld while the failure itself is still said.
        if (message === 'git push failed') {
          box.revoke?.()
        }
      },
    )
    box.revoke = built.revokeTrust
    await built.adapter.handleAction('push')
    expect(built.surface.said.some((said) => said.text.startsWith(UI_TEXT.gitPushFailed))).toBe(
      true,
    )
    expect(built.terminals).toEqual([])
  })

  it('says restricted without a terminal when trust is revoked at confirmation', async () => {
    const repo = aheadOfCheckedOut()
    const box: { revoke?: () => void } = {}
    const built = harness(repo, () => {
      box.revoke?.()
      return Promise.resolve(true)
    })
    box.revoke = built.revokeTrust
    await built.adapter.handleAction('push')
    expect(noticesOf(built.surface, 'warning')).toContain(UI_TEXT.gitRestricted)
    expect(built.terminals).toEqual([])
  })
})

describe('RuntimeGit generations', () => {
  it('brings back Generate when a generation is marked failed', () => {
    const repo = makeRepository()
    const { adapter, surface } = harness(repo, () => Promise.resolve(false))
    const id = adapter.generationStarting('commitMessage')
    adapter.generationFailed(id)
    expect(
      surface.posts.some((post) => post.type === 'gitDraft' && post.draft.kind === 'failed'),
    ).toBe(true)
  })
})
