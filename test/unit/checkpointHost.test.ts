import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  type CheckpointPort,
  type CheckpointStoreApi,
  createCheckpointPort,
  prepareCheckpointTurn,
  withCheckpointCopies,
} from '../../src/host/checkpoints/checkpointHost'
import { ignoredChanges, scanIgnored } from '../../src/host/checkpoints/ignoredScan'
import {
  CHECKPOINT_IGNORED_FOLDER_MAX_FILES,
  CHECKPOINT_IGNORED_SCAN_MAX_FILES,
  type CheckpointAvailability,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  createGitProcess,
  GitExitError,
  GitMissingError,
  processGitProcess,
} from '../../src/host/git'
import { noopToolIo } from './helpers/fakeToolIo'
import { removeFolder } from './helpers/temporaryFolders'
import { FakeLogOutputChannel } from './helpers/fakes'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-checkpoint-host-')))

afterAll(async () => {
  await removeFolder(base)
})

/** A store whose every method records its call; only what a test calls matters. */
function fakeStore() {
  const calls: string[] = []
  const done = (call: string) => {
    calls.push(call)
    return Promise.resolve()
  }
  const store: CheckpointStoreApi = {
    isNativeUnsafe: false,
    markNativeBackend: () => done('native'),
    markUnprovenProcess: () => done('unproved'),
    capture: () => {
      calls.push('capture')
      return Promise.resolve({ ok: false as const, reason: 'failed' as const, detail: 'x' })
    },
    release: () => done('release'),
    record: (sessionId) => done(`record ${sessionId}`),
    markTurn: (key, isRunning) => done(`mark ${key} ${String(isRunning)}`),
    endTurn: (sessionId) => done(`end ${sessionId}`),
    turns: () => {
      calls.push('turns')
      return Promise.resolve(['t1'])
    },
    restore: () => {
      calls.push('restore')
      return Promise.resolve({ ok: false as const, reason: 'noCheckpoint' as const })
    },
    redo: () => {
      calls.push('redo')
      return Promise.resolve({ ok: false as const, reason: 'redoGone' as const })
    },
    forgetSession: (sessionId) => done(`forget ${sessionId}`),
    queueForget: (sessionId) => done(`queue ${sessionId}`),
    maintain: () => done('maintain'),
    beforeToolWrite: (absolutePath) => {
      calls.push(`copy ${absolutePath}`)
      return Promise.reject(new Error('the staging folder is full'))
    },
  }
  return { store, calls }
}

const NO_SNAPSHOT = {
  tree: 't',
  coverage: { skipped: [], repositories: [] },
  inventory: { files: new Map(), skippedFolders: [], isPartial: false },
  createdAt: 0,
  pin: 'refs/muse-spark/pin/1',
  folders: [],
}

function portOver(posture: { isTrusted: boolean; isEnabled: boolean; hasGit: boolean }) {
  const { store, calls } = fakeStore()
  const port = createCheckpointPort({
    isNamespaceKnown: () => true,
    store,
    isWorkspaceTrusted: () => posture.isTrusted,
    isEnabled: () => posture.isEnabled,
    hasGit: () => posture.hasGit,
  })
  return { port, calls }
}

/** A port that neither takes a capture nor offers a turn or a restore. */
async function expectNothingOffered(
  port: CheckpointPort,
  availability: CheckpointAvailability,
): Promise<void> {
  expect(port.availability()).toBe(availability)
  expect(await port.capture()).toBeUndefined()
  expect(await port.turns('s1')).toEqual([])
  expect(
    await port.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      unsavedPaths: () => [],
    }),
  ).toEqual({
    ok: false,
    reason: 'unavailable',
  })
}

describe('createCheckpointPort (M72)', () => {
  it('refuses unknown canonical namespaces before any process or turn can start', async () => {
    const { store, calls } = fakeStore()
    const port = createCheckpointPort({
      store,
      isNamespaceKnown: () => false,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    await expectNothingOffered(port, 'noFolder')
    await expect(port.markNativeBackend()).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    await expect(port.markUnprovenProcess()).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    await expect(port.markTurn('turn', true)).rejects.toThrow(UI_TEXT.checkpointsNativeUnsafe)
    expect(calls).toEqual([])
    const shell = vi.fn(noopToolIo.runShell)
    const wrapped = withCheckpointCopies({ ...noopToolIo, runShell: shell }, port)
    await expect(wrapped.runShell('write something', '/ws', 1000)).rejects.toThrow(
      UI_TEXT.checkpointFailed,
    )
    expect(shell).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatch(/^mark workspace-activity:.* false$/)
  })

  it('runs no git in Restricted Mode, and queues an archived conversation for later', async () => {
    const { port, calls } = portOver({ isTrusted: false, isEnabled: true, hasGit: true })
    await expectNothingOffered(port, 'restricted')
    expect(
      await port.redo({ backend: () => 'modelApi', restoreId: 'r1', unsavedPaths: () => [] }),
    ).toEqual({
      ok: false,
      reason: 'unavailable',
    })
    await port.endTurn('s1', 't1')
    await port.maintain()
    await port.forgetSession('s1')
    await port.markTurn('k1', true)
    expect(calls).toEqual(['queue s1', 'mark k1 true'])
  })

  it('with the setting off takes and offers nothing new, but finishes what is under way', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: false, hasGit: true })
    await expectNothingOffered(port, 'off')
    await port.record('s1', 't1', NO_SNAPSHOT)
    await port.endTurn('s1', 't1')
    await port.redo({ backend: () => 'modelApi', restoreId: 'r1', unsavedPaths: () => [] })
    await port.forgetSession('s1')
    await port.maintain()
    expect(calls).toEqual(['release', 'end s1', 'redo', 'forget s1', 'maintain'])
  })

  it('says when git is missing, and runs none', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: false })
    expect(port.availability()).toBe('noGit')
    expect(await port.capture()).toBeUndefined()
    await port.maintain()
    expect(calls).toEqual([])
  })

  it('takes and offers checkpoints when on', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    expect(port.availability()).toBe('on')
    await port.capture()
    await port.record('s1', 't1', NO_SNAPSHOT)
    expect(await port.turns('s1')).toEqual(['t1'])
    await port.restore({
      backend: () => 'modelApi',
      sessionId: 's1',
      turnId: 't1',
      unsavedPaths: () => [],
    })
    expect(calls).toEqual(['capture', 'record s1', 'turns', 'restore'])
  })

  it('has no folder to checkpoint without a store', async () => {
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store: undefined,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    expect(port.availability()).toBe('noFolder')
    expect(await port.capture()).toBeUndefined()
  })
})

describe('prepareCheckpointTurn (M72)', () => {
  it('awaits capture and durable record before admitting queued or scheduled edits', async () => {
    const { store, calls } = fakeStore()
    const captured = Promise.withResolvers<undefined>()
    const persisted = Promise.withResolvers<undefined>()
    store.capture = async () => {
      calls.push('capture')
      await captured.promise
      return { ok: true, snapshot: NO_SNAPSHOT }
    }
    store.record = async () => {
      calls.push('record')
      await persisted.promise
    }
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    let isAdmitted = false
    const preparation = (async () => {
      await prepareCheckpointTurn(port, 's1', 't2', new FakeLogOutputChannel())
      isAdmitted = true
    })()
    await vi.waitFor(() => {
      expect(calls).toContain('capture')
    })
    expect(isAdmitted).toBe(false)
    captured.resolve(undefined)
    await vi.waitFor(() => {
      expect(calls).toContain('record')
    })
    expect(isAdmitted).toBe(false)
    persisted.resolve(undefined)
    await preparation
    expect(isAdmitted).toBe(true)
  })

  it('reuses the checkpoint already captured for the panel submission', async () => {
    const { port, calls } = portOver({ isTrusted: true, isEnabled: true, hasGit: true })
    await prepareCheckpointTurn(port, 's1', 't1', new FakeLogOutputChannel())
    expect(calls).toEqual(['mark s1\0t1 true', 'turns'])
  })

  it('releases a refused preimage and logs failure kind without storage paths', async () => {
    const { store, calls } = fakeStore()
    store.capture = () => Promise.resolve({ ok: true, snapshot: NO_SNAPSHOT })
    store.record = () => Promise.reject(new Error('EACCES /private/profile/store'))
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
    })
    const log = new FakeLogOutputChannel()
    await prepareCheckpointTurn(port, 's1', 't2', log)
    expect(calls).toContain('release')
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('/private/profile')
  })
})

describe('withCheckpointCopies (M72)', () => {
  it('awaits an activity mark before starting shell or hook work', async () => {
    const { store, calls } = fakeStore()
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    store.markTurn = async (_key, isRunning) => {
      if (!isRunning) {
        return
      }
      entered.resolve(undefined)
      await resume.promise
    }
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => false,
      hasGit: () => true,
    })
    const work = vi.fn(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
        isWorkspaceShutdownProven: true as const,
      }),
    )
    const io = withCheckpointCopies({ ...noopToolIo, runShell: work, runHook: work }, port)
    const running = io.runShell('owned no-process fixture', '/ws', 1000)
    try {
      await entered.promise
      expect(work).not.toHaveBeenCalled()
    } finally {
      resume.resolve(undefined)
    }
    await running
    expect(work).toHaveBeenCalledOnce()
    expect(calls).not.toContain('unproved')
  })
  it('copies before each tool write, and a copy that fails fails the write', async () => {
    const { store, calls } = fakeStore()
    const port = createCheckpointPort({
      isNamespaceKnown: () => true,
      store,
      isWorkspaceTrusted: () => true,
      isEnabled: () => true,
      hasGit: () => true,
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
    await expect(wrapped.writeFile('/ws/.env', 'KEY=1')).rejects.toThrow(
      'the staging folder is full',
    )
    await expect(wrapped.reserveFile('/ws/image.png')).rejects.toThrow('the staging folder is full')
    await expect(
      wrapped.writeFileIfUnchanged('/ws/.env', 'expected', 'KEY=2', {
        expectedCanonicalPath: '/ws/.env',
        unsavedAt: [],
      }),
    ).rejects.toThrow('the staging folder is full')
    expect(calls).toEqual(['copy /ws/.env', 'copy /ws/image.png', 'copy /ws/.env'])
    expect(writes).toEqual([])
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
    await expect(
      relative(['status'], { cwd: base, env: {}, timeoutMs: 1000 }),
    ).rejects.toBeInstanceOf(GitMissingError)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('ends a running command when the window closes, and starts none after', async () => {
    // A stand-in `git` on its own PATH: this Node, which sleeps when asked.
    const bin = path.join(base, 'fake-git-bin')
    await mkdir(bin, { recursive: true })
    const fake = path.join(bin, process.platform === 'win32' ? 'git.exe' : 'git')
    await copyFile(process.execPath, fake)
    const sleeper = createGitProcess({
      platform: process.platform,
      env: { PATH: bin },
      fileExists: existsSync,
      spawn,
    })
    const stopping = new AbortController()
    const running = sleeper(['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: base,
      env: process.env,
      timeoutMs: 60_000,
      signal: stopping.signal,
    })
    setTimeout(() => {
      stopping.abort()
    }, 200)
    await expect(running).rejects.toThrow(/window is closing/)
    await expect(
      sleeper(['-e', '0'], {
        cwd: base,
        env: process.env,
        timeoutMs: 60_000,
        signal: stopping.signal,
      }),
    ).rejects.toThrow(/not started/)
  })
})
