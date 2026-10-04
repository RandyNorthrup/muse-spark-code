import { mkdir, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as atomic from '../../src/host/fsAtomic'
import type { ShellResult, ToolIo } from '../../src/core/backends/modelapi/tools'
import {
  createCheckpointPort,
  withCheckpointStorageGuard,
} from '../../src/host/checkpoints/checkpointHost'
import { enteringShell, noopToolIo } from './helpers/fakeToolIo'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { turnKey } from '../../src/host/checkpoints/checkpointStore'
import { readArchives } from '../../src/host/checkpoints/checkpointArchives'
import { didWriteRef } from '../../src/host/checkpoints/recordRefs'
import { ShadowGit } from '../../src/host/checkpoints/shadowGit'
import { GitExitError, processGitProcess } from '../../src/host/git'
import {
  CHECKPOINT_NATIVE_WINDOW,
  CHECKPOINT_FENCED_WINDOW,
  CHECKPOINT_ACTIVITY_PREFIX,
  UI_TEXT,
} from '../../src/shared/constants'
import {
  holdRestoreRef,
  changedFileTurn,
  restoreOutcome,
  harness,
  isPresent,
  owner,
  read,
  REAL_GIT_TIMEOUT_MS,
  redoOutcome,
  removeCheckpointFolders,
  restoreTurn,
  shadowGit,
  shadowRefs,
  storedUnit,
  storedUnits,
  toolWrite,
  turn,
  recordingOf,
  twoFileTurn,
  write,
} from './helpers/checkpointHarness'

// Independent stores, real Git refs and real file bytes. The retired
// store.lock/records.json implementation is not used or mocked here.
afterEach(removeCheckpointFolders)
const realGit = processGitProcess()
const SHORT_HEARTBEAT_MS = 50
const OLD_PRESENCE_MS = 10 * 60 * 1000
const UNIT_REF = '/m86/unit/'

/** Real shadow refs, with command failures injected only after initialization. */
async function refFixture() {
  const h = await harness()
  await h.store.turns('none')
  const shadow = new ShadowGit(
    {
      storageDir: h.storage,
      top: h.top,
      platform: process.platform,
      instance: h.store.instance,
    },
    { git: realGit, env: process.env, signal: new AbortController().signal },
  )
  const ref = 'refs/muse-spark/test-lock'
  const previous = await shadow.text(['hash-object', '-w', '--stdin'], { input: 'previous' })
  const next = await shadow.text(['hash-object', '-w', '--stdin'], { input: 'next' })
  await shadow.run(['update-ref', ref, previous])
  return { h, shadow, ref, previous, next }
}

describe('checkpoint ref lock contention', () => {
  it.each(['present', 'absent'])(
    'retries one git exit failure while the previous ref is %s, then persists the next value',
    async (state) => {
      const { h, shadow, ref, previous, next } = await refFixture()
      if (state === 'absent') {
        await shadow.run(['update-ref', '-d', ref])
      }
      const run = shadow.run.bind(shadow)
      let attempts = 0
      vi.spyOn(shadow, 'run').mockImplementation(async (args, command) => {
        if (args[0] === 'update-ref') {
          attempts += 1
          if (attempts === 1) {
            throw new GitExitError(1, 'cannot lock ref: File exists', 'update-ref')
          }
        }
        return await run(args, command)
      })
      await expect(
        didWriteRef(shadow, ref, next, state === 'absent' ? undefined : previous),
      ).resolves.toBe(true)
      expect(attempts).toBe(2)
      expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(next)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'throws the git error after exactly three unchanged-ref failures',
    async () => {
      const { h, shadow, ref, previous, next } = await refFixture()
      const run = shadow.run.bind(shadow)
      const error = new GitExitError(1, 'cannot lock ref: File exists', 'update-ref')
      let attempts = 0
      vi.spyOn(shadow, 'run').mockImplementation(async (args, command) => {
        if (args[0] === 'update-ref') {
          attempts += 1
          throw error
        }
        return await run(args, command)
      })
      await expect(didWriteRef(shadow, ref, next, previous)).rejects.toBe(error)
      expect(attempts).toBe(3)
      expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(previous)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'aborts during the contention wait without another write attempt',
    async () => {
      const { h, shadow, ref, previous, next } = await refFixture()
      const run = shadow.run.bind(shadow)
      const controller = new AbortController()
      let attempts = 0
      vi.spyOn(shadow, 'run').mockImplementation(async (args, command) => {
        if (args[0] === 'update-ref') {
          attempts += 1
          throw new GitExitError(1, 'cannot lock ref: File exists', 'update-ref')
        }
        const output = await run(args, command)
        if (args[0] === 'for-each-ref' && args.includes(ref)) {
          // Abort after the re-read, once didWriteRef has entered its wait.
          setTimeout(() => {
            controller.abort()
          }, 0)
        }
        return output
      })
      await expect(
        didWriteRef(shadow, ref, next, previous, controller.signal),
      ).rejects.toMatchObject({
        name: 'AbortError',
      })
      expect(attempts).toBe(1)
      expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(previous)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'returns false without retrying when another writer wins the compare-and-swap',
    async () => {
      const { h, shadow, ref, previous, next } = await refFixture()
      const rival = await shadow.text(['hash-object', '-w', '--stdin'], { input: 'rival' })
      const run = shadow.run.bind(shadow)
      let attempts = 0
      vi.spyOn(shadow, 'run').mockImplementation(async (args, command) => {
        if (args[0] === 'update-ref') {
          attempts += 1
          await run(['update-ref', ref, rival, previous], command)
        }
        return await run(args, command)
      })
      await expect(didWriteRef(shadow, ref, next, previous)).resolves.toBe(false)
      expect(attempts).toBe(1)
      expect(shadowGit(h.storage, ['rev-parse', ref]).trim()).toBe(rival)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
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

/** A store whose next write of a unit record (a fold, not a number) fails once. */
async function failingFold() {
  let isFailing = false
  const h = await harness({
    gitProcess: async (args, options) => {
      const isFold =
        args.includes('update-ref') &&
        args.some((arg) => arg.includes(UNIT_REF)) &&
        !args.includes('0000000000000000000000000000000000000000')
      if (isFailing && isFold) {
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

describe('CheckpointStore across independent windows (M72, M86)', () => {
  it.each(['shell', 'hook'] as const)(
    'keeps %s activity fenced with recording off and sticky after unproved completion',
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
      const io: ToolIo = { ...noopToolIo, runShell: enteringShell(work), runHook: work }
      const wrapped = withCheckpointStorageGuard(io, port)
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
        expect(await redoOutcome(port, previous.restoreId)).toEqual({
          ok: false,
          reason: 'nativeUnsafe',
        })
        const names = await readdir(path.join(h.storage, 'windows'))
        expect(await read(h.storage, `windows/${names[0] ?? ''}`)).toContain(
          CHECKPOINT_ACTIVITY_PREFIX,
        )
      } finally {
        resume.release()
      }
      await running
      expect(h.store.isNativeUnsafe).toBe(true)
      expect(await redoOutcome(port, previous.restoreId)).toEqual({
        ok: false,
        reason: 'nativeUnsafe',
      })
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
      const wrapped = withCheckpointStorageGuard(
        { ...noopToolIo, runShell: enteringShell(() => Promise.resolve(shellResult(true))) },
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
      const io = withCheckpointStorageGuard({ ...noopToolIo, runShell: enteringShell(work) }, port)
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
          transcriptTurnIds: ['t1'],
          unsavedPaths: () => [],
        }),
      ).toEqual({ ok: false, reason: 'backendUnsupported' })
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      const restored = await restoreTurn(h.store, 't1')
      expect(
        await h.store.redo({
          backend: () => backend,
          sourceSessionId: 's1',
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
      const restoring = restoreOutcome(h.store, 't1')
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
      if (phase === 'before') {
        // The native start won the race: it runs, so the restore refuses.
        expect(await restoring).toEqual({ ok: false, reason: 'nativeUnsafe' })
        expect(await read(h.root, 'a.txt')).toBe('a1\n')
      } else {
        // The restore won: the start was refused and every caller then starts
        // nothing, so its fence is withdrawn and the restore goes ahead (Codex,
        // PR #55); the other window is not left unsafe.
        expect(await restoring).toMatchObject({ ok: true })
        expect(await read(h.root, 'a.txt')).toBe('a0\n')
        expect(other.isNativeUnsafe).toBe(false)
      }
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
      await native.markNativeBackend()
      await h.store.maintain()
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
      const unitsBefore = storedUnits(h.storage)
      const unsafeFile = unsafeFiles[0]
      if (unsafeFile === undefined) {
        throw new Error('expected exactly one owned unsafe marker')
      }
      // This fixture owns no native child. It models explicit user confirmation
      // of full native shutdown, not a production inference from the owner PID.
      await rm(unsafeFile)
      expect(shadowRefs(h.storage)).toEqual(refsBefore)
      expect(storedUnits(h.storage)).toEqual(unitsBefore)
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
                  staged: async (staged) => {
                    await options.staged?.(staged)
                    backend = undefined
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
          transcriptTurnIds: ['t1'],
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
      // A failure nobody can prove changed nothing stays unsettled in the batch.
      const batch = storedUnits(h.storage).find((unit) => unit.owner.unitKind === 'batch')
      expect(batch?.writes.map((entry) => entry.outcome)).toEqual(['unsettled'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a committed file deletion and Redo when empty-folder cleanup fails',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('made/a.txt', 'created by turn\n'))
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
      const redone = await redoOutcome(h.reopen(), restored.restoreId)
      expect(redone).toMatchObject({ ok: true, changed: ['made/a.txt'] })
      expect(await read(h.root, 'made/a.txt')).toBe('created by turn\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a failed end’s copies in its journal, its turn published, and seals it before the next operation',
    async () => {
      const { h, failNext } = await failingFold()
      await write(h.root, '.env', 'original\n')
      const unit = owner(h.store, 't1')
      await h.store.markTurn(turnKey('s1', 't1'), true)
      await h.store.startUnit(unit)
      await toolWrite(h.store, unit, h.root, '.env', 'changed\n')
      failNext()
      await expect(h.store.endUnit(unit, { ranProcesses: false })).rejects.toThrow(
        'injected end-record failure',
      )
      await h.store.markTurn(turnKey('s1', 't1'), false)
      expect(storedUnit(h.storage, 't1').status).toBe('incomplete')
      const other = h.reopen()
      // The turn stays published until its end is sealed.
      expect(await restoreOutcome(other, 't1')).toEqual({ ok: false, reason: 'turnElsewhere' })
      await h.store.turns('s1')
      expect(storedUnit(h.storage, 't1')).toMatchObject({ status: 'complete' })
      await restoreTurn(other, 't1')
      expect(await read(h.root, '.env')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a window that publishes and creates its files during cleanup enumeration',
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
            writeFileSync(path.join(storage, 'work-new-window.index'), 'index\n')
            mkdirSync(path.join(storage, 'm86', 'new-window'), { recursive: true })
            writeFileSync(path.join(storage, 'm86', 'new-window', 'journal.jsonl'), '')
          }
          return pid === process.pid
        },
      })
      storage = h.storage
      await h.store.turns('s1')
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
      expect(await read(h.storage, 'staging/new-window/copy')).toBe('original\n')
      expect(await isPresent(h.storage, 'work-new-window.index')).toBe(true)
      expect(await isPresent(h.storage, 'm86/new-window/journal.jsonl')).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'reports an applied Redo when its batch cannot be sealed, and seals it before the next operation',
    async () => {
      const { h, failNext } = await failingFold()
      await changedFileTurn(h)
      const restored = await restoreTurn(h.store, 't1')
      failNext()
      const result = await redoOutcome(h.store, restored.restoreId)
      expect(result).toMatchObject({ ok: true, changed: ['a.txt'], isRedoSpent: true })
      if (!result.ok || result.restoreId === undefined) {
        throw new Error('expected the Redo’s own Redo')
      }
      expect(await read(h.root, 'a.txt')).toBe('a1\n')
      expect(storedUnit(h.storage, result.restoreId).status).toBe('incomplete')
      await h.store.turns('s1')
      expect(storedUnit(h.storage, result.restoreId).status).toBe('complete')
      const inverse = await redoOutcome(h.reopen(), result.restoreId)
      expect(inverse).toMatchObject({ ok: true, changed: ['a.txt'] })
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'observes an already-persisted unit ref when its command reports a late failure',
    async () => {
      let isFailing = false
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          if (
            isFailing &&
            args.includes('update-ref') &&
            args.some((arg) => arg.includes(UNIT_REF))
          ) {
            isFailing = false
            throw new GitExitError(-1, 'injected transport failure after persistence', 'update-ref')
          }
          return output
        },
      })
      await write(h.root, 'a.txt', 'original\n')
      isFailing = true
      await turn(h, 't1', (tool) => tool('a.txt', 'changed\n'))
      expect(storedUnits(h.storage).map((unit) => unit.sequence)).toEqual([1])
      expect(storedUnit(h.storage, 't1').endedAt).toBeDefined()
      await restoreTurn(h.store, 't1')
      expect(await read(h.root, 'a.txt')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps both windows’ records when they start units at once',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await Promise.all([
        h.store.startUnit(owner(h.store, 't1', 's1')),
        other.startUnit(owner(other, 'u1', 's2')),
      ])
      expect(await h.store.turns('s2')).toEqual(['u1'])
      expect(await other.turns('s1')).toEqual(['t1'])
      expect(storedUnits(h.storage)).toHaveLength(2)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps a live window’s open unit and journal through another window’s cleanup and recovery',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await write(h.root, 'a.txt', 'before\n')
      const unit = owner(other, 'u1', 's2')
      await other.startUnit(unit)
      await toolWrite(other, unit, h.root, 'a.txt', 'after\n', 'published')
      await h.store.maintain()
      expect(storedUnit(h.storage, 'u1')).toMatchObject({ status: 'incomplete', writes: [] })
      expect(await isPresent(h.storage, `m86/${other.instance}/journal.jsonl`)).toBe(true)
      await other.endUnit(unit, { ranProcesses: false })
      expect(storedUnit(h.storage, 'u1').writes.map((entry) => entry.outcome)).toEqual([
        'unsettled',
      ])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses another window’s running turn, then leaves its later write alone',
    async () => {
      const h = await harness()
      const other = h.reopen()
      await twoFileTurn(h)
      await turn(
        { store: other, root: h.root },
        'u1',
        (tool) => tool('b.txt', 'other window\n'),
        's2',
      )
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
    'ends only the window’s own units',
    async () => {
      const h = await harness()
      const unit = owner(h.store, 't1')
      await h.store.startUnit(unit)
      await h.reopen().endUnit(unit, { ranProcesses: false })
      expect(storedUnit(h.storage, 't1').endedAt).toBeUndefined()
      await h.store.endUnit(unit, { ranProcesses: false })
      expect(storedUnit(h.storage, 't1').endedAt).toBeDefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'persists an archive before window close and hides the conversation’s units from then on',
    async () => {
      const h = await harness()
      await turn(h, 't1', (tool) => tool('a.txt', 'new\n'))
      await h.store.queueForget('s1')
      const archives = await readArchives(h.storage)
      expect(archives.map((entry) => entry.archive.sessionId)).toEqual(['s1'])
      h.store.dispose()
      const other = h.reopen()
      expect(await other.turns('s1')).toEqual([])
      await other.maintain()
      expect(storedUnits(h.storage).filter((unit) => unit.owner.sessionId === 's1')).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'writes an archive without Git even before any record exists',
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
      const first = restoreOutcome(h.store, 't1')
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
    'preserves a later user edit when a failed end is sealed later',
    async () => {
      const { h, failNext } = await failingFold()
      await write(h.root, 'a.txt', 'a0\n')
      const unit = owner(h.store, 't1')
      await h.store.startUnit(unit)
      await toolWrite(h.store, unit, h.root, 'a.txt', 'a1\n')
      failNext()
      await expect(h.store.endUnit(unit, { ranProcesses: false })).rejects.toThrow(
        'injected end-record failure',
      )
      await write(h.root, 'a.txt', 'later user edit\n')
      await h.store.turns('s1')
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
      await turn(h, 't1', async (tool) => {
        await tool('a.txt', 'a1\n')
        await tool('b.txt', 'b1\n')
      })
      const journal = recordingOf(h.store).journal
      const appendIntent = journal.appendIntent.bind(journal)
      const stopAfterIntent = vi
        .spyOn(journal, 'appendIntent')
        .mockImplementation(async (entry) => {
          await appendIntent(entry)
          if (entry.owner.unitKind === 'batch' && entry.path === 'b.txt') h.store.dispose()
        })
      let outcome: Awaited<ReturnType<typeof h.store.restore>>
      try {
        outcome = await h.store.restore({
          backend: () => 'modelApi',
          sessionId: 's1',
          turnId: 't1',
          transcriptTurnIds: ['t1'],
          unsavedPaths: () => [],
        })
      } finally {
        stopAfterIntent.mockRestore()
      }
      expect(outcome).toMatchObject({
        ok: true,
        changed: ['a.txt'],
        refused: [{ path: 'b.txt', reason: 'failed' }],
      })
      if (!outcome.ok || outcome.restoreId === undefined) {
        throw new Error('expected a durable partial Redo')
      }
      // The batch records the write it made, sealed as the window closed; the
      // next one stopped after its intent and before any change, so it stays
      // unsettled, for a later restore to judge by the bytes.
      const batch = storedUnit(h.storage, outcome.restoreId)
      expect(batch.writes.map((entry) => [entry.path, entry.outcome])).toEqual([
        ['a.txt', 'done'],
        ['b.txt', 'unsettled'],
      ])
      expect(await read(h.root, 'a.txt')).toBe('a0\n')
      expect(await read(h.root, 'b.txt')).toBe('b1\n')
      const redone = await redoOutcome(h.reopen(), outcome.restoreId)
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
    'removes only the folders the turn’s writes made, innermost first',
    async () => {
      const h = await harness()
      await mkdir(path.join(h.root, 'empty'))
      await mkdir(path.join(h.root, 'outer', 'inner'), { recursive: true })
      await turn(h, 't1', async (tool) => {
        await tool('empty/new.txt', 'new\n')
        await tool('outer/inner/x.txt', 'new\n')
        await tool('made/deep/n.txt', 'new\n')
      })
      await restoreTurn(h.store, 't1')
      expect(await readdir(path.join(h.root, 'empty'))).toEqual([])
      expect(await readdir(path.join(h.root, 'outer', 'inner'))).toEqual([])
      expect(await isPresent(h.root, 'made')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
