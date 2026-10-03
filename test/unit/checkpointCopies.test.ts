import { mkdir, mkdtemp, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as identity from '../../src/core/fs/fileIdentity'
import { CheckpointCopies } from '../../src/host/checkpoints/checkpointCopies'
import {
  CHECKPOINT_COPY_SWEEP_MAX_FILES,
  CHECKPOINT_COPY_SWEEP_MAX_MS,
} from '../../src/shared/constants'

const folders: string[] = []
const sweepers: CheckpointCopies[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const sweeper of sweepers.splice(0)) await sweeper.close()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

async function setup() {
  const storage = await mkdtemp(path.join(tmpdir(), 'muse-copy-sweep-'))
  folders.push(storage)
  const blobs = path.join(storage, 'm86', 'one', 'blobs')
  await mkdir(blobs, { recursive: true })
  const sweeper = new CheckpointCopies(storage)
  sweepers.push(sweeper)
  const copy = async (name: string) => {
    const file = path.join(blobs, name)
    await writeFile(file, 'copy bytes')
    await utimes(file, 0, 0)
    return file
  }
  return { storage, blobs, sweeper, copy }
}

async function copyCount(folder: string): Promise<number> {
  const names = await readdir(folder)
  return names.length
}

it('bounds copy traversal by count and resumes its directory cursor next pass', async () => {
  const t = await setup()
  const count = CHECKPOINT_COPY_SWEEP_MAX_FILES + 2
  for (let index = 0; index < count; index += 1) await t.copy(`orphan-${String(index)}`)
  vi.spyOn(performance, 'now').mockReturnValue(0)
  await t.sweeper.sweep([], [])
  const left = await copyCount(t.blobs)
  expect(left).toBeGreaterThan(0)
  expect(left).toBeLessThan(count)
  for (let pass = 0; pass < count && (await copyCount(t.blobs)) > 0; pass += 1) {
    await t.sweeper.sweep([], [])
  }
  expect(await readdir(t.blobs)).toEqual([])
})

it('bounds copy traversal by time and resumes next pass', async () => {
  const t = await setup()
  await t.copy('first')
  await t.copy('second')
  const clock = vi
    .spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValue(CHECKPOINT_COPY_SWEEP_MAX_MS + 1)
  await t.sweeper.sweep([], [])
  clock.mockRestore()
  expect(await copyCount(t.blobs)).toBe(1)
  await t.sweeper.sweep([], [])
  expect(await readdir(t.blobs)).toEqual([])
})

it('sweeps a crash-left stage but preserves every copy behind an unexplained journal tail', async () => {
  const t = await setup()
  const stage = await t.copy('abandoned.tmp')
  const journal = path.join(t.storage, 'm86', 'one', 'journal.jsonl')
  await writeFile(journal, '{')
  await t.sweeper.sweep([], [])
  expect(await readFile(stage, 'utf8')).toBe('copy bytes')
  await writeFile(journal, '')
  await t.sweeper.sweep([], [])
  expect(await readdir(t.blobs)).toEqual([])
})

it.each(['ino', 'dev'] as const)(
  'preserves a replaced copy with distinct native %s IDs that round to one Number',
  async (field) => {
    const t = await setup()
    const file = await t.copy('orphan')
    const moved = path.join(t.storage, 'moved')
    const sample = identity.lstatIdentity
    let samples = 0
    vi.spyOn(identity, 'lstatIdentity').mockImplementation(async (target) => {
      const stats = await sample(target)
      if (target !== file) return stats
      const id = samples++ === 0 ? 9_007_199_254_740_992n : 9_007_199_254_740_993n
      if (samples === 1) {
        await rename(file, moved)
        await writeFile(file, 'user bytes')
        await utimes(file, 0, 0)
      }
      return Object.assign(stats, { dev: 77n, ino: 88n, [field]: id })
    })
    await t.sweeper.sweep([], [])
    expect(samples).toBe(2)
    expect(await readFile(file, 'utf8')).toBe('user bytes')
    expect(await readFile(moved, 'utf8')).toBe('copy bytes')
  },
)
