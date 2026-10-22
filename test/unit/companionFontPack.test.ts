import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findCompanionFontPack,
  openUsageCompanion,
} from '../../src/runtime/usage/usageCompanionEntry'
import { createUsageAccess } from '../../src/runtime/usage/usageServiceEntry'
import { EN } from '../../src/shared/l10n/en'
import { recordingLogger } from './helpers/recordingLogger'
import { removeFolder } from './helpers/temporaryFolders'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await removeFolder(root)
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'companion-fonts-'))
  roots.push(root)
  return root
}

const VERSION = `test-pack-${'a'.repeat(64)}`
async function makePack(root: string, version = VERSION): Promise<string> {
  const directory = path.join(root, version)
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'fonts.css'), '/* pack */')
  await writeFile(path.join(directory, 'inter.woff2'), 'wOF2')
  return directory
}

describe('companion installed-font discovery', () => {
  it('reports no pack when the fonts root is absent or empty', async () => {
    await expect(
      findCompanionFontPack(path.join(await makeRoot(), 'missing')),
    ).resolves.toBeUndefined()
    await expect(findCompanionFontPack(await makeRoot())).resolves.toBeUndefined()
  })
  it('serves the pack allowlist: fonts.css and woff2 only', async () => {
    const root = await makeRoot()
    const directory = await makePack(root)
    await writeFile(path.join(directory, 'manifest.json'), '{}')
    await writeFile(path.join(directory, 'inter-ofl.txt'), 'licence')
    await expect(findCompanionFontPack(root)).resolves.toEqual({
      directory,
      files: ['fonts.css', 'inter.woff2'],
    })
  })
  it('ignores decoy names and versions without their stylesheet', async () => {
    const root = await makeRoot()
    await mkdir(path.join(root, 'not-a-version'), { recursive: true })
    await writeFile(path.join(root, 'not-a-version', 'fonts.css'), '/* decoy */')
    const bare = path.join(root, `bare-${'b'.repeat(64)}`)
    await mkdir(bare, { recursive: true })
    await writeFile(path.join(bare, 'inter.woff2'), 'wOF2')
    const directory = await makePack(root)
    await expect(findCompanionFontPack(root)).resolves.toEqual({
      directory,
      files: ['fonts.css', 'inter.woff2'],
    })
  })
  it('prefers the newest installed version', async () => {
    const root = await makeRoot()
    await makePack(root, `aaa-${'0'.repeat(64)}`)
    const current = await makePack(root, `zzz-${'f'.repeat(64)}`)
    await expect(findCompanionFontPack(root)).resolves.toMatchObject({ directory: current })
  })
  it('skips a version whose files escape its directory', async () => {
    const root = await makeRoot()
    const outside = path.join(root, 'outside.css')
    await writeFile(outside, '/* escaped */')
    const version = path.join(root, `evil-${'c'.repeat(64)}`)
    await mkdir(version, { recursive: true })
    await symlink(outside, path.join(version, 'fonts.css'))
    await expect(findCompanionFontPack(root)).resolves.toBeUndefined()
  })
  it('refuses a broken install missing the theme sheets before listening', async () => {
    const root = await makeRoot()
    const assetsFolder = path.join(root, 'dist', 'webview')
    await mkdir(assetsFolder, { recursive: true })
    await writeFile(path.join(assetsFolder, 'usage.js'), 'export {}')
    await writeFile(path.join(assetsFolder, 'usage.css'), '/* entry */')
    const { log } = recordingLogger()
    const usage = createUsageAccess({
      dataFolder: root,
      packageRoot: process.cwd(),
      host: 'ACP',
      locale: 'en',
      uiText: EN,
      log,
    })
    await expect(
      openUsageCompanion({ usage, assetsFolder, locale: 'en', uiText: EN, log }),
    ).rejects.toThrow('EPANEL_ASSET')
  })
})
