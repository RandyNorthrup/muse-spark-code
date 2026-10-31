// The created-path registry must retire every retained stage and displaced
// manifest: save() kept `${file}.${uuid}` and the published-aside copy
// forever (31,920 files in six days of Windows real use). Real files in a
// real private folder through the product's own native file commands on
// every platform (createdPathCommands): the Linux helper built below, the
// Windows job assembly built below, the macOS helper native/darwin/build.sh
// builds (hosted CI builds it before the unit step).
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { createdPathCommands } from '../../src/core/resources/resourceGovernorEntry'
import { runtimeWindowsJob } from '../../src/runtime/resources/jobs'
import { configureResources } from '../../src/core/resources/admission'
import { buildLinuxHelper } from '../../scripts/build-linux-helper.mjs'
import { createdRegistryProof } from './helpers/resources/registryProof'

const fixture: {
  root: string
  commands?: (args: readonly string[]) => Promise<string>
  dispose?: () => void
} = {
  root: '',
}

async function files(args: readonly string[]): Promise<string> {
  if (fixture.commands === undefined) throw new Error('the native file commands were not prepared')
  return await fixture.commands(args)
}

// This fixture retires no owners and archives nothing: the shared proof's
// false answers and production uninstalled answer are the true ones here.
const proof = createdRegistryProof(files, () => fixture.root)

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

beforeAll(async () => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp', 'fix-created-sweep-'))
  // The product's own helper builds, so the fixture runs the confined native
  // protocol the product ships, never a copy of its flags.
  if (process.platform === 'linux') {
    buildLinuxHelper(path.join(fixture.root, 'linux', process.arch))
    fixture.commands = createdPathCommands(fixture.root, undefined)
  } else if (process.platform === 'win32') {
    // The job helpers build where the Windows pipe helper suite builds them:
    // the temporary root, which the run's TEMP keeps private.
    const windowsJob = runtimeWindowsJob(
      mkdtempSync(path.join(tmpdir(), 'created-sweep-jobs-')),
      path.resolve('.'),
    )
    // The build is admitted through the governor, configured as the host does.
    fixture.dispose = configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob,
    })
    if ((await windowsJob()) === undefined) throw new Error('the Windows job helpers did not build')
    fixture.commands = createdPathCommands(path.resolve('native'), windowsJob)
  } else {
    fixture.commands = createdPathCommands(path.resolve('native'), undefined)
  }
})

afterAll(() => {
  fixture.dispose?.()
  fixture.root = ''
})

describe('created registry sweep', () => {
  it('saves leave only the live manifest and live entries', async () => {
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
    // The load queues the retirement; clean() runs after it and reports it.
    const second = await openRegistry(dir)
    await second.clean()
    expect(await folderNames(dir)).toEqual(['registry.json', 'trees'])
    const reopened = await readFile(path.join(dir, 'registry.json'), 'utf8')
    expect(JSON.parse(reopened)).toHaveLength(2)
  })

  it('a retained name exchanged for a foreign file is never removed', async () => {
    const dir = mkdtempSync(path.join(fixture.root, 'foreign-'))
    const planted = [
      `registry.json.${randomUUID()}`,
      `registry.json.${randomUUID()}.previous`,
      `${randomUUID()}.json.${randomUUID()}`,
    ]
    for (const name of planted) await plant(dir, name, 'personal manifest')
    const registry = await openRegistry(dir)
    await registry.createTemp('owner-c')
    const cleanup = await registry.clean()
    for (const name of planted)
      expect(await readFile(path.join(dir, name), 'utf8')).toBe('personal manifest')
    // Left alone and reported, never removed.
    for (const name of planted.slice(0, 2)) expect(cleanup.refused).toContain(path.join(dir, name))
  })

  it('one load cleans a folder seeded with 5,000 leftover names', async () => {
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
    // The load returns while the retirement is queued: a save goes through
    // the same queue in between instead of waiting for all 5,000.
    const second = await openRegistry(dir)
    await second.createTemp('owner-during')
    await second.clean()
    expect(await folderNames(dir)).toEqual(['registry.json', 'trees'])
    expect(JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8'))).toHaveLength(2)
    // 5,000 real files planted and retired through the native helpers take
    // 7.5 to 13.6 s on this project's Windows PC, near the repository's 15 s
    // Windows budget: no limit of ours on it (owner 2026-10-16).
  }, 0)
})
