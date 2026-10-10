import { createToolIo } from '../../../src/host/backend/toolIo'

/** Real checked file reads with no shell environment or worker process. */
export function acpMediaIo() {
  return createToolIo({
    platform: process.platform,
    listFiles: () => Promise.resolve([]),
    systemRoot: process.env['SystemRoot'],
    env: () => ({}),
    searchWorkerPath: '',
    log: () => undefined,
    unsavedFiles: () => [],
  })
}
