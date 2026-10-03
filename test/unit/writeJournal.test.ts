// The write journal (M86, PLAN.md D63, spec section 6) on the real file
// system: one durable line per entry, content-addressed blobs, and what a
// reader makes of a journal a crash or a full disk cut short.

import { mkdtempSync, realpathSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import type { Owner, WriteRecord } from '../../src/core/checkpoints/toolWrites'
import { WriteJournal } from '../../src/host/checkpoints/writeJournal'
import {
  CHECKPOINT_BLOBS_DIR,
  CHECKPOINT_JOURNAL_FILE,
  CHECKPOINT_WRITES_DIR,
} from '../../src/shared/constants'
import { fsFailure, halfWhenFull, journalFsWith, NODE_JOURNAL_FS } from './helpers/journalFs'
import { removeFolder } from './helpers/temporaryFolders'

const base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-write-journal-')))

afterAll(async () => {
  await removeFolder(base)
})

// Real file system work, flushed to the disk: slower on a busy Windows host.
const REAL_FS_TIMEOUT_MS = 60_000

const OID_A = gitBlobOid(Buffer.from('a'))
const OID_B = gitBlobOid(Buffer.from('b'))

/** A fresh storage folder of its own. */
async function storage(): Promise<string> {
  return await fsp.mkdtemp(path.join(base, 'storage-'))
}

/** Every instance's journal, as a new window reads it. */
async function readAll(storageDir: string) {
  return await WriteJournal.readAll(storageDir)
}

function ownerOf(instance: string, unitId = 't1'): Owner {
  return { instance, sessionId: 's1', unitKind: 'turn', unitId }
}

function writeOf(instance: string, id: string, seq: number): WriteRecord {
  return {
    id,
    instance,
    seq,
    owner: ownerOf(instance),
    path: 'src/a.txt',
    before: { present: true, oid: OID_A, mode: '100644' },
    after: { present: true, oid: OID_B },
    createdFolders: [],
    isKept: true,
  }
}

function journalFile(storageDir: string, instance: string): string {
  return path.join(storageDir, CHECKPOINT_WRITES_DIR, instance, CHECKPOINT_JOURNAL_FILE)
}

/** The journal's entries as a reader finds them, by kind. */
async function kinds(storageDir: string, instance: string) {
  const journals = await readAll(storageDir)
  const journal = journals.get(instance)
  return {
    kinds: journal?.entries.map((entry) => entry.kind),
    tornTail: journal?.tornTail,
  }
}

describe('WriteJournal (M86)', { timeout: REAL_FS_TIMEOUT_MS }, () => {
  it('takes its snapshot only after a partial append becomes durable', async () => {
    const storageDir = await storage()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    let hasPaused = false
    const journal = new WriteJournal({
      storageDir,
      instance: 'snapshot',
      fs: journalFsWith((real) => ({
        write: async (bytes, offset, length, position) => {
          if (hasPaused) {
            return await real.write(bytes, offset, length, position)
          }
          hasPaused = true
          const half = Math.floor(length / 2)
          await real.write(bytes, offset, half, position)
          entered.resolve(undefined)
          await release.promise
          return { bytesWritten: half }
        },
      })),
    })
    const append = journal.appendIntent(writeOf('snapshot', 'w1', 1))
    await entered.promise
    const snapshot = journal.snapshot()
    release.resolve(undefined)
    await append
    expect(await snapshot).toEqual({
      entries: [{ kind: 'intent', write: writeOf('snapshot', 'w1', 1) }],
      tornTail: 'none',
    })
    await journal.close()
  })

  it.skipIf(process.platform === 'win32')(
    'retries blob and newly created folder name barriers after EIO',
    async () => {
      const storageDir = await storage()
      const blobFolder = path.join(
        storageDir,
        CHECKPOINT_WRITES_DIR,
        'barrier',
        CHECKPOINT_BLOBS_DIR,
      )
      const bytes = Buffer.from('durable bytes')
      let hasFailedFolder = false
      let hasFailedBlob = false
      let blobFlushes = 0
      let parentFlushes = 0
      const journal = new WriteJournal({
        storageDir,
        instance: 'barrier',
        fs: {
          ...NODE_JOURNAL_FS,
          open: async (file, flags, mode) => {
            const handle = await fsp.open(file, flags, mode)
            if (flags !== 'r') {
              return handle
            }
            return {
              write: async (data, offset, length, position) =>
                await handle.write(data, offset, length, position),
              truncate: async (length) => {
                await handle.truncate(length)
              },
              stat: async () => await handle.stat(),
              close: async () => {
                await handle.close()
              },
              sync: async () => {
                if (file === storageDir) {
                  parentFlushes += 1
                  if (!hasFailedFolder) {
                    hasFailedFolder = true
                    throw fsFailure('EIO')
                  }
                }
                if (file === blobFolder) {
                  blobFlushes += 1
                  if (!hasFailedBlob) {
                    hasFailedBlob = true
                    throw fsFailure('EIO')
                  }
                }
                await handle.sync()
              },
            }
          },
        },
      })
      await expect(journal.writeBlob(bytes)).rejects.toThrow('EIO')
      await expect(journal.writeBlob(bytes)).rejects.toThrow('EIO')
      expect(
        await fsp.readFile(WriteJournal.blobPath(storageDir, 'barrier', gitBlobOid(bytes))),
      ).toEqual(bytes)
      expect(await journal.writeBlob(bytes)).toBe(gitBlobOid(bytes))
      expect(blobFlushes).toBe(2)
      expect(parentFlushes).toBe(2)
    },
  )
  it('appends every entry as one line and reads each instance back in its order', async () => {
    const storageDir = await storage()
    const first = new WriteJournal({ storageDir, instance: 'one' })
    const second = new WriteJournal({ storageDir, instance: 'two' })
    await first.appendIntent(writeOf('one', 'w1', 1))
    await second.appendIntent(writeOf('two', 'w2', 1))
    await first.appendDone('w1')
    await first.appendAborted('w3')
    await first.appendIncomplete(ownerOf('one'))
    await first.appendSeal(ownerOf('one'))
    await Promise.all([first.close(), second.close()])
    const text = await fsp.readFile(journalFile(storageDir, 'one'), 'utf8')
    expect(text.split('\n')).toHaveLength(6)
    expect(text.endsWith('\n')).toBe(true)
    const journals = await WriteJournal.readAll(storageDir)
    expect(new Set(journals.keys())).toEqual(new Set(['one', 'two']))
    expect(journals.get('one')).toEqual({
      entries: [
        { kind: 'intent', write: writeOf('one', 'w1', 1) },
        { kind: 'done', id: 'w1' },
        { kind: 'aborted', id: 'w3' },
        { kind: 'incomplete', owner: ownerOf('one') },
        { kind: 'seal', owner: ownerOf('one') },
      ],
      tornTail: 'none',
    })
    expect(journals.get('two')?.entries).toEqual([
      { kind: 'intent', write: writeOf('two', 'w2', 1) },
    ])
  })

  it('appends concurrent entries one whole line after another', async () => {
    const storageDir = await storage()
    const journal = new WriteJournal({ storageDir, instance: 'many' })
    const ids = Array.from({ length: 40 }, (_, index) => `w${String(index)}`)
    await Promise.all(
      ids.map(async (id) => {
        await journal.appendDone(id)
      }),
    )
    await journal.close()
    const journals = await WriteJournal.readAll(storageDir)
    expect(journals.get('many')?.entries.map((entry) => ('id' in entry ? entry.id : ''))).toEqual(
      ids,
    )
  })

  it('keeps a blob whole under its git blob id, and once', async () => {
    const storageDir = await storage()
    const journal = new WriteJournal({ storageDir, instance: 'blobs' })
    const bytes = Buffer.from('kept before copy\n')
    const oid = await journal.writeBlob(bytes)
    expect(oid).toBe(gitBlobOid(bytes))
    const file = WriteJournal.blobPath(storageDir, 'blobs', oid)
    expect(await fsp.readFile(file)).toEqual(bytes)
    const { ino } = await fsp.stat(file)
    expect(await journal.writeBlob(Buffer.from(bytes))).toBe(oid)
    const again = await fsp.stat(file)
    expect(again.ino).toBe(ino)
    expect(await journal.writeBlob(new Uint8Array())).toBe(gitBlobOid(new Uint8Array()))
    // No stage is left beside them.
    const kept = await fsp.readdir(path.dirname(file))
    expect(new Set(kept)).toEqual(new Set([oid, gitBlobOid(new Uint8Array())]))
  })

  it.each(['done', 'seal'] as const)(
    'cuts a %s whose flush failed back off the journal, and appends again after it (F)',
    async (kind) => {
      const storageDir = await storage()
      let flushes = 0
      const journal = new WriteJournal({
        storageDir,
        instance: 'flush',
        fs: journalFsWith((real) => ({
          sync: async () => {
            flushes += 1
            // The second line's flush fails: written, but not known to be on the disk.
            if (flushes === 2) {
              throw fsFailure('EIO')
            }
            await real.sync()
          },
        })),
      })
      await journal.appendIntent(writeOf('flush', 'w1', 1))
      await expect(
        kind === 'done' ? journal.appendDone('w1') : journal.appendSeal(ownerOf('flush')),
      ).rejects.toThrow('EIO')
      // The line that may not be durable is gone: the write stays unsettled.
      expect(await kinds(storageDir, 'flush')).toEqual({ kinds: ['intent'], tornTail: 'none' })
      await journal.appendAborted('w2')
      await journal.close()
      expect(await kinds(storageDir, 'flush')).toEqual({
        kinds: ['intent', 'aborted'],
        tornTail: 'none',
      })
    },
  )

  it('leaves the journal as it was when the disk is full mid-line (N)', async () => {
    const storageDir = await storage()
    let isFull = false
    const journal = new WriteJournal({
      storageDir,
      instance: 'full',
      // Half the line lands, then the disk is full.
      fs: journalFsWith((real) => ({ write: halfWhenFull(real, () => isFull) })),
    })
    await journal.appendIntent(writeOf('full', 'w1', 1))
    const before = await fsp.readFile(journalFile(storageDir, 'full'), 'utf8')
    isFull = true
    await expect(journal.appendIntent(writeOf('full', 'w2', 2))).rejects.toThrow('ENOSPC')
    expect(await fsp.readFile(journalFile(storageDir, 'full'), 'utf8')).toBe(before)
    isFull = false
    await journal.appendDone('w1')
    await journal.close()
    expect(await kinds(storageDir, 'full')).toEqual({ kinds: ['intent', 'done'], tornTail: 'none' })
  })

  it('is broken for good when a torn line cannot be cut back: nothing follows it', async () => {
    const storageDir = await storage()
    let isFull = false
    const journal = new WriteJournal({
      storageDir,
      instance: 'broken',
      fs: journalFsWith((real) => ({
        write: halfWhenFull(real, () => isFull),
        truncate: () => Promise.reject(fsFailure('EIO')),
      })),
    })
    await journal.appendIntent(writeOf('broken', 'w1', 1))
    isFull = true
    await expect(journal.appendDone('w1')).rejects.toThrow('ENOSPC')
    isFull = false
    await expect(journal.appendSeal(ownerOf('broken'))).rejects.toThrow(
      'the write journal is broken',
    )
    await journal.close()
    // The half line is the last one, and a reader says so.
    expect(await kinds(storageDir, 'broken')).toEqual({ kinds: ['intent'], tornTail: 'unparsed' })
  })

  it('reads a torn last line: an intent as unsettled, any other entry as never written (F)', async () => {
    const storageDir = await storage()
    const write = async (instance: string, text: string) => {
      const file = journalFile(storageDir, instance)
      await fsp.mkdir(path.dirname(file), { recursive: true })
      await fsp.writeFile(file, text)
    }
    const intent = (instance: string, id: string, seq: number) =>
      JSON.stringify({ kind: 'intent', write: writeOf(instance, id, seq) })
    const done = JSON.stringify({ kind: 'done', id: 'w1' })
    await write('cut', `${intent('cut', 'w1', 1)}\n${intent('cut', 'w2', 2)}`)
    await write('ended', `${intent('ended', 'w1', 1)}\n${done}`)
    await write('garbage', `${intent('garbage', 'w1', 1)}\n{"kind":"do`)
    await write('middle', `${intent('middle', 'w1', 1)}\nnot json\n${done}\n`)
    const journals = await WriteJournal.readAll(storageDir)
    expect(journals.get('cut')).toMatchObject({ tornTail: 'intent' })
    expect(journals.get('cut')?.entries.map((entry) => entry.kind)).toEqual(['intent', 'intent'])
    // A done that never got its line feed was never durable: its write stays unsettled.
    expect(journals.get('ended')?.entries.map((entry) => entry.kind)).toEqual(['intent'])
    expect(journals.get('ended')?.tornTail).toBe('none')
    expect(journals.get('garbage')?.tornTail).toBe('unparsed')
    expect(journals.get('middle')?.entries.map((entry) => entry.kind)).toEqual(['intent', 'done'])
    expect(journals.get('middle')?.tornTail).toBe('unparsed')
  })

  it("reads a dead instance's journal from a new one, and skips lines that are not its own", async () => {
    const storageDir = await storage()
    const dead = new WriteJournal({ storageDir, instance: 'dead' })
    await dead.appendIntent(writeOf('dead', 'w1', 1))
    await dead.writeBlob(Buffer.from('a'))
    // The window is gone: never closed, never sealed. A new window reads it.
    const file = journalFile(storageDir, 'dead')
    const foreign = JSON.stringify({ kind: 'intent', write: writeOf('other', 'w9', 9) })
    await fsp.appendFile(file, `${foreign}\n`)
    const journals = await WriteJournal.readAll(storageDir)
    expect(journals.get('dead')).toEqual({
      entries: [{ kind: 'intent', write: writeOf('dead', 'w1', 1) }],
      tornTail: 'unparsed',
    })
    expect(await fsp.readFile(WriteJournal.blobPath(storageDir, 'dead', OID_A), 'utf8')).toBe('a')
    await dead.close()
    // Folders with no journal (a blob kept, no intent yet) and stray names are skipped.
    await fsp.mkdir(path.join(storageDir, CHECKPOINT_WRITES_DIR, 'empty', CHECKPOINT_BLOBS_DIR), {
      recursive: true,
    })
    await fsp.writeFile(path.join(storageDir, CHECKPOINT_WRITES_DIR, 'not an id'), '')
    const found = await readAll(storageDir)
    expect(new Set(found.keys())).toEqual(new Set(['dead']))
    expect(await WriteJournal.readAll(path.join(storageDir, 'missing'))).toEqual(new Map())
  })

  it('refuses an instance or blob id that would lead out of its folder', () => {
    expect(() => WriteJournal.blobPath(base, '..', OID_A)).toThrow('not an instance id')
    expect(() => WriteJournal.blobPath(base, 'one', `../${OID_A}`)).toThrow('not a blob id')
    expect(() => new WriteJournal({ storageDir: base, instance: 'a/b' })).toThrow(
      'not an instance id',
    )
  })
})
