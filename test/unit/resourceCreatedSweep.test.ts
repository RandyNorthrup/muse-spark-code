// The created-path registry must retire every retained stage and displaced
// manifest: save() kept `${file}.${uuid}` and the published-aside copy
// forever (31,920 files in six days of Windows real use). Real files in a
// real private folder through the real Linux helper, built once below.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CreatedRegistry, type CreatedPathProof } from '../../src/core/resources/createdRegistry'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'

const isLinux = process.platform === 'linux'
const fixture = { root: '', helper: '' }

const execFileAsync = promisify(execFile)

async function files(args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync(fixture.helper, [...args], {
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  })
  return stdout
}

const proof: CreatedPathProof = {
  files,
  directories: undefined,
  // This fixture retires no owners and archives nothing: false and the
  // production uninstalled answer are the true answers here.
  exited: () => Promise.resolve(false),
  createdByTree: () => Promise.resolve(false),
  archivedAndClean: () => Promise.reject(new Error('Archive/clean proof is not installed')),
  freeBytes: () => Promise.resolve(null),
}

async function openRegistry(dir: string): Promise<CreatedRegistry> {
  return await CreatedRegistry.open(
    path.join(dir, 'registry.json'),
    Date.now,
    proof,
    path.join(dir, 'trees'),
  )
}

async function folderNames(dir: string): Promise<string[]> {
  const names = await readdir(dir)
  return names.toSorted((a, b) => a.localeCompare(b))
}

async function plant(dir: string, name: string, text: string): Promise<void> {
  await writeFile(path.join(dir, name), text, { mode: 0o600 })
}

beforeAll(() => {
  if (!isLinux) return
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp', 'fix-created-sweep-'))
  // The product's own helper build (scripts/build.mjs), so the fixture runs
  // the confined native protocol the product ships, never a copy of its flags.
  buildLinuxHelper(fixture.root)
  fixture.helper = path.join(fixture.root, 'muse-created')
})

afterAll(() => {
  fixture.root = ''
})

describe('created registry sweep', () => {
  it('saves leave only the live manifest and live entries', async () => {
    if (!isLinux) return
    const dir = mkdtempSync(path.join(fixture.root, 'saves-'))
    const registry = await openRegistry(dir)
    for (let i = 0; i < 6; i++) await registry.createTemp(`owner-${String(i)}`)
    expect(await folderNames(dir)).toEqual(['registry.json', 'trees'])
    const trees = await readdir(path.join(dir, 'trees'))
    expect(trees.filter((name) => name !== '.')).toHaveLength(6)
    const manifest = await readFile(path.join(dir, 'registry.json'), 'utf8')
    expect(JSON.parse(manifest)).toHaveLength(6)
  })

  it('one load retires names left by an earlier run', async () => {
    if (!isLinux) return
    const dir = mkdtempSync(path.join(fixture.root, 'load-'))
    const first = await openRegistry(dir)
    await first.createTemp('owner-a')
    await first.createTemp('owner-b')
    const manifest = await readFile(path.join(dir, 'registry.json'), 'utf8')
    await plant(dir, `registry.json.${randomUUID()}`, manifest)
    await plant(dir, `registry.json.${randomUUID()}.publish`, manifest)
    await plant(dir, `registry.json.${randomUUID()}.previous`, manifest)
    await plant(dir, `.muse-retired-${randomUUID()}`, manifest)
    const before = await folderNames(dir)
    expect(before.length).toBeGreaterThan(2)
    await openRegistry(dir)
    expect(await folderNames(dir)).toEqual(['registry.json', 'trees'])
    const reopened = await readFile(path.join(dir, 'registry.json'), 'utf8')
    expect(JSON.parse(reopened)).toHaveLength(2)
  })

  it('a retained name exchanged for a foreign file is never removed', async () => {
    if (!isLinux) return
    const dir = mkdtempSync(path.join(fixture.root, 'foreign-'))
    const planted = [
      `registry.json.${randomUUID()}`,
      `registry.json.${randomUUID()}.previous`,
      `${randomUUID()}.json.${randomUUID()}`,
    ]
    for (const name of planted) await plant(dir, name, 'personal manifest')
    const registry = await openRegistry(dir)
    await registry.createTemp('owner-c')
    for (const name of planted)
      expect(await readFile(path.join(dir, name), 'utf8')).toBe('personal manifest')
  })

  it('one load cleans a folder seeded with 5,000 leftover names', async () => {
    if (!isLinux) return
    const dir = mkdtempSync(path.join(fixture.root, 'seed-'))
    const registry = await openRegistry(dir)
    await registry.createTemp('owner-seed')
    const manifest = await readFile(path.join(dir, 'registry.json'), 'utf8')
    const seeds: string[] = []
    for (let i = 0; i < 2000; i++) seeds.push(`registry.json.${randomUUID()}`)
    for (let i = 0; i < 1500; i++) seeds.push(`registry.json.${randomUUID()}.publish`)
    for (let i = 0; i < 1000; i++) seeds.push(`registry.json.${randomUUID()}.previous`)
    for (let i = 0; i < 400; i++) seeds.push(`${randomUUID()}.json.${randomUUID()}`)
    for (let i = 0; i < 100; i++) seeds.push(`.muse-retired-${randomUUID()}`)
    for (let i = 0; i < seeds.length; i += 32) {
      const batch = seeds.slice(i, i + 32)
      await Promise.all(batch.map((name) => plant(dir, name, manifest)))
    }
    await openRegistry(dir)
    expect(await folderNames(dir)).toEqual(['registry.json', 'trees'])
    expect(JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8'))).toHaveLength(1)
  })
})
