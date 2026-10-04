// The owner-bound recording io (M86, PLAN.md D63, spec section 5) over the
// real tool io, the real conditional writer and a real journal on the real
// file system. A crash is a step that never returns: what a new window then
// reads from the journal is what the dead one left. Rows: A, B, F, G, H, I,
// J, K, N, O and O2 of spec section 13, the recorder's part of each.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, type Stats } from 'node:fs'
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { FileReservation, ToolIo } from '../../src/core/backends/modelapi/tools'
import * as identity from '../../src/core/fs/fileIdentity'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import type { JournalEntry, Owner } from '../../src/core/checkpoints/toolWrites'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { createCheckpointedMemory } from '../../src/host/backend/checkpointedMemory'
import { systemPath } from '../../src/host/backend/memoryIo'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createFileExclusively } from '../../src/host/fsAtomic'
import { createCheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import { type JournalFs, WriteJournal } from '../../src/host/checkpoints/writeJournal'
import {
  createOwnerIo,
  type OwnerIoDeps,
  TurnRecorder,
  WriteLanes,
} from '../../src/host/checkpoints/writeRecorder'
import {
  CHECKPOINT_BLOBS_DIR,
  CHECKPOINT_MODEL_TEXT,
  CHECKPOINT_WRITES_DIR,
  FILE_REFUSAL_MODEL_TEXT,
} from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { nativeToolIo } from './helpers/fakeToolIo'
import { halfWhenFull, journalFsWith } from './helpers/journalFs'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-write-recorder-')))

afterAll(async () => {
  await removeFolder(base)
})

// Real file system work, flushed to the disk: slower on a busy Windows host.
const REAL_FS_TIMEOUT_MS = 60_000

const INSTANCE = 'instance-1'
const IS_WINDOWS = process.platform === 'win32'
// Windows keeps no execute bit: no mode is recorded there.
const FILE_MODE = IS_WINDOWS ? undefined : '100644'
const EMPTY_OID = gitBlobOid(new Uint8Array())
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

function oidOf(content: string | Uint8Array): string {
  return gitBlobOid(typeof content === 'string' ? Buffer.from(content) : content)
}

function present(content: string | Uint8Array, mode: string | undefined = FILE_MODE) {
  return { present: true, oid: oidOf(content), ...(mode !== undefined && { mode }) }
}

function ownerOf(unitId: string, sessionId = 's1'): Owner {
  return { instance: INSTANCE, sessionId, unitKind: 'turn', unitId }
}

/** The journal file's line writes and flushes passed through `around`; blobs and folders as they are. */
function journalFsAround(around: {
  readonly write?: (
    line: string,
    real: () => Promise<{ readonly bytesWritten: number }>,
  ) => Promise<{ readonly bytesWritten: number }>
  readonly sync?: (real: () => Promise<void>) => Promise<void>
}): JournalFs {
  return journalFsWith((real) => ({
    write: async (bytes, offset, length, position) => {
      const write = async () => await real.write(bytes, offset, length, position)
      const line = Buffer.from(bytes.subarray(offset, offset + length)).toString('utf8')
      return await (around.write?.(line, write) ?? write())
    },
    sync: async () => {
      await (around.sync?.(real.sync) ?? real.sync())
    },
  }))
}

async function setup(options: { readonly fs?: JournalFs } = {}) {
  // The test's own folder: the workspace, the storage, and what lies outside both.
  const folder = await mkdtemp(path.join(base, 'case-'))
  const root = path.join(folder, 'ws')
  const storageDir = path.join(folder, 'storage')
  await mkdir(root)
  await mkdir(storageDir)
  const journal = new WriteJournal({ storageDir, instance: INSTANCE, fs: options.fs })
  const lanes = new WriteLanes(process.platform)
  const log = new FakeLogOutputChannel()
  const toolIo = nativeToolIo()
  let ids = 0
  const recording: Omit<OwnerIoDeps, 'owner'> = {
    journal,
    lanes,
    workspaceRoot: root,
    platform: process.platform,
    canonicalPath,
    newId: () => {
      ids += 1
      return `w${String(ids)}`
    },
    log,
  }
  return {
    folder,
    root,
    storageDir,
    journal,
    lanes,
    log,
    toolIo,
    recording,
    ownerIo: (unitId = 't1', inner: ToolIo = toolIo, sessionId = 's1') =>
      createOwnerIo(inner, { ...recording, owner: ownerOf(unitId, sessionId) }),
    file: (relative: string) => path.join(root, ...relative.split('/')),
    /** The journal as a new window would read it from the disk. */
    entries: async (): Promise<readonly JournalEntry[]> => {
      const journals = await WriteJournal.readAll(storageDir)
      return journals.get(INSTANCE)?.entries ?? []
    },
    blobs: async (): Promise<readonly string[]> => {
      try {
        return await readdir(
          path.join(storageDir, CHECKPOINT_WRITES_DIR, INSTANCE, CHECKPOINT_BLOBS_DIR),
        )
      } catch {
        return []
      }
    },
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

it.each(['ino', 'dev'] as const)(
  'copies no outside bytes from distinct native %s IDs that round to one Number',
  async (field) => {
    const t = await setup()
    const file = t.file('collision.txt')
    const moved = path.join(t.folder, 'outside.txt')
    await writeFile(file, 'inside before')
    const samplePath = identity.lstatIdentity
    const sampleHandle = identity.handleIdentity
    let isMoved = false
    const baseId = 9_007_199_254_740_992n
    const otherId = 9_007_199_254_740_993n
    expect(Number(baseId)).toBe(Number(otherId))
    const pathSpy = vi.spyOn(identity, 'lstatIdentity').mockImplementation(async (target) => {
      const stats = await samplePath(target)
      return target === file
        ? Object.assign(stats, { dev: 77n, ino: 88n, [field]: isMoved ? otherId : baseId })
        : stats
    })
    const handleSpy = vi.spyOn(identity, 'handleIdentity').mockImplementation(async (handle) => {
      const stats = await sampleHandle(handle)
      const id = isMoved ? otherId : baseId
      if (!isMoved) {
        await rename(file, moved)
        await writeFile(moved, 'outside secrets')
        await writeFile(file, 'replacement bytes')
        isMoved = true
      }
      return Object.assign(stats, { dev: 77n, ino: 88n, [field]: id })
    })
    const blobSpy = vi.spyOn(t.journal, 'writeBlob')
    try {
      await expect(t.ownerIo().writeFile(file, 'proposed bytes')).rejects.toThrow()
      expect(blobSpy).not.toHaveBeenCalled()
      expect(await t.blobs()).toEqual([])
      expect(await readFile(file, 'utf8')).toBe('replacement bytes')
      expect(await readFile(moved, 'utf8')).toBe('outside secrets')
    } finally {
      pathSpy.mockRestore()
      handleSpy.mockRestore()
      blobSpy.mockRestore()
      await t.journal.close()
    }
  },
  REAL_FS_TIMEOUT_MS,
)

/** A tool io whose conditional writer runs `afterIntent` once the intent is journaled, before the rename. */
function pausedAfterIntent(t: Setup, afterIntent: () => Promise<void>): ToolIo {
  return {
    ...t.toolIo,
    writeFileIfUnchanged: async (file, expected, content, options) =>
      await t.toolIo.writeFileIfUnchanged(file, expected, content, {
        ...options,
        staged: async (staged) => {
          await options.staged?.(staged)
          await afterIntent()
        },
      }),
  }
}

/** Never settles: the step a crash stopped. */
function crashed(): Promise<never> {
  return new Promise<never>(() => undefined)
}

/** Each entry as `kind id` (`incomplete` and `seal` name no write). */
function kindsOf(entries: readonly JournalEntry[]): readonly string[] {
  return entries.map((entry) => {
    switch (entry.kind) {
      case 'intent': {
        return `intent ${entry.write.id}`
      }
      case 'done':
      case 'aborted': {
        return `${entry.kind} ${entry.id}`
      }
      default: {
        return entry.kind
      }
    }
  })
}

function intents(entries: readonly JournalEntry[]) {
  return entries.flatMap((entry) => (entry.kind === 'intent' ? [entry.write] : []))
}

async function sizeOf(file: string): Promise<number> {
  const stats = await stat(file)
  return stats.size
}

/** What is at the path, links not followed: asked by name. */
async function linkStat(file: string): Promise<Stats> {
  return await lstat(file)
}

async function isDirectoryOf(file: string): Promise<boolean> {
  const stats = await linkStat(file)
  return stats.isDirectory()
}

async function isSymbolicLinkOf(file: string): Promise<boolean> {
  const stats = await linkStat(file)
  return stats.isSymbolicLink()
}

async function isFIFOOf(file: string): Promise<boolean> {
  const stats = await linkStat(file)
  return stats.isFIFO()
}

async function isMissing(file: string): Promise<boolean> {
  try {
    await lstat(file)
    return false
  } catch {
    return true
  }
}

describe('createOwnerIo: one write (M86 A, spec 5.3)', { timeout: REAL_FS_TIMEOUT_MS }, () => {
  it('records a new file and a changed one: copy, kept bytes, intent, publication, done', async () => {
    const t = await setup()
    await writeFile(t.file('changed.txt'), 'old\n')
    const io = t.ownerIo()
    await io.writeFile(t.file('a/b/new.txt'), 'new\n', t.file('a/b/new.txt'))
    await io.writeFile(t.file('changed.txt'), 'changed\n', t.file('changed.txt'))
    expect(await readFile(t.file('a/b/new.txt'), 'utf8')).toBe('new\n')
    expect(await readFile(t.file('changed.txt'), 'utf8')).toBe('changed\n')
    const entries = await t.entries()
    expect(kindsOf(entries)).toEqual(['intent w1', 'done w1', 'intent w2', 'done w2'])
    expect(intents(entries)).toEqual([
      {
        id: 'w1',
        instance: INSTANCE,
        seq: 1,
        owner: ownerOf('t1'),
        path: 'a/b/new.txt',
        before: { present: false },
        after: present('new\n'),
        createdFolders: ['a', 'a/b'],
        isKept: true,
      },
      {
        id: 'w2',
        instance: INSTANCE,
        seq: 2,
        owner: ownerOf('t1'),
        path: 'changed.txt',
        before: present('old\n'),
        after: present('changed\n'),
        createdFolders: [],
        isKept: true,
      },
    ])
    // What a restore and a Redo need, kept under the blob ids.
    expect(new Set(await t.blobs())).toEqual(
      new Set([oidOf('new\n'), oidOf('old\n'), oidOf('changed\n')]),
    )
    expect(
      await readFile(WriteJournal.blobPath(t.storageDir, INSTANCE, oidOf('old\n')), 'utf8'),
    ).toBe('old\n')
  })

  it('records nothing outside the workspace folder', async () => {
    const t = await setup()
    const outside = path.join(t.folder, 'outside.md')
    await t.ownerIo().writeFile(outside, 'personal\n')
    expect(await readFile(outside, 'utf8')).toBe('personal\n')
    expect(await t.entries()).toEqual([])
  })
})

describe(
  'createOwnerIo: crashes and lost outcomes (M86 F, B)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it('journals the intent before it publishes: a crash between them leaves the file as it was', async () => {
      const t = await setup()
      await writeFile(t.file('a.txt'), 'before\n')
      const reached = Promise.withResolvers<undefined>()
      const io = t.ownerIo(
        't1',
        pausedAfterIntent(t, async () => {
          reached.resolve(undefined)
          await crashed()
        }),
      )
      void io.writeFile(t.file('a.txt'), 'after\n', t.file('a.txt'))
      await reached.promise
      // The window is gone here. What a new one finds: an intent, durable, and no outcome.
      expect(kindsOf(await t.entries())).toEqual(['intent w1'])
      expect(intents(await t.entries())[0]?.after).toEqual(present('after\n'))
      expect(await readFile(t.file('a.txt'), 'utf8')).toBe('before\n')
    })

    it('leaves a write whose done never came unsettled, the file holding its after; the user may save in that gap', async () => {
      const lineWritten = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const t = await setup({
        fs: journalFsAround({
          write: async (line, real) => {
            if (line.startsWith('{"kind":"done"')) {
              lineWritten.resolve(undefined)
              await resume.promise
            }
            return await real()
          },
        }),
      })
      await writeFile(t.file('a.txt'), 'before\n')
      const writing = t.ownerIo().writeFile(t.file('a.txt'), 'after\n', t.file('a.txt'))
      await lineWritten.promise
      // Published, its done not yet journaled: a reader sees it unsettled, the file at its after.
      expect(await readFile(t.file('a.txt'), 'utf8')).toBe('after\n')
      expect(kindsOf(await t.entries())).toEqual(['intent w1'])
      // The user saves in that gap: the record still says what the tool wrote.
      await writeFile(t.file('a.txt'), 'user\n')
      resume.resolve(undefined)
      await writing
      expect(kindsOf(await t.entries())).toEqual(['intent w1', 'done w1'])
      expect(await readFile(t.file('a.txt'), 'utf8')).toBe('user\n')
    })

    it('reports a write as written when its done cannot be flushed, leaves it unsettled, and logs it', async () => {
      let flushes = 0
      const t = await setup({
        fs: journalFsAround({
          sync: async (real) => {
            flushes += 1
            if (flushes === 2) {
              throw Object.assign(new Error('EIO: the disk failed'), { code: 'EIO' })
            }
            await real()
          },
        }),
      })
      await t.ownerIo().writeFile(t.file('a.txt'), 'after\n', t.file('a.txt'))
      expect(await readFile(t.file('a.txt'), 'utf8')).toBe('after\n')
      expect(kindsOf(await t.entries())).toEqual(['intent w1'])
      expect(t.log.warn).toHaveBeenCalledWith(
        'A write to a.txt stays unsettled: its outcome could not be journaled (Error)',
      )
    })

    it('refuses the write, changing nothing, when the disk is full while journaling (N)', async () => {
      let isFull = false
      const t = await setup({
        fs: journalFsWith((real) => ({ write: halfWhenFull(real, () => isFull) })),
      })
      await writeFile(t.file('kept.txt'), 'kept\n')
      const io = t.ownerIo()
      await io.writeFile(t.file('first.txt'), 'first\n', t.file('first.txt'))
      isFull = true
      await expect(io.writeFile(t.file('kept.txt'), 'lost\n', t.file('kept.txt'))).rejects.toThrow(
        `kept.txt ${CHECKPOINT_MODEL_TEXT.writeNotRecorded}`,
      )
      await expect(
        io.writeFile(t.file('new/deep/file.txt'), 'lost\n', t.file('new/deep/file.txt')),
      ).rejects.toThrow(CHECKPOINT_MODEL_TEXT.writeNotRecorded)
      expect(await readFile(t.file('kept.txt'), 'utf8')).toBe('kept\n')
      // Neither the file nor the folders made for it are left.
      expect(await isMissing(t.file('new'))).toBe(true)
      expect(kindsOf(await t.entries())).toEqual(['intent w1', 'done w1'])
    })
  },
)

describe(
  'createOwnerIo: conditional publication (M86 G, H)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it('refuses a write when the file changes between its copy and its publication (G)', async () => {
      const t = await setup()
      await writeFile(t.file('a.txt'), 'before\n')
      // Changed after the copy, before anything was staged: nothing is recorded.
      const early = t.ownerIo('t1', {
        ...t.toolIo,
        writeFileIfUnchanged: async (...args) => {
          await writeFile(t.file('a.txt'), 'user early\n')
          return await t.toolIo.writeFileIfUnchanged(...args)
        },
      })
      await expect(early.writeFile(t.file('a.txt'), 'tool\n', t.file('a.txt'))).rejects.toThrow(
        `a.txt ${CHECKPOINT_MODEL_TEXT.fileChangedWhileWriting}`,
      )
      expect(await t.entries()).toEqual([])
      // Changed after the intent, before the rename: the write is aborted, and nothing restorable.
      const late = t.ownerIo(
        't2',
        pausedAfterIntent(t, async () => {
          await writeFile(t.file('a.txt'), 'user late\n')
        }),
      )
      await expect(late.writeFile(t.file('a.txt'), 'tool\n', t.file('a.txt'))).rejects.toThrow(
        CHECKPOINT_MODEL_TEXT.fileChangedWhileWriting,
      )
      // (`w1` was the early write's id: it never reached its intent.)
      expect(kindsOf(await t.entries())).toEqual(['intent w2', 'aborted w2'])
      expect(await readFile(t.file('a.txt'), 'utf8')).toBe('user late\n')
    })

    it("records format on edit as one write, and its 'changed' as aborted (H)", async () => {
      const t = await setup()
      await writeFile(t.file('a.ts'), 'written')
      const options = { expectedCanonicalPath: t.file('a.ts'), unsavedAt: [] }
      expect(
        await t
          .ownerIo()
          .writeFileIfUnchanged(t.file('a.ts'), fingerprint('written'), 'formatted', options),
      ).toBe('written')
      expect(intents(await t.entries())).toMatchObject([
        { id: 'w1', path: 'a.ts', before: present('written'), after: present('formatted') },
      ])
      // Not the text the edit wrote: nothing to format, nothing recorded.
      expect(
        await t
          .ownerIo('t2')
          .writeFileIfUnchanged(t.file('a.ts'), fingerprint('other'), 'x', options),
      ).toBe('changed')
      // The user typed while the formatter ran: changed, aborted, theirs kept.
      await writeFile(t.file('a.ts'), 'written')
      const typing = t.ownerIo(
        't3',
        pausedAfterIntent(t, async () => {
          await writeFile(t.file('a.ts'), 'typed')
        }),
      )
      expect(
        await typing.writeFileIfUnchanged(
          t.file('a.ts'),
          fingerprint('written'),
          'formatted',
          options,
        ),
      ).toBe('changed')
      expect(kindsOf(await t.entries())).toEqual([
        'intent w1',
        'done w1',
        'intent w2',
        'aborted w2',
      ])
      expect(await readFile(t.file('a.ts'), 'utf8')).toBe('typed')
    })
  },
)

describe(
  'createOwnerIo: an image reserved, filled, released (M86 I)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it('records a reservation before its create, then its fill', async () => {
      const t = await setup()
      const reservation = await t
        .ownerIo()
        .reserveFile(t.file('img/out.png'), t.file('img/out.png'))
      // A crash before the fill leaves an empty file, recorded absent → empty: a restore deletes it.
      expect(intents(await t.entries())).toEqual([
        expect.objectContaining({
          path: 'img/out.png',
          before: { present: false },
          after: { present: true, oid: EMPTY_OID },
          createdFolders: ['img'],
          isKept: true,
        }),
      ])
      expect(await sizeOf(t.file('img/out.png'))).toBe(0)
      expect(await reservation.fill(PNG)).toBe('done')
      expect(await readFile(t.file('img/out.png'))).toEqual(PNG)
      const entries = await t.entries()
      expect(kindsOf(entries)).toEqual(['intent w1', 'done w1', 'intent w2', 'done w2'])
      expect(intents(entries)[1]).toMatchObject({
        before: { present: true, oid: EMPTY_OID },
        after: { present: true, oid: oidOf(PNG) },
      })
    })

    it('records a release as empty → absent, and removes the file', async () => {
      const t = await setup()
      const reservation = await t.ownerIo().reserveFile(t.file('out.png'), t.file('out.png'))
      expect(await reservation.release()).toBe('done')
      expect(await isMissing(t.file('out.png'))).toBe(true)
      expect(intents(await t.entries())[1]).toMatchObject({
        before: { present: true, oid: EMPTY_OID },
        after: { present: false },
      })
      expect(kindsOf(await t.entries())).toEqual(['intent w1', 'done w1', 'intent w2', 'done w2'])
    })

    it("refuses to fill a reserved file the user wrote into, and leaves the user's bytes on release", async () => {
      const t = await setup()
      const reservation = await t.ownerIo().reserveFile(t.file('out.png'), t.file('out.png'))
      await writeFile(t.file('out.png'), 'the user wrote here')
      expect(await reservation.fill(PNG)).toBe('changed')
      expect(await reservation.release()).toBe('changed')
      expect(await readFile(t.file('out.png'), 'utf8')).toBe('the user wrote here')
      expect(kindsOf(await t.entries())).toEqual([
        'intent w1',
        'done w1',
        'intent w2',
        'aborted w2',
        'intent w3',
        'aborted w3',
      ])
    })

    it('leaves a fill that failed part way unsettled, and never cleans it up blindly', async () => {
      const t = await setup()
      const partial: ToolIo = {
        ...t.toolIo,
        reserveFile: async (file, expected, beforeCreate): Promise<FileReservation> => {
          const real = await t.toolIo.reserveFile(file, expected, beforeCreate)
          return {
            ...real,
            fill: async (bytes) => {
              await appendFile(file, bytes.subarray(0, 3))
              throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
            },
          }
        },
      }
      const reservation = await t
        .ownerIo('t1', partial)
        .reserveFile(t.file('out.png'), t.file('out.png'))
      await expect(reservation.fill(PNG)).rejects.toThrow('ENOSPC')
      // The image tool releases the file next: it is no longer empty, so it stays.
      expect(await reservation.release()).toBe('changed')
      expect(await readFile(t.file('out.png'))).toEqual(PNG.subarray(0, 3))
      expect(kindsOf(await t.entries())).toEqual([
        'intent w1',
        'done w1',
        'intent w2',
        'intent w3',
        'aborted w3',
      ])
    })
  },
)

describe(
  'createOwnerIo: destinations it never opens (M86 O2)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it('refuses a folder before changing anything', async () => {
      const t = await setup()
      await mkdir(t.file('folder'))
      const io = t.ownerIo()
      await expect(io.writeFile(t.file('folder'), 'x', t.file('folder'))).rejects.toThrow(
        `folder ${CHECKPOINT_MODEL_TEXT.fileNotRegular}`,
      )
      await expect(
        io.recordNew(t.file('folder'), 'x', undefined, () => Promise.reject(new Error('not run'))),
      ).rejects.toThrow(CHECKPOINT_MODEL_TEXT.fileNotRegular)
      expect(await isDirectoryOf(t.file('folder'))).toBe(true)
      expect(await t.entries()).toEqual([])
    })

    it('refuses a link swapped in at the path after it was resolved, without following it', async () => {
      const t = await setup()
      const elsewhere = path.join(t.folder, 'elsewhere')
      await mkdir(elsewhere)
      await writeFile(path.join(elsewhere, 'a.txt'), 'outside\n')
      // A junction needs no privilege on Windows; elsewhere a link to the file outside.
      await (IS_WINDOWS
        ? symlink(elsewhere, t.file('linked'), 'junction')
        : symlink(path.join(elsewhere, 'a.txt'), t.file('linked')))
      // The path was resolved before the link was swapped in: it still names itself.
      const io = createOwnerIo(t.toolIo, {
        ...t.recording,
        owner: ownerOf('t1'),
        canonicalPath: async (file) =>
          file === t.file('linked') ? file : await canonicalPath(file),
      })
      await expect(io.writeFile(t.file('linked'), 'x', t.file('linked'))).rejects.toThrow(
        `linked ${CHECKPOINT_MODEL_TEXT.fileNotRegular}`,
      )
      expect(await isSymbolicLinkOf(t.file('linked'))).toBe(true)
      expect(await readFile(path.join(elsewhere, 'a.txt'), 'utf8')).toBe('outside\n')
      expect(await t.entries()).toEqual([])
    })

    it.skipIf(IS_WINDOWS)(
      'refuses a pipe without opening it, which would wait for a writer',
      async () => {
        const t = await setup()
        execFileSync('mkfifo', [t.file('pipe')])
        await expect(t.ownerIo().writeFile(t.file('pipe'), 'x', t.file('pipe'))).rejects.toThrow(
          `pipe ${CHECKPOINT_MODEL_TEXT.fileNotRegular}`,
        )
        expect(await isFIFOOf(t.file('pipe'))).toBe(true)
        expect(await t.entries()).toEqual([])
      },
    )
  },
)

describe('createOwnerIo: the copy is confined (M86 O)', { timeout: REAL_FS_TIMEOUT_MS }, () => {
  it('records only folders actually created by image reservation or exclusive memory publication', async () => {
    const t = await setup()
    const borrowed: ToolIo = {
      ...t.toolIo,
      reserveFile: async (file, expected, beforeCreate) => {
        // Another writer supplies the previously absent parent before our mkdir.
        await mkdir(path.dirname(file), { recursive: true })
        return await t.toolIo.reserveFile(file, expected, beforeCreate)
      },
    }
    const io = t.ownerIo('t1', borrowed)
    const reservation = await io.reserveFile(t.file('user-image/a.png'))
    await reservation.fill(PNG)
    await io.recordNew(t.file('user-memory/a.txt'), 'note', undefined, async (staged) => {
      await mkdir(t.file('user-memory'))
      await createFileExclusively(t.file('user-memory/a.txt'), 'note', {
        mode: 0o600,
        warn: () => undefined,
        ...(staged !== undefined && { staged }),
      })
    })
    const writes = intents(await t.entries())
    expect(writes.map((write) => [write.path, write.createdFolders])).toEqual([
      ['user-image/a.png', []],
      ['user-image/a.png', []],
      ['user-memory/a.txt', []],
    ])
    expect(await readFile(t.file('user-memory/a.txt'), 'utf8')).toBe('note')
    await io.drain()
    await t.journal.close()
  })
  it('keeps no bytes from outside when a folder on the way is swapped for a link during the copy', async () => {
    const t = await setup()
    await mkdir(t.file('sub'))
    await writeFile(t.file('sub/a.txt'), 'inside\n')
    const elsewhere = path.join(t.folder, 'secret')
    await mkdir(elsewhere)
    await writeFile(path.join(elsewhere, 'a.txt'), 'outside secret\n')
    let lookups = 0
    const io = createOwnerIo(t.toolIo, {
      ...t.recording,
      owner: ownerOf('t1'),
      canonicalPath: async (file) => {
        if (file.endsWith('a.txt')) {
          lookups += 1
          // The third look is the copy's last, after its read: the folder is swapped just
          // before it. Windows refuses to move a folder that holds an open file, so there
          // the lookup tells what the swap would.
          if (lookups === 3 && IS_WINDOWS) {
            return path.join(elsewhere, 'a.txt')
          }
          if (lookups === 3) {
            await rename(t.file('sub'), t.file('sub-moved'))
            await symlink(elsewhere, t.file('sub'), 'dir')
          }
        }
        return await canonicalPath(file)
      },
    })
    await expect(io.writeFile(t.file('sub/a.txt'), 'tool\n', t.file('sub/a.txt'))).rejects.toThrow(
      FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval,
    )
    expect(lookups).toBe(3)
    expect(await t.blobs()).toEqual([])
    expect(await t.entries()).toEqual([])
    expect(await readFile(path.join(elsewhere, 'a.txt'), 'utf8')).toBe('outside secret\n')
    expect(await readFile(t.file(IS_WINDOWS ? 'sub/a.txt' : 'sub-moved/a.txt'), 'utf8')).toBe(
      'inside\n',
    )
  })

  it.runIf(IS_WINDOWS)(
    'records one path for every spelling of a file on a folding file system',
    async () => {
      const t = await setup()
      await writeFile(t.file('Readme.md'), 'one\n')
      await t.ownerIo().writeFile(t.file('README.MD'), 'two\n', t.file('Readme.md'))
      expect(intents(await t.entries()).map((write) => write.path)).toEqual(['Readme.md'])
    },
  )

  it.runIf(process.platform === 'linux')(
    'records two files for two spellings on a case-sensitive one',
    async () => {
      const t = await setup()
      await writeFile(t.file('Readme.md'), 'one\n')
      await t.ownerIo().writeFile(t.file('README.md'), 'two\n', t.file('README.md'))
      expect(await readFile(t.file('Readme.md'), 'utf8')).toBe('one\n')
      expect(intents(await t.entries())).toEqual([
        expect.objectContaining({ path: 'README.md', before: { present: false } }),
      ])
    },
  )
})

describe(
  'createOwnerIo: owners and order (M86 K, spec 4 and 5.1)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it("binds each conversation's writes to it, both writing at once in one window", async () => {
      const t = await setup()
      const unused = () => Promise.reject(new Error('no memory in this test'))
      const recorder = new TurnRecorder({
        ...t.recording,
        io: t.toolIo,
        memory: () => ({ writeFile: unused, createFile: unused }),
      })
      const first = recorder.start(ownerOf('turn-a', 's1'))
      const second = recorder.start(ownerOf('turn-b', 's2'))
      await Promise.all(
        [1, 2, 3].flatMap((round) => [
          first.io.writeFile(t.file('mine.txt'), `s1 ${String(round)}\n`, t.file('mine.txt')),
          second.io.writeFile(t.file('theirs.txt'), `s2 ${String(round)}\n`, t.file('theirs.txt')),
        ]),
      )
      await Promise.all([
        recorder.end(ownerOf('turn-a', 's1')),
        recorder.end(ownerOf('turn-b', 's2')),
      ])
      const writes = intents(await t.entries())
      expect(
        writes.filter((write) => write.path === 'mine.txt').map((write) => write.owner),
      ).toEqual(Array.from({ length: 3 }, () => ownerOf('turn-a', 's1')))
      expect(
        writes.filter((write) => write.path === 'theirs.txt').map((write) => write.owner),
      ).toEqual(Array.from({ length: 3 }, () => ownerOf('turn-b', 's2')))
      // The instance's order: one counter for every owner.
      expect(writes.map((write) => write.seq)).toEqual([1, 2, 3, 4, 5, 6])
      // Each file's writes form one chain, in the order they were published.
      for (const file of ['mine.txt', 'theirs.txt']) {
        const chain = writes.filter((write) => write.path === file)
        for (let index = 1; index < chain.length; index += 1) {
          expect(chain[index]?.before).toEqual(chain[index - 1]?.after)
        }
      }
      // Ended: a write of the turn after its end is refused, and nothing recorded.
      await expect(
        first.io.writeFile(t.file('mine.txt'), 'late\n', t.file('mine.txt')),
      ).rejects.toThrow(CHECKPOINT_MODEL_TEXT.turnWritesEnded)
      expect(intents(await t.entries())).toHaveLength(6)
    })

    it('publishes two owners’ writes to one path one after another, in the order of their intents', async () => {
      const t = await setup()
      await writeFile(t.file('shared.txt'), 'zero\n')
      const held = Promise.withResolvers<undefined>()
      const reached = Promise.withResolvers<undefined>()
      const first = t.ownerIo(
        'turn-1',
        pausedAfterIntent(t, async () => {
          reached.resolve(undefined)
          await held.promise
        }),
      )
      const second = t.ownerIo('turn-2', t.toolIo, 's2')
      const secondQueued = Promise.withResolvers<undefined>()
      const entered: number[] = []
      let attempts = 0
      const exclusive = t.lanes.exclusive.bind(t.lanes)
      vi.spyOn(t.lanes, 'exclusive').mockImplementation(
        <T>(key: string, work: () => Promise<T>) => {
          const attempt = ++attempts
          const pending = exclusive(key, async () => {
            entered.push(attempt)
            return await work()
          })
          if (attempt === 2) {
            secondQueued.resolve(undefined)
          }
          return pending
        },
      )
      const writingFirst = first.writeFile(t.file('shared.txt'), 'one\n', t.file('shared.txt'))
      await reached.promise
      const writingSecond = second.writeFile(t.file('shared.txt'), 'two\n', t.file('shared.txt'))
      // The second waits on the path: no intent of its own while the first is under way.
      await secondQueued.promise
      expect(entered).toEqual([1])
      expect(kindsOf(await t.entries())).toEqual(['intent w1'])
      held.resolve(undefined)
      await Promise.all([writingFirst, writingSecond])
      expect(kindsOf(await t.entries())).toEqual(['intent w1', 'done w1', 'intent w2', 'done w2'])
      const [one, two] = intents(await t.entries())
      expect(two?.before).toEqual(one?.after)
      expect(await readFile(t.file('shared.txt'), 'utf8')).toBe('two\n')
    })

    it('drains: waits for the writes under way, and admits none after', async () => {
      const t = await setup()
      const held = Promise.withResolvers<undefined>()
      const reached = Promise.withResolvers<undefined>()
      const io = t.ownerIo(
        't1',
        pausedAfterIntent(t, async () => {
          reached.resolve(undefined)
          await held.promise
        }),
      )
      const writing = io.writeFile(t.file('a.txt'), 'a\n', t.file('a.txt'))
      await reached.promise
      let isDrained = false
      const draining = (async () => {
        await io.drain()
        isDrained = true
      })()
      await expect(io.writeFile(t.file('b.txt'), 'b\n', t.file('b.txt'))).rejects.toThrow(
        `${t.file('b.txt')} ${CHECKPOINT_MODEL_TEXT.turnWritesEnded}`,
      )
      expect(isDrained).toBe(false)
      held.resolve(undefined)
      await Promise.all([writing, draining])
      expect(kindsOf(await t.entries())).toEqual(['intent w1', 'done w1'])
      expect(await isMissing(t.file('b.txt'))).toBe(true)
    })
  },
)

/** No lifetime guard: the memory tests own their window. */
function noGuard(): void {
  // Nothing closes during these tests.
}

/** The window's memory and a turn recorder over it, as activation composes them. */
function memorySetup(t: Setup) {
  const dataRoot = path.join(t.folder, 'data', 'muse', 'memory')
  const port = createCheckpointPort({
    store: undefined,
    isNamespaceKnown: () => true,
    isEnabled: () => true,
    isWorkspaceTrusted: () => true,
    hasGit: () => true,
  })
  const memory = createCheckpointedMemory(t.toolIo, port, {
    platform: process.platform,
    dataRoot: () => dataRoot,
    workspaceRoot: t.root,
    systemPath,
    warn: (message) => {
      t.log.warn(message)
    },
    captureGuard: () => noGuard,
  })
  const recorder = new TurnRecorder({
    ...t.recording,
    io: t.toolIo,
    memory: memory.turnWrites,
  })
  const located = async (scope: 'project' | 'personal', note: string) => {
    const place = await memory.store.locate(scope, note)
    if (!place.ok) {
      throw new Error(place.reason)
    }
    return place.value
  }
  return { memory, recorder, located, dataRoot }
}

describe(
  'the model’s memory, as activation composes it (M86 J)',
  { timeout: REAL_FS_TIMEOUT_MS },
  () => {
    it('records a new note and its index line before they are published, and an edit of it', async () => {
      const t = await setup()
      const m = memorySetup(t)
      const turn = m.recorder.start(ownerOf('t1'))
      const note = await m.located('project', 'deploy.md')
      expect(
        await m.memory.store.add(note, { content: 'Deploy on Fridays.' }, undefined, turn.memory),
      ).toMatchObject({ ok: true })
      expect(
        await m.memory.store.edit(
          await m.located('project', 'deploy.md'),
          { old_str: 'Fridays', new_str: 'Mondays' },
          undefined,
          turn.memory,
        ),
      ).toMatchObject({ ok: true })
      await m.recorder.end(ownerOf('t1'))
      const writes = intents(await t.entries())
      expect(writes.map((write) => [write.path, write.before.present])).toEqual([
        ['.agents/memory/deploy.md', false],
        ['.agents/memory/MEMORY.md', false],
        ['.agents/memory/deploy.md', true],
      ])
      expect(writes[0]).toMatchObject({
        after: { present: true, oid: oidOf('Deploy on Fridays.') },
        createdFolders: ['.agents', '.agents/memory'],
      })
      expect(writes[2]).toMatchObject({
        before: present('Deploy on Fridays.', undefined),
        after: { oid: oidOf('Deploy on Mondays.') },
      })
      expect(kindsOf(await t.entries()).filter((kind) => kind.startsWith('done'))).toHaveLength(3)
    })

    it('publishes no new note when its intent cannot be journaled', async () => {
      let isFull = false
      const t = await setup({
        fs: journalFsWith((real) => ({ write: halfWhenFull(real, () => isFull) })),
      })
      const m = memorySetup(t)
      const turn = m.recorder.start(ownerOf('t1'))
      isFull = true
      const outcome = await m.memory.store.add(
        await m.located('project', 'deploy.md'),
        { content: 'x' },
        undefined,
        turn.memory,
      )
      expect(outcome).toEqual({
        ok: false,
        reason: `.agents/memory/deploy.md ${CHECKPOINT_MODEL_TEXT.writeNotRecorded}`,
      })
      expect(await isMissing(t.file('.agents/memory/deploy.md'))).toBe(true)
    })

    it("never records the Memory view's writes, nor personal memory outside the workspace", async () => {
      const t = await setup()
      const m = memorySetup(t)
      const turn = m.recorder.start(ownerOf('t1'))
      // The user's own note, from the view, while the turn runs.
      await m.memory.viewStore.create('project', 'mine.md', 'Mine')
      // The model's note in personal memory, outside the workspace folder.
      expect(
        await m.memory.store.add(
          await m.located('personal', 'prefs.md'),
          { content: 'Tabs.' },
          undefined,
          turn.memory,
        ),
      ).toMatchObject({ ok: true })
      await m.recorder.end(ownerOf('t1'))
      expect(await readFile(t.file('.agents/memory/mine.md'), 'utf8')).toContain('Mine')
      expect(await readFile(path.join(m.dataRoot, 'personal', 'prefs.md'), 'utf8')).toBe('Tabs.')
      expect(await t.entries()).toEqual([])
    })
  },
)
