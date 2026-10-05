import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stageVsix, packagedChangelog } from '../../scripts/package-vsix.mjs'
import { listFiles } from '@vscode/vsce/out/package.js'

const ROOT = process.cwd()
const fixture = { root: '', stage: '', files: [] }
const excluded = [
  'PLAN.md',
  'AGENTS.md',
  'docs/certification/train-0.13.0.md',
  'test/unit/private.test.ts',
  'test/fixtures/private.json',
  'src/extension.ts',
  'dist/meta/webview.json',
  'dist/webview/main.js.map',
  'dist/webview/chunks/dialog.js.map',
  'media/readme/banner.png',
  'docs/marketplace-readme.md',
  'l10n/untranslated.json',
]

beforeAll(async () => {
  mkdirSync(path.join(ROOT, 'temp'), { recursive: true })
  fixture.root = mkdtempSync(path.join(ROOT, 'temp', 'train13b-package-'))
  fixture.stage = path.join(fixture.root, 'dist', 'vsix-package')
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  for (const file of [
    '.vscodeignore',
    'README.md',
    'CHANGELOG.md',
    'docs/marketplace-readme.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.txt',
    'docs/PRIVACY.md',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    cpSync(path.join(ROOT, file), path.join(fixture.root, file))
  }
  writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify(manifest, null, 2))
  const markers = excluded.filter(
    (file) => !['PLAN.md', 'docs/marketplace-readme.md'].includes(file),
  )
  for (const file of markers) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(path.join(fixture.root, file), 'must not ship')
  }
  writeFileSync(path.join(fixture.root, 'PLAN.md'), 'must not ship')
  for (const file of [
    'dist/extension.js',
    'dist/validation.js',
    'dist/webview/main.js',
    'dist/webview/main.css',
    'dist/webview/chunks/UsageDialog-test.js',
    'native/darwin/muse-dictate',
  ]) {
    mkdirSync(path.dirname(path.join(fixture.root, file)), { recursive: true })
    writeFileSync(path.join(fixture.root, file), 'runtime')
  }
  cpSync(path.join(ROOT, 'l10n'), path.join(fixture.root, 'l10n'), { recursive: true })
  cpSync(path.join(ROOT, 'package.nls.json'), path.join(fixture.root, 'package.nls.json'))
  writeFileSync(
    path.join(fixture.root, 'dist/meta/webview.json'),
    JSON.stringify({
      outputs: { 'dist/webview/main.js': {}, 'dist/webview/chunks/UsageDialog-test.js': {} },
    }),
  )
  fixture.files = await stageVsix(fixture.root, fixture.stage)
})
afterAll(() => rmSync(fixture.root, { recursive: true, force: true }))

describe('VSIX packaging', () => {
  it.each(excluded)('excludes %s from actual VSCE collection', (file) => {
    expect(fixture.files).not.toContain(file)
  })
  it('ships the helper, shared runtime and deferred chunks', async () => {
    const packaged = await listFiles({ cwd: fixture.stage, dependencies: false })
    expect(packaged).toEqual(
      expect.arrayContaining([
        'dist/validation.js',
        'dist/webview/chunks/UsageDialog-test.js',
        'native/darwin/muse-dictate',
      ]),
    )
    expect(packaged).not.toContain('docs/marketplace-readme.md')
  })
  it('compacts translations with identical values and leaves the source byte-exact', () => {
    const source = path.join(fixture.root, 'l10n/ui.de.json')
    const before = readFileSync(path.join(ROOT, 'l10n/ui.de.json'))
    const shipped = readFileSync(path.join(fixture.stage, 'l10n/ui.de.json'), 'utf8')
    expect(JSON.parse(shipped)).toEqual(JSON.parse(before))
    expect(shipped).toBe(JSON.stringify(JSON.parse(before)))
    expect(createHash('sha256').update(readFileSync(source)).digest('hex')).toBe(
      createHash('sha256').update(before).digest('hex'),
    )
  })
  it('keeps a compact guide and recent notes with links to complete documentation', () => {
    expect(readFileSync(path.join(fixture.stage, 'README.md'), 'utf8')).toBe(
      readFileSync('docs/marketplace-readme.md', 'utf8'),
    )
    const source = readFileSync('CHANGELOG.md', 'utf8')
    const sections = source.matchAll(/^## \[\d+\.\d+\.\d+\].*$/gm).toArray()
    const shipped = readFileSync(path.join(fixture.stage, 'CHANGELOG.md'), 'utf8')
    expect(shipped).toContain(source.slice(0, sections[2].index).trimEnd())
    expect(shipped).not.toContain(sections[2][0])
    expect(shipped).toContain('[Complete release history]')
    expect(packagedChangelog('## [0.1.0] - 2026-01-01\n\nNotes')).toContain('Notes')
    expect(() => packagedChangelog('No releases')).toThrow('No released')
  })
  it('keeps the quiet GitHub star link in the README Marketplace and Open VSX render', () => {
    expect(readFileSync(path.join(fixture.stage, 'README.md'), 'utf8')).toContain(
      '[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)',
    )
  })
  it('refuses a stage outside its owned build directory', async () => {
    await expect(stageVsix(fixture.root, path.join(fixture.root, 'other'))).rejects.toThrow(
      'Invalid VSIX stage',
    )
  })
})
