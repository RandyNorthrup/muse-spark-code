import { engineFixtures } from './fixtures'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeEditReview } from '../../../src/runtime/features/editReview'
import { canonicalPath } from '../../../src/host/canonicalPath'
import { UI_TEXT } from '../../../src/shared/constants'
import { admissionPort } from '../../unit/helpers/activationReview'
import { nativeToolIo } from '../../unit/helpers/fakeToolIo'
import { FakeLogOutputChannel } from '../../unit/helpers/fakes'

const patch = JSON.stringify({
  files: [
    { path: 'notes.md', hunks: [{ oldStart: 1, newStart: 1, lines: ['-before', '+after'] }] },
  ],
})
const fixtures = engineFixtures()

async function setup(backend: 'museCode' | 'modelApi') {
  const root = await fixtures.folder('m104-pb-review-')
  const file = path.join(root, 'notes.md')
  await writeFile(file, 'after\n')
  let isTrusted = true
  const dirty: string[] = []
  const { checkpoints, marks } = admissionPort(() => Promise.resolve())
  const io = nativeToolIo(() => dirty)
  const publish = vi.spyOn(io, 'writeFileIfUnchanged')
  const openDiff = vi.fn<Parameters<typeof createRuntimeEditReview>[0]['openDiff']>(() =>
    Promise.resolve(),
  )
  const read = vi.fn((target: string) => readFile(target, 'utf8'))
  const owner = createRuntimeEditReview(
    {
      workspaceRoot: root,
      platform: process.platform,
      readFile: read,
      realPath: canonicalPath,
      io,
      trash: (target) => rm(target),
      checkpoints,
      assertCurrent: () => {
        if (!isTrusted) throw new Error(`${backend}: restricted`)
      },
      openDiff,
      log: new FakeLogOutputChannel(),
    },
    UI_TEXT,
    'en',
  )
  fixtures.own(owner)
  return {
    root,
    file,
    dirty,
    marks,
    publish,
    openDiff,
    read,
    owner,
    restrict: () => {
      isTrusted = false
    },
  }
}

describe.each(['museCode', 'modelApi'] as const)('portable edit review on %s', (backend) => {
  it('presents original text and reverts one actual hunk under checkpoint admission', async () => {
    const { owner, file, openDiff, marks } = await setup(backend)
    const described = await owner.review.describe(patch)
    expect(described[0]?.refusal).toBeUndefined()
    expect(await owner.review.openDiff('item', patch)).toEqual([])
    expect(openDiff).toHaveBeenCalledWith('before\n', file, expect.any(String))
    const reverted = await owner.review.revertHunk('item', patch, 0, 0)
    expect(reverted.isReverted).toBe(true)
    expect(await readFile(file, 'utf8')).toBe('before\n')
    expect(marks).toEqual([true, false])
  })

  it('refuses dirty buffers and escaped patch paths without publishing', async () => {
    const { owner, file, dirty, publish } = await setup(backend)
    dirty.push(file)
    const reverted = await owner.review.revertHunk('item', patch, 0, 0)
    expect(reverted.isReverted).toBe(false)
    const escaped = patch.replace('notes.md', '../outside.md')
    const described = await owner.review.describe(escaped)
    expect(described[0]?.refusal).toBeDefined()
    expect(publish).not.toHaveBeenCalled()
    expect(await readFile(file, 'utf8')).toBe('after\n')
  })

  it('rechecks trust after a suspended read and denies before dispatch', async () => {
    const { owner, read, restrict, publish, file } = await setup(backend)
    const waiting = Promise.withResolvers<undefined>()
    read.mockImplementationOnce(async () => {
      restrict()
      await waiting.promise
      return 'after\n'
    })
    const reverting = owner.review.revert('item', patch)
    const denied = expect(reverting).rejects.toThrow('restricted')
    waiting.resolve(undefined)
    await denied
    expect(publish).not.toHaveBeenCalled()
    expect(await readFile(file, 'utf8')).toBe('after\n')
  })

  it('shares release, drains a suspended diff and refuses further actions', async () => {
    const { owner, read, openDiff } = await setup(backend)
    const waiting = Promise.withResolvers<undefined>()
    const started = Promise.withResolvers<undefined>()
    read.mockImplementationOnce(async () => {
      started.resolve(undefined)
      await waiting.promise
      return 'after\n'
    })
    const opening = owner.review.openDiff('item', patch)
    const denied = expect(opening).rejects.toThrow('MHP_FEATURE_RELEASED')
    await started.promise
    const first = owner.dispose()
    expect(owner.dispose()).toBe(first)
    let isClosed = false
    void first.then(() => {
      isClosed = true
    })
    await Promise.resolve()
    expect(isClosed).toBe(false)
    waiting.resolve(undefined)
    await denied
    await first
    expect(openDiff).not.toHaveBeenCalled()
    await expect(owner.review.describe(patch)).rejects.toThrow('MHP_FEATURE_RELEASED')
  })
})
