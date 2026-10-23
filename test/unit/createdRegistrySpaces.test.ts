// RLF-MACPATH: the created-path registry must be safe under a data home
// with spaces (`~/Library/Application Support/Muse Spark Code` on macOS,
// `%LOCALAPPDATA%\Muse Spark Code` on Windows) and must refuse a relative
// tree base outright, so a split or relative path can never scatter
// private folders (`Support/`, `Spark/`, `Code/`) into the working folder.
// Real files in a real private folder through the product's own native
// protocol (the compiled `native/darwin/MuseSparkCreated.c` on macOS and
// Linux, the job assembly on Windows), opened, created, finished and
// released exactly as the product wires it.
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CreatedRegistry } from '../../src/core/resources/createdRegistry'
import { createdRegistryProof } from './helpers/resources/registryProof'
import { nativeCreated, useCreatedNative } from './helpers/createdNative'
import { removeFolder } from './helpers/temporaryFolders'

useCreatedNative()

const fixture: { root: string } = { root: '' }
// Nothing is retired or archived here; the exit proof below retires the
// test's owners so finish/release run the native remove with spaces.
const proof = createdRegistryProof(nativeCreated)
const exitingProof = { ...proof, exited: () => Promise.resolve(true) }

/** The words a shell split of a spaces data home would drop in the cwd. */
const SPLIT_WORDS = ['Application', 'Support', 'Spark', 'Code']

beforeAll(() => {
  mkdirSync('temp', { recursive: true })
  fixture.root = mkdtempSync(path.resolve('temp', 'fix-created-spaces-'))
})

afterAll(async () => {
  if (fixture.root !== '') await removeFolder(fixture.root)
})

describe('created registry paths', () => {
  it('refuses a relative registry file or tree base and writes nothing beside it', async () => {
    await expect(CreatedRegistry.open('relative/registry.json', Date.now, proof)).rejects.toThrow(
      'Creation registry must be absolute',
    )
    await expect(
      CreatedRegistry.open(
        path.join(fixture.root, 'registry.json'),
        Date.now,
        proof,
        'relative/trees',
      ),
    ).rejects.toThrow('Creation registry must be absolute')
    expect(existsSync(path.join(process.cwd(), 'relative'))).toBe(false)
  })

  it('a data home with spaces keeps every tree, stage and manifest inside it', async () => {
    const before = new Set(await readdir(process.cwd()))
    const dir = path.join(
      mkdtempSync(path.join(fixture.root, 'home-')),
      'Application Support',
      'Muse Spark Code',
      'resource-created',
    )
    mkdirSync(path.join(dir, 'trees'), { recursive: true })
    const registry = await CreatedRegistry.open(
      path.join(dir, 'registry.json'),
      Date.now,
      exitingProof,
      path.join(dir, 'trees'),
    )
    const first = await registry.createTemp('spaces-owner-a')
    const second = await registry.createTemp('spaces-owner-b')
    for (const tree of [first, second]) {
      expect(tree.root.startsWith(`${registry.base}${path.sep}`)).toBe(true)
      expect(await readdir(tree.root)).toEqual(
        expect.arrayContaining(['.muse-owner.json', 'browser-cache', 'browser-profile']),
      )
    }
    expect(JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8'))).toHaveLength(2)
    await registry.finish('spaces-owner-a', false)
    expect(await registry.release(first.id)).toBe(true)
    expect(existsSync(first.root)).toBe(false)
    await registry.finish('spaces-owner-b', false)
    expect(await registry.release(second.id)).toBe(true)
    expect(await readdir(path.join(dir, 'trees'))).toHaveLength(0)
    expect(JSON.parse(await readFile(path.join(dir, 'registry.json'), 'utf8'))).toHaveLength(0)
    const after = await readdir(process.cwd())
    for (const word of SPLIT_WORDS) {
      if (!before.has(word)) expect(after).not.toContain(word)
    }
  })
})
