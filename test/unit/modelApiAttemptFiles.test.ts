// The production manager and native ToolIO over real Git worktrees: changing
// only host.workspaceRoot must not retain the parent's file-list closure.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ModelApiBackendManager } from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { createToolIo } from '../../src/host/backend/toolIo'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { createWorkspaceFileLister } from '../../src/host/mention/workspaceFiles'
import { processGitRunner } from '../../src/host/git'
import { fakeModelApi } from './helpers/fakeModelApi'
import { fakeManagerDeps } from './helpers/modelApiManager'
import { FakeLogOutputChannel } from './helpers/fakes'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

it('lists new and uncommitted attempt files through the production adapter without parent-only names', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'muse-attempt-files-'))
  roots.push(temp)
  const parent = path.join(temp, 'parent')
  const attempt = path.join(temp, 'attempt')
  await mkdir(parent)
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  }
  const git = processGitRunner({ env })
  const automaticGit = processGitRunner({ env, isAutomatic: true })
  await git(['init'], parent)
  await git(['config', 'user.name', 'Offline test'], parent)
  await git(['config', 'user.email', 'offline@example.invalid'], parent)
  await writeFile(path.join(parent, 'tracked.txt'), 'initial\n')
  await git(['add', '--all'], parent)
  await git(['commit', '-m', 'fixture'], parent)
  await automaticGit(['worktree', 'add', '-b', 'attempt-fixture', attempt, 'HEAD'], parent)
  await writeFile(path.join(parent, 'parent-only.txt'), 'not in attempt\n')
  await writeFile(path.join(attempt, 'attempt-only.txt'), 'new\n')
  await writeFile(path.join(attempt, 'tracked.txt'), 'uncommitted\n')
  const log = new FakeLogOutputChannel()
  const list = (workspaceRoot: string) =>
    createWorkspaceFileLister({
      workspaceRoot,
      respectGitIgnore: () => true,
      isWorkspaceTrusted: () => true,
      runGit: automaticGit,
      findFiles: () => Promise.resolve([]),
      log,
    })()
  const api = fakeModelApi()
  let ids = 0
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: parent,
      io: createToolIo({
        platform: process.platform,
        listFiles: () => list(parent),
        systemRoot: process.env['SystemRoot'],
        env: () => env,
        searchWorkerPath: 'unused',
        log: () => undefined,
        unsavedFiles: () => [],
      }),
      listAttemptFiles: list,
      contextIo: fileContextIo,
      newId: () => `offline-${String(++ids)}`,
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
    }),
  )
  const host = await manager.buildAttemptHost(attempt, () => undefined)
  try {
    const session = await host.startSession({
      workspaceRoot: attempt,
      modelId: 'muse-spark-1.3',
      approvalMode: 'promptUnmatched',
    })
    const done = Promise.withResolvers<undefined>()
    session.onEvent((event) => {
      if (event.type === 'turnCompleted') done.resolve(undefined)
    })
    api.script({ calls: [{ name: 'list_files', arguments: '{}' }] }, { text: 'done' })
    await session.sendTurn([{ type: 'text', text: 'list this worktree' }])
    await done.promise
    const replay = JSON.stringify(api.responseBodies())
    expect(replay).toContain('attempt-only.txt')
    expect(replay).toContain('tracked.txt')
    expect(replay).not.toContain('parent-only.txt')
  } finally {
    await host.close()
    await manager.dispose()
  }
})
