// The runtime conversation Git adapter (M123 lane G, PLAN.md D104):
// the commit form, commit, push with its terminal fallback, link display,
// draft prompts and generations on the fixture repositories, and explicit
// answers for the pull request half until lane P lands it.

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createGitProcess, GitExitError, type GitProcess } from '../../src/host/git'
import { resolveExecutable } from '../../src/core/executables'
import * as launcher from '../../src/core/resources/launcher'
import { ResourcePausedError } from '../../src/core/resources/launch'
import type { GitSurface } from '../../src/host/conversation/conversationController'
import { createConversationGit } from '../../src/host/git/conversationGitEntry'
import { readNativeStatus } from '../../src/core/git/status'
import { createRuntimeGit, RuntimeGit } from '../../src/runtime/panel/git/adapter'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { STDERR_SHOWN_CHARS, UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { fakeGitWindow } from './helpers/fakeGit'
import {
  dirtyScratchRepository,
  fakeRuntimeGitDeps,
  isolateGitEnvironment,
} from './helpers/github/fakes'
import { createFixtureRepositories, type FixtureRepositories } from './helpers/github/repositories'
import type { RuntimeGitDeps, RuntimePushConfirmation } from '../../src/core/git/runtimeGit'

/** Removes a link or junction itself, never what it leads to. */
function removeLink(link: string): void {
  try {
    unlinkSync(link)
  } catch {
    // A Windows junction is removed as a directory entry.
    rmdirSync(link)
  }
}

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
function makeDirtyRepo(): { readonly dir: string; readonly cleanup: () => void } {
  return dirtyScratchRepository('m123-native-adapter-')
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

  // Every git here commits as the test's own identity, never the machine's (R12).
  beforeEach(() => {
    isolateGitEnvironment()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    const scratch = makeDirtyRepo()
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
    const scratch = makeDirtyRepo()
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
    const work = makeDirtyRepo()
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
    const scratch = makeDirtyRepo()
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

  it('pushes the own fixture after its confirmation, then reports up to date', async () => {
    const fake = fakeSurface()
    const { git, calls } = adapterFor(repos().own, fake)
    await git.handleAction('push')
    // The URL shown is where git really pushes: the fixture's `insteadOf`
    // rewrite of github.com to its local bare repository.
    expect(calls.confirmations).toEqual([
      {
        remote: 'origin',
        remoteUrl: execFileSync('git', ['remote', 'get-url', '--push', 'origin'], {
          cwd: repos().own,
          env: repos().environment,
          encoding: 'utf8',
        }).trim(),
        branch: 'feature',
        target: 'feature',
        commits: 1,
      },
    ])
    expect(calls.confirmations[0]?.remoteUrl?.includes('github.com')).toBe(false)
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
      const gitPath = path.join(tmpdir(), 'resolved', 'git')
      const { git, calls } = adapterFor(direct, fake, { gitPath })
      await git.handleAction('push')
      expect(
        fake.said.some(
          (message) => message.level === 'error' && message.text.startsWith(UI_TEXT.gitPushFailed),
        ),
      ).toBe(true)
      // The same git the service runs, in the root it bound to.
      expect(calls.terminals).toEqual([
        { command: [gitPath, 'push', '-u', 'origin', 'doomed'], cwd: await canonicalPath(direct) },
      ])
    } finally {
      rmSync(direct, { recursive: true, force: true })
    }
  })

  for (const change of ['the folder is replaced', 'a commit lands'] as const) {
    it(`R5: opens no terminal when, as the failed push ends, ${change}`, async () => {
      const environment = repos().environment
      const base = mkdtempSync(path.join(tmpdir(), 'm123-native-pushfail-moved-'))
      const direct = path.join(base, 'repo')
      const makeDoomed = (folder: string): void => {
        execFileSync('git', ['clone', '-q', repos().parentBare, folder], { env: environment })
        execFileSync('git', ['checkout', '-q', '-b', 'doomed'], { cwd: folder, env: environment })
        writeFileSync(path.join(folder, 'doomed.txt'), 'doomed\n')
        execFileSync('git', ['add', 'doomed.txt'], { cwd: folder, env: environment })
        execFileSync('git', ['commit', '-q', '-m', 'Doomed'], { cwd: folder, env: environment })
        execFileSync('git', ['remote', 'set-url', 'origin', '/nonexistent/bare.git'], {
          cwd: folder,
          env: environment,
        })
      }
      try {
        makeDoomed(direct)
        const real = createGitProcess({
          platform: process.platform,
          env: environment,
          fileExists: existsSync,
          spawn,
        })
        const run: GitProcess = async (args, options) => {
          try {
            return await real(args, options)
          } catch (error: unknown) {
            if (args[0] === 'push') {
              if (change === 'a commit lands') {
                writeFileSync(path.join(direct, 'doomed.txt'), 'later\n')
                execFileSync('git', ['commit', '-q', '-am', 'Later'], {
                  cwd: direct,
                  env: environment,
                })
              } else {
                renameSync(direct, path.join(base, 'repo-moved'))
                makeDoomed(direct)
              }
            }
            throw error
          }
        }
        const fake = fakeSurface()
        const { deps, calls } = fakeRuntimeGitDeps(direct)
        const git = createRuntimeGit(fake.surface, deps, { run })
        await git.handleAction('push')
        expect(fake.said.some((message) => message.text.startsWith(UI_TEXT.gitPushFailed))).toBe(
          true,
        )
        expect(calls.terminals).toEqual([])
        expect(fake.notices).toContainEqual({ level: 'warning', text: UI_TEXT.gitOperationChanged })
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    })
  }

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
    const scratch = makeDirtyRepo()
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
    expect(fake.notices).toContainEqual({
      level: 'warning',
      text: UI_TEXT.gitRestricted,
    })
  })

  it('notices a refused launch in its own words', async () => {
    const scratch = makeDirtyRepo()
    try {
      const gitPath = resolveExecutable('git', {
        platform: process.platform,
        pathVariable: process.env['PATH'],
        fileExists: existsSync,
      })
      if (gitPath === undefined) {
        throw new Error('the tests need git on PATH')
      }
      const fake = fakeSurface()
      const { deps } = fakeRuntimeGitDeps(scratch.dir, { gitPath })
      // The production governed launch, refused by the governor.
      const git = createRuntimeGit(fake.surface, deps)
      vi.spyOn(launcher, 'execResourceFile').mockRejectedValue(new ResourcePausedError())
      try {
        await git.handleAction('openCommit')
      } finally {
        vi.restoreAllMocks()
      }
      expect(fake.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitMachineBusy,
      })
    } finally {
      scratch.cleanup()
    }
  })

  // RVM123G's findings, each against the real git on scratch repositories.

  /** The real runner, recording each git that reached its spawn, with an optional pause before one. */
  function watchedRunner(): {
    readonly run: GitProcess
    readonly spawned: string[]
    pauseAt: (
      subcommand: string,
      onCall?: number,
    ) => { reached: Promise<void>; release: () => void }
    onCall: (subcommand: string, action: (count: number) => void) => void
  } {
    const real = createGitProcess({
      platform: process.platform,
      env: repos().environment,
      fileExists: existsSync,
      spawn,
    })
    const spawned: string[] = []
    const counts = new Map<string, number>()
    const pauses = new Map<string, { onCall: number; gate: Promise<void>; reached: () => void }>()
    const actions = new Map<string, (count: number) => void>()
    const run: GitProcess = async (args, options) => {
      const [subcommand = ''] = args
      const count = (counts.get(subcommand) ?? 0) + 1
      counts.set(subcommand, count)
      const pause = pauses.get(subcommand)
      if (pause?.onCall === count) {
        pause.reached()
        await pause.gate
      }
      const result = await real(args, {
        ...options,
        beforeRun: () => {
          options.beforeRun?.()
          spawned.push(subcommand)
        },
      })
      actions.get(subcommand)?.(count)
      return result
    }
    return {
      run,
      spawned,
      pauseAt: (subcommand, onCall = 1) => {
        const gate = Promise.withResolvers<undefined>()
        const atGate = Promise.withResolvers<undefined>()
        pauses.set(subcommand, {
          onCall,
          gate: gate.promise,
          reached: () => {
            atGate.resolve(undefined)
          },
        })
        return {
          reached: atGate.promise,
          release: () => {
            gate.resolve(undefined)
          },
        }
      },
      onCall: (subcommand, action) => {
        actions.set(subcommand, action)
      },
    }
  }

  function scratchGit(dir: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd: dir, env: repos().environment, encoding: 'utf8' })
  }

  /** A clone of the parent on a new branch one commit ahead of its pushed upstream. */
  function aheadClone(branch: string): { readonly dir: string; readonly cleanup: () => void } {
    const dir = mkdtempSync(path.join(tmpdir(), 'm123-native-ahead-'))
    execFileSync('git', ['clone', '-q', repos().parentBare, dir], { env: repos().environment })
    scratchGit(dir, 'checkout', '-q', '-b', branch)
    writeFileSync(path.join(dir, `${branch}.txt`), 'one\n')
    scratchGit(dir, 'add', `${branch}.txt`)
    scratchGit(dir, 'commit', '-q', '-m', 'One')
    scratchGit(dir, 'push', '-q', '-u', 'origin', branch)
    writeFileSync(path.join(dir, `${branch}.txt`), 'two\n')
    scratchGit(dir, 'commit', '-q', '-am', 'Two')
    return {
      dir,
      cleanup: () => {
        rmSync(dir, { recursive: true, force: true })
      },
    }
  }

  it('#1 asks with the masked remote URL and target before any push, and pushes nothing on No', async () => {
    const scratch = aheadClone('declined')
    try {
      // A URL carrying a credential: the modal shows it masked.
      const secretUrl = 'https://user:canary-pass@github.com/RandyNorthrup/muse-spark-code.git'
      scratchGit(scratch.dir, 'remote', 'set-url', 'origin', secretUrl)
      const watched = watchedRunner()
      const fake = fakeSurface()
      const confirmations: RuntimePushConfirmation[] = []
      const { deps } = fakeRuntimeGitDeps(scratch.dir, {
        confirmPush: (confirmation) => {
          confirmations.push(confirmation)
          return Promise.resolve(false)
        },
      })
      const git = createRuntimeGit(fake.surface, deps, { run: watched.run })
      await git.handleAction('push')
      expect(confirmations).toHaveLength(1)
      expect(confirmations[0]).toMatchObject({
        remote: 'origin',
        branch: 'declined',
        target: 'declined',
        commits: 1,
      })
      expect(confirmations[0]?.remoteUrl).toContain('github.com/RandyNorthrup/muse-spark-code')
      expect(JSON.stringify(confirmations)).not.toContain('canary-pass')
      expect(watched.spawned).not.toContain('push')
      expect(fake.notices).toContainEqual({ level: 'info', text: UI_TEXT.gitPushDeclined })
    } finally {
      scratch.cleanup()
    }
  })

  it('#13 asks which remote a first push goes to, and pushes to the one picked', async () => {
    const base = mkdtempSync(path.join(tmpdir(), 'm123-native-remotes-'))
    try {
      const dir = path.join(base, 'work')
      const alpha = path.join(base, 'alpha.git').replaceAll('\\', '/')
      const beta = path.join(base, 'beta.git').replaceAll('\\', '/')
      execFileSync('git', ['init', '-q', '--bare', alpha], { env: repos().environment })
      execFileSync('git', ['init', '-q', '--bare', beta], { env: repos().environment })
      execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: repos().environment })
      writeFileSync(path.join(dir, 'a.txt'), 'a\n')
      scratchGit(dir, 'add', 'a.txt')
      scratchGit(dir, 'commit', '-q', '-m', 'A')
      scratchGit(dir, 'remote', 'add', 'alpha', alpha)
      scratchGit(dir, 'remote', 'add', 'beta', beta)
      // Dismissed: nothing is asked further and nothing goes.
      const dismissed = fakeSurface()
      const first = adapterFor(dir, dismissed)
      await first.git.handleAction('push')
      expect(first.calls.remotePicks).toEqual([['alpha', 'beta']])
      expect(first.calls.confirmations).toEqual([])
      expect(dismissed.notices).toContainEqual({ level: 'info', text: UI_TEXT.gitPushDeclined })
      // Picked: the modal names it, and the first push goes there with `-u`.
      const fake = fakeSurface()
      const { git, calls } = adapterFor(dir, fake, {
        pickRemote: () => Promise.resolve('beta'),
      })
      await git.handleAction('push')
      expect(calls.confirmations).toEqual([
        { remote: 'beta', remoteUrl: beta, branch: 'main', target: 'main', commits: undefined },
      ])
      expect(
        execFileSync('git', ['--git-dir', beta, 'rev-parse', 'refs/heads/main'], {
          env: repos().environment,
          encoding: 'utf8',
        }).trim(),
      ).toMatch(/^[0-9a-f]{40}$/)
      expect(scratchGit(dir, 'rev-parse', '--abbrev-ref', '@{u}').trim()).toBe('beta/main')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  for (const stop of ['cancel', 'session change', 'disposal'] as const) {
    it(`#2 stops a pending commit's git on ${stop}: nothing is staged or committed`, async () => {
      const scratch = makeDirtyRepo()
      try {
        const watched = watchedRunner()
        const fake = fakeSurface()
        fake.setSession('s1')
        const { deps } = fakeRuntimeGitDeps(scratch.dir)
        const git = createRuntimeGit(fake.surface, deps, { run: watched.run })
        git.sessionChanged('s1')
        await git.handleAction('openCommit')
        // The commit's own status read (the form made the first) waits here.
        const pause = watched.pauseAt('status', 2)
        const committing = git.commit('Stopped', true)
        await pause.reached
        if (stop === 'cancel') {
          await git.handleAction('cancel')
        } else if (stop === 'session change') {
          fake.setSession('s2')
          git.sessionChanged('s2')
        } else {
          git.dispose()
        }
        pause.release()
        await committing
        expect(watched.spawned).not.toContain('add')
        expect(watched.spawned).not.toContain('commit')
        expect(scratchGit(scratch.dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
      } finally {
        scratch.cleanup()
      }
    })
  }

  it('#5 redacts the whole failure before cutting it, so a value never outlives its name', async () => {
    const canary = `zq9${'x'.repeat(40)}`
    const tail = `${canary} ${'p'.repeat(STDERR_SHOWN_CHARS - canary.length - 1)}`
    const failing: GitProcess = () => Promise.reject(new Error(`fatal: GITHUB_TOKEN=${tail}`))
    const fake = fakeSurface()
    const { deps } = fakeRuntimeGitDeps(repos().own)
    const git = createRuntimeGit(fake.surface, deps, { run: failing })
    await git.handleAction('openCommit')
    expect(fake.said.length > 0).toBe(true)
    expect(JSON.stringify([...fake.posted, ...fake.notices, ...fake.said])).not.toContain(canary)
  })

  it('#6 never reads a new file through a folder swapped for a link after status', async () => {
    const scratch = makeDirtyRepo()
    const outside = mkdtempSync(path.join(tmpdir(), 'm123-native-outside-'))
    try {
      scratchGit(scratch.dir, 'checkout', '-q', '--', 'a.txt')
      mkdirSync(path.join(scratch.dir, 'dir'))
      writeFileSync(path.join(scratch.dir, 'dir', 'new.txt'), 'inside\n')
      writeFileSync(path.join(outside, 'new.txt'), 'OUTSIDE-CANARY\n')
      const watched = watchedRunner()
      // After status listed `dir/new.txt`, `dir` becomes a link (a junction on Windows) outside.
      watched.onCall('diff', () => {
        renameSync(path.join(scratch.dir, 'dir'), path.join(scratch.dir, 'dir-old'))
        symlinkSync(outside, path.join(scratch.dir, 'dir'), 'junction')
      })
      const fake = fakeSurface()
      const { deps } = fakeRuntimeGitDeps(scratch.dir)
      const git = createRuntimeGit(fake.surface, deps, { run: watched.run })
      let prompt: string
      try {
        prompt = await git.promptFor('commitMessage')
      } catch (error: unknown) {
        prompt = String(error)
      }
      expect(prompt).not.toContain('OUTSIDE-CANARY')
      expect(prompt).toContain(UI_TEXT.gitOperationChanged)
    } finally {
      const swapped = path.join(scratch.dir, 'dir')
      if (lstatSync(swapped, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
        removeLink(swapped)
      }
      scratch.cleanup()
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('#7 opens no terminal when trust is lost during the push', async () => {
    const scratch = aheadClone('untrusted')
    try {
      // The push itself would fail: the remote is gone.
      scratchGit(scratch.dir, 'remote', 'set-url', 'origin', '/nonexistent/bare.git')
      let isTrusted = true
      const watched = watchedRunner()
      // The push's own root check is the second toplevel read: trust goes after it.
      watched.onCall('rev-parse', (count) => {
        if (count === 2) {
          isTrusted = false
        }
      })
      const fake = fakeSurface()
      const { deps, calls } = fakeRuntimeGitDeps(scratch.dir, { isTrusted: () => isTrusted })
      const git = createRuntimeGit(fake.surface, deps, { run: watched.run })
      await git.handleAction('push')
      expect(calls.terminals).toEqual([])
      expect(watched.spawned).not.toContain('push')
      expect(fake.notices).toContainEqual({ level: 'warning', text: UI_TEXT.gitRestricted })
    } finally {
      scratch.cleanup()
    }
  })

  it('#7 opens no terminal for a refusal while the conversation still owns the push', async () => {
    const scratch = aheadClone('moved')
    try {
      const fake = fakeSurface()
      const { deps, calls } = fakeRuntimeGitDeps(scratch.dir, {
        // While the modal is open, the branch gains a commit: what was confirmed is gone.
        confirmPush: () => {
          writeFileSync(path.join(scratch.dir, 'moved.txt'), 'three\n')
          scratchGit(scratch.dir, 'commit', '-q', '-am', 'Three')
          return Promise.resolve(true)
        },
      })
      const watched = watchedRunner()
      const git = createRuntimeGit(fake.surface, deps, { run: watched.run })
      await git.handleAction('push')
      expect(watched.spawned).not.toContain('push')
      expect(calls.terminals).toEqual([])
      expect(fake.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitOperationChanged,
      })
    } finally {
      scratch.cleanup()
    }
  })

  it('#7 opens no terminal for git’s own failure once trust is gone', async () => {
    const scratch = aheadClone('lost')
    try {
      scratchGit(scratch.dir, 'remote', 'set-url', 'origin', '/nonexistent/bare.git')
      let isTrusted = true
      const watched = watchedRunner()
      // The push itself fails as git; trust goes while it runs.
      const failingAfter: GitProcess = async (args, options) => {
        try {
          return await watched.run(args, options)
        } catch (error: unknown) {
          if (args[0] === 'push') {
            isTrusted = false
          }
          throw error
        }
      }
      const fake = fakeSurface()
      const { deps, calls } = fakeRuntimeGitDeps(scratch.dir, { isTrusted: () => isTrusted })
      const git = createRuntimeGit(fake.surface, deps, { run: failingAfter })
      await git.handleAction('push')
      expect(watched.spawned).toContain('push')
      expect(fake.said.some((message) => message.text.startsWith(UI_TEXT.gitPushFailed))).toBe(true)
      expect(calls.terminals).toEqual([])
    } finally {
      scratch.cleanup()
    }
  })

  it('#8 refuses a commit when other bytes were staged, or a file edited, after the form', async () => {
    const scratch = makeDirtyRepo()
    try {
      // Staged under the same name, then other bytes staged: same paths, other index object.
      scratchGit(scratch.dir, 'add', 'a.txt')
      const staged = fakeSurface()
      const first = adapterFor(scratch.dir, staged)
      await first.git.handleAction('openCommit')
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'six\n')
      scratchGit(scratch.dir, 'add', 'a.txt')
      await first.git.commit('Staged two', false)
      expect(staged.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitOperationChanged,
      })
      // An unstaged edit of the same size after the form.
      scratchGit(scratch.dir, 'reset', '-q')
      const unstaged = fakeSurface()
      const second = adapterFor(scratch.dir, unstaged)
      await second.git.handleAction('openCommit')
      writeFileSync(path.join(scratch.dir, 'a.txt'), 'ten\n')
      await second.git.commit('Unstaged six', true)
      expect(unstaged.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitOperationChanged,
      })
      expect(scratchGit(scratch.dir, 'rev-list', '--count', 'HEAD').trim()).toBe('1')
    } finally {
      scratch.cleanup()
    }
  })

  it('#9 serializes stage-and-commit across conversations sharing a repository', async () => {
    const scratch = makeDirtyRepo()
    try {
      // a.txt staged for A's staged-only commit; b.txt new for B's commit of everything.
      scratchGit(scratch.dir, 'add', 'a.txt')
      writeFileSync(path.join(scratch.dir, 'b.txt'), 'b\n')
      const watchedA = watchedRunner()
      const watchedB = watchedRunner()
      const surfaceA = fakeSurface()
      const surfaceB = fakeSurface()
      const a = createRuntimeGit(surfaceA.surface, fakeRuntimeGitDeps(scratch.dir).deps, {
        run: watchedA.run,
      })
      const b = createRuntimeGit(surfaceB.surface, fakeRuntimeGitDeps(scratch.dir).deps, {
        run: watchedB.run,
      })
      await a.handleAction('openCommit')
      await b.handleAction('openCommit')
      const pause = watchedA.pauseAt('commit')
      const committingA = a.commit('Only staged A', false)
      await pause.reached
      const committingB = b.commit('Everything B', true)
      // Long enough for B to stage everything if nothing held it back.
      await new Promise((resolve) => setTimeout(resolve, 500))
      pause.release()
      await Promise.all([committingA, committingB])
      const files = scratchGit(scratch.dir, 'show', '--name-only', '--format=', 'HEAD~0')
        .split('\n')
        .filter((line) => line !== '')
      expect(scratchGit(scratch.dir, 'log', '-1', '--format=%s').trim()).toBe('Only staged A')
      expect(files).toEqual(['a.txt'])
      // B's form no longer matches the repository A committed to.
      expect(surfaceB.notices).toContainEqual({
        level: 'warning',
        text: UI_TEXT.gitOperationChanged,
      })
    } finally {
      scratch.cleanup()
    }
  })

  it('#16 takes the native route in a VS Code-family host without vscode.git', () => {
    const window = fakeGitWindow().window
    const native = fakeRuntimeGitDeps(repos().own).deps
    const fake = fakeSurface()
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined)
    const routed = createConversationGit(
      { ...window, nativeGit: () => native },
      fake.surface,
      UI_TEXT,
      uiLocale(),
    )
    expect(routed).toBeInstanceOf(RuntimeGit)
    routed.dispose()
    // With the git extension installed, VS Code's own adapter stays.
    const installed: vscode.Extension<unknown> = {
      id: 'vscode.git',
      extensionUri: vscode.Uri.file('/git'),
      extensionPath: '/git',
      isActive: false,
      packageJSON: {},
      // ExtensionKind.Workspace
      extensionKind: 2,
      exports: undefined,
      activate: () => Promise.resolve(undefined),
    }
    vi.mocked(vscode.extensions.getExtension).mockReturnValue(installed)
    const kept = createConversationGit(
      { ...window, nativeGit: () => native },
      fake.surface,
      UI_TEXT,
      uiLocale(),
    )
    expect(kept).not.toBeInstanceOf(RuntimeGit)
    kept.dispose()
    vi.mocked(vscode.extensions.getExtension).mockReset()
  })
})
