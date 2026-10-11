import { vi } from 'vitest'
import type { RuntimeBackendDeps } from '../../../src/runtime/backends'
export function fakeRuntimeBackendDeps(): Pick<
  RuntimeBackendDeps,
  'secrets' | 'runGit' | 'fetch' | 'sleep' | 'log'
> {
  return {
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    runGit: () => Promise.reject(new Error('unexpected git')),
    fetch: () => Promise.reject(new Error('unexpected fetch')),
    sleep: () => Promise.resolve(),
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}
