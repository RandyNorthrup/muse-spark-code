import { mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ShadowPathTooLongError } from '../../src/host/checkpoints/shadowGit'
import { MODEL_TEXT } from '../../src/shared/constants'
import {
  checkpointPort,
  harness,
  isPresent,
  owner,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
} from './helpers/checkpointHarness'

afterEach(removeCheckpointFolders)

describe('checkpoint storage that git cannot use or the workspace holds (M72, M86)', () => {
  it(
    'lets a message go ahead when the storage path is too long, and refuses the unit',
    async () => {
      const h = await harness()
      const store = h.reopenAt(h.storage, h.root, 20)
      // No store can be opened at this path by any window, so no restore can be
      // running elsewhere: the turn is published and the message is not refused.
      await store.markTurn('pending:first', true, true)
      await expect(store.startUnit(owner(store, 't1'))).rejects.toBeInstanceOf(
        ShadowPathTooLongError,
      )
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
      await expect(store.startUnit(owner(store, 't1'))).rejects.toThrow()
      expect(await isPresent(inside, 'shadow.git/HEAD')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses storage that a link on its way puts inside the workspace',
    async () => {
      const h = await harness()
      // A junction (a folder link elsewhere) beside the storage, into the workspace:
      // the path as written is outside it, the path as resolved inside.
      const inner = path.join(h.root, 'inner')
      await mkdir(inner, { recursive: true })
      const alias = path.join(path.dirname(h.storage), 'alias')
      await symlink(inner, alias, 'junction')
      const store = h.reopenAt(path.join(alias, 'checkpoints', 'key'), h.root)
      await store.markTurn('pending:first', true, true)
      await expect(store.startUnit(owner(store, 't1'))).rejects.toThrow()
      expect(await isPresent(inner, 'checkpoints/key/shadow.git/HEAD')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'refuses a workspace held by the storage in the same way',
    async () => {
      const h = await harness()
      const store = h.reopenAt(h.storage, path.join(h.storage, 'ws'))
      await store.markTurn('pending:first', true, true)
      await expect(store.startUnit(owner(store, 't1'))).rejects.toThrow()
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'keeps working for an ordinary layout',
    async () => {
      const h = await harness()
      await expect(h.store.startUnit(owner(h.store, 't1'))).resolves.toEqual({ sequence: 1 })
    },
    REAL_GIT_TIMEOUT_MS,
  )
})

describe('a tool writing into the checkpoint storage (M72, M86)', () => {
  it(
    'still writes workspace files when the storage sits beside the workspace',
    async () => {
      // The layout every store test uses: <base>/storage and <base>/ws. Deriving the
      // storage root from the folder's parent once refused every tool write here.
      const h = await harness()
      const port = checkpointPort(h)
      expect(() => {
        port.refuseStorageWrite(path.join(h.root, 'a.txt'))
      }).not.toThrow()
      expect(() => {
        port.refuseStorageWrite(path.join(h.storage, 'shadow.git', 'config'))
      }).toThrow(MODEL_TEXT.checkpointStorageWrite)
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
      const refuses = (file: string) => () => {
        port.refuseStorageWrite(file)
      }
      const own = path.join(checkpoints, 'key', 'shadow.git', 'config')
      const other = path.join(checkpoints, 'another-key', 'shadow.git', 'info', 'attributes')
      expect(refuses(own)).toThrow(MODEL_TEXT.checkpointStorageWrite)
      expect(refuses(other)).toThrow(MODEL_TEXT.checkpointStorageWrite)
      // A journal of this version is the storage's too.
      expect(refuses(path.join(checkpoints, 'key', 'm86', 'x', 'journal.jsonl'))).toThrow(
        MODEL_TEXT.checkpointStorageWrite,
      )
      expect(refuses(path.join(h.root, 'a.txt'))).not.toThrow()
      // Another install's repository anywhere in the workspace (a second VS Code
      // edition whose storage the workspace holds) is refused by its folder name.
      expect(refuses(path.join(h.root, 'Insiders', 'x', 'SHADOW.GIT', 'config'))).toThrow(
        MODEL_TEXT.checkpointStorageWrite,
      )
      // A folder that only begins with the same letters is not the storage.
      expect(refuses(path.join(`${checkpoints}-notes`, 'x.txt'))).not.toThrow()
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
