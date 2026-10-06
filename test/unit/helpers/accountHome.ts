import { vi } from 'vitest'
import path from 'node:path'
import type { MuseCodeAccountHome } from '../../../src/core/backends/musecode/accountHomes'

/** Test-owned home lease; it does not enable the shipped capture gate. */
export function fakeAccountHome(
  account = 'work',
  configHome = path.resolve('test/fixtures/workspace/no-muse-config', account),
) {
  return {
    provider: 'meta',
    account,
    configHome,
    assertCurrent: vi.fn(),
    observeUsage: vi.fn(),
  } satisfies MuseCodeAccountHome
}
