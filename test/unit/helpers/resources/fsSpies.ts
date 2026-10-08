// Spies on node:fs/promises removal calls for swap and failure probes. Type
// imports only: a vi.mock factory loads this module while node:fs/promises
// itself is being mocked.
import type * as FsPromises from 'node:fs/promises'
import { vi } from 'vitest'

/** `node:fs/promises` with `rm` and `rename` as pass-through spies (a `vi.mock` factory body). */
export function withRemovalSpies(real: typeof FsPromises): typeof FsPromises {
  return { ...real, rm: vi.fn(real.rm), rename: vi.fn(real.rename) }
}

/** Puts the spied `rm` and `rename` back on the real functions. */
export function restoreRemovalSpies(spied: typeof FsPromises, real: typeof FsPromises): void {
  vi.mocked(spied.rm).mockImplementation(real.rm)
  vi.mocked(spied.rename).mockImplementation(real.rename)
}
