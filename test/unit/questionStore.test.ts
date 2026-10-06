import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createQuestionStore } from '../../src/runtime/questions/questionStore'
import {
  createHostQuestionStore,
  questionClock,
  questionsDeferAfterSeconds,
} from '../../src/host/questions/questionStore'
import { UI_TEXT } from '../../src/shared/constants'
import { questionFixture } from './helpers/questions/fixtures'
import { removeFolder } from './helpers/temporaryFolders'
import { workspace } from './mocks/vscode'

const folders: string[] = []
afterEach(async () => {
  for (const folder of folders.splice(0)) await removeFolder(folder)
  vi.mocked(workspace.getConfiguration).mockReset()
})
async function directory() {
  const folder = await mkdtemp(path.join(tmpdir(), 'm112-q-'))
  folders.push(folder)
  return folder
}

function get<T>(_section: string, defaultValue?: T): T | undefined {
  return defaultValue
}
function configuration(
  globalValue: unknown,
  workspaceValue: unknown,
): vscode.WorkspaceConfiguration {
  const value: vscode.WorkspaceConfiguration = {
    get,
    has: () => false,
    inspect: () => undefined,
    update: () => Promise.resolve(),
  }
  vi.spyOn(value, 'inspect').mockReturnValue({
    key: 'museSpark.questions.deferAfterSeconds',
    globalValue,
    workspaceValue,
  })
  return value
}

describe('owner-only question persistence', () => {
  it('deletes every crash-left temporary snapshot for the session and preserves other sessions and link targets', async () => {
    const folder = await directory()
    const store = createQuestionStore(folder)
    await store.save('session-1', [questionFixture()])
    const own = ['session-1.json.111.tmp', 'session-1.json.222.tmp']
    const other = ['session-10.json.111.tmp', 'other.json.222.tmp', 'session-1.json.keep']
    for (const name of [...own, ...other])
      await writeFile(path.join(folder, name), 'QUESTION_CRASH_CANARY')
    const target = path.join(folder, 'target')
    await writeFile(target, 'QUESTION_LINK_TARGET')
    await symlink(target, path.join(folder, 'session-1.json.link.tmp'))
    await store.remove('session-1')
    expect(await readdir(folder)).toEqual(expect.arrayContaining([...other, 'target']))
    expect(await readdir(folder)).toHaveLength(other.length + 1)
    expect(await readFile(target, 'utf8')).toBe('QUESTION_LINK_TARGET')
    await writeFile(path.join(folder, own[0] ?? ''), 'QUESTION_SECOND_CRASH')
    await store.remove('session-1')
    expect(await readdir(folder)).toEqual(expect.arrayContaining([...other, 'target']))
    expect(await readdir(folder)).toHaveLength(other.length + 1)
  })

  it('round-trips across host/runtime adapters, enforces permissions, atomically replaces and removes by session', async () => {
    const root = await directory()
    const host = createHostQuestionStore(root)
    expect(await host.load('session-1')).toEqual([])
    await host.save('session-1', [questionFixture()])
    const written = await stat(path.join(root, 'questions/session-1.json'))
    if (process.platform !== 'win32') expect(written.mode & 0o777).toBe(0o600)
    await host.save('other', [questionFixture({ sessionId: 'other' })])
    const runtime = createQuestionStore(path.join(root, 'questions'))
    expect(await runtime.load('session-1')).toEqual([questionFixture()])
    await runtime.save('session-1', [questionFixture({ reminders: 1 })])
    expect(await host.load('session-1')).toEqual([questionFixture({ reminders: 1 })])
    expect(await readdir(path.join(root, 'questions'))).toEqual(['other.json', 'session-1.json'])
    if (process.platform !== 'win32') {
      const directoryStat = await stat(path.join(root, 'questions'))
      const fileStat = await stat(path.join(root, 'questions/session-1.json'))
      expect(directoryStat.mode & 0o777).toBe(0o700)
      expect(fileStat.mode & 0o777).toBe(0o600)
    }
    await host.remove('session-1')
    expect(await runtime.load('session-1')).toEqual([])
    expect(await runtime.load('other')).toHaveLength(1)
  })

  it('rejects corrupt/cross-session data and path traversal, without quoting planted question text', async () => {
    const folder = await directory()
    const store = createQuestionStore(folder)
    const file = path.join(folder, 'session-1.json')
    await writeFile(file, '{"canary":"QUESTION_TEXT_CANARY",BROKEN')
    await expect(store.load('session-1')).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        snapshot: { sessionId: 'other', questions: [questionFixture({ sessionId: 'other' })] },
      }),
    )
    await expect(store.load('session-1')).rejects.toThrow(UI_TEXT.questionAnswerFailed)
    await expect(store.load('../escape')).rejects.toThrow()
    await expect(store.load('x'.repeat(101))).rejects.toThrow(UI_TEXT.answerNotAccepted)
    await expect(
      store.save('session-1', [questionFixture({ sessionId: 'other' })]),
    ).rejects.toThrow()
    await expect(store.remove('../escape')).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toContain('other')
  })

  it('refuses a linked directory/file without writing question text to the target', async () => {
    const root = await directory()
    const other = await directory()
    const linked = path.join(root, 'linked')
    await symlink(other, linked, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(
      createQuestionStore(linked).save('session-1', [questionFixture()]),
    ).rejects.toThrow()
    const target = path.join(other, 'target.json')
    await writeFile(target, 'untouched')
    await symlink(target, path.join(root, 'session-1.json'))
    await expect(createQuestionStore(root).save('session-1', [questionFixture()])).rejects.toThrow()
    await expect(createQuestionStore(root).load('session-1')).rejects.toThrow()
    expect(await readFile(target, 'utf8')).toBe('untouched')
  })

  it('reads only machine settings, with sixty/zero/five-to-ten and a cancellable clock', () => {
    vi.mocked(workspace.getConfiguration).mockReturnValue(configuration(undefined, 0))
    expect(questionsDeferAfterSeconds()).toBe(60)
    vi.mocked(workspace.getConfiguration).mockReturnValue(configuration(0, 60))
    expect(questionsDeferAfterSeconds()).toBe(0)
    vi.mocked(workspace.getConfiguration).mockReturnValue(configuration(5, 3600))
    expect(questionsDeferAfterSeconds()).toBe(10)
    const clock = questionClock()
    expect(clock.now()).toBeGreaterThan(0)
    const cancel = clock.setTimer(0, () => {
      throw new Error('cancelled clock fired')
    })
    cancel()
    cancel()
  })
})

it('repairs owner-only permissions on an existing directory and loaded file', async () => {
  if (process.platform === 'win32') return
  const root = await directory()
  const folder = path.join(root, 'questions')
  await mkdir(folder)
  await chmod(folder, 0o777)
  const store = createQuestionStore(folder)
  await store.save('session-1', [questionFixture()])
  const directoryStat = await stat(folder)
  expect(directoryStat.mode & 0o777).toBe(0o700)
  const file = path.join(folder, 'session-1.json')
  await chmod(file, 0o777)
  expect(await store.load('session-1')).toEqual([questionFixture()])
  const loaded = await stat(file)
  expect(loaded.mode & 0o777).toBe(0o600)
})
