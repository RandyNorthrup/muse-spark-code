import { Buffer } from 'node:buffer'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitBlobOid } from '../../src/core/checkpoints/gitListings'
import { applyFileStep } from '../../src/host/checkpoints/checkpointFiles'
import { ATOMIC_TEMPORARY_SUFFIX } from '../../src/shared/constants'
import {
  done,
  harness,
  read,
  REAL_GIT_TIMEOUT_MS,
  redoRestore,
  removeCheckpointFolders,
  turn,
  write,
} from './helpers/checkpointHarness'

// Facade around real filesystem calls; the native stage is closed before the hold.
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fs>()),
}))

beforeEach(() => vi.restoreAllMocks())
afterEach(async () => {
  vi.restoreAllMocks()
  await removeCheckpointFolders()
})

function holdNativeStage(target: string) {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const open = fs.open
  let wasHeld = false
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args)
    const name = args[0]
    if (
      !wasHeld &&
      typeof name === 'string' &&
      name.startsWith(`${target}.`) &&
      name.endsWith(ATOMIC_TEMPORARY_SUFFIX)
    ) {
      wasHeld = true
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close()
        entered.resolve(undefined)
        await resume.promise
      })
    }
    return handle
  })
  return { entered, resume }
}

async function fileTurn() {
  const h = await harness()
  await write(h.root, 'nested/a.txt', 'a0\n')
  await write(h.root, 'b.txt', 'b0\n')
  await turn(h, 't1', async (tool) => {
    await tool('nested/a.txt', 'a1\n')
    await tool('b.txt', 'b1\n')
  })
  return h
}

function lateChangeResult(change: string) {
  if (change === 'disk edit') {
    return { reason: 'changedAfter', after: 'new user bytes\n' }
  }
  return change === 'dirty editor'
    ? { reason: 'unsaved', after: 'a1\n' }
    : { reason: 'failed', after: 'foreign bytes\n' }
}

describe('checkpoint native publication boundary (M72/M68/M86)', () => {
  it.each(['disk edit', 'dirty editor', 'parent junction swap'])(
    'preserves a late %s during a real closed stage and keeps partial Redo',
    async (change) => {
      const h = await fileTurn()
      const target = path.join(h.root, 'nested', 'a.txt')
      const held = holdNativeStage(target)
      let isDirty = false
      const restoring = h.store.restore({
        backend: () => 'modelApi',
        sessionId: 's1',
        turnId: 't1',
        transcriptTurnIds: ['t1'],
        unsavedPaths: () => (isDirty ? [target] : []),
      })
      const outside = path.join(path.dirname(h.top), 'foreign')
      try {
        await held.entered.promise
        if (change === 'disk edit') {
          await write(h.root, 'nested/a.txt', 'new user bytes\n')
        } else if (change === 'dirty editor') {
          isDirty = true
        } else {
          await fs.mkdir(outside)
          await fs.writeFile(path.join(outside, 'a.txt'), 'foreign bytes\n')
          await fs.rename(path.dirname(target), `${path.dirname(target)}-moved`)
          await fs.symlink(outside, path.dirname(target), 'junction')
        }
      } finally {
        held.resume.resolve(undefined)
      }
      const restored = done(await restoring)
      expect(restored.changed).toEqual(['b.txt'])
      const { reason, after } = lateChangeResult(change)
      expect(restored.refused).toContainEqual({
        path: 'nested/a.txt',
        reason,
      })
      expect(await fs.readFile(target, 'utf8')).toBe(after)
      expect(restored.restoreId).toBeDefined()
      const redone = await redoRestore(h.reopen(), restored.restoreId ?? '')
      expect(redone.changed).toEqual(['b.txt'])
      expect(await read(h.root, 'b.txt')).toBe('b1\n')
      expect(await fs.readFile(target, 'utf8')).toBe(after)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'publishes an unchanged real staged restore and its durable inverse',
    async () => {
      const h = await fileTurn()
      const held = holdNativeStage(path.join(h.root, 'nested', 'a.txt'))
      const restoring = h.store.restore({
        backend: () => 'modelApi',
        sessionId: 's1',
        turnId: 't1',
        transcriptTurnIds: ['t1'],
        unsavedPaths: () => [],
      })
      try {
        await held.entered.promise
        expect(await read(h.root, 'nested/a.txt')).toBe('a1\n')
      } finally {
        held.resume.resolve(undefined)
      }
      const restored = done(await restoring)
      expect(restored.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'b.txt',
        'nested/a.txt',
      ])
      expect(await read(h.root, 'nested/a.txt')).toBe('a0\n')
      const redone = await redoRestore(h.reopen(), restored.restoreId ?? '')
      expect(redone.changed.toSorted((left, right) => left.localeCompare(right))).toEqual([
        'b.txt',
        'nested/a.txt',
      ])
      expect(await read(h.root, 'nested/a.txt')).toBe('a1\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'rechecks an unlinked deletion target after the awaited blob read retargets its parent',
    async () => {
      const h = await harness()
      await write(h.root, 'nested/a.txt', 'original\n')
      const target = path.join(h.root, 'nested', 'a.txt')
      const outside = path.join(path.dirname(h.top), 'foreign-delete')
      await fs.mkdir(outside)
      // Matching bytes cannot authorize removal of a different directory's file.
      await fs.writeFile(path.join(outside, 'a.txt'), 'original\n')
      const readFile = fs.readFile
      let wasSwapped = false
      vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
        const result = await readFile(...args)
        if (!wasSwapped && args[0] === target) {
          wasSwapped = true
          await fs.rename(path.dirname(target), `${path.dirname(target)}-moved`)
          await fs.symlink(outside, path.dirname(target), 'junction')
        }
        return result
      })
      expect(
        await applyFileStep(
          { workspaceRoot: h.root, platform: process.platform, log: h.log },
          {
            path: 'nested/a.txt',
            target: null,
            expect: { kind: 'blob', oid: gitBlobOid(Buffer.from('original\n')) },
            removeFolders: [],
          },
          undefined,
        ),
      ).toBe('linked')
      expect(await fs.readFile(target, 'utf8')).toBe('original\n')
      expect(await fs.readFile(`${path.dirname(target)}-moved/a.txt`, 'utf8')).toBe('original\n')
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
