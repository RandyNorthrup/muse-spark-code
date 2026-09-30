import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as atomic from '../../src/host/fsAtomic'
import type { ShellResult, ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  createCheckpointPort,
  withCheckpointCopies,
} from '../../src/host/checkpoints/checkpointHost'
import { noopToolIo } from './helpers/fakeToolIo'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnKey } from '../../src/host/checkpoints/checkpointStore'
import { readArchives } from '../../src/host/checkpoints/checkpointArchives'
import { GitExitError, processGitProcess } from '../../src/host/git'
import {
  CHECKPOINT_PRUNE_GRACE_MS,
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_ACTIVITY_PREFIX,
  UI_TEXT,
} from '../../src/shared/constants'
import { parseRecord } from '../../src/host/checkpoints/checkpointRecords'
import {
  captured,
  holdRestoreRef,
  changedFileTurn,
  restoreOutcome,
  harness,
  type Harness,
  isPresent,
  leftovers,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreTurn,
  shadowRefs,
  storedRecords,
  turn,
  write,
} from './helpers/checkpointHarness'

// Independent stores, real Git refs and real file bytes. The retired
// store.lock/records.json implementation is not used or mocked here.
afterEach(removeCheckpointFolders)
const realGit = processGitProcess()
const SHORT_HEARTBEAT_MS = 50
const OLD_PRESENCE_MS = 10 * 60 * 1000
// Real filesystem operations with one injectable directory-cleanup failure.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}))
vi.mock('../../src/host/fsAtomic', async (importOriginal) => ({
  ...(await importOriginal<typeof atomic>()),
}))

function gate() {
  const held = Promise.withResolvers<undefined>()
  return {
    promise: held.promise,
    release: () => {
      held.resolve(undefined)
    },
  }
}

async function stagedFiles(storage: string): Promise<number> {
  const folders = await readdir(path.join(storage, 'staging'))
  const lists = await Promise.all(
    folders.map((folder) => readdir(path.join(storage, 'staging', folder))),
  )
  return lists.reduce((sum, list) => sum + list.length, 0)
}

async function failingEnd() {
  let isFailing = false
  const h = await harness({
    gitProcess: async (args, options) => {
      if (
        isFailing &&
        args.includes('update-ref') &&
        args.some((arg) => arg.includes('/record/'))
      ) {
        isFailing = false
        throw new Error('injected end-record failure')
      }
      return await realGit(args, options)
    },
  })
  return {
    h,
    failNext: () => {
      isFailing = true
    },
  }
}

async function windowCaptures(h: Harness) {
  const other = h.reopen()
  const [one, two] = await Promise.all([captured(h.store), captured(other)])
  return { other, one, two }
}

function shellResult(isProven: boolean): ShellResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    isTimedOut: false,
    isCancelled: false,
    ...(isProven && { isWorkspaceShutdownProven: true }),
  }
}

describe('CheckpointStore across independent windows (M72)', () => {
  it.each(['shell', 'hook'] as const)(
    'keeps %s activity fenced with capture off and sticky after unproved completion',
    async (kind) => {
      const h = await harness()
      await changedFileTurn(h)
      const previous = await restoreTurn(h.store, 't1')
      let isEnabled = false
      const port = createCheckpointPort({
        isNamespaceKnown: () => true,
        store: h.store,
        hasGit: () => true,
        isEnabled: () => isEnabled,
        isWorkspaceTrusted: () => true,
      })
      const entered = gate()
      const resume = gate()
      const work = async () => {
        entered.release()
        await resume.promise
        return shellResult(false)
      }
      const io: ToolIo = { ...noopToolIo, runShell: work, runHook: work }
      const wrapped = withCheckpointCopies(io, port)
      const hook = wrapped.runHook
      if (hook === undefined) {
        throw new Error('expected hook wrapper')
      }
      const running =
        kind === 'shell'
          ? wrapped.runShell('owned fixture', h.root, REAL_GIT_TIMEOUT_MS)
          : hook('owned fixture', '{}', h.root, REAL_GIT_TIMEOUT_MS)
      try {
        await entered.promise
        isEnabled = true
        expect(await restoreOutcome(port, 't1')).toEqual({ ok: false, reason: 'nativeUnsafe' })
        expect(
          await port.redo({
            backend: () => 'modelApi',
            restoreId: previous.restoreId ?? '',
            unsavedPaths: () => [],
          }),
        ).toEqual({ ok: false, reason: 'nativeUnsafe' })
        const names = await readdir(path.join(h.storage, 'windows'))
        expect(await read(h.storage, `windows/${names[0] ?? ''}`)).toContain(
          CHECKPOINT_ACTIVITY_PREFIX,
        )
      } finally {
        resume.release()
      }
      await running
      expect(h.store.isNativeUnsafe).toBe(true)
      expect(
        await port.redo({
          backend: () => 'modelApi',
          restoreId: previous.restoreId ?? '',
          unsavedPaths: () => [],
        }),
      ).toEqual({ ok: false, reason: 'nativeUnsafe' })
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'clears an activity lease only for locally owned no-process proof',
    async () => {
      const h = await harness()
      const port = createCheckpointPort({
        isNamespaceKnown: () => true,
        store: h.store,
        hasGit: () => true,
        isEnabled: () => false,
        isWorkspaceTrusted: () => true,
      })
      // This controlled I/O fixture creates no native process or descendant.
      const wrapped = withCheckpointCopies(
        { ...noopToolIo, runShell: () => Promise.resolve(shellResult(true)) },
        port,
      )
      await wrapped.runShell('no process exists', h.root, REAL_GIT_TIMEOUT_MS)
      expect(h.store.isNativeUnsafe).toBe(false)
      const names = await readdir(path.join(h.storage, 'windows'))
      const text = await read(h.storage, `windows/${names[0] ?? ''}`)
      expect(text).not.toContain(CHECKPOINT_ACTIVITY_PREFIX)
      expect(text).not.toContain(CHECKPOINT_NATIVE_WINDOW)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses new noGit shell activity under a held real restore ref without invoking Git or work',
    async () => {
      let canRunGit = true
      const h = await harness({
        gitProcess: async (args, options) => {
          if (!canRunGit) {
            throw new Error('Git must not run in this posture')
          }
          return await realGit(args, options)
        },
      })
      await holdRestoreRef(h)
      canRunGit = false
      const port = createCheckpointPort({
        isNamespaceKnown: () => true,
        store: h.store,
        hasGit: () => false,
        isEnabled: () => false,
        isWorkspaceTrusted: () => false,
      })
      const work = vi.fn(() => Promise.resolve(shellResult(true)))
      const io = withCheckpointCopies({ ...noopToolIo, runShell: work }, port)
      await expect(io.runShell('must not start', h.root, REAL_GIT_TIMEOUT_MS)).rejects.toThrow(
        UI_TEXT.checkpointFailed,
      )
      expect(work).not.toHaveBeenCalled()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['museCode', undefined] as const)(
    'refuses destructive store restore and Redo for actual backend %s',
    async (backend) => {
      const h = await harness()
      await changedFileTurn(h)
      expect(
        await h.store.restore({
          backend: () => backend,
          sessionId: 's1',
          turnId: 't1',
          unsavedPaths: () => [],
        }),
      ).toEqual({ ok: false, reason: 'backendUnsupported' })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      const restored = await restoreTurn(h.store, 't1')
      expect(
        await h.store.redo({
          backend: () => backend,
          restoreId: restored.restoreId ?? '',
          unsavedPaths: () => [],
        }),
      ).toEqual({ ok: false, reason: 'backendUnsupported' })
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['before', 'after'] as const)(
    'refuses a restore when native startup crosses %s the real CAS reservation',
    async (phase) => {
      const entered = gate()
      const resume = gate()
      let isArmed = false
      const h = await harness({
        gitProcess: async (args, options) => {
          const isAdmission =
            isArmed &&
            args.includes('update-ref') &&
            args.includes('refs/muse-spark/restore-active') &&
            !args.includes('-d')
          if (isAdmission) {
            isArmed = false
            if (phase === 'before') {
              entered.release()
              await resume.promise
            }
          }
          const output = await realGit(args, options)
          if (isAdmission && phase === 'after') {
            entered.release()
            await resume.promise
          }
          return output
        },
      })
      await changedFileTurn(h)
      const other = h.reopen()
      await other.turns('s1')
      isArmed = true
      const restoring = h.store.restore({
        backend: () => 'modelApi',
        sessionId: 's1',
        turnId: 't1',
        unsavedPaths: () => [],
      })
      try {
        await entered.promise
        if (phase === 'before') {
          await other.markNativeBackend()
        } else {
          await expect(other.markNativeBackend()).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
        }
      } finally {
        resume.release()
      }
      expect(await restoring).toEqual({ ok: false, reason: 'nativeUnsafe' })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      expect(shadowRefs(h.storage)).not.toContain('refs/muse-spark/restore-active')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps native uncertainty after owner death/dispose, and recovers only by exact confirmed marker removal',
    async () => {
      const h = await harness({ isProcessAlive: (pid) => pid === process.pid })
      await changedFileTurn(h)
      const native = h.reopen(424_242)
      const pending = await captured(native)
      await native.markNativeBackend()
      await h.store.maintain()
      expect(shadowRefs(h.storage)).toContain(pending.pin)
      const names = await readdir(path.join(h.storage, 'windows'))
      const unsafeFiles: string[] = []
      for (const name of names) {
        const file = path.join(h.storage, 'windows', name)
        const text = await read(h.storage, `windows/${name}`)
        if (text.includes(CHECKPOINT_NATIVE_WINDOW)) {
          unsafeFiles.push(file)
        }
      }
      expect(unsafeFiles).toHaveLength(1)
      native.dispose()
      await vi.waitFor(() => {
        expect(native.isNativeUnsafe).toBe(true)
      })
      expect(await restoreOutcome(h.store, 't1')).toEqual({ ok: false, reason: 'nativeUnsafe' })
      const refsBefore = shadowRefs(h.storage)
      const recordsBefore = storedRecords(h.storage)
      const unsafeFile = unsafeFiles[0]
      if (unsafeFile === undefined) {
        throw new Error('expected exactly one owned unsafe marker')
      }
      // This fixture owns no native child. It models explicit user confirmation
      // of full native shutdown, not a production inference from the owner PID.
      await rm(unsafeFile)
      expect(shadowRefs(h.storage)).toEqual(refsBefore)
      expect(storedRecords(h.storage)).toEqual(recordsBefore)
      expect(await h.store.turns('s1')).toEqual(['t1'])
      await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'marks native startup without invoking Git in a Restricted/noGit posture',
    async () => {
      const h = await harness({
        git: 'none',
        gitProcess: () => {
          throw new Error('Git must not run')
        },
      })
      await h.store.markNativeBackend()
      expect(h.store.isNativeUnsafe).toBe(true)
      const names = await readdir(path.join(h.storage, 'windows'))
      expect(names).toHaveLength(1)
      expect(await read(h.storage, `windows/${names[0] ?? ''}`)).toContain(CHECKPOINT_NATIVE_WINDOW)
      await expect(h.store.markTurn(CHECKPOINT_NATIVE_WINDOW, false, false)).rejects.toThrow(
        UI_TEXT.checkpointsNativeUnsafe,
      )
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses packed or unreadable native reservation metadata without revealing storage paths',
    async () => {
      const h = await harness({
        git: 'none',
        gitProcess: () => {
          throw new Error('Git must not run')
        },
      })
      const shadow = path.join(h.storage, 'shadow.git')
      await mkdir(shadow, { recursive: true })
      await writeFile(path.join(shadow, 'packed-refs'), '# unknown packed metadata\n')
      await expect(h.store.markNativeBackend()).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain(h.storage)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'stops a file commit if its attached Model API session is revoked during atomic preparation',
    async () => {
      const h = await harness()
      await changedFileTurn(h)
      let backend: 'modelApi' | undefined = 'modelApi'
      const original = atomic.writeFileIfUnchanged
      const spy = vi
        .spyOn(atomic, 'writeFileIfUnchanged')
        .mockImplementation(async (file, expected, content, options) => {
          return await original(
            file,
            expected,
            content,
            file === path.join(h.root, 'a.txt')
              ? {
                  ...options,
                  realPath: async (target) => {
                    const canonical = await fs.realpath(target)
                    backend = undefined
                    return canonical
                  },
                }
              : options,
          )
        })
      let restored: Awaited<ReturnType<typeof h.store.restore>>
      try {
        restored = await h.store.restore({
          backend: () => backend,
          sessionId: 's1',
          turnId: 't1',
          unsavedPaths: () => [],
        })
      } finally {
        spy.mockRestore()
      }
      expect(restored).toMatchObject({
        ok: true,
        changed: [],
        refused: [{ path: 'a.txt', reason: 'failed' }],
      })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      const files = await readdir(h.root)
      expect(files.filter((name) => name.startsWith('a.txt.'))).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a committed file deletion and Redo when empty-folder cleanup fails',
    async () => {
      const h = await harness()
      await turn(h, 't1', () => write(h.root, 'made/a.txt', 'created by turn\n'))
      const original = fs.rmdir
      const spy = vi.spyOn(fs, 'rmdir').mockImplementation(async (folder, options) => {
        if (folder === path.join(h.root, 'made')) {
          throw Object.assign(new Error('injected directory EACCES'), { code: 'EACCES' })
        }
        await original(folder, options)
      })
      let restored: Awaited<ReturnType<typeof restoreTurn>>
      try {
        restored = await restoreTurn(h.store, 't1')
      } finally {
        spy.mockRestore()
      }
      expect(restored.changed).toEqual(['made/a.txt'])
      expect(await isPresent(h.root, 'made/a.txt')).toBe(false)
      expect(await isPresent(h.root, 'made')).toBe(true)
      expect(restored.restoreId).toBeDefined()
      const redone = await h.reopen().redo({
        backend: () => 'modelApi',
        restoreId: restored.restoreId ?? '',
        unsavedPaths: () => [],
      })
      expect(redone).toMatchObject({ ok: true, changed: ['made/a.txt'] })
      expect(await read(h.root, 'made/a.txt')).toBe('created by turn\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'keeps a failed end’s ignored preimage past prune grace and retries the original boundary',
    async () => {
      const { h, failNext } = await failingEnd()
      const original = 'unique ignored preimage older than prune grace\n'
      await write(h.root, '.gitignore', '.env\n')
      await write(h.root, '.env', original)
      await h.store.record('s1', 't1', await captured(h.store))
      await h.store.beforeToolWrite(path.join(h.root, '.env'))
      await write(h.root, '.env', 'changed\n')
      failNext()
      await expect(h.store.endTurn('s1', 't1')).rejects.toThrow('injected end-record failure')
      const pin = shadowRefs(h.storage).find(
        (ref) => ref.includes('/pin/') && ref.includes('/end-'),
      )
      if (pin === undefined) {
        throw new Error('expected owned pending-end pin')
      }
      const pending = parseRecord(
        execFileSync(
          'git',
          ['--git-dir', path.join(h.storage, 'shadow.git'), 'cat-file', '-p', `${pin}:record.json`],
          { encoding: 'utf8' },
        ),
      )
      if (pending?.kind !== 'checkpoint') {
        throw new Error('expected pending checkpoint metadata')
      }
      const blob = pending.ignored?.changes.find((change) => change.path === '.env')?.preImage
      if (blob === undefined || blob === null) {
        throw new Error('expected ignored preimage blob')
      }
      const object = path.join(
        h.storage,
        'shadow.git',
        'objects',
        blob.oid.slice(0, 2),
        blob.oid.slice(2),
      )
      const old = new Date(Date.now() - CHECKPOINT_PRUNE_GRACE_MS - 1000)
      await utimes(object, old, old)
      const other = h.reopen()
      await other.record('s2', 'other', await captured(other))
      await other.endTurn('s2', 'other')
      await other.forgetSession('s2')
      expect(
        execFileSync(
          'git',
          ['--git-dir', path.join(h.storage, 'shadow.git'), 'cat-file', '-p', blob.oid],
          { encoding: 'utf8' },
        ),
      ).toBe(original)
      await h.store.endTurn('s1', 't1')
      await restoreTurn(other, 't1')
      expect(await read(h.root, '.env')).toBe(original)
      expect(shadowRefs(h.storage).filter((ref) => ref.includes('/end-'))).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'keeps a window that publishes and creates staging/index files during cleanup enumeration',
    async () => {
      let reads = 0
      let storage = ''
      const h = await harness({
        isProcessAlive: (pid) => {
          reads += 1
          if (reads === 2) {
            // The preceding presence directory enumeration cannot include this
            // newly published window; the later file enumerations do include it.
            writeFileSync(
              path.join(storage, 'windows', 'new-window.json'),
              JSON.stringify({
                instance: 'new-window',
                pid: process.pid,
                running: [CHECKPOINT_FENCED_WINDOW, 'pending:message'],
              }),
            )
            mkdirSync(path.join(storage, 'staging', 'new-window'), { recursive: true })
            writeFileSync(path.join(storage, 'staging', 'new-window', 'copy'), 'original\n')
            const index = readdirSync(storage).find(
              (name) => name.startsWith('work-') && name.endsWith('.index'),
            )
            if (index === undefined) {
              throw new Error('expected an existing real Git index')
            }
            copyFileSync(path.join(storage, index), path.join(storage, 'work-new-window.index'))
          }
          return pid === process.pid
        },
      })
      storage = h.storage
      await write(h.root, '.env', 'original\n')
      await captured(h.store)
      await writeFile(
        path.join(storage, 'windows', 'observer.json'),
        JSON.stringify({
          instance: 'observer',
          pid: process.pid,
          running: [CHECKPOINT_FENCED_WINDOW],
        }),
      )
      await h.store.maintain()
      expect(reads).toBeGreaterThan(1)
      expect(await stagedFiles(h.storage)).toBe(1)
      expect(await read(h.storage, 'staging/new-window/copy')).toBe('original\n')
      const storageFiles = await readdir(h.storage)
      expect(
        storageFiles.filter((name) => name.startsWith('work-') && name.endsWith('.index')),
      ).toHaveLength(2)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'reports applied Redo and its inverse when trimming the original record fails',
    async () => {
      let originalRef = ''
      const h = await harness({
        gitProcess: async (args, options) => {
          if (
            originalRef !== '' &&
            args.includes('update-ref') &&
            String(options.input).includes(originalRef)
          ) {
            throw new GitExitError(128, 'injected original-trim IO failure', 'update-ref')
          }
          return await realGit(args, options)
        },
      })
      await changedFileTurn(h)
      const restore = await restoreTurn(h.store, 't1')
      originalRef = `refs/muse-spark/record/${restore.restoreId ?? ''}`
      const result = await h.store.redo({
        backend: () => 'modelApi',
        restoreId: restore.restoreId ?? '',
        unsavedPaths: () => [],
      })
      originalRef = ''
      expect(result).toMatchObject({ ok: true, changed: ['a.txt'], isRedoSpent: false })
      if (!result.ok || result.restoreId === undefined) {
        throw new Error('expected inverse Redo')
      }
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      const inverse = await h
        .reopen()
        .redo({ backend: () => 'modelApi', restoreId: result.restoreId, unsavedPaths: () => [] })
      expect(inverse).toMatchObject({ ok: true, changed: ['a.txt'] })
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'observes an already-persisted ref when its command reports a late failure',
    async () => {
      let isFailing = false
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          if (
            isFailing &&
            args.includes('update-ref') &&
            args.some((arg) => arg.includes('/record/'))
          ) {
            isFailing = false
            throw new GitExitError(-1, 'injected transport failure after persistence', 'update-ref')
          }
          return output
        },
      })
      await write(h.root, 'a.txt', 'original\n')
      const snapshot = await captured(h.store)
      isFailing = true
      await h.store.record('s1', 't1', snapshot)
      await write(h.root, 'a.txt', 'changed\n')
      await h.store.endTurn('s1', 't1')
      expect(
        storedRecords(h.storage).find((entry) => entry.kind === 'checkpoint')?.endedAt,
      ).toBeDefined()
      await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'a.txt')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'protects a live capture that has not been attached to a turn',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'original\n')
      const waiting = await captured(other)
      await h.store.maintain()
      expect(await leftovers(h.storage)).toEqual({ pins: 1, staging: 0 })
      await other.record('s2', 'u1', waiting)
      await write(h.root, 'a.txt', 'changed\n')
      await other.endTurn('s2', 'u1')
      await restoreTurn(other, 'u1', 's2')
      expect(await read(h.root, 'a.txt')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
  it(
    'keeps both windows’ records when they record at once',
    async () => {
      const h = await harness()
      const { other, one, two } = await windowCaptures(h)
      await Promise.all([h.store.record('s1', 't1', one), other.record('s2', 'u1', two)])
      expect(await h.store.turns('s2')).toEqual(['u1'])
      expect(await other.turns('s1')).toEqual(['t1'])
      expect(storedRecords(h.storage)).toHaveLength(2)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'creates one checkpoint for the same turn recorded by two windows',
    async () => {
      const h = await harness()
      const { other, one, two } = await windowCaptures(h)
      await Promise.all([h.store.record('s1', 't1', one), other.record('s1', 't1', two)])
      expect(storedRecords(h.storage)).toHaveLength(1)
      expect(await h.store.turns('s1')).toEqual(['t1'])
      expect(await leftovers(h.storage)).toEqual({ pins: 0, staging: 0 })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a live window’s pinned capture and tool copies through another window’s cleanup',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'before\n')
      const waiting = await captured(other)
      await other.record('s2', 'u1', await captured(other))
      await other.beforeToolWrite(path.join(h.root, 'a.txt'))
      await write(h.root, 'a.txt', 'after\n')
      await h.store.maintain()
      expect(await leftovers(h.storage)).toEqual({ pins: 1, staging: 1 })
      await other.record('s2', 'u2', waiting)
      await captured(other)
      other.dispose()
      await h.store.maintain()
      expect(await leftovers(h.storage)).toEqual({ pins: 0, staging: 0 })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses another window’s running turn, then preserves its overlapping changes',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'a0\n')
      await write(h.root, 'b.txt', 'b0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await other.record('s2', 'u1', await captured(other))
      await write(h.root, 'b.txt', 'other window\n')
      await other.endTurn('s2', 'u1')
      await write(h.root, 'a.txt', 'a1\n')
      await h.store.endTurn('s1', 't1')
      await other.markTurn('pending:message', true)
      expect(await restoreOutcome(h.store, 't1')).toEqual({ ok: false, reason: 'turnElsewhere' })
      await other.markTurn('pending:message', false)
      const outcome = await restoreTurn(h.store, 't1')
      expect(outcome.changed).toEqual(['a.txt'])
      expect(outcome.refused).toEqual([{ path: 'b.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'b.txt')).toBe('other window\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'ends only the window’s own turns',
    async () => {
      const h = await harness()
      await h.store.record('s1', 't1', await captured(h.store))
      await h.reopen().endTurn('s1', 't1')
      const before = storedRecords(h.storage).find((record) => record.kind === 'checkpoint')
      expect(before?.endedAt).toBeUndefined()
      await h.store.endTurn('s1', 't1')
      const after = storedRecords(h.storage).find((record) => record.kind === 'checkpoint')
      expect(after?.endedAt).toBeDefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps ignored preimages while their end record fails, then imports them before trimming',
    async () => {
      const failing = { isArmed: false }
      const h = await harness({
        gitProcess: async (args, options) => {
          if (
            failing.isArmed &&
            args.includes('update-ref') &&
            args.some((arg) => arg.includes('/record/'))
          ) {
            failing.isArmed = false
            throw new Error('injected record failure')
          }
          return await realGit(args, options)
        },
      })
      await write(h.root, '.gitignore', '.env\n')
      await write(h.root, '.env', 'original\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await h.store.beforeToolWrite(path.join(h.root, '.env'))
      await write(h.root, '.env', 'changed\n')
      failing.isArmed = true
      await expect(h.store.endTurn('s1', 't1')).rejects.toThrow('injected record failure')
      await h.store.markTurn(turnKey('s1', 't1'), false)
      expect(await stagedFiles(h.storage)).toBe(1)
      const other = h.reopen()
      expect(await restoreOutcome(other, 't1')).toEqual({ ok: false, reason: 'turnElsewhere' })
      await h.store.endTurn('s1', 't1')
      expect(await stagedFiles(h.storage)).toBe(0)
      await restoreTurn(other, 't1')
      expect(await read(h.root, '.env')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'persists an archive before window close and rejects captures older than it',
    async () => {
      const h = await harness()
      await turn(h, 't1', () => write(h.root, 'a.txt', 'new\n'))
      const earlier = await captured(h.store)
      await h.store.queueForget('s1')
      const archives = await readArchives(h.storage)
      expect(archives.map((entry) => entry.archive.sessionId)).toEqual(['s1'])
      h.store.dispose()
      const other = h.reopen()
      await other.record('s1', 'late', earlier)
      expect(await other.turns('s1')).toEqual([])
      expect(storedRecords(h.storage).filter((record) => record.sessionId === 's1')).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes an archive without Git even before any checkpoint exists',
    async () => {
      const h = await harness({
        gitProcess: () => {
          throw new Error('Git must not run')
        },
      })
      await h.store.queueForget('s1')
      h.store.dispose()
      const archives = await readArchives(h.storage)
      expect(archives.map((entry) => entry.archive.sessionId)).toEqual(['s1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'fails a tool write with localized text when its preimage cannot be staged',
    async () => {
      const h = await harness()
      await h.store.markTurn('pending:message', true)
      await write(h.root, 'b.txt', 'original\n')
      await writeFile(path.join(h.storage, 'staging'), '')
      await expect(h.store.beforeToolWrite(path.join(h.root, 'b.txt'))).rejects.toThrow(
        UI_TEXT.checkpointFailed,
      )
      expect(await read(h.root, 'b.txt')).toBe('original\n')
      expect(JSON.stringify(h.log.warn.mock.calls)).not.toContain(h.storage)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'admits only one independent-window restore and excludes a new turn until it ends',
    async () => {
      const entered = gate()
      const resume = gate()
      const held = { isArmed: false }
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          if (
            held.isArmed &&
            args.includes('update-ref') &&
            args.includes('refs/muse-spark/restore-active') &&
            !args.includes('-d')
          ) {
            held.isArmed = false
            entered.release()
            await resume.promise
          }
          return output
        },
      })
      await changedFileTurn(h)
      const other = h.reopen()
      await other.turns('s1')
      held.isArmed = true
      const first = h.store.restore({
        backend: () => 'modelApi',
        sessionId: 's1',
        turnId: 't1',
        unsavedPaths: () => [],
      })
      try {
        await entered.promise
        expect(await restoreOutcome(other, 't1')).toEqual({ ok: false, reason: 'turnElsewhere' })
        await expect(other.markTurn('next', true)).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
        await other.markTurn('next', false)
        expect(await read(h.root, 'a.txt')).toBe('a1\n')
      } finally {
        resume.release()
      }
      const firstOutcome = await first
      expect(firstOutcome.ok).toBe(true)
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(shadowRefs(h.storage)).not.toContain('refs/muse-spark/restore-active')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'preserves later user edits when a failed end record is retried',
    async () => {
      const { h, failNext } = await failingEnd()
      await write(h.root, 'a.txt', 'a0\n')
      await h.store.record('s1', 't1', await captured(h.store))
      await write(h.root, 'a.txt', 'a1\n')
      failNext()
      await expect(h.store.endTurn('s1', 't1')).rejects.toThrow('injected end-record failure')
      await write(h.root, 'a.txt', 'later user edit\n')
      await h.store.endTurn('s1', 't1')
      const restored = await restoreTurn(h.store, 't1')
      expect(restored.changed).toEqual([])
      expect(restored.refused).toEqual([{ path: 'a.txt', reason: 'changedAfter' }])
      expect(await read(h.root, 'a.txt')).toBe('later user edit\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'stops a cancelled restore before its next file and keeps Redo for exactly what changed',
    async () => {
      const h = await harness()
      await Promise.all([write(h.root, 'a.txt', 'a0\n'), write(h.root, 'b.txt', 'b0\n')])
      await turn(h, 't1', async () => {
        await write(h.root, 'a.txt', 'a1\n')
        await write(h.root, 'b.txt', 'b1\n')
      })
      const outcome = await h.store.restore({
        backend: () => 'modelApi',
        sessionId: 's1',
        turnId: 't1',
        unsavedPaths: () => {
          if (readFileSync(path.join(h.root, 'a.txt'), 'utf8') === 'a0\n') {
            h.store.dispose()
          }
          return []
        },
      })
      expect(outcome).toMatchObject({
        ok: true,
        changed: ['a.txt'],
        refused: [{ path: 'b.txt', reason: 'failed' }],
      })
      if (!outcome.ok || outcome.restoreId === undefined) {
        throw new Error('expected durable partial Redo')
      }
      const record = storedRecords(h.storage).find(
        (entry) => entry.id === outcome.restoreId && entry.kind === 'restore',
      )
      if (record?.kind !== 'restore') {
        throw new Error('expected the partial restore record')
      }
      expect(record.entries.map((entry) => entry.path)).toEqual(['a.txt'])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(await read(h.root, 'b.txt')).toBe('b1\n')
      const redone = await h
        .reopen()
        .redo({ backend: () => 'modelApi', restoreId: outcome.restoreId, unsavedPaths: () => [] })
      expect(redone).toMatchObject({ ok: true, changed: ['a.txt'], isRedoSpent: true })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      expect(await read(h.root, 'b.txt')).toBe('b1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps the window’s presence beating while open',
    async () => {
      const h = await harness({ heartbeatMs: SHORT_HEARTBEAT_MS })
      await h.store.markTurn('pending:message', true)
      const [presence] = await readdir(path.join(h.storage, 'windows'))
      const file = path.join(h.storage, 'windows', presence ?? '')
      const past = new Date(Date.now() - OLD_PRESENCE_MS - 1000)
      await utimes(file, past, past)
      await vi.waitFor(async () => {
        const written = await stat(file)
        expect(Date.now() - written.mtimeMs).toBeLessThan(OLD_PRESENCE_MS)
      })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'preserves pre-existing empty directories while removing directories the turn made',
    async () => {
      const h = await harness()
      await mkdir(path.join(h.root, 'empty'))
      await mkdir(path.join(h.root, 'outer', 'inner'), { recursive: true })
      await turn(h, 't1', async () => {
        await write(h.root, 'empty/new.txt', 'new\n')
        await write(h.root, 'outer/inner/x.txt', 'new\n')
        await write(h.root, 'made/deep/n.txt', 'new\n')
      })
      await restoreTurn(h.store, 't1')
      expect(await readdir(path.join(h.root, 'empty'))).toEqual([])
      expect(await readdir(path.join(h.root, 'outer', 'inner'))).toEqual([])
      expect(await isPresent(h.root, 'made')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
