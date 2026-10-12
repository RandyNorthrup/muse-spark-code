// Passthrough spies over the filesystem writes the schedule ports perform,
// shared by the suites that fault-inject them. Each suite keeps its own thin
// `vi.mock` factory because only the factory sees the original module (a
// shared module object would spy on itself), and names only the writes it
// faults so the remaining surface stays the real implementation.
import type * as disk from 'node:fs/promises'
import { vi } from 'vitest'

type SpiedWrite = 'link' | 'unlink' | 'rename' | 'readFile'

export async function mockedDiskModule(
  importOriginal: () => Promise<typeof disk>,
  spied: readonly SpiedWrite[] = ['link', 'unlink', 'rename', 'readFile'],
) {
  const actual = await importOriginal()
  return {
    ...actual,
    link: spied.includes('link') ? vi.fn(actual.link) : actual.link,
    unlink: spied.includes('unlink') ? vi.fn(actual.unlink) : actual.unlink,
    rename: spied.includes('rename') ? vi.fn(actual.rename) : actual.rename,
    readFile: spied.includes('readFile') ? vi.fn(actual.readFile) : actual.readFile,
  }
}
