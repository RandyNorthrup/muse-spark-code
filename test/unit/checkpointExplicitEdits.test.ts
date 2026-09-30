import { randomUUID } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { link, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canonicalPath } from '../../src/host/canonicalPath'
import { type CheckpointPort, withCheckpointEdit } from '../../src/host/checkpoints/checkpointHost'
import { EditReview } from '../../src/host/editor/editReview'
import { createPlanIo, type PlanIoOptions } from '../../src/host/planFeatures'
import { ATOMIC_TEMPORARY_SUFFIX, PLAN_STAGE_STALE_MS, UI_TEXT } from '../../src/shared/constants'
import {
  changedFileTurn,
  checkpointPort,
  type Harness,
  harness,
  holdRestoreRef,
  isPresent,
  read,
  REAL_GIT_TIMEOUT_MS,
  removeCheckpointFolders,
  restoreOutcome,
  write,
} from './helpers/checkpointHarness'
import { fakeMuseCodeManager } from './helpers/museCodeManager'

afterEach(removeCheckpointFolders)

const PLAN_NAME = '2026-09-29-owned.md'
const EDIT_PATCH = JSON.stringify({
  files: [
    {
      path: 'review.txt',
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-before', '+after'] }],
    },
  ],
})
const CREATED_PATCH = JSON.stringify({
  files: [
    {
      path: 'review.txt',
      hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: ['+after'] }],
    },
  ],
})

function editLease(h: Harness, signal: AbortSignal, cwd?: string, isTrusted = () => true) {
  const manager = fakeMuseCodeManager({ workspaceRoot: h.root, isWorkspaceTrusted: isTrusted })
  const port = checkpointPort(h, isTrusted)
  const check = manager.workspaceActionGuard(signal, cwd)
  const edit = async (work: (assertCanWrite?: () => void) => Promise<void>) => {
    await withCheckpointEdit(port, check, async () => {
      await work(check)
    })
  }
  return { manager, port, edit }
}

function planIo(h: Harness, edit: PlanIoOptions['edit'], options: Partial<PlanIoOptions> = {}) {
  return createPlanIo({
    log: h.log,
    now: () => Date.now(),
    ...options,
    ...(edit !== undefined && { edit }),
  })
}

function holdEditAdmission(port: CheckpointPort) {
  const entered = Promise.withResolvers<undefined>()
  const resume = Promise.withResolvers<undefined>()
  const mark = port.markTurn.bind(port)
  vi.spyOn(port, 'markTurn').mockImplementation(async (key, running) => {
    if (running) {
      entered.resolve(undefined)
      await resume.promise
    }
    await mark(key, running)
  })
  return { entered, resume }
}

type EditFamily = 'plan create' | 'plan cleanup' | 'review write' | 'review delete'

async function startEdit(h: Harness, family: EditFamily, edit: NonNullable<PlanIoOptions['edit']>) {
  const io = planIo(h, edit)
  const folder = path.join(h.root, '.agents', 'plans')
  if (family === 'plan create') {
    return await io.createFile(path.join(folder, PLAN_NAME), '# Owned\n')
  }
  if (family === 'plan cleanup') {
    await io.removeStaleStages(folder)
    return
  }
  const review = new EditReview({
    workspaceRoot: h.root,
    platform: process.platform,
    readFile: async (file) => await readFile(file, 'utf8'),
    realPath: canonicalPath,
    writeFile: async (file, content) => {
      await edit(async () => {
        await writeFile(file, content)
      })
    },
    deleteFile: async (file) => {
      await edit(async () => {
        await rm(file)
      })
    },
    openDiff: () => Promise.resolve(),
    log: h.log,
  })
  return await review.revert('owned-review', family === 'review write' ? EDIT_PATCH : CREATED_PATCH)
}

describe('current-main explicit workspace edits (M72/M79)', () => {
  it(
    'publishes no plan after trust is withdrawn during awaited presence admission',
    async () => {
      const h = await harness()
      let isTrusted = true
      const lease = editLease(h, new AbortController().signal, h.root, () => isTrusted)
      const publish = vi.fn(link)
      const { entered, resume } = holdEditAdmission(lease.port)
      const target = path.join(h.root, '.agents', 'plans', PLAN_NAME)
      const writing = planIo(h, lease.edit, { publish }).createFile(target, '# Refused\n')
      const refused = expect(writing).rejects.toThrow(UI_TEXT.checkpointFailed)
      try {
        await entered.promise
        isTrusted = false
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(publish).not.toHaveBeenCalled()
      expect(await isPresent(h.root, '.agents/plans')).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each(['trust withdrawn', 'window closed', 'owner disposed'])(
    'publishes no staged plan after %s, preserving the owned cleanup boundary',
    async (reason) => {
      const h = await harness()
      let isTrusted = true
      const lifetime = new AbortController()
      const lease = editLease(h, lifetime.signal, h.root, () => isTrusted)
      const staged = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const publish = vi.fn(link)
      const target = path.join(h.root, '.agents', 'plans', PLAN_NAME)
      const writing = planIo(h, lease.edit, {
        publish,
        staged: async () => {
          staged.resolve(undefined)
          await resume.promise
        },
      }).createFile(target, '# Must stay staged\n')
      const refused = expect(writing).rejects.toThrow(
        reason === 'trust withdrawn' ? UI_TEXT.checkpointFailed : UI_TEXT.questionCancelled,
      )
      try {
        await staged.promise
        expect(await isPresent(h.root, `.agents/plans/${PLAN_NAME}`)).toBe(false)
        if (reason === 'trust withdrawn') {
          isTrusted = false
        } else if (reason === 'window closed') {
          lifetime.abort()
        } else {
          await lease.manager.dispose()
        }
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(publish).not.toHaveBeenCalled()
      expect(await readdir(path.dirname(target))).toEqual([])
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'leaves the stale stage when trust is withdrawn after awaited ownership reads',
    async () => {
      const h = await harness()
      const name = `.a.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
      await write(h.root, `.agents/plans/${name}`, 'owned stage')
      const target = path.join(h.root, '.agents', 'plans', name)
      const now = Date.now()
      const old = new Date(now - PLAN_STAGE_STALE_MS - 1)
      await utimes(target, old, old)
      let isTrusted = true
      const lease = editLease(h, new AbortController().signal, h.root, () => isTrusted)
      await planIo(h, lease.edit, {
        now: () => {
          isTrusted = false
          return now
        },
      }).removeStaleStages(path.dirname(target))
      expect(await readFile(target, 'utf8')).toBe('owned stage')
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'holds a plan publication lease through real link settlement and preserves no-clobber success',
    async () => {
      const h = await harness()
      await changedFileTurn(h)
      const lease = editLease(h, new AbortController().signal)
      const entered = Promise.withResolvers<undefined>()
      const resume = Promise.withResolvers<undefined>()
      const target = path.join(h.root, '.agents', 'plans', PLAN_NAME)
      const io = planIo(h, lease.edit, {
        publish: async (stage, file) => {
          entered.resolve(undefined)
          await resume.promise
          await link(stage, file)
        },
      })
      const writing = io.createFile(target, '# Exact bytes\n')
      try {
        await entered.promise
        expect(await restoreOutcome(h.reopen(), 't1')).toEqual({
          ok: false,
          reason: 'turnElsewhere',
        })
        expect(await isPresent(h.root, `.agents/plans/${PLAN_NAME}`)).toBe(false)
      } finally {
        resume.resolve(undefined)
      }
      expect(await writing).toBe(true)
      expect(await readFile(target, 'utf8')).toBe('# Exact bytes\n')
      expect(await io.createFile(target, 'must not replace')).toBe(false)
      expect(await readFile(target, 'utf8')).toBe('# Exact bytes\n')
      expect(h.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'clears a failed plan publication lease only after owned-stage cleanup settles',
    async () => {
      const h = await harness()
      await changedFileTurn(h)
      const lease = editLease(h, new AbortController().signal)
      const target = path.join(h.root, '.agents', 'plans', PLAN_NAME)
      const io = planIo(h, lease.edit, {
        publish: () => Promise.reject(new Error('publication refused')),
      })
      await expect(io.createFile(target, '# Failed\n')).rejects.toThrow('publication refused')
      expect(await readdir(path.dirname(target))).toEqual([])
      expect(h.store.isNativeUnsafe).toBe(false)
      const restored = await restoreOutcome(h.reopen(), 't1')
      expect(restored.ok).toBe(true)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each<EditFamily>(['plan create', 'plan cleanup', 'review write', 'review delete'])(
    'performs no %s workspace mutation under a real restore ref',
    async (family) => {
      const h = await harness()
      await write(h.root, 'review.txt', 'after\n')
      await holdRestoreRef(h)
      const lease = editLease(h, new AbortController().signal)
      await expect(startEdit(h, family, lease.edit)).rejects.toThrow(UI_TEXT.restoreTurnElsewhere)
      expect(await read(h.root, 'review.txt')).toBe('after\n')
      expect(await isPresent(h.root, `.agents/plans/${PLAN_NAME}`)).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it.each<EditFamily>(['plan create', 'plan cleanup', 'review write', 'review delete'])(
    'performs no %s mutation after closure while admission is held',
    async (family) => {
      const h = await harness()
      await write(h.root, 'review.txt', 'after\n')
      const lifetime = new AbortController()
      const lease = editLease(h, lifetime.signal)
      const { entered, resume } = holdEditAdmission(lease.port)
      const writing = startEdit(h, family, lease.edit)
      const refused = expect(writing).rejects.toThrow(UI_TEXT.questionCancelled)
      try {
        await entered.promise
        lifetime.abort()
      } finally {
        resume.resolve(undefined)
      }
      await refused
      expect(await read(h.root, 'review.txt')).toBe('after\n')
      expect(await isPresent(h.root, `.agents/plans/${PLAN_NAME}`)).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )

  it(
    'removes an owned stale plan stage while preserving a replaced candidate through the same lease',
    async () => {
      const h = await harness()
      const folder = path.join(h.root, '.agents', 'plans')
      const ownedName = `.a.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
      const swappedName = `.b.md.${randomUUID()}${ATOMIC_TEMPORARY_SUFFIX}`
      await write(h.root, `.agents/plans/${ownedName}`, 'old owned')
      const swapped = path.join(folder, swappedName)
      const now = Date.now()
      const old = new Date(now - PLAN_STAGE_STALE_MS - 1)
      await utimes(path.join(folder, ownedName), old, old)
      const lease = editLease(h, new AbortController().signal)
      await planIo(h, lease.edit, { now: () => now }).removeStaleStages(folder)
      expect(await isPresent(folder, ownedName)).toBe(false)
      await write(h.root, `.agents/plans/${swappedName}`, 'original candidate')
      await utimes(swapped, old, old)
      let hasReplaced = false
      const io = planIo(h, lease.edit, {
        now: () => {
          if (!hasReplaced) {
            renameSync(swapped, `${swapped}-moved`)
            writeFileSync(swapped, 'foreign replacement')
            hasReplaced = true
          }
          return now
        },
      })
      await io.removeStaleStages(folder)
      expect(await readFile(swapped, 'utf8')).toBe('foreign replacement')
      expect(await readFile(`${swapped}-moved`, 'utf8')).toBe('original candidate')
      expect(h.store.isNativeUnsafe).toBe(false)
    },
    REAL_GIT_TIMEOUT_MS,
  )
})
