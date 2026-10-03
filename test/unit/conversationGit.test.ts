import { describe, expect, it, vi } from 'vitest'
import { ConversationGit } from '../../src/host/git/conversationGit'
import type { GitSurface } from '../../src/host/conversation/conversationController'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import {
  CAPTURED_ALREADY_EXISTS,
  CAPTURED_CHECKS_FAILED,
  CAPTURED_PULL_OWN,
  CAPTURED_FORK_REPOSITORY,
  CAPTURED_STATUS_FAILED,
} from './helpers/githubCapture'
import { change, fakeGitWindow, type FakeGitWindowOptions, fakeRepository } from './helpers/fakeGit'
import { FAKE_GITHUB_TOKEN, fakeGitHub } from './helpers/fakeGitHub'

const TOKEN_SHAPE = `ghp_${'7'.repeat(36)}`
const REPO_PATH = '/repos/RandyNorthrup/muse-spark-code'
const OWN_SHA = CAPTURED_PULL_OWN.head.sha

function setup(options: FakeGitWindowOptions = {}) {
  const fake = fakeGitWindow(options)
  const posted: HostToWebviewMessage[] = []
  // What the user reads in the panel, and which of it may reach the log.
  const notices: [string, string][] = []
  const logged: string[] = []
  const session = { id: undefined as string | undefined }
  const surface: GitSurface = {
    post: (message) => {
      posted.push(message)
    },
    notice: (level, text) => {
      notices.push([level, text])
      if (level !== 'info') {
        logged.push(text)
      }
    },
    say: (level, text) => {
      notices.push([level, text])
    },
    sessionId: () => session.id,
  }
  const git = new ConversationGit(fake.window, surface)
  const ofType = <T extends HostToWebviewMessage['type']>(type: T) =>
    posted.filter(
      (message): message is Extract<HostToWebviewMessage, { type: T }> => message.type === type,
    )
  return { ...fake, git, posted, notices, logged, session, ofType }
}

/** A branch one commit ahead of its upstream: the push is a plain fast-forward. */
function aheadRepository() {
  return fakeRepository({
    HEAD: {
      name: 'docs/how-its-built',
      upstream: { remote: 'origin', name: 'docs/how-its-built' },
      ahead: 1,
      behind: 0,
    },
  })
}

/** Creation follows the confirmation form, after GitHub says the branch has no open PR. */
async function openForCreation(t: ReturnType<typeof setup>): Promise<void> {
  t.github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
  await t.git.handleAction('openPullRequest')
}

describe('commit (M71)', () => {
  it('shows the exact commit scope and requires the final consent', async () => {
    const repository = fakeRepository({
      indexChanges: [change('a.ts')],
      untrackedChanges: [change('new.ts')],
    })
    const t = setup({ repository, confirmsCommit: false })
    await t.git.handleAction('openCommit')
    await t.git.commit('Fix parser', true)
    expect(t.commitConfirmations).toEqual([
      {
        message: 'Fix parser',
        branch: 'docs/how-its-built',
        files: ['a.ts', 'new.ts'],
        includesUnstaged: true,
      },
    ])
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(t.ofType('gitDone').at(-1)?.ok).toBe(false)
  })

  it('refuses a diff changed while the final commit consent waits', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository })
    await t.git.handleAction('openCommit')
    vi.spyOn(t.window, 'confirmCommit').mockImplementation(() => {
      repository.diffText = 'diff --git a/a.ts b/a.ts\n+unapproved change\n'
      return Promise.resolve(true)
    })
    await t.git.commit('Fix', false)
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(t.notices.at(-1)?.[1]).toBe(UI_TEXT.gitOperationChanged)
  })

  it('refuses a staged set changed since the commit form opened', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository })
    await t.git.handleAction('openCommit')
    repository.state.indexChanges.push(change('surprise.ts'))
    await t.git.commit('Fix', false)
    expect(t.commitConfirmations).toEqual([])
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
  })

  it('opens the form with the changes, then commits through the git extension', async () => {
    const repository = fakeRepository({
      indexChanges: [change('src/a.ts')],
      workingTreeChanges: [change('README.md')],
      untrackedChanges: [change('new.txt')],
    })
    const t = setup({ repository })
    await t.git.handleAction('openCommit')
    expect(t.ofType('gitCommitForm')[0]?.form).toEqual({
      branch: 'docs/how-its-built',
      staged: 1,
      unstaged: 2,
      files: [
        { path: 'src/a.ts', isStaged: true },
        { path: 'README.md', isStaged: false },
        { path: 'new.txt', isStaged: false },
      ],
      moreFiles: 0,
    })
    await t.git.commit('  Add the parser\n\nbody  ', false)
    expect(repository.calls.find((call) => call.method === 'commit')?.args).toEqual([
      'Add the parser\n\nbody',
      { postCommitCommand: null },
    ])
    expect(t.ofType('gitDone')).toEqual([{ type: 'gitDone', form: 'commit', ok: true }])
    expect(t.notices.at(-1)).toEqual(['info', 'Committed “Add the parser” on docs/how-its-built'])
  })

  it('stages everything when asked, and runs no post-commit command', async () => {
    const repository = fakeRepository({ workingTreeChanges: [change('a.ts')] })
    const t = setup({ repository })
    await t.git.commit('Fix', true)
    expect(repository.calls.find((call) => call.method === 'commit')?.args[1]).toEqual({
      all: true,
      postCommitCommand: null,
    })
  })

  it('refuses nothing staged, an empty message, and says there is nothing to commit', async () => {
    const repository = fakeRepository({ workingTreeChanges: [change('a.ts')] })
    const t = setup({ repository })
    await t.git.commit('Fix', false)
    await t.git.commit(' '.repeat(3), true)
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(t.ofType('gitDone').map((message) => message.ok)).toEqual([false, false])
    const empty = setup()
    await empty.git.handleAction('openCommit')
    expect(empty.ofType('gitCommitForm')).toEqual([])
    expect(empty.notices).toEqual([['info', 'There is nothing to commit.']])
  })

  it('masks a credential in the message and commits nothing until the user sends it again', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository })
    await t.git.commit(`Rotate ${TOKEN_SHAPE}`, false)
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(t.ofType('gitDraft')[0]?.draft).toEqual({
      kind: 'commitMessage',
      message: 'Rotate [redacted]',
    })
  })

  it("shows git's own words when the commit fails, and logs only its code", async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    repository.failNext(
      'commit',
      Object.assign(new Error('Failed to execute git'), {
        stderr: 'Author identity unknown\n*** Please tell me who you are.',
        gitErrorCode: 'NoUserNameConfigured',
      }),
    )
    const t = setup({ repository })
    await t.git.commit('Fix', false)
    expect(t.notices.at(-1)?.[1]).toBe(
      'The commit failed: Author identity unknown\n*** Please tell me who you are.',
    )
    const logged = [...t.log.warn.mock.calls.flat(), ...t.logged].join('\n')
    expect(logged).toContain('NoUserNameConfigured')
    expect(logged).not.toContain('Author identity')
  })
})

describe('commit and push through the workspace admission (M72)', () => {
  it('runs no Git API call when trust ends while push admission awaits', async () => {
    const repository = aheadRepository()
    const t = setup({ repository })
    vi.spyOn(t.window, 'admit').mockImplementation((start) => {
      repository.calls.length = 0
      vi.spyOn(t.window, 'isWorkspaceTrusted').mockReturnValue(false)
      return start()
    })
    await t.git.handleAction('push')
    expect(repository.calls).toEqual([])
    expect(t.notices.at(-1)).toEqual([
      'error',
      `${UI_TEXT.gitPushFailed}: ${UI_TEXT.gitRestricted}`,
    ])
  })

  it('takes its last look at the repository inside the admission, then commits', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository })
    vi.spyOn(t.window, 'admit').mockImplementation((start) => {
      repository.calls.push({ method: 'admit', args: [] })
      return start()
    })
    await t.git.commit('Fix', false)
    const methods = repository.calls.map((call) => call.method)
    expect(methods.slice(methods.indexOf('admit'))).toEqual([
      'admit',
      'status',
      'diff',
      'diff',
      'commit',
    ])
  })

  it('commits nothing when the admission refuses, and says its reason', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository, refusesAdmission: 'The window is closing' })
    await t.git.commit('Fix', false)
    expect(t.admissions()).toBe(1)
    expect(repository.calls.some((call) => call.method === 'commit')).toBe(false)
    expect(t.ofType('gitDone').at(-1)?.ok).toBe(false)
    expect(t.notices.at(-1)).toEqual(['warning', 'The window is closing'])
  })

  it('pushes only inside the admission, and pushes nothing when it refuses', async () => {
    const repository = aheadRepository()
    const t = setup({ repository })
    await t.git.handleAction('push')
    expect(t.admissions()).toBe(1)
    expect(repository.calls.some((call) => call.method === 'push')).toBe(true)
    const refusedRepository = aheadRepository()
    const refused = setup({ repository: refusedRepository, refusesAdmission: 'Trust ended' })
    await refused.git.handleAction('push')
    expect(refusedRepository.calls.some((call) => call.method === 'push')).toBe(false)
    expect(refused.notices.at(-1)).toEqual(['error', 'The push failed: Trust ended'])
  })

  it('says a commit that went through even when the conversation changed under it', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository })
    t.session.id = 'first'
    t.git.sessionChanged('first')
    vi.spyOn(repository, 'commit').mockImplementation(() => {
      t.session.id = 'second'
      t.git.sessionChanged('second')
      return Promise.resolve()
    })
    await t.git.commit('Fix', false)
    expect(t.notices.at(-1)).toEqual(['info', 'Committed “Fix” on docs/how-its-built'])
    expect(t.ofType('gitDone').at(-1)?.ok).toBe(true)
  })

  it('says a push that went through even when the conversation changed under it', async () => {
    const repository = aheadRepository()
    const t = setup({ repository })
    t.session.id = 'first'
    t.git.sessionChanged('first')
    vi.spyOn(repository, 'push').mockImplementation(() => {
      t.session.id = 'second'
      t.git.sessionChanged('second')
      return Promise.resolve()
    })
    await t.git.handleAction('push')
    expect(t.notices.at(-1)).toEqual(['info', 'Pushed docs/how-its-built to origin'])
  })
})

describe('push (M71): always asks, never forces', () => {
  it.each(['head', 'commit', 'upstream', 'remote', 'trust', 'session', 'cancel', 'dispose'])(
    'stops a push when %s changes while its modal waits',
    async (changed) => {
      const repository = aheadRepository()
      const flags = { repository, isTrusted: true }
      const t = setup(flags)
      const dialog = Promise.withResolvers<boolean>()
      const confirm = vi.spyOn(t.window, 'confirmPush').mockReturnValue(dialog.promise)
      const pushing = t.git.handleAction('push')
      await vi.waitFor(() => {
        expect(confirm).toHaveBeenCalledOnce()
      })
      switch (changed) {
        case 'head': {
          repository.state.HEAD = { ...repository.state.HEAD, name: 'other' }
          break
        }
        case 'commit': {
          repository.state.HEAD = { ...repository.state.HEAD, commit: '2'.repeat(40) }
          break
        }
        case 'upstream': {
          repository.state.HEAD = {
            ...repository.state.HEAD,
            upstream: { remote: 'origin', name: 'other' },
          }
          break
        }
        case 'remote': {
          repository.state.remotes = [
            { name: 'origin', fetchUrl: 'https://github.com/other/repository.git' },
          ]
          break
        }
        case 'trust': {
          flags.isTrusted = false
          break
        }
        case 'session': {
          t.session.id = 'another-session'
          t.git.sessionChanged(t.session.id)
          break
        }
        case 'cancel': {
          await t.git.handleAction('cancel')
          break
        }
        case 'dispose': {
          t.git.dispose()
          break
        }
      }
      dialog.resolve(true)
      await pushing
      expect(repository.calls.some((call) => call.method === 'push')).toBe(false)
    },
  )

  it('refuses a branch changed during the remote picker before asking to push', async () => {
    const repository = fakeRepository({ remotes: [{ name: 'one' }, { name: 'two' }] })
    const t = setup({ repository })
    vi.spyOn(t.window, 'pickRemote').mockImplementation(() => {
      repository.state.HEAD = { name: 'other' }
      return Promise.resolve('one')
    })
    await t.git.handleAction('push')
    expect(t.pushConfirmations).toEqual([])
    expect(repository.calls.some((call) => call.method === 'push')).toBe(false)
  })

  it('asks with the remote, its URL masked, the branch and the count, then pushes three arguments', async () => {
    const repository = aheadRepository()
    repository.state.remotes = [
      {
        name: 'origin',
        fetchUrl: `https://${TOKEN_SHAPE}@github.com/RandyNorthrup/muse-spark-code.git`,
      },
    ]
    const t = setup({ repository })
    await t.git.handleAction('push')
    expect(t.pushConfirmations).toEqual([
      {
        remote: 'origin',
        remoteUrl: 'https://[redacted]@github.com/RandyNorthrup/muse-spark-code.git',
        branch: 'docs/how-its-built',
        target: 'docs/how-its-built',
        commits: 1,
      },
    ])
    const push = repository.calls.find((call) => call.method === 'push')
    // Exactly remote, refspec and set-upstream: no fourth, force-mode argument.
    expect(push?.args).toEqual(['origin', 'docs/how-its-built', false])
    expect(t.notices.at(-1)).toEqual(['info', 'Pushed docs/how-its-built to origin'])
  })

  it('ignores a second press while a push is running', async () => {
    const repository = aheadRepository()
    const t = setup({ repository })
    await Promise.all([t.git.handleAction('push'), t.git.handleAction('push')])
    expect(t.pushConfirmations).toHaveLength(1)
    expect(repository.calls.filter((call) => call.method === 'push')).toHaveLength(1)
    // Once it ended, the next press runs.
    await t.git.handleAction('push')
    expect(t.pushConfirmations).toHaveLength(2)
  })

  it.each(['commit', 'pullRequest'] as const)(
    'answers a %s press ignored during a push as failed, so the form comes back',
    async (form) => {
      const t = setup({ repository: aheadRepository() })
      const pushing = t.git.handleAction('push')
      await (form === 'commit'
        ? t.git.commit('Fix', false)
        : t.git.createPullRequest({
            head: 'docs/how-its-built',
            base: 'main',
            title: 'T',
            body: '',
            isDraft: true,
          }))
      expect(t.ofType('gitDone')).toEqual([{ type: 'gitDone', form, ok: false }])
      await pushing
      expect(t.repository.calls.some((call) => call.method === 'commit')).toBe(false)
    },
  )

  it('pushes nothing when the user says no', async () => {
    const repository = aheadRepository()
    const t = setup({ repository, confirmsPush: false })
    await t.git.handleAction('push')
    expect(repository.calls.some((call) => call.method === 'push')).toBe(false)
    expect(t.notices.at(-1)).toEqual(['info', 'Nothing was pushed.'])
  })

  it('refuses, without asking, a branch behind its upstream and a name that would force', async () => {
    const heads = [
      // Behind: the only way through is a force.
      { name: 'feature', upstream: { remote: 'origin', name: 'feature' }, ahead: 2, behind: 1 },
      { name: '+main' },
      { name: '-f' },
    ]
    for (const head of heads) {
      const repository = fakeRepository({ HEAD: head })
      const t = setup({ repository })
      await t.git.handleAction('push')
      expect(t.pushConfirmations, head.name).toEqual([])
      expect(repository.calls.some((call) => call.method === 'push')).toBe(false)
      expect(t.notices.at(-1)?.[0]).toBe('warning')
    }
    const behind = setup({ repository: fakeRepository({ HEAD: heads[0] }) })
    await behind.git.handleAction('push')
    expect(behind.notices.at(-1)?.[1]).toContain('never force-pushes')
  })

  it('makes a first push with -u to the remote the user picks when git cannot tell', async () => {
    const repository = fakeRepository({
      HEAD: { name: 'topic' },
      remotes: [
        { name: 'fork', fetchUrl: 'https://github.com/me/r.git' },
        { name: 'upstream', fetchUrl: 'https://github.com/o/r.git' },
      ],
    })
    const t = setup({ repository, pickRemote: 'fork' })
    await t.git.handleAction('push')
    expect(t.pushConfirmations[0]).toMatchObject({ remote: 'fork', commits: undefined })
    expect(repository.calls.find((call) => call.method === 'push')?.args).toEqual([
      'fork',
      'topic',
      true,
    ])
  })

  it('shows what git and GitHub said, but logs neither: their words can name a path', async () => {
    const path = '/home/someone/secret-project'
    const repository = aheadRepository()
    repository.failNext(
      'push',
      Object.assign(new Error('Failed'), {
        stderr: `fatal: could not read ${path}/.git/config`,
        gitErrorCode: 'PushRejected',
      }),
    )
    const github = fakeGitHub()
    github.answer('POST', `${REPO_PATH}/pulls`, {
      status: 422,
      body: { message: 'Validation Failed', errors: [{ message: `base ${path} invalid` }] },
    })
    const t = setup({ repository, github })
    await t.git.handleAction('push')
    repository.state.HEAD = { ...repository.state.HEAD, ahead: 0, behind: 0 }
    await openForCreation(t)
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: false,
    })
    repository.failNext(
      'status',
      Object.assign(new Error(`fatal: ${path} is not a repository`), {}),
    )
    await t.git.handleAction('openCommit')
    const shown = t.notices.map(([, text]) => text).join('\n')
    expect(shown.split(path)).toHaveLength(4)
    const logged = [...t.log.warn.mock.calls.flat(), ...t.log.info.mock.calls.flat(), ...t.logged]
    expect(logged.join('\n')).not.toContain(path)
  })

  it('says why when git refuses the push', async () => {
    const repository = aheadRepository()
    repository.failNext(
      'push',
      Object.assign(new Error('Failed'), {
        stderr: '! [rejected] main -> main (fetch first)\nerror: failed to push some refs',
        gitErrorCode: 'PushRejected',
      }),
    )
    const t = setup({ repository })
    await t.git.handleAction('push')
    expect(t.notices.at(-1)?.[0]).toBe('error')
    expect(t.notices.at(-1)?.[1]).toContain('[rejected]')
  })
})

describe('Restricted Mode and a held window (M71)', () => {
  it('runs no status on a repository admitted after trust was revoked', async () => {
    const t = setup()
    vi.spyOn(t.window, 'isWorkspaceTrusted').mockReturnValueOnce(true).mockReturnValue(false)
    await t.git.handleAction('openCommit')
    expect(t.repository.calls).toEqual([])
  })

  it('runs no git in Restricted Mode, and says why', async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({ repository, isTrusted: false })
    await t.git.handleAction('openCommit')
    await t.git.handleAction('push')
    await t.git.handleAction('openPullRequest')
    await t.git.commit('Fix', true)
    expect(repository.calls).toEqual([])
    expect(t.notices.every(([, text]) => text.includes('Restricted Mode'))).toBe(true)
    await expect(t.git.promptFor('commitMessage')).rejects.toThrow('Restricted Mode')
  })

  it("runs none in a window held on someone else's pull request, whatever VS Code trusts", async () => {
    const repository = fakeRepository({ indexChanges: [change('a.ts')] })
    const t = setup({
      repository,
      hold: { folder: '/held', pullRequest: undefined },
    })
    await t.git.handleAction('push')
    await t.git.commit('Fix', true)
    expect(repository.calls).toEqual([])
    expect(t.notices[0]?.[1]).toContain('trust this worktree')
    await t.git.handleAction('trustWorktree')
    expect(t.trustRequests()).toBe(1)
  })

  it('shows the hold card, the worktree line and only what changed', () => {
    const t = setup({
      isTrusted: false,
      hold: {
        folder: '/held',
        pullRequest: {
          repository: 'RandyNorthrup/muse-spark-code',
          number: 51,
          url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
          title: 'test: lock Android/Termux P0 behavior',
          author: 'Piangpi1997',
          headSha: '29fe2d8a111e5424c69c3ad0e7328b53a98646af',
          isAuthoredByUser: false,
        },
      },
    })
    t.git.postState(true)
    t.git.postState()
    expect(t.ofType('gitState')).toEqual([
      {
        type: 'gitState',
        state: {
          hold: {
            isRestricted: true,
            pullRequest: {
              repository: 'RandyNorthrup/muse-spark-code',
              number: 51,
              title: 'test: lock Android/Termux P0 behavior',
              author: 'Piangpi1997',
              url: 'https://github.com/RandyNorthrup/muse-spark-code/pull/51',
            },
          },
        },
      },
    ])
    // A fresh webview with nothing to show is sent nothing.
    const plain = setup()
    plain.git.postState(true)
    expect(plain.posted).toEqual([])
  })
})

async function createPrivatePullRequest(t: ReturnType<typeof setup>) {
  await t.git.createPullRequest({
    head: 'docs/how-its-built',
    base: 'main',
    title: 'T',
    body: 'private body',
    isDraft: true,
  })
}

describe('pull requests (M71)', () => {
  it('requires the host-confirmed PR form before creating anything', async () => {
    const t = setup({ repository: aheadRepository() })
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: 'B',
      isDraft: true,
    })
    expect(t.github.requests).toEqual([])
    expect(t.pushConfirmations).toEqual([])
    expect(t.notices.at(-1)?.[1]).toBe(UI_TEXT.gitOpenPullRequestFirst)
  })

  it('refuses a changed destination even when the PR head has the same name', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    t.repository.state.remotes = [
      { name: 'origin', fetchUrl: 'https://github.com/Piangpi1997/muse-spark-code.git' },
    ]
    await createPrivatePullRequest(t)
    expect(t.github.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(t.pushConfirmations).toEqual([])
  })

  it('refuses GitHub changing the fork destination after the form was shown', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    t.github.answer('GET', REPO_PATH, { status: 200, body: CAPTURED_FORK_REPOSITORY })
    await createPrivatePullRequest(t)
    expect(t.github.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(t.pushConfirmations).toEqual([])
  })

  it('stops PR creation after a submitted push when its form was cancelled', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    vi.spyOn(t.repository, 'push').mockImplementation(async () => {
      await t.git.handleAction('cancel')
    })
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: 'B',
      isDraft: true,
    })
    expect(t.pushConfirmations).toHaveLength(1)
    expect(t.github.requests.some((request) => request.method === 'POST')).toBe(false)
  })

  it('opens the form: remote, masked URL, branch and GitHub default base', async () => {
    const github = fakeGitHub()
    github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
    const t = setup({ repository: aheadRepository(), github })
    await t.git.handleAction('openPullRequest')
    expect(t.ofType('gitPullRequestForm')[0]?.form).toEqual({
      repository: 'RandyNorthrup/muse-spark-code',
      remote: 'origin',
      remoteUrl: 'https://github.com/RandyNorthrup/muse-spark-code.git',
      head: 'docs/how-its-built',
      base: 'main',
      push: 'needed',
      commits: 1,
    })
    expect(t.tokenRequests).toEqual(['ask'])
  })

  it('links the open pull request that already exists instead of opening another', async () => {
    const t = setup({ repository: aheadRepository() })
    t.session.id = 'session-1'
    await t.git.handleAction('openPullRequest')
    expect(t.ofType('gitPullRequestForm')).toEqual([])
    expect(t.notices[0]?.[1]).toContain('#56 is already open')
    expect(t.window.links.get('session-1')).toMatchObject({ number: 56 })
    expect(t.ofType('gitState').at(-1)?.state.pullRequest).toMatchObject({
      number: 56,
      state: 'open',
      checks: { passed: 5, running: 1 },
    })
  })

  it('refuses a remote that is not on github.com', async () => {
    const repository = aheadRepository()
    repository.state.remotes = [{ name: 'origin', fetchUrl: 'https://gitlab.com/o/r.git' }]
    const t = setup({ repository })
    await t.git.handleAction('openPullRequest')
    expect(t.notices[0]?.[1]).toContain('github.com only')
    expect(t.github.requests).toEqual([])
  })

  it('pushes nothing when the sign-in is declined or GitHub cannot be reached', async () => {
    const request = {
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: false,
    }
    const signedOut = setup({ repository: aheadRepository(), isSignedOut: true })
    await signedOut.git.createPullRequest(request)
    const github = fakeGitHub()
    github.failNetwork(new TypeError('fetch failed'))
    const offline = setup({ repository: aheadRepository(), github })
    await offline.git.createPullRequest(request)
    for (const t of [signedOut, offline]) {
      expect(t.pushConfirmations).toEqual([])
      expect(t.repository.calls.some((call) => call.method === 'push')).toBe(false)
      expect(t.ofType('gitDone').at(-1)?.ok).toBe(false)
    }
  })

  it('sends nothing to GitHub when the sign-in is declined', async () => {
    const t = setup({ repository: aheadRepository(), isSignedOut: true })
    await t.git.handleAction('openPullRequest')
    expect(t.github.requests).toEqual([])
    expect(t.notices.at(-1)?.[1]).toContain('sign-in was not given')
  })

  it('pushes first (asking), creates the pull request as shown, and links it', async () => {
    const github = fakeGitHub()
    github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
    const repository = aheadRepository()
    const t = setup({ repository, github })
    t.session.id = 'session-1'
    await openForCreation(t)
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: ' README: how this extension is built ',
      body: 'Body',
      isDraft: true,
    })
    expect(t.pushConfirmations).toHaveLength(1)
    expect(repository.calls.find((call) => call.method === 'push')?.args).toEqual([
      'origin',
      'docs/how-its-built',
      false,
    ])
    const created = github.requests.find((request) => request.method === 'POST')
    expect(created?.body).toEqual({
      title: 'README: how this extension is built',
      body: 'Body',
      head: 'docs/how-its-built',
      base: 'main',
      draft: true,
    })
    expect(created?.authorization).toBe(`Bearer ${FAKE_GITHUB_TOKEN}`)
    expect(t.ofType('gitDone')).toEqual([{ type: 'gitDone', form: 'pullRequest', ok: true }])
    expect(t.window.links.get('session-1')).toMatchObject({ number: 56 })
  })

  it('creates nothing when the push is declined', async () => {
    const t = setup({ repository: aheadRepository(), confirmsPush: false })
    await openForCreation(t)
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: false,
    })
    expect(t.github.requests.some((request) => request.method === 'POST')).toBe(false)
    expect(t.ofType('gitDone')).toEqual([{ type: 'gitDone', form: 'pullRequest', ok: false }])
  })

  it('masks a credential in the title or body and sends nothing', async () => {
    const t = setup({ repository: aheadRepository() })
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: `token ${TOKEN_SHAPE}`,
      isDraft: false,
    })
    expect(t.github.requests).toEqual([])
    expect(t.pushConfirmations).toEqual([])
    expect(t.ofType('gitDraft')[0]?.draft).toEqual({
      kind: 'pullRequest',
      title: 'T',
      body: 'token [redacted]',
    })
  })

  it('refuses a changed branch, a base that is not a plain name, and an empty title', async () => {
    const t = setup({ repository: aheadRepository() })
    const request = {
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: false,
    }
    await t.git.createPullRequest({ ...request, head: 'other' })
    await t.git.createPullRequest({ ...request, base: '+main' })
    await t.git.createPullRequest({ ...request, title: '  ' })
    expect(t.github.requests.some((r) => r.method === 'POST')).toBe(false)
    expect(t.pushConfirmations).toEqual([])
    expect(t.notices.map(([, text]) => text)).toEqual([
      'The branch changed since the form opened. Open the form again.',
      'That base branch name would not mean only itself to git.',
      'Give the pull request a title.',
    ])
  })

  it("says GitHub's refusal and keeps the form", async () => {
    const github = fakeGitHub()
    github.answer('POST', `${REPO_PATH}/pulls`, { status: 422, body: CAPTURED_ALREADY_EXISTS })
    const repository = fakeRepository({
      HEAD: {
        name: 'docs/how-its-built',
        upstream: { remote: 'origin', name: 'docs/how-its-built' },
        ahead: 0,
        behind: 0,
      },
    })
    const t = setup({ repository, github })
    await openForCreation(t)
    await t.git.createPullRequest({
      head: 'docs/how-its-built',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: false,
    })
    // Up to date: no push asked.
    expect(t.pushConfirmations).toEqual([])
    expect(t.notices.at(-1)?.[1]).toContain('A pull request already exists')
    expect(t.ofType('gitDone').at(-1)?.ok).toBe(false)
  })

  it("opens a fork's pull request on its parent, the head named owner:branch", async () => {
    const github = fakeGitHub()
    github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
    const repository = fakeRepository({
      HEAD: { name: 'android-termux-p0-tests' },
      remotes: [{ name: 'origin', fetchUrl: 'https://github.com/Piangpi1997/muse-spark-code.git' }],
    })
    const t = setup({ repository, github })
    await t.git.handleAction('openPullRequest')
    expect(t.ofType('gitPullRequestForm')[0]?.form).toMatchObject({
      repository: 'RandyNorthrup/muse-spark-code',
      headRepository: 'Piangpi1997/muse-spark-code',
      head: 'android-termux-p0-tests',
      push: 'needed',
    })
    expect(github.requests.at(-1)?.path).toContain('head=Piangpi1997%3Aandroid-termux-p0-tests')
    await t.git.createPullRequest({
      head: 'android-termux-p0-tests',
      base: 'main',
      title: 'T',
      body: '',
      isDraft: true,
    })
    const created = github.requests.find((request) => request.method === 'POST')
    expect(created?.path).toBe(`${REPO_PATH}/pulls`)
    expect(created?.body).toMatchObject({ head: 'Piangpi1997:android-termux-p0-tests' })
  })
})

/** A pull request created before the conversation had a session. */
async function openedBeforeAnySession() {
  const github = fakeGitHub()
  github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
  const t = setup({ repository: aheadRepository(), github })
  await openForCreation(t)
  await t.git.createPullRequest({
    head: 'docs/how-its-built',
    base: 'main',
    title: 'T',
    body: '',
    isDraft: false,
  })
  return t
}

describe('the linked pull request (M71)', () => {
  it('shows a resumed conversation its pull request, with failed checks named', async () => {
    const github = fakeGitHub()
    github.answer('GET', `${REPO_PATH}/commits/${OWN_SHA}/check-runs`, {
      status: 200,
      body: CAPTURED_CHECKS_FAILED,
    })
    github.answer('GET', `${REPO_PATH}/commits/${OWN_SHA}/status`, {
      status: 200,
      body: CAPTURED_STATUS_FAILED,
    })
    const t = setup({ github })
    await t.window.links.set('s1', {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 56,
      url: CAPTURED_PULL_OWN.html_url,
      title: 'old title',
      linkedAt: 1,
    })
    t.git.sessionChanged('s1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const view = t.ofType('gitState').at(-1)?.state.pullRequest
    expect(view).toMatchObject({
      number: 56,
      title: 'README: how this extension is built',
      state: 'open',
      checks: {
        failed: 2,
        failedNames: ['build / quality (macos-latest)', 'TypeScript Localization Update'],
      },
    })
    expect(t.tokenRequests).toEqual(['silent'])
  })

  it('forgets a pull request opened before any session when the conversation is cleared', async () => {
    const t = await openedBeforeAnySession()
    expect(t.ofType('gitState').at(-1)?.state.pullRequest?.number).toBe(56)
    t.git.sessionChanged(undefined)
    t.git.sessionChanged('s-new')
    expect(t.ofType('gitState').at(-1)?.state).toEqual({})
    expect(t.window.links.get('s-new')).toBeUndefined()
  })

  it('links a pull request opened before any session to the session that starts next', async () => {
    const t = await openedBeforeAnySession()
    t.git.sessionChanged('s-first')
    await vi.waitFor(() => {
      expect(t.window.links.get('s-first')).toMatchObject({ number: 56 })
    })
  })

  it('asks for a sign-in only when the user presses it, and shows a refusal as it came', async () => {
    const t = setup({ isSignedOut: true })
    await t.window.links.set('s1', {
      repository: 'RandyNorthrup/muse-spark-code',
      number: 56,
      url: CAPTURED_PULL_OWN.html_url,
      title: 't',
      linkedAt: 1,
    })
    t.git.sessionChanged('s1')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(t.ofType('gitState').at(-1)?.state.pullRequest?.needsSignIn).toBe(true)
    await t.git.handleAction('signInGitHub')
    expect(t.tokenRequests).toEqual(['silent', 'ask'])
    t.git.sessionChanged(undefined)
    expect(t.ofType('gitState').at(-1)?.state).toEqual({})
  })
})

/** A reply and its turn's end, as the backends send them. */
function completed(turnId: string, text: string): AgentEvent[] {
  return [
    {
      type: 'itemCompleted',
      item: { itemId: `m-${turnId}`, kind: 'agentMessage', status: 'completed', turnId, text },
    },
    { type: 'turnCompleted', turnId, terminal: 'completed' },
  ]
}

describe('drafts inside the user’s own turn (M71)', () => {
  it('retires the first commit form draft after a manual commit before opening second.ts', async () => {
    const repository = fakeRepository({ indexChanges: [change('first.ts')] })
    const t = setup({ repository })
    await t.git.handleAction('openCommit')
    const old = t.git.generationStarting('commitMessage')
    t.git.generationSubmitted('first-turn', old)
    await t.git.commit('Manual first commit', false)
    expect(t.git.isGenerationCurrent(old)).toBe(false)
    repository.state.indexChanges = [change('second.ts')]
    await t.git.handleAction('openCommit')
    for (const event of completed('first-turn', 'Draft for FIRST commit')) t.git.onEvent(event)
    expect(t.ofType('gitCommitForm').at(-1)?.form.files).toEqual([
      { path: 'second.ts', isStaged: true },
    ])
    expect(t.ofType('gitDraft')).toEqual([])
  })

  it('keys a pending generation to its form instance when another form opens', async () => {
    const t = setup({ repository: fakeRepository({ indexChanges: [change('first.ts')] }) })
    await t.git.handleAction('openCommit')
    const old = t.git.generationStarting('commitMessage')
    await t.git.handleAction('openCommit')
    expect(t.git.isGenerationCurrent(old)).toBe(false)
    t.git.generationSubmitted('old', old)
    for (const event of completed('old', 'Earlier form draft')) t.git.onEvent(event)
    expect(t.ofType('gitDraft')).toEqual([])
  })

  it('compares a fork draft against upstream main, excluding commits from behind origin main', async () => {
    const repository = aheadRepository()
    repository.state.remotes = [
      { name: 'origin', fetchUrl: 'https://github.com/Piangpi1997/muse-spark-code.git' },
      { name: 'upstream', fetchUrl: 'https://github.com/RandyNorthrup/muse-spark-code.git' },
    ]
    const t = setup({ repository })
    await openForCreation(t)
    vi.spyOn(repository, 'log').mockImplementation(({ range }) =>
      Promise.resolve([
        {
          hash: OWN_SHA,
          message: range === 'upstream/main..HEAD' ? 'My change' : 'Unrelated upstream commit',
        },
      ]),
    )
    const diff = vi.spyOn(repository, 'diffBetween')
    const prompt = await t.git.promptFor('pullRequest')
    expect(prompt).toContain('- My change')
    expect(prompt).not.toContain('Unrelated upstream commit')
    expect(diff).toHaveBeenCalledWith('upstream/main', 'HEAD')
  })

  it('refuses a fork draft without a destination fetch remote instead of falling back to origin', async () => {
    const repository = aheadRepository()
    repository.state.remotes = [
      { name: 'origin', fetchUrl: 'https://github.com/Piangpi1997/muse-spark-code.git' },
    ]
    const t = setup({ repository })
    await openForCreation(t)
    await expect(t.git.promptFor('pullRequest')).rejects.toThrow(
      UI_TEXT.gitDestinationBaseUnavailable,
    )
    expect(
      repository.calls.some((call) => ['log', 'diffBetween', 'fetch'].includes(call.method)),
    ).toBe(false)
  })

  it('fetches a missing destination base through admission and verifies the ref before diffing', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    t.repository.failNext('log', new Error('unknown origin/main'))
    await expect(t.git.promptFor('pullRequest')).resolves.toContain('Add the parser')
    expect(t.admissions()).toBe(1)
    const calls = t.repository.calls.filter((call) =>
      ['log', 'fetch', 'diffBetween'].includes(call.method),
    )
    expect(calls.map((call) => call.method)).toEqual(['log', 'fetch', 'log', 'diffBetween'])
    expect(calls[1]?.args).toEqual([{ remote: 'origin', ref: 'main' }])
  })

  it('refuses a destination base still missing after fetch', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    vi.spyOn(t.repository, 'log').mockRejectedValue(new Error('unknown base'))
    await expect(t.git.promptFor('pullRequest')).rejects.toThrow(
      UI_TEXT.gitDestinationBaseUnavailable,
    )
    expect(t.repository.calls.some((call) => call.method === 'diffBetween')).toBe(false)
  })

  it('starts no destination fetch when trust is lost during checkpoint admission', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    t.repository.failNext('log', new Error('unknown base'))
    vi.spyOn(t.window, 'admit').mockImplementation((start) => {
      vi.spyOn(t.window, 'isWorkspaceTrusted').mockReturnValue(false)
      return start()
    })
    await expect(t.git.promptFor('pullRequest')).rejects.toThrow(UI_TEXT.gitRestricted)
    expect(t.repository.calls.some((call) => call.method === 'fetch')).toBe(false)
  })

  it('reports a PR completed during Cancel as successful with its URL and stops linking', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    const original = t.window.github.createPullRequest.bind(t.window.github)
    vi.spyOn(t.window.github, 'createPullRequest').mockImplementation(async (...args) => {
      const created = await original(...args)
      await t.git.handleAction('cancel')
      return created
    })
    const link = vi.spyOn(t.window.links, 'set')
    await t.git.createPullRequest({
      title: 'Title',
      body: '',
      head: 'docs/how-its-built',
      base: 'main',
      isDraft: true,
    })
    expect(t.ofType('gitDone')).toEqual([{ type: 'gitDone', form: 'pullRequest', ok: true }])
    expect(t.notices.at(-1)).toEqual([
      'info',
      `Opened draft pull request #56: ${CAPTURED_PULL_OWN.html_url}`,
    ])
    expect(link).not.toHaveBeenCalled()
    expect(t.ofType('gitState').some((message) => message.state.pullRequest !== undefined)).toBe(
      false,
    )
  })

  it('keeps the PR form when the conversation attaches its first backend session', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    t.session.id = 'first-session'
    t.git.sessionChanged(t.session.id)
    await expect(t.git.promptFor('pullRequest')).resolves.toContain('docs/how-its-built')
  })

  it('ignores an old draft acknowledgement or failure after cancellation and a new request', async () => {
    const t = setup()
    const old = t.git.generationStarting('commitMessage')
    await t.git.handleAction('cancel')
    const current = t.git.generationStarting('commitMessage')
    t.git.generationSubmitted('old-turn', old)
    t.git.onEvent({
      type: 'itemCompleted',
      item: {
        kind: 'agentMessage',
        itemId: 'old-reply',
        status: 'completed',
        turnId: 'old-turn',
        text: 'Stale message',
      },
    })
    t.git.onEvent({ type: 'turnCompleted', turnId: 'old-turn', terminal: 'completed' })
    t.git.generationFailed(old)
    expect(t.git.isGenerationCurrent(current)).toBe(true)
    t.git.generationSubmitted('current-turn', current)
    t.git.onEvent({
      type: 'itemCompleted',
      item: {
        kind: 'agentMessage',
        itemId: 'reply',
        status: 'completed',
        turnId: 'current-turn',
        text: 'Fresh message',
      },
    })
    t.git.onEvent({ type: 'turnCompleted', turnId: 'current-turn', terminal: 'completed' })
    expect(
      t.ofType('gitDraft').filter((message) => message.draft.kind === 'commitMessage'),
    ).toEqual([{ type: 'gitDraft', draft: { kind: 'commitMessage', message: 'Fresh message' } }])
  })

  it('uses the edited PR base and refuses a base that could change git arguments', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    const prompt = await t.git.promptFor('pullRequest', 'release')
    expect(t.repository.calls.find((call) => call.method === 'log')?.args).toEqual([
      { range: 'origin/release..HEAD' },
    ])
    expect(prompt).toContain('release')
    await expect(t.git.promptFor('pullRequest', '+main')).rejects.toThrow(UI_TEXT.gitBaseInvalid)
  })

  it('stops before the PR diff when its branch changes while log awaits', async () => {
    const t = setup({ repository: aheadRepository() })
    await openForCreation(t)
    vi.spyOn(t.repository, 'log').mockImplementation(() => {
      t.repository.state.HEAD = { name: 'other' }
      return Promise.resolve([])
    })
    await expect(t.git.promptFor('pullRequest')).rejects.toThrow(UI_TEXT.gitOperationChanged)
    expect(t.repository.calls.some((call) => call.method === 'diffBetween')).toBe(false)
  })

  it('builds the commit prompt from the staged diff, marked as data', async () => {
    const repository = fakeRepository({ indexChanges: [change('src/a.ts')] })
    const t = setup({ repository })
    const prompt = await t.git.promptFor('commitMessage')
    expect(prompt).toContain(MODEL_TEXT.gitUntrustedData)
    expect(prompt).toContain('Staged files:\n- src/a.ts')
    expect(repository.calls.find((call) => call.method === 'diff')?.args).toEqual([true])
  })

  it('fills the form from the reply to the turn that asked, even when it ends before the ack', () => {
    const t = setup()
    t.git.generationStarting('commitMessage')
    for (const event of completed('t1', '```\nAdd the parser\n```')) {
      t.git.onEvent(event)
    }
    expect(t.ofType('gitDraft')).toEqual([])
    t.git.generationSubmitted('t1')
    expect(t.ofType('gitDraft')).toEqual([
      { type: 'gitDraft', draft: { kind: 'commitMessage', message: 'Add the parser' } },
    ])
  })

  it('ignores other turns once its own is known, and fails a cancelled turn back to the form', () => {
    const t = setup()
    t.git.generationStarting('pullRequest')
    t.git.generationSubmitted('t2')
    for (const event of completed('other', 'Nope')) {
      t.git.onEvent(event)
    }
    expect(t.ofType('gitDraft')).toEqual([])
    t.git.onEvent({ type: 'turnCompleted', turnId: 't2', terminal: 'cancelled' })
    expect(t.ofType('gitDraft')).toEqual([
      { type: 'gitDraft', draft: { kind: 'failed', forKind: 'pullRequest' } },
    ])
    expect(t.notices.at(-1)?.[0]).toBe('warning')
  })

  it('needs the pull request form first, and reads the branch against its base', async () => {
    const github = fakeGitHub()
    github.answer('GET', `${REPO_PATH}/pulls`, { status: 200, body: [] })
    const repository = aheadRepository()
    const t = setup({ repository, github })
    await expect(t.git.promptFor('pullRequest')).rejects.toThrow('pull request form first')
    await t.git.handleAction('openPullRequest')
    const prompt = await t.git.promptFor('pullRequest')
    expect(repository.calls.find((call) => call.method === 'log')?.args).toEqual([
      { range: 'origin/main..HEAD' },
    ])
    expect(prompt).toContain('- Add the parser')
    expect(prompt).toContain('Changed files:\n- src/parser.ts')
    t.git.generationStarting('pullRequest')
    t.git.generationSubmitted('t3')
    for (const event of completed('t3', 'Add the parser\n\nIt parses.')) {
      t.git.onEvent(event)
    }
    expect(t.ofType('gitDraft').at(-1)?.draft).toEqual({
      kind: 'pullRequest',
      title: 'Add the parser',
      body: 'It parses.',
    })
  })

  it('gives the button back when the message does not go', () => {
    const t = setup()
    t.git.generationStarting('commitMessage')
    t.git.generationFailed()
    expect(t.ofType('gitDraft')).toEqual([
      { type: 'gitDraft', draft: { kind: 'failed', forKind: 'commitMessage' } },
    ])
  })
})
