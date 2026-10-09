// The runtime conversation Git adapter (M123 lane G, PLAN.md D104):
// the commit form, commit, push with its terminal fallback, link display,
// draft prompts and generations on the fixture repositories, and explicit
// answers for the pull request half until lane P lands it.

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createGitProcess, GitExitError, type GitProcess } from '../../src/host/git'
import type { GitSurface } from '../../src/host/conversation/conversationController'
import { readNativeStatus } from '../../src/core/git/status'
import { createRuntimeGit } from '../../src/runtime/panel/git/adapter'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { fakeRuntimeGitDeps } from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'
import type { RuntimeGitDeps } from '../../src/core/git/runtimeGit'

interface PostedNotice {
  readonly level: 'info' | 'warning' | 'error'
  readonly text: string
}

interface FakeSurface {
  readonly surface: GitSurface
  readonly posted: HostToWebviewMessage[]
  readonly notices: PostedNotice[]
  readonly said: PostedNotice[]
  setSession: (sessionId: string | undefined) => void
}

function fakeSurface(): FakeSurface {
  const posted: HostToWebviewMessage[] = []
  const notices: PostedNotice[] = []
  const said: PostedNotice[] = []
  let sessionId: string | undefined
  return {
    surface: {
      post: (message) => {
        posted.push(message)
      },
      notice: (level, text) => {
        notices.push({ level, text })
      },
      say: (level, text) => {
        said.push({ level, text })
      },
      sessionId: () => sessionId,
    },
    posted,
    notices,
    said,
    setSession: (next) => {
      sessionId = next
    },
  }
}

/** A reply and its turn's end, as the backends send them. */
function turnReply(turnId: string, text: string): AgentEvent[] {
  const message = {
    itemId: `m-${turnId}`,
    kind: 'agentMessage',
    status: 'completed',
    text,
    turnId,
  }
  return [
    { type: 'itemCompleted', item: message },
    { type: 'turnCompleted', turnId, terminal: 'completed' },
  ]
}

/** A dirty scratch repository: one unstaged change to show and commit. */
function makeDirtyRepo(environment: NodeJS.ProcessEnv): {
  readonly dir: string
  readonly cleanup: () => void
} {
  const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-adapter-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, env: environment })
  writeFileSync(path.join(dir, 'a.txt'), 'one\n')
  execFileSync('git', ['add', 'a.txt'], { cwd: dir, env: environment })
  execFileSync('git', ['commit', '-q', '-m', 'Add a'], { cwd: dir, env: environment })
  writeFileSync(path.join(dir, 'a.txt'), 'two\n')
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

describe('createRuntimeGit', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'm123-native-adapter-'))
  const built: FixtureRepositories[] = []
  const repos = (): FixtureRepositories => {
    const [first] = built
    if (first === undefined) {
      throw new Error('the fixture repositories were not built')
    }
    return first
  }

  beforeAll(() => {
    built.push(createFixtureRepositories(root))
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function adapterFor(
    repositoryRoot: string,
    fake: FakeSurface,
    overrides: Partial<RuntimeGitDeps> = {},
  ) {
    const { deps, calls } = fakeRuntimeGitDeps(repositoryRoot, overrides)
    const git = createRuntimeGit(fake.surface, deps, {
      run: createGitProcess({
        platform: process.platform,
        env: repos().environment,
        fileExists: existsSync,
        spawn,
      }),
    })
    return { git, calls }
  }

  it('posts the commit form with the branch and the counts', async () => {
    const scratch = makeDirtyRepo(repos().environment)
    try {
      const fake = fakeSurface()
      const { git } = adapterFor(scratch.dir, fake)
      await git.handleAction('openCommit')
      const form = fake.posted.find((message) => message.type === 'gitCommitForm')
      expect(form).toMatchObject({
        type: 'gitCommitForm',
        form: { branch: 'main', staged: 0, unstaged: 1, moreFiles: 0 },
      })
      expect(fake.notices).toEqual([])
    } finally {
      scratch.cleanup()
    }
  })

  it('says there is nothing to commit on a clean tree', async () => {
    const fake = fakeSurface()
    const { git } = adapterFor(repos().own, fake)
    await git.handleAction('openCommit')
    expect(fake.notices).toEqual([{ level: 'info', text: UI_TEXT.gitNothingToCommit }])
  })

  it('commits after the form, and shows the commit', async () => {
    const scratch = makeDirtyRepo(repos().environment)
    try {
      const fake = fakeSurface()
      const { git } = adapterFor(scratch.dir, fake)
      await git.handleAction('openCommit')
      await git.commit('Change a', true)
      expect(
        fake.notices.some((notice) => notice.level === 'info' && notice.text.includes('Change a')),
      ).toBe(true)
      expect(
        fake.posted.some(
          (message) => message.type === 'gitDone' && message.form === 'commit' && message.ok,
        ),
      ).toBe(true)
      const { snapshot } = await readNativeStatus(
        createGitProcess({
          platform: process.platform,
          env: repos().environment,
          fileExists: existsSync,
          spawn,
        }),
        { cwd: scratch.dir, env: repos().environment },
      )
      expect([...snapshot.staged, ...snapshot.unstaged, ...snapshot.untracked]).toEqual([])
    } finally {
      scratch.cleanup()
    }
  })

  it('answers an empty message and a credential shape without committing', async () => {
    const work = makeDirtyRepo(repos().environment)
    try {
      const panel = fakeSurface()
      const { git } = adapterFor(work.dir, panel)
      await git.handleAction('openCommit')
      await git.commit(' '.repeat(3), true)
      expect(panel.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitCommitMessageEmpty,
      })
      const canary = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
      await git.commit(`Ship ${canary}`, true)
      expect(panel.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitCredentialMasked,
      })
      const draft = panel.posted.find((message) => message.type === 'gitDraft')
      expect(draft).toBeDefined()
      expect(JSON.stringify(draft)).not.toContain(canary)
      // Nothing went in: the change is still there.
      await git.handleAction('openCommit')
      const forms = panel.posted.filter((message) => message.type === 'gitCommitForm')
      expect(forms.some((message) => message.form.unstaged + message.form.staged > 0)).toBe(true)
    } finally {
      work.cleanup()
    }
  })

  it('refuses a commit when the tree moved under the form', async () => {
    const scratch = makeDirtyRepo(repos().environment)
    try {
      const fake = fakeSurface()
      const { git } = adapterFor(scratch.dir, fake)
      await git.handleAction('openCommit')
      writeFileSync(path.join(scratch.dir, 'b.txt'), 'moved\n')
      await git.commit('Stale form', true)
      expect(fake.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitOperationChanged,
      })
      expect(
        fake.posted.some(
          (message) => message.type === 'gitDone' && message.form === 'commit' && !message.ok,
        ),
      ).toBe(true)
    } finally {
      scratch.cleanup()
    }
  })

  it('pushes the own fixture after its action, then reports up to date', async () => {
    const fake = fakeSurface()
    const { git, calls } = adapterFor(repos().own, fake)
    await git.handleAction('push')
    expect(
      fake.notices.some((notice) => notice.level === 'info' && notice.text.includes('feature')),
    ).toBe(true)
    expect(calls.terminals).toEqual([])
    await git.handleAction('push')
    expect(fake.notices).toContainEqual({ level: 'info', text: UI_TEXT.gitPushUpToDate })
  })

  it('refuses behind and detached pushes with the shared words', async () => {
    const behindFake = fakeSurface()
    const behind = adapterFor(repos().behind, behindFake)
    await behind.git.handleAction('push')
    expect(behindFake.notices).toContainEqual({
      level: 'warning',
      text: UI_TEXT.gitPushBehind,
    })
    const detachedFake = fakeSurface()
    const detached = adapterFor(repos().detached, detachedFake)
    await detached.git.handleAction('push')
    expect(detachedFake.notices).toContainEqual({
      level: 'warning',
      text: UI_TEXT.gitPushDetached,
    })
  })

  it('opens the same push command in the terminal when the push fails', async () => {
    // Behind refuses before spawning; a doomed scratch branch fails after it.
    const environment = repos().environment
    const direct = mkdtempSync(path.join(tmpdir(), 'm123-native-pushfail-'))
    try {
      execFileSync('git', ['clone', '-q', repos().parentBare, direct], { env: environment })
      execFileSync('git', ['checkout', '-q', '-b', 'doomed'], { cwd: direct, env: environment })
      writeFileSync(path.join(direct, 'doomed.txt'), 'doomed\n')
      execFileSync('git', ['add', 'doomed.txt'], { cwd: direct, env: environment })
      execFileSync('git', ['commit', '-q', '-m', 'Doomed'], { cwd: direct, env: environment })
      execFileSync('git', ['remote', 'set-url', 'origin', '/nonexistent/bare.git'], {
        cwd: direct,
        env: environment,
      })
      const fake = fakeSurface()
      const { git, calls } = adapterFor(direct, fake)
      await git.handleAction('push')
      expect(
        fake.said.some(
          (message) => message.level === 'error' && message.text.startsWith(UI_TEXT.gitPushFailed),
        ),
      ).toBe(true)
      expect(calls.terminals).toEqual([
        { command: ['git', 'push', '-u', 'origin', 'doomed'], cwd: direct },
      ])
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  it('stays silent when Cancel wins the push', async () => {
    const controller = new AbortController()
    controller.abort()
    const fake = fakeSurface()
    const { git, calls } = adapterFor(repos().own, fake, { signal: controller.signal })
    await git.handleAction('push')
    expect([...fake.notices, ...fake.said]).toEqual([])
    expect(calls.terminals).toEqual([])
  })

  it('shows the linked pull request for the session, and clears it after', async () => {
    const fake = fakeSurface()
    const { deps } = fakeRuntimeGitDeps(repos().own)
    const git = createRuntimeGit(fake.surface, deps, {
      run: createGitProcess({
        platform: process.platform,
        env: repos().environment,
        fileExists: existsSync,
        spawn,
      }),
    })
    const root = await canonicalPath(repos().own)
    await deps.links.set(root, 's1', {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 51,
      url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
      title: 'Held checkout',
      linkedAt: 1,
    })
    fake.setSession('s1')
    git.sessionChanged('s1')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const states = fake.posted.filter((message) => message.type === 'gitState')
    expect(states.length > 0).toBe(true)
    expect(states.at(-1)).toMatchObject({
      type: 'gitState',
      state: { pullRequest: { number: 51 } },
    })
    fake.setSession(undefined)
    git.sessionChanged(undefined)
    expect(fake.posted.at(-1)).toMatchObject({ type: 'gitState', state: {} })
  })

  it('prompts a commit message from the native diff', async () => {
    const scratch = makeDirtyRepo(repos().environment)
    try {
      const fake = fakeSurface()
      const { git } = adapterFor(scratch.dir, fake)
      const prompt = await git.promptFor('commitMessage')
      expect(prompt).toContain('main')
      expect(prompt).toContain('a.txt')
      expect(prompt.toLowerCase()).toContain('diff')
    } finally {
      scratch.cleanup()
    }
  })

  it('asks for the pull request form before a pull request prompt', async () => {
    const fake = fakeSurface()
    const { git } = adapterFor(repos().own, fake)
    await expect(git.promptFor('pullRequest')).rejects.toThrow(UI_TEXT.gitOpenPullRequestFirst)
  })

  it('settles a commit-message generation from the turn reply', () => {
    const fake = fakeSurface()
    const { git } = adapterFor(repos().own, fake)
    const id = git.generationStarting('commitMessage')
    expect(git.isGenerationCurrent(id)).toBe(true)
    git.generationSubmitted('t1', id)
    for (const event of turnReply('t1', 'Add the native service')) {
      git.onEvent(event)
    }
    const draft = fake.posted.find((message) => message.type === 'gitDraft')
    expect(draft).toMatchObject({
      type: 'gitDraft',
      draft: { kind: 'commitMessage', message: 'Add the native service' },
    })
  })

  it('answers the pull request half explicitly until lane P', async () => {
    const fake = fakeSurface()
    const { git } = adapterFor(repos().own, fake)
    await git.handleAction('openPullRequest')
    await git.handleAction('refreshPullRequest')
    await git.handleAction('signInGitHub')
    expect(
      fake.notices.filter((notice) => notice.text === UI_TEXT.gitHubSignInDeclined),
    ).toHaveLength(3)
    await git.createPullRequest({
      head: 'feature',
      base: 'main',
      title: 'Native service',
      body: '',
      isDraft: true,
    })
    expect(fake.notices).toContainEqual({
      level: 'warning',
      text: UI_TEXT.gitHubSignInDeclined,
    })
    expect(
      fake.posted.some(
        (message) => message.type === 'gitDone' && message.form === 'pullRequest' && !message.ok,
      ),
    ).toBe(true)
    await git.handleAction('trustWorktree')
    expect(fake.notices).toContainEqual({ level: 'warning', text: UI_TEXT.gitHeld })
  })

  it('redacts a credential-shaped failure before it reaches the panel', async () => {
    const canary = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const failing: GitProcess = () =>
      Promise.reject(new GitExitError(1, `remote: Invalid token ${canary}`, 'push'))
    const fake = fakeSurface()
    const { deps } = fakeRuntimeGitDeps(repos().behind)
    // Every git call fails with a credential-shaped stderr, from the root check on.
    const git = createRuntimeGit(fake.surface, deps, { run: failing })
    await git.handleAction('openCommit')
    expect(JSON.stringify([...fake.posted, ...fake.notices, ...fake.said])).not.toContain(canary)
  })

  it('notices the trust loss in the panel words', async () => {
    const fake = fakeSurface()
    const { git } = adapterFor(repos().own, fake, { isTrusted: () => false })
    await git.handleAction('openCommit')
    expect(fake.said).toContainEqual({
      level: 'warning',
      text: UI_TEXT.gitOperationChanged,
    })
  })
})
