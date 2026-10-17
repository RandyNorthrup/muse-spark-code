// The versioned schedule store root carries a pre-version store across once,
// so a draft created before the root moved is never orphaned.
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { carryLegacyScheduleStore } from '../../src/runtime/schedules/storeRoot'

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()!
    await rm(folder, { recursive: true, force: true })
  }
})

async function dataDir(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'schedule-store-root-'))
  folders.push(folder)
  return folder
}

it('creates the versioned root on a fresh data folder', async () => {
  const data = await dataDir()
  await carryLegacyScheduleStore(data)
  await expect(readdir(path.join(data, 'schedules', 'v1'))).resolves.toEqual([])
})

it('carries every pre-version entry across exactly once', async () => {
  const data = await dataDir()
  await mkdir(path.join(data, 'schedules'), { recursive: true })
  await writeFile(path.join(data, 'schedules', 'index.json'), '{"v":1}')
  await mkdir(path.join(data, 'schedules', 'workspace'))
  await writeFile(path.join(data, 'schedules', 'workspace', 'job.json'), '{}')
  await carryLegacyScheduleStore(data)
  const root = path.join(data, 'schedules', 'v1')
  await expect(readFile(path.join(root, 'index.json'), 'utf8')).resolves.toBe('{"v":1}')
  await expect(readFile(path.join(root, 'workspace', 'job.json'), 'utf8')).resolves.toBe('{}')
  await expect(readdir(path.join(data, 'schedules'))).resolves.toEqual(['v1'])
  // A second start moves nothing and keeps what the first carried.
  await carryLegacyScheduleStore(data)
  await expect(readFile(path.join(root, 'index.json'), 'utf8')).resolves.toBe('{"v":1}')
  await expect(readdir(path.join(data, 'schedules'))).resolves.toEqual(['v1'])
})
