// Removing a test's temporary folder. On Windows a file there can stay held
// for a moment after the test is done with it (seen as EBUSY once under a
// full coverage run, every test green; a probe of the tree kill found no
// process escaping), so Node retries the removal. A folder still held after
// the retries, as one a leaked process sits in would be, fails the suite.

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
