import path from 'node:path'

/** Virtual filesystem fixture only; production tests use native volume/inode identities. */
export function fakeWorkerIdentity(canonical: string): Promise<string> {
  const isWindows = /^[a-z]:[\\/]/i.test(canonical) || canonical.startsWith('\\\\')
  return Promise.resolve(
    isWindows ? path.win32.normalize(canonical).toLowerCase() : path.posix.normalize(canonical),
  )
}
