// Removing a test's temporary folder. On Windows a scanner or an indexer
// can hold a file there for a moment after the test is done with it, so
// Node retries the removal. A folder still held after the retries fails the
// suite: that is how a process a test leaves behind shows (the tree kill's
// orphans, PLAN.md M27, sat in `toolIo.test.ts`'s folder this way).

import { readdirSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REMOVE_RETRIES = 5
const REMOVE_RETRY_DELAY_MS = 200

export function removeFolder(folder: string): Promise<void> {
  return rm(folder, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  })
}

/**
The temporary folders one suite makes, all removed afterwards. Suites
share it instead of repeating the tracker, so the duplication gate stays
silent and every folder still cleans up the same way.
*/
export function temporaryTracker() {
  const folders: string[] = []
  return {
    cleanup: async (): Promise<void> => {
      await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
    },
    make: async (prefix: string): Promise<string> => {
      const folder = await mkdtemp(path.join(tmpdir(), prefix))
      folders.push(folder)
      return folder
    },
  }
}

/** A test's temporary folder for one body: created, handed over, removed. */
export async function usingTempDir<T>(
  prefix: string,
  work: (folder: string) => T | Promise<T>,
): Promise<T> {
  const folder = await mkdtemp(path.join(tmpdir(), prefix))
  try {
    return await work(folder)
  } finally {
    await removeFolder(folder)
  }
}

/**
A fresh directory under the process temporary folder (resolved, so
macOS's `/var` symlink never leaks into hashed paths).
*/
export async function temporaryDir(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
}

/** Every file under a folder, as absolute paths: what a key scan reads. */
export function filesUnder(folder: string): readonly string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}
