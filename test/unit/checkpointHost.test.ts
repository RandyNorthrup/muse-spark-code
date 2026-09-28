import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  type CheckpointStoreApi,
  createCheckpointPort,
  withCheckpointCopies,
} from '../../src/host/checkpoints/checkpointHost'
import { ignoredChanges, scanIgnored } from '../../src/host/checkpoints/ignoredScan'
import {
  CHECKPOINT_IGNORED_FOLDER_MAX_FILES,
  CHECKPOINT_IGNORED_SCAN_MAX_FILES,
} from '../../src/shared/constants'
import { createGitProcess, GitExitError, processGitProcess } from '../../src/host/git'
import { FakeLogOutputChannel } from './helpers/fakes'
import { countLogged } from './helpers/logText'
import { noopToolIo } from './helpers/fakeToolIo'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-checkpoint-host-')))

afterAll(async () => {
  await removeFolder(base)
})

/** A store whose every method is a spy; only what a test calls matters. */
function fakeStore() {
  const calls: string[] = []
  const store: CheckpointStoreApi = {
    record: vi.fn(() => Promise.resolve()),
    endTurn: vi.fn(() => Promise.resolve()),
    restore: vi.fn(() => Promise.resolve({ ok: false as const, reason: 'noCheckpoint' as const })),
    redo: vi.fn(() => Promise.resolve({ ok: false as const, reason: 'redoGone' as const })),
    capture: vi.fn(() => {
      calls.push('capture')
      return Promise.resolve({ ok: false as const, reason: 'failed' as const, detail: 'x' })
    }),
    beforeToolWrite: vi.fn((absolutePath: string) => {
      calls.push(`copy ${absolutePath}`)
      return Promise.reject(new Error('the shadow repository is busy'))
    }),
    forgetSession: vi.fn((sessionId: string) => {
      calls.push(`forget ${sessionId}`)
      return Promise.resolve()
    }),
    turns: vi.fn(() => Promise.resolve(['t1'])),
  }
  return { store, calls }
}

describe('createCheckpointPort (M72)', () => {
  it('runs no git in Restricted Mode or with the setting off, and says which', async () => {
    const { store, calls } = fakeStore()
    const posture = { isTrusted: false, isEnabled: true }
    const port = createCheckpointPort({
      store,
      isWorkspaceTrusted: () => posture.isTrusted,
      isEnabled: () => posture.isEnabled,
      log: new FakeLogOutputChannel(),
    })
    expect(port.availability()).toBe('restricted')
    expect(await port.capture()).toBeUndefined()
    expect(await port.turns('s1')).toEqual([])
    expect(await port.restore({ sessionId: 's1', turnId: 't1', unsavedPaths: [] })).toEqual({
      ok: false,
      reason: 'noCheckpoint',
    })
    await port.forgetSession('s1')
    posture.isTrusted = true
    posture.isEnabled = false
    expect(port.availability()).toBe('off')
    expect(await port.capture()).toBeUndefined()
    expect(calls).toEqual([])
    posture.isEnabled = true
    expect(port.availability()).toBe('on')
    await port.capture()
    expect(await port.turns('s1')).toEqual(['t1'])
    await port.forgetSession('s1')
    expect(calls).toEqual(['capture', 'forget s1'])
  })

  it('has no folder to checkpoint without a store', async () => {
    const port = createCheckpointPort({
      store: undefined,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      log: new FakeLogOutputChannel(),
    })
    expect(port.availability()).toBe('noFolder')
    expect(await port.capture()).toBeUndefined()
  })
})

describe('withCheckpointCopies (M72)', () => {
  it('copies before each tool write, and a failed copy never fails the write', async () => {
    const { store, calls } = fakeStore()
    const log = new FakeLogOutputChannel()
    const port = createCheckpointPort({
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      log,
    })
    const writes: string[] = []
    const io: ToolIo = {
      ...noopToolIo,
      writeFile: (absolutePath) => {
        writes.push(absolutePath)
        calls.push(`write ${absolutePath}`)
        return Promise.resolve()
      },
    }
    const wrapped = withCheckpointCopies(io, port)
    await wrapped.writeFile('/ws/.env', 'KEY=1')
    expect(calls).toEqual(['copy /ws/.env', 'write /ws/.env'])
    expect(writes).toEqual(['/ws/.env'])
    expect(countLogged(log, 'the shadow repository is busy')).toBe(1)
  })
})

describe('the ignored-file scan (M72)', () => {
  it('reads sizes and times, walks a small ignored folder, and leaves out a large one', async () => {
    const root = path.join(base, 'scan')
    await mkdir(path.join(root, 'dist'), { recursive: true })
    await mkdir(path.join(root, 'huge'), { recursive: true })
    await writeFile(path.join(root, '.env'), 'A=1')
    await writeFile(path.join(root, 'dist', 'a.js'), 'x')
    for (let index = 0; index <= CHECKPOINT_IGNORED_FOLDER_MAX_FILES; index += 1) {
      await writeFile(path.join(root, 'huge', `f${String(index)}`), '')
    }
    const inventory = await scanIgnored(root, ['.env'], ['dist', 'huge'])
    const scanned = [...inventory.files].map(([key]) => key).toSorted((a, b) => a.localeCompare(b))
    expect(scanned).toEqual(['.env', 'dist/a.js'])
    expect(inventory.files.get('.env')?.size).toBe(3)
    expect(inventory.skippedFolders).toEqual(['huge'])
    expect(inventory.isPartial).toBe(false)
    expect(CHECKPOINT_IGNORED_SCAN_MAX_FILES).toBeGreaterThan(CHECKPOINT_IGNORED_FOLDER_MAX_FILES)
  })

  it('tells created, changed and deleted files apart, and says nothing where it did not look', () => {
    const start = {
      files: new Map([
        ['kept.log', { size: 1, mtimeMs: 1 }],
        ['changed.log', { size: 1, mtimeMs: 1 }],
        ['deleted.log', { size: 1, mtimeMs: 1 }],
      ]),
      skippedFolders: ['node_modules'],
      isPartial: false,
    }
    const end = {
      files: new Map([
        ['kept.log', { size: 1, mtimeMs: 1 }],
        ['changed.log', { size: 2, mtimeMs: 5 }],
        ['new.log', { size: 3, mtimeMs: 6 }],
        ['node_modules/x/added.js', { size: 1, mtimeMs: 6 }],
      ]),
      skippedFolders: [],
      isPartial: false,
    }
    expect(ignoredChanges(start, end)).toEqual([
      {
        path: 'changed.log',
        kind: 'changed',
        startStat: { size: 1, mtimeMs: 1 },
        endStat: { size: 2, mtimeMs: 5 },
      },
      { path: 'deleted.log', kind: 'deleted', startStat: { size: 1, mtimeMs: 1 }, endStat: null },
      { path: 'new.log', kind: 'created', startStat: null, endStat: { size: 3, mtimeMs: 6 } },
    ])
  })
})

describe('createGitProcess (M72)', () => {
  const git = processGitProcess()
  const env = process.env

  it('feeds stdin and returns stdout as bytes', async () => {
    const oid = await git(['hash-object', '--stdin'], {
      cwd: base,
      env,
      input: 'hello\n',
      timeoutMs: 30_000,
    })
    expect(oid.toString('utf8').trim()).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })

  it('rejects a non-zero exit with its code and what git said', async () => {
    const failing = git(['cat-file', '-t', 'not-an-object'], { cwd: base, env, timeoutMs: 30_000 })
    await expect(failing).rejects.toBeInstanceOf(GitExitError)
    await expect(failing).rejects.toMatchObject({ exitCode: 128 })
  })

  it('rejects when git is only reachable relatively, without running anything', async () => {
    const spawn = vi.fn()
    const relative = createGitProcess({
      platform: 'linux',
      env: { PATH: '.:bin' },
      fileExists: () => true,
      spawn,
    })
    await expect(relative(['status'], { cwd: base, env: {}, timeoutMs: 1000 })).rejects.toThrow(
      /not found/,
    )
    expect(spawn).not.toHaveBeenCalled()
  })
})
