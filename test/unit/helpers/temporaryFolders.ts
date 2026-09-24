// Removing a test's temporary folder. On Windows a scanner or an indexer
// can hold a file there for a moment after the test is done with it, so
// Node retries the removal. A folder still held after the retries fails the
// suite: that is how a process a test leaves behind shows (the tree kill's
// orphans, PLAN.md M27, sat in `toolIo.test.ts`'s folder this way).

import { rm } from 'node:fs/promises'

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
