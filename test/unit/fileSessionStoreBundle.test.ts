// The Model API backend's session store as its own bundle (PLAN.md D6, D14;
// ACTBUD017): src/host/backend/fileSessionStoreEntry.ts built as
// scripts/build.mjs builds it, then required by `lazyFileSessionStore` when
// the host is first built. Making the loader loads nothing; the window gets
// one store; a bundle that cannot load refuses with the Model API backend's
// own sentence and is tried again on the next build.

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Logger } from '../../src/host/logger'
import {
  isFileSessionStoreBundle,
  lazyFileSessionStore,
} from '../../src/host/backend/fileSessionStoreBundle'
import * as entry from '../../src/host/backend/fileSessionStoreEntry'
import { MODEL_API_SESSIONS_BUNDLE_FILE, UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { builtForTests, lazyLoaderCases } from './helpers/lazyBundles'
import { removeFolder } from './helpers/temporaryFolders'

const built = builtForTests(
  'src/host/backend/fileSessionStoreEntry.ts',
  MODEL_API_SESSIONS_BUNDLE_FILE,
)
const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'muse-session-store-')))
afterAll(() => removeFolder(directory))

function storeLoader(deps: {
  readonly bundlePath: string
  readonly log: Logger
  readonly loadBundle?: ((file: string) => unknown) | undefined
}) {
  return lazyFileSessionStore({
    ...deps,
    store: {
      directory,
      log: deps.log,
      retentionDays: () => 0,
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
    },
  })
}

describe('isFileSessionStoreBundle', () => {
  it('accepts the entry and refuses a module without its factory', () => {
    expect(isFileSessionStoreBundle(entry)).toBe(true)
    expect(isFileSessionStoreBundle({ createFileSessionStore: 'no' })).toBe(false)
    expect(isFileSessionStoreBundle(undefined)).toBe(false)
  })
})

describe('lazyFileSessionStore', () => {
  lazyLoaderCases(storeLoader, built, () => UI_TEXT.modelApiBundleUnavailable)

  it('lists the stored sessions through the shipped bundle', async () => {
    const store = storeLoader({ bundlePath: built.file, log: new FakeLogOutputChannel() })()
    await expect(store.list()).resolves.toEqual([])
  })
})
