import { mkdir, mkdtemp, readdir, rm, symlink, utimes } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CheckpointStore } from '../../src/host/checkpoints/checkpointStore'
import { legacyCheckpointTurns } from '../../src/host/checkpoints/legacyCheckpoints'
import { gitPathMax } from '../../src/host/checkpoints/shadowGit'
import { type GitProcess, processGitProcess } from '../../src/host/git'
import { CHECKPOINT_STALE_LOCK_MS } from '../../src/shared/constants'
import {
  captured,
  harness,
  type Harness,
  isPresent,
  read,
  redoRestore,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreTurn,
  runGit,
  shadowGit,
  storedRecords,
  turn,
  write,
} from './helpers/checkpointHarness'
import { removeFolder } from './helpers/temporaryFolders'

// Real git over real folders (M72, PLAN.md "Long storage paths"). Git on
// Windows refuses a repository path by PATH_MAX, however `core.longpaths`
// is set: measured with git 2.52.0.windows.1, a `GIT_DIR` of 221 characters
// or more is refused as written absolute, `<git dir>/objects` must fit in
// 259, and a folder git changes into (the work tree, a new repository)
// in 258. These numbers are git's, not the store's: the tests reach them
// with real paths on Windows, and on any platform by lowering the limit
// the store is told (`gitPathMax`) relative to the temporary folder.

const realGit = processGitProcess()
const WINDOWS_PATH_MAX = 260
const ABSOLUTE_MARGIN = 40
const REPOSITORY_MARGIN = 9
const DIRECTORY_MARGIN = 2
const SHADOW_SUFFIX = `${path.sep}shadow.git`.length
const SEGMENT_CHARS = 50
// How far past the temporary folder a lowered limit reaches.
const LOWERED_HEADROOM = 120
const INITIALIZER = /^\.i-[0-9a-f]{12}$/u
// Any initializer folder, under this name or the one an earlier build used.
const INITIALIZER_LIKE = /^(?:\.i-|shadow-.*\.initializing$)/u

afterEach(removeCheckpointFolders)

interface Limits {
  /** What the store is told (undefined: the platform's own). */
  readonly told: number | undefined
  readonly absolute: number
  readonly repository: number
  readonly directory: number
}

function limitsOf(pathMax: number, told: number | undefined): Limits {
  return {
    told,
    absolute: pathMax - ABSOLUTE_MARGIN,
    repository: pathMax - REPOSITORY_MARGIN,
    directory: pathMax - DIRECTORY_MARGIN,
  }
}

const NATURAL = limitsOf(WINDOWS_PATH_MAX, undefined)

/** The limit a test lowers to: near the temporary folder, never past what real git takes. */
function loweredLimits(base: string): Limits {
  const pathMax = Math.min(base.length + LOWERED_HEADROOM, gitPathMax(process.platform))
  return limitsOf(pathMax, pathMax)
}

/** A folder path of exactly `length` characters below `parent`. */
function pathOfLength(parent: string, length: number): string {
  let remaining = length - parent.length
  if (remaining < SEGMENT_CHARS) {
    throw new Error(`the temporary folder is too long (${String(parent.length)}) for this fixture`)
  }
  const names: string[] = []
  while (remaining > SEGMENT_CHARS + 2) {
    names.push('d'.repeat(SEGMENT_CHARS))
    remaining -= SEGMENT_CHARS + 1
  }
  names.push('e'.repeat(remaining - 1))
  const made = path.join(parent, ...names)
  expect(made).toHaveLength(length)
  return made
}

/** A storage folder whose repository (`shadow.git` in it) is `repository` characters long. */
function storageFor(base: string, repository: number): string {
  return pathOfLength(path.join(base, 'g'), repository - SHADOW_SUFFIX)
}

interface Call {
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
}

function recordingGit(calls: Call[]): GitProcess {
  return async (args, options) => {
    calls.push({ args, cwd: options.cwd, env: options.env })
    return await realGit(args, options)
  }
}

const baseOf = (h: Harness) => path.dirname(h.storage)

/** The commands that ran in the shadow repository (they carry `GIT_DIR`). */
function shadowCalls(calls: readonly Call[]): readonly Call[] {
  return calls.filter((call) => call.env['GIT_DIR'] !== undefined)
}

/** Every entry of a storage folder that is an initializer, whatever its name. */
async function initializers(storage: string): Promise<readonly string[]> {
  const names = await readdir(storage)
  return names.filter((name) => INITIALIZER_LIKE.test(name))
}

/** Capture, record, end, restore and redo on a store, read back independently and by a second window. */
async function roundTrip(
  h: Harness,
  storage: string,
  limits: Limits,
  workspace = h.root,
): Promise<void> {
  const store = h.reopenAt(storage, workspace, limits.told)
  await write(workspace, 'a.txt', 'one\n')
  await write(workspace, 'sub/b.txt', 'b\n')
  // An ignored file a tool writes is copied first, by a path git opens itself.
  await write(workspace, '.gitignore', '.env\n')
  await write(workspace, '.env', 'KEY=before\n')
  await turn({ store }, 't1', async () => {
    await write(workspace, 'a.txt', 'two\n')
    await rm(path.join(workspace, 'sub', 'b.txt'))
    await store.beforeToolWrite(path.join(workspace, '.env'))
    await write(workspace, '.env', 'KEY=after\n')
  })
  expect(await store.turns('s1')).toEqual(['t1'])
  expect(storedRecords(storage).map((record) => record.kind)).toEqual(['checkpoint'])
  const restored = await restoreTurn(store, 't1')
  expect(await read(workspace, 'a.txt')).toBe('one\n')
  expect(await read(workspace, 'sub/b.txt')).toBe('b\n')
  expect(await read(workspace, '.env')).toBe('KEY=before\n')
  await redoRestore(store, restored.restoreId)
  expect(await read(workspace, 'a.txt')).toBe('two\n')
  expect(await read(workspace, '.env')).toBe('KEY=after\n')
  expect(await isPresent(workspace, 'sub/b.txt')).toBe(false)
  expect(
    storedRecords(storage)
      .map((record) => record.kind)
      .toSorted((a, b) => a.localeCompare(b)),
  ).toEqual(['checkpoint', 'restore'])
  // Another window on the same storage reads what this one wrote.
  expect(await h.reopenAt(storage, workspace, limits.told).turns('s1')).toEqual(['t1'])
  expect(await initializers(storage)).toEqual([])
  expect(await isPresent(storage, 'shadow.git/HEAD')).toBe(true)
}

const TIERS = [
  {
    tier: 'the longest absolute spelling git takes',
    repository: (limits: Limits) => limits.absolute,
    isRelative: false,
  },
  {
    tier: 'the shortest that must be relative',
    repository: (limits: Limits) => limits.absolute + 1,
    isRelative: true,
  },
  {
    tier: 'the longest git opens at all',
    repository: (limits: Limits) => limits.repository,
    isRelative: true,
  },
] as const

const SUITES = [
  { label: 'the platform’s own limit', isNatural: true },
  { label: 'a lowered limit', isNatural: false },
] as const

describe.each(SUITES)('checkpoint storage beyond git’s path limits with $label (M72)', (suite) => {
  // The platform's own limit is reached with real paths only where it is 260.
  const isWindowsOnly = suite.isNatural && process.platform !== 'win32'
  const limitsFor = (h: Harness) => (suite.isNatural ? NATURAL : loweredLimits(baseOf(h)))

  describe.skipIf(isWindowsOnly)('at its edges', () => {
    it.each(TIERS)(
      'takes, records, restores and redoes checkpoints at $tier',
      async ({ repository, isRelative }) => {
        const calls: Call[] = []
        const h = await harness({ gitProcess: recordingGit(calls) })
        const limits = limitsFor(h)
        const storage = storageFor(baseOf(h), repository(limits))
        await roundTrip(h, storage, limits)
        const inShadow = shadowCalls(calls)
        expect(inShadow.length).toBeGreaterThan(0)
        for (const call of inShadow) {
          // Short paths keep the absolute spelling and the work tree as the
          // directory; only a repository git would refuse goes relative.
          expect(call.env['GIT_DIR']).toBe(
            isRelative ? 'shadow.git' : path.join(storage, 'shadow.git'),
          )
          expect(call.cwd).toBe(isRelative ? storage : h.top)
          expect(call.env['GIT_WORK_TREE']).toBe(h.top)
          expect(path.isAbsolute(call.env['GIT_INDEX_FILE'] ?? '')).toBe(true)
        }
        const init = calls.find((call) => call.args.includes('init'))
        expect(init?.cwd).toBe(storage)
        expect(init?.args).toEqual(expect.arrayContaining(['-c', 'core.longpaths=true']))
        expect(init?.args.at(-1)).toMatch(INITIALIZER)
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it(
      'refuses a repository path git cannot open, says so, and starts and makes no repository',
      async () => {
        const calls: Call[] = []
        const h = await harness({ gitProcess: recordingGit(calls) })
        const limits = limitsFor(h)
        const storage = storageFor(baseOf(h), limits.repository + 1)
        const capture = await h.reopenAt(storage, h.root, limits.told).capture()
        expect(capture).toMatchObject({ ok: false, reason: 'pathTooLong' })
        expect(capture.ok || capture.detail).toContain(
          `storage path is ${String(limits.repository + 1)}`,
        )
        expect(calls).toEqual([])
        // Only the window's presence (a folder of its own) is written.
        expect(await readdir(storage)).toEqual(['windows'])
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it(
      'refuses a work tree git cannot change into before any git starts',
      async () => {
        const calls: Call[] = []
        const h = await harness({ git: 'none', gitProcess: recordingGit(calls) })
        const limits = limitsFor(h)
        const deep = pathOfLength(path.join(h.top, 'w'), limits.directory + 1)
        await mkdir(deep, { recursive: true })
        const store = h.reopenAt(path.join(baseOf(h), 'short-storage'), deep, limits.told)
        const capture = await store.capture()
        expect(capture).toMatchObject({ ok: false, reason: 'pathTooLong' })
        expect(capture.ok || capture.detail).toContain(`workspace path is ${String(deep.length)}`)
        expect(calls).toEqual([])
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it(
      'names a long store’s records when an older reader opens it with no prepare',
      async () => {
        const h = await harness()
        const limits = limitsFor(h)
        const storage = storageFor(baseOf(h), limits.absolute + 1)
        const store = h.reopenAt(storage, h.root, limits.told)
        await write(h.root, 'a.txt', 'one\n')
        await turn({ store }, 't1', () => write(h.root, 'a.txt', 'two\n'))
        await expect(
          legacyCheckpointTurns(
            {
              storageDir: storage,
              workspaceRoot: h.root,
              platform: process.platform,
              git: realGit,
              env: process.env,
              signal: new AbortController().signal,
              ...(limits.told !== undefined && { gitPathMax: limits.told }),
            },
            's1',
          ),
        ).resolves.toEqual(['t1'])
      },
      REAL_GIT_TIMEOUT_MS,
    )

    it(
      'reaches storage through a link that is short while its target is too long',
      async () => {
        const h = await harness()
        const limits = limitsFor(h)
        const base = baseOf(h)
        const real = storageFor(base, limits.repository + 1)
        await mkdir(real, { recursive: true })
        const link = path.join(base, 'link')
        await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir')
        // The same folder, spelled by its canonical path, is refused; spelled
        // through the link it is usable, and the repository lands in the
        // folder the link names (one folder: one volume, one rename).
        expect(await h.reopenAt(real, h.root, limits.told).capture()).toMatchObject({
          ok: false,
          reason: 'pathTooLong',
        })
        await roundTrip(h, link, limits)
        expect(await isPresent(real, 'shadow.git/HEAD')).toBe(true)
      },
      REAL_GIT_TIMEOUT_MS,
    )
  })
})

describe('the initializer of the shadow repository (M72)', () => {
  it(
    'leaves nothing behind when git init fails after it made the repository',
    async () => {
      let isFailing = true
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          if (isFailing && args.includes('init')) {
            throw new Error('injected init failure')
          }
          return output
        },
      })
      const storage = path.join(baseOf(h), 'init-fails')
      const store = h.reopenAt(storage)
      expect(await store.capture()).toMatchObject({ ok: false, reason: 'failed' })
      expect(await initializers(storage)).toEqual([])
      expect(await isPresent(storage, 'shadow.git')).toBe(false)
      isFailing = false
      const again = await store.capture()
      expect(again.ok).toBe(true)
      expect(await initializers(storage)).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves no half-made repository when the window closes while git init runs',
    async () => {
      const window: { store?: CheckpointStore } = {}
      const h = await harness({
        gitProcess: async (args, options) => {
          if (!args.includes('init')) {
            return await realGit(args, options)
          }
          // What a git ended part-way leaves: some of the repository's folders.
          await mkdir(path.join(options.cwd, args.at(-1) ?? '', 'objects'), { recursive: true })
          const running = realGit(args, options)
          window.store?.dispose()
          return await running
        },
      })
      const storage = path.join(baseOf(h), 'init-cancelled')
      const store = h.reopenAt(storage)
      window.store = store
      const capture = await store.capture()
      expect(capture.ok).toBe(false)
      expect(await initializers(storage)).toEqual([])
      expect(await isPresent(storage, 'shadow.git')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves nothing behind when the repository cannot be published',
    async () => {
      const h = await harness()
      const storage = path.join(baseOf(h), 'init-blocked')
      // A folder that is not a repository already stands where it belongs.
      await mkdir(path.join(storage, 'shadow.git', 'not-a-repository'), { recursive: true })
      expect(await h.reopenAt(storage).capture()).toMatchObject({ ok: false, reason: 'failed' })
      expect(await initializers(storage)).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'lets two windows start one storage at once: one repository, both captures, no initializer',
    async () => {
      const second: { store?: CheckpointStore } = {}
      let isNested = false
      const nested: boolean[] = []
      const h = await harness({
        gitProcess: async (args, options) => {
          const output = await realGit(args, options)
          if (!isNested && second.store !== undefined && args.includes('init')) {
            // The second window starts, makes and publishes its own repository
            // while the first one's is made but not yet published.
            isNested = true
            const capture = await second.store.capture()
            nested.push(capture.ok)
          }
          return output
        },
      })
      const storage = path.join(baseOf(h), 'two-windows')
      const first = h.reopenAt(storage)
      const other = h.reopenAt(storage)
      second.store = other
      await write(h.root, 'a.txt', 'one\n')
      const snapshot = await captured(first)
      expect(nested).toEqual([true])
      expect(await initializers(storage)).toEqual([])
      expect(await isPresent(storage, 'shadow.git/HEAD')).toBe(true)
      await first.record('s1', 't1', snapshot)
      await first.endTurn('s1', 't1')
      expect(await other.turns('s1')).toEqual(['t1'])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'removes an initializer a window that died left, and no other folder or a live one’s',
    async () => {
      const clock = Date.now() + 2 * CHECKPOINT_STALE_LOCK_MS
      const h = await harness({ now: () => clock })
      const storage = path.join(baseOf(h), 'leftovers')
      const dead = path.join(storage, '.i-0123456789ab')
      const live = path.join(storage, '.i-ba9876543210')
      const others = ['.i-short', '.i-0123456789abcdef', 'i-0123456789ab']
      await mkdir(path.join(dead, 'objects'), { recursive: true })
      await mkdir(live, { recursive: true })
      for (const name of others) {
        await mkdir(path.join(storage, name), { recursive: true })
      }
      const old = new Date(clock - CHECKPOINT_STALE_LOCK_MS - 1000)
      const recent = new Date(clock - 1000)
      for (const folder of [dead, ...others.map((name) => path.join(storage, name))]) {
        await utimes(folder, old, old)
      }
      await utimes(live, recent, recent)
      const capture = await h.reopenAt(storage).capture()
      expect(capture.ok).toBe(true)
      const names = await readdir(storage)
      expect(
        names.filter((name) => name.startsWith('.i-')).toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(['.i-0123456789abcdef', '.i-ba9876543210', '.i-short'])
      expect(await isPresent(storage, 'i-0123456789ab')).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

// The volumes to try for a folder apart from the temporary folder's (C: is taken).
const DRIVE_LETTERS = 'D E F G H I J K L M N O P Q R S T U V W X Y Z'.split(' ')

/** A folder on another volume than the temporary folder, or undefined when there is none. */
async function folderOnAnotherVolume(): Promise<string | undefined> {
  const here = statSync(tmpdir()).dev
  const roots =
    process.platform === 'win32'
      ? DRIVE_LETTERS.map((letter) => `${letter}:${path.sep}`)
      : ['/dev/shm']
  for (const root of roots) {
    try {
      if (statSync(root).dev !== here) {
        return await mkdtemp(path.join(root, 'muse-lane-native-'))
      }
    } catch {
      // No such volume, or no place in it for this test.
    }
  }
  return undefined
}

describe('storage and workspace on different volumes (M72)', () => {
  for (const { tier, repository } of TIERS.slice(0, 2)) {
    it(
      `restores a workspace on another volume at ${tier}`,
      async (context) => {
        const other = await folderOnAnotherVolume()
        if (other === undefined) {
          context.skip('no second volume to write to')
          return
        }
        try {
          const h = await harness()
          const limits = loweredLimits(baseOf(h))
          const workspace = path.join(other, 'workspace')
          await mkdir(workspace, { recursive: true })
          runGit(workspace, ['init', '-q', '-b', 'main'])
          expect(statSync(workspace).dev).not.toBe(statSync(baseOf(h)).dev)
          await roundTrip(h, storageFor(baseOf(h), repository(limits)), limits, workspace)
        } finally {
          await removeFolder(other)
        }
      },
      REAL_GIT_TIMEOUT_MS,
    )
  }

  it(
    'keeps the repository in the folder a storage link names on another volume',
    async (context) => {
      const other = await folderOnAnotherVolume()
      if (other === undefined) {
        context.skip('no second volume to write to')
        return
      }
      try {
        const h = await harness()
        const limits = loweredLimits(baseOf(h))
        const real = path.join(other, 'storage')
        await mkdir(real, { recursive: true })
        const link = path.join(baseOf(h), 'volume-link')
        await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir')
        expect(statSync(real).dev).not.toBe(statSync(baseOf(h)).dev)
        await roundTrip(h, link, limits)
        expect(await isPresent(real, 'shadow.git/HEAD')).toBe(true)
      } finally {
        await removeFolder(other)
      }
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('the independent reads of the tests (M72)', () => {
  it.skipIf(process.platform !== 'win32')(
    'read refs whose files are past 260 characters',
    async () => {
      const h = await harness()
      const storage = storageFor(baseOf(h), NATURAL.absolute)
      const store = h.reopenAt(storage)
      await write(h.root, 'a.txt', 'one\n')
      await turn({ store }, 't1', () => write(h.root, 'a.txt', 'two\n'))
      const refs = shadowGit(storage, ['for-each-ref', '--format=%(refname)', 'refs/muse-spark/'])
        .split('\n')
        .filter((ref) => ref.includes('/record/'))
      expect(refs).toHaveLength(1)
      expect(
        path.join(storage, 'shadow.git', ...(refs[0] ?? '').split('/')).length,
      ).toBeGreaterThan(WINDOWS_PATH_MAX)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('the platform’s git path limit (M72)', () => {
  it('is the platform’s PATH_MAX', () => {
    expect([
      gitPathMax('win32'),
      gitPathMax('darwin'),
      gitPathMax('linux'),
      gitPathMax('freebsd'),
    ]).toEqual([260, 1024, 4096, 4096])
  })
})
