// Spies on node:fs/promises calls for swap, race and failure probes. Type
// imports only: a vi.mock factory loads this module while node:fs/promises
// itself is being mocked.
import type * as FsPromises from 'node:fs/promises'
import { vi } from 'vitest'

/** `node:fs/promises` with pass-through spies on the calls the probes intercept (a `vi.mock` factory body). */
export function withRemovalSpies(real: typeof FsPromises): typeof FsPromises {
  return {
    ...real,
    rm: vi.fn(real.rm),
    rename: vi.fn(real.rename),
    // Overloaded signatures: the spy calls through with the same arguments.
    lstat: vi.fn(real.lstat) as typeof real.lstat,
    link: vi.fn(real.link),
    mkdir: vi.fn(real.mkdir) as typeof real.mkdir,
  }
}

/** Puts every spied call back on the real function. */
export function restoreRemovalSpies(spied: typeof FsPromises, real: typeof FsPromises): void {
  vi.mocked(spied.rm).mockImplementation(real.rm)
  vi.mocked(spied.rename).mockImplementation(real.rename)
  vi.mocked(spied.lstat).mockImplementation(real.lstat)
  vi.mocked(spied.link).mockImplementation(real.link)
  vi.mocked(spied.mkdir).mockImplementation(real.mkdir)
}
