import { vi } from 'vitest'
import path from 'node:path'
import type { MuseCodeAccountHome } from '../../../src/core/backends/musecode/accountHomes'
import { UI_TEXT } from '../../../src/shared/constants'

/** Test-owned home lease; it does not enable the shipped capture gate. */
export function fakeAccountHome(
  account = 'work',
  configHome = path.resolve('test/fixtures/workspace/no-muse-config', account),
) {
  const lifetime = new AbortController()
  const home = {
    provider: 'meta',
    account,
    configHome,
    generation: 0,
    signal: lifetime.signal,
    assertCurrent: vi.fn(() => {
      if (lifetime.signal.aborted) throw new Error(UI_TEXT.accounts.invalidAccount)
    }),
    observeUsage: vi.fn(),
  } satisfies MuseCodeAccountHome
  return {
    ...home,
    invalidate: () => {
      lifetime.abort()
    },
  }
}
