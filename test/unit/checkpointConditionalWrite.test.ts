import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fingerprint } from '../../src/core/verify/fingerprint'
import {
  createCheckpointPort,
  withCheckpointCopies,
} from '../../src/host/checkpoints/checkpointHost'
import { writeFileIfUnchanged } from '../../src/host/fsAtomic'
import { noopToolIo } from './helpers/fakeToolIo'
import {
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  turn,
  write,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

describe('M68 conditional writer with M72 preimages', () => {
  it(
    'keeps the real ignored preimage before a successful fingerprint-bound write',
    async () => {
      const h = await harness()
      await write(h.root, '.gitignore', '.env\n')
      const before = 'LOCAL=before\n'
      await write(h.root, '.env', before)
      const port = createCheckpointPort({
        store: h.store,
        isNamespaceKnown: () => true,
        isEnabled: () => true,
        isWorkspaceTrusted: () => true,
        hasGit: () => true,
      })
      const io = withCheckpointCopies(
        {
          ...noopToolIo,
          writeFileIfUnchanged: async (file, expected, content, options) =>
            await writeFileIfUnchanged(file, expected, content, {
              sleep: () => Promise.resolve(),
              expectedCanonicalPath: options.expectedCanonicalPath,
              platform: process.platform,
            }),
        },
        port,
      )
      const target = path.join(h.root, '.env')
      await turn(h, 't1', async () => {
        expect(
          await io.writeFileIfUnchanged(target, fingerprint(before), 'LOCAL=after\n', {
            expectedCanonicalPath: target,
            unsavedAt: [],
          }),
        ).toBe('written')
      })
      const restored = await restoreOutcome(h.store, 't1')
      expect(restored).toMatchObject({ ok: true, changed: ['.env'] })
      expect(await read(h.root, '.env')).toBe(before)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
