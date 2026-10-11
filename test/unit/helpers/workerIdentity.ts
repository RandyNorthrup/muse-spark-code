import path from 'node:path'
import type { WorkerFenceIo } from '../../../src/core/team/workers/workerFence'

export function fakeWorkerFiles(
  io: WorkerFenceIo,
  read: (absolute: string, maxBytes: number) => Promise<string | undefined>,
  write: (absolute: string, content: string) => Promise<void> = () => Promise.resolve(),
): WorkerFenceIo {
  return {
    ...io,
    openFile: async (given) => {
      const absolute = await io.realPath(given)
      const identity = await io.pathIdentity(absolute)
      return {
        identify: () => Promise.resolve({ absolute, identity }),
        read: (maxBytes) => read(absolute, maxBytes),
        write: (content) => write(absolute, content),
        close: () => Promise.resolve(),
      }
    },
  }
}

/** Virtual filesystem fixture only; production tests use native volume/inode identities. */
export function fakeWorkerIdentity(canonical: string): Promise<string> {
  const isWindows = /^[a-z]:[\\/]/i.test(canonical) || canonical.startsWith('\\\\')
  return Promise.resolve(
    isWindows ? path.win32.normalize(canonical).toLowerCase() : path.posix.normalize(canonical),
  )
}
