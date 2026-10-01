import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MODEL_TEXT } from '../../src/shared/constants'
import {
  captured,
  checkpointPort,
  harness,
  isPresent,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

describe('checkpoint storage that git cannot use or the workspace holds (M72)', () => {
  it(
    'lets a message go ahead when the storage path is too long, and refuses the capture',
    async () => {
      const h = await harness()
      const store = h.reopenAt(h.storage, h.root, 20)
      // No store can be opened at this path by any window, so no restore can be
      // running elsewhere: the turn is published and the message is not refused.
      await store.markTurn('pending:first', true, true)
      expect(await store.capture()).toMatchObject({ ok: false, reason: 'pathTooLong' })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses to keep its repository inside the workspace, and still lets the message go ahead',
    async () => {
      const h = await harness()
      const inside = path.join(h.root, 'storage', 'checkpoints', 'key')
      const store = h.reopenAt(inside, h.root)
      await store.markTurn('pending:first', true, true)
      expect(await store.capture()).toMatchObject({ ok: false, reason: 'failed' })
      expect(await isPresent(inside, 'shadow.git/HEAD')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses a workspace held by the storage in the same way',
    async () => {
      const h = await harness()
      const store = h.reopenAt(h.storage, path.join(h.storage, 'ws'))
      await store.markTurn('pending:first', true, true)
      expect(await store.capture()).toMatchObject({ ok: false, reason: 'failed' })
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps working for an ordinary layout',
    async () => {
      const h = await harness()
      await expect(captured(h.store)).resolves.toBeDefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('a tool writing into the checkpoint storage (M72)', () => {
  it(
    'still copies and writes workspace files when the storage sits beside the workspace',
    async () => {
      // The layout every store test uses: <base>/storage and <base>/ws. Deriving the
      // storage root from the folder's parent once refused every tool write here.
      const h = await harness()
      const port = checkpointPort(h)
      await expect(port.beforeToolWrite(path.join(h.root, 'a.txt'))).resolves.toBeUndefined()
      await expect(
        port.beforeToolWrite(path.join(h.storage, 'shadow.git', 'config')),
      ).rejects.toThrow(MODEL_TEXT.checkpointStorageWrite)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'is refused for the storage of this and of any other folder, whatever the setting',
    async () => {
      const h = await harness()
      // The layout the extension keeps: <global storage>/checkpoints/<key>.
      const checkpoints = path.join(path.dirname(h.storage), 'global', 'checkpoints')
      const port = checkpointPort({
        store: h.reopenAt(path.join(checkpoints, 'key'), undefined, undefined, checkpoints),
      })
      const own = path.join(checkpoints, 'key', 'shadow.git', 'config')
      const other = path.join(checkpoints, 'another-key', 'shadow.git', 'info', 'attributes')
      await expect(port.beforeToolWrite(own)).rejects.toThrow(MODEL_TEXT.checkpointStorageWrite)
      await expect(port.beforeToolWrite(other)).rejects.toThrow(MODEL_TEXT.checkpointStorageWrite)
      await expect(port.beforeToolWrite(path.join(h.root, 'a.txt'))).resolves.toBeUndefined()
      // A folder that only begins with the same letters is not the storage.
      await expect(
        port.beforeToolWrite(path.join(`${checkpoints}-notes`, 'x.txt')),
      ).resolves.toBeUndefined()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
