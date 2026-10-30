// Git in the runtime panel (M104 lane B, D104): the conversation controller's
// own git buttons and forms, served by the native route over the editor's
// services (dist/nativeGit.js), on real repositories with the user's own git.
// The editor answers the push question and takes the terminal as an editor
// would; nothing is pushed anywhere but to a bare repository of the suite's
// own. The GitHub half (the device flow, `gh`) needs the network and the
// machine's credential store, so it is proved at the adapter
// (nativeGitPullRequests.test.ts) and not here.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { processGitRunner } from '../../src/host/git'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { parseMhpResult } from '../../src/shared/hostApi/protocol'
import { testGit } from './helpers/nativeGitHarness'
import type { ChatSurface } from './helpers/panelEditor'
import { confirmations, connectedPanel } from './helpers/panelConversation'
import { createPanelRun, type PanelRun } from './helpers/panelRun'
import { assertCurrentProductionBuild } from './productionBuild'

const ROOT = process.cwd()
const runs: PanelRun[] = []

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
})

afterAll(async () => {
  for (const run of runs) await run.dispose()
})

/** A workspace that is a repository of its own with one commit, and the git that made it. */
function repositoryRun() {
  const run = createPanelRun('muse-panel-git-')
  runs.push(run)
  run.prepare()
  const git = testGit(run.folder)
  git.run(run.workspace, 'init', '-q', '-b', 'main')
  for (const [key, value] of [
    ['user.name', 'Panel Suite'],
    ['user.email', 'panel@example.invalid'],
    ['commit.gpgsign', 'false'],
  ] as const)
    git.run(run.workspace, 'config', key, value)
  writeFileSync(path.join(run.workspace, 'base.txt'), 'base\n')
  git.run(run.workspace, 'add', 'base.txt')
  git.run(run.workspace, 'commit', '-q', '-m', 'Base')
  return { run, git }
}

/** The name the environment holds the PATH under (Windows keeps its own casing). */
function pathVariable(): { path: string } {
  return { path: Object.keys(process.env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH' }
}

/** What the person is shown next that is a notice of this level. */
async function noticeOf(chat: ChatSurface, level: 'info' | 'warning' | 'error') {
  return await chat.shown('notice', (payload) => payload['level'] === level)
}

describe('git in the runtime panel', () => {
  it('shows the commit form of the workspace’s repository and commits through it', async () => {
    const { run, git } = repositoryRun()
    writeFileSync(path.join(run.workspace, 'a.txt'), 'a\n')
    const { host, editor, exit } = await connectedPanel(run, { runGit: processGitRunner() })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openCommit' })
    expect(await chat.shown('gitCommitForm')).toMatchObject({
      form: { branch: 'main', staged: 0, unstaged: 1, files: [{ path: 'a.txt', isStaged: false }] },
    })
    chat.say({ type: 'gitCommit', message: 'Add a', includeUnstaged: true })
    expect(await chat.shown('gitDone')).toMatchObject({ form: 'commit', ok: true })
    expect(git.run(run.workspace, 'log', '-1', '--format=%s')).toBe('Add a')
    expect(git.run(run.workspace, 'status', '--porcelain')).toBe('')
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('asks before it pushes, names every part of the push, and pushes only on a yes', async () => {
    const { run, git } = repositoryRun()
    const remote = path.join(run.folder, 'remote.git')
    git.run(run.folder, 'init', '-q', '--bare', '-b', 'main', remote)
    git.run(run.workspace, 'remote', 'add', 'origin', remote)
    const { host, editor, exit } = await connectedPanel(run, { runGit: processGitRunner() })
    const { asked, reached } = confirmations(host, [null, 1])
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'push' })
    await reached(1)
    const [question] = asked
    expect(question?.title).toBe(fill(UI_TEXT.gitPushConfirm, { branch: 'main', remote: 'origin' }))
    for (const part of [
      remote,
      UI_TEXT.gitPushFirstPush,
      UI_TEXT.gitPushNeverForce,
      UI_TEXT.gitCommandConsequences,
    ])
      expect(question?.message).toContain(part)
    expect(question?.choices).toEqual([{ id: 1, title: UI_TEXT.gitPushAction }])
    // Closing the question is a no: nothing went up, and the person is told.
    expect(await noticeOf(chat, 'info')).toMatchObject({ text: UI_TEXT.gitPushDeclined })
    expect(git.run(remote, 'for-each-ref')).toBe('')
    chat.say({ type: 'gitAction', action: 'push' })
    await reached(2)
    await noticeOf(chat, 'info')
    expect(git.run(remote, 'rev-parse', 'main')).toBe(git.run(run.workspace, 'rev-parse', 'HEAD'))
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('opens a push git itself could not finish in the editor’s terminal, with git’s own command', async () => {
    const { run, git } = repositoryRun()
    const missing = path.join(run.folder, 'nowhere.git')
    git.run(run.workspace, 'remote', 'add', 'origin', missing)
    const { host, editor, exit } = await connectedPanel(run, { runGit: processGitRunner() })
    const shown = Promise.withResolvers<unknown>()
    const created: unknown[] = []
    host.serve('terminal/create', (params) => {
      created.push(params)
      return { terminalId: 'terminal-1' }
    })
    host.serve('terminal/show', (params) => {
      shown.resolve(params)
      return null
    })
    const { reached } = confirmations(host, [1])
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'push' })
    await reached(1)
    // The failure is said in the panel, git's words redacted first, and the same command opens for the person to finish.
    expect(await noticeOf(chat, 'error')).toMatchObject({
      text: expect.stringContaining('does not appear to be a git repository'),
    })
    expect(await shown.promise).toEqual({ terminalId: 'terminal-1' })
    expect(created).toEqual([
      {
        cwd: pathToFileURL(run.workspace).href,
        executable: expect.stringMatching(/git(\.exe)?$/u),
        args: expect.arrayContaining(['push', 'origin']),
        env: {},
      },
    ])
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('runs no git in a workspace the editor does not trust, and starts once it does', async () => {
    const { run, git } = repositoryRun()
    writeFileSync(path.join(run.workspace, 'a.txt'), 'a\n')
    // The user's own runner, watched: what git is asked is what the product asks.
    const runner = processGitRunner()
    const asked: (readonly string[])[] = []
    const { host, editor, exit } = await connectedPanel(run, {
      runGit: (args, cwd) => {
        asked.push(args)
        return runner(args, cwd)
      },
      trusted: false,
    })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openCommit' })
    expect(await noticeOf(chat, 'warning')).toMatchObject({ text: UI_TEXT.gitRestricted })
    chat.say({ type: 'gitCommit', message: 'Add a', includeUnstaged: true })
    expect(await noticeOf(chat, 'warning')).toMatchObject({ text: UI_TEXT.gitRestricted })
    expect(git.run(run.workspace, 'status', '--porcelain')).toBe('?? a.txt')
    expect(asked.filter((args) => args.includes('rev-parse'))).toEqual([])
    // Trusting the workspace rebuilds the conversation, and its Git opens.
    host.send({ jsonrpc: '2.0', method: 'workspace/didGrantTrust', params: { trusted: true } })
    const trusted = await editor.nextSurface()
    trusted.say({ type: 'gitAction', action: 'openCommit' })
    expect(await trusted.shown('gitCommitForm')).toMatchObject({
      form: { branch: 'main', files: [{ path: 'a.txt', isStaged: false }] },
    })
    expect(asked.some((args) => args.includes('rev-parse'))).toBe(true)
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })

  it('says why there is no Git in a workspace that is no repository, and with no git program', async () => {
    const run = createPanelRun('muse-panel-git-')
    runs.push(run)
    run.prepare()
    const first = await connectedPanel(run, { runGit: processGitRunner() })
    const chat = await first.editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openCommit' })
    expect(await noticeOf(chat, 'warning')).toMatchObject({
      text: UI_TEXT.gitWorkspaceNotRepository,
    })
    parseMhpResult('shutdown', await first.host.request('shutdown', {}))
    expect(await first.exit).toBe(0)
    // The same with no git program on the PATH at all.
    const { path: variable } = pathVariable()
    const saved = process.env[variable]
    process.env[variable] = path.join(run.folder, 'no-programs-here')
    let second: Awaited<ReturnType<typeof connectedPanel>>
    let other: ChatSurface
    try {
      second = await connectedPanel(run, { runGit: processGitRunner() })
      other = await second.editor.nextSurface()
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, variable)
      else process.env[variable] = saved
    }
    other.say({ type: 'gitAction', action: 'openCommit' })
    expect(await noticeOf(other, 'warning')).toMatchObject({ text: UI_TEXT.gitProgramMissing })
    parseMhpResult('shutdown', await second.host.request('shutdown', {}))
    expect(await second.exit).toBe(0)
  })

  it('works on the repository around a workspace that is one of its folders', async () => {
    const run = createPanelRun('muse-panel-git-')
    runs.push(run)
    run.prepare()
    const git = testGit(run.folder)
    git.run(run.folder, 'init', '-q', '-b', 'main')
    writeFileSync(path.join(run.workspace, 'inner.txt'), 'inner\n')
    const { host, editor, exit } = await connectedPanel(run, { runGit: processGitRunner() })
    const chat = await editor.nextSurface()
    chat.say({ type: 'gitAction', action: 'openCommit' })
    const { form } = await chat.shown('gitCommitForm')
    // The repository is git's toplevel: the workspace's file is named from there.
    expect(form).toMatchObject({
      branch: 'main',
      files: expect.arrayContaining([{ path: 'workspace/inner.txt', isStaged: false }]),
    })
    parseMhpResult('shutdown', await host.request('shutdown', {}))
    expect(await exit).toBe(0)
  })
})
