// Removing a test's temporary folder. On Windows a scanner or an indexer
// can hold a file there for a moment after the test is done with it, so
// Node retries the removal. A folder still held after the retries fails the
// suite: that is how a process a test leaves behind shows (the tree kill's
// orphans, PLAN.md M27, sat in `toolIo.test.ts`'s folder this way).

import { readdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
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

/** Every file under a folder, as absolute paths: what a key scan reads. */
export function filesUnder(folder: string): readonly string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}
