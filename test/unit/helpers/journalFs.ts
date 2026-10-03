// The write journal's file system for the M86 tests (writeJournal.ts): node's
// own, or one whose journal file fails or waits at a step a test chooses, so a
// crash, a full disk or a lost flush happens where the test says.

import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { JournalFs, JournalHandle } from '../../../src/host/checkpoints/writeJournal'
import { CHECKPOINT_JOURNAL_FILE } from '../../../src/shared/constants'

export const NODE_JOURNAL_FS: JournalFs = { open, mkdir, rename, rm, stat, readFile, readdir }

/** The journal file's handle with the steps `replace` gives; blobs and folders as they are. */
export function journalFsWith(replace: (real: JournalHandle) => Partial<JournalHandle>): JournalFs {
  return {
    ...NODE_JOURNAL_FS,
    open: async (file, flags, mode) => {
      const handle = await open(file, flags, mode)
      if (path.basename(file) !== CHECKPOINT_JOURNAL_FILE) {
        return handle
      }
      const real: JournalHandle = {
        write: async (bytes, offset, length, position) =>
          await handle.write(bytes, offset, length, position),
        sync: async () => {
          await handle.sync()
        },
        truncate: async (length) => {
          await handle.truncate(length)
        },
        stat: async () => await handle.stat(),
        close: async () => {
          await handle.close()
        },
      }
      return { ...real, ...replace(real) }
    },
  }
}

/** A file system error with its code, as node gives one. */
export function fsFailure(code: string): Error {
  return Object.assign(new Error(`${code}: the file system refused`), { code })
}

/** A line write that lands half the line, then finds the disk full, while `isFull` says so. */
export function halfWhenFull(real: JournalHandle, isFull: () => boolean): JournalHandle['write'] {
  return async (bytes, offset, length, position) => {
    if (!isFull()) {
      return await real.write(bytes, offset, length, position)
    }
    await real.write(bytes, offset, Math.floor(length / 2), position)
    throw fsFailure('ENOSPC')
  }
}
