import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { listFiles } from '@vscode/vsce/out/package.js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { removeFolder } from './helpers/temporaryFolders'

const bundles = ['vault.js', 'vaultBoundaries.js', 'estimator.js', 'estimateContracts.js']
const nativeFiles = [
  'dist/native/darwin/muse-vault',
  'native/windows/MuseSparkVault.cs',
  'native/windows/MuseSparkVaultCng.cs',
  'native/windows/MuseSparkVaultHello.cs',
  'native/windows/MuseSparkVaultLock.cs',
]
const fixture = { folder: '' }
beforeAll(() => {
  fixture.folder = mkdtempSync(path.resolve('temp/int0180-packaging-'))
  cpSync('package.json', path.join(fixture.folder, 'package.json'))
  cpSync('.vscodeignore', path.join(fixture.folder, '.vscodeignore'))
  mkdirSync(path.join(fixture.folder, 'dist'))
  for (const file of [...bundles.map((bundle) => `dist/${bundle}`), ...nativeFiles]) {
    const target = path.join(fixture.folder, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, '// test fixture')
  }
})
afterAll(() => removeFolder(fixture.folder))
it('ships the newly shared Node dependencies and first-use features in the VSIX', async () => {
  const files = await listFiles({ cwd: fixture.folder, dependencies: false })
  for (const file of [...bundles.map((bundle) => `dist/${bundle}`), ...nativeFiles])
    expect(files).toContain(file)
})
it('downloads and restores executable mode for the native vault before packaging', () => {
  const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
  const packages = workflow.slice(
    workflow.indexOf('\n  packages:'),
    workflow.indexOf('\n  secrets:'),
  )
  expect(packages).toContain('name: muse-vault-darwin')
  expect(packages).toContain('path: dist/native/darwin')
  expect(packages).toContain('chmod +x dist/native/darwin/muse-vault')
})
