import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildEnvironment } from '../../../scripts/package-hosts/manifest.mjs'

const required = [
  'runtimeContext.js',
  'runtimeEngines.js',
  'runtimeBackendServices.js',
  'runtimePresentation.js',
  'hostProtocol.js',
  'sessionBoard.js',
  'checkpointStore.js',
  'planMarkdown.js',
  'judge.js',
  'browserCheck.js',
  'browserRuntime.js',
  'whatsNew.json',
]
const baseline = [
  'acp.js',
  'runtimePanel.js',
  'runtimePanelPorts.js',
  'conversation.js',
  'modelApi.js',
  'reviewer.js',
  'foreignHooks.js',
  'hookRuntime.js',
  'recorder.js',
  'uiText.js',
  'uiTextRuntime.js',
  'uiTextHooks.js',
  'uiTextSurfaces.js',
  'extensionHooks.js',
  'validation.js',
  'wire.js',
  'searchWorker.js',
  'pageWorker.js',
]
const fixture = { root: '' }
beforeEach(() => {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'm104-pf-package-'))
  for (const dir of ['scripts', 'dist/webview/portable', 'docs/schemas', 'l10n', 'native/windows'])
    mkdirSync(path.join(fixture.root, dir), { recursive: true })
  copyFileSync('scripts/package-acp.mjs', path.join(fixture.root, 'scripts/package-acp.mjs'))
  // Only ancillary notice/badge tools are faked. The actual packaging script and npm pack run.
  writeFileSync(
    path.join(fixture.root, 'scripts/check-badges.mjs'),
    'export const renderPackageReadme = text => text;',
  )
  writeFileSync(
    path.join(fixture.root, 'scripts/third-party-notices.mjs'),
    "import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[3], 'fixture notice');",
  )
  writeFileSync(
    path.join(fixture.root, 'package.json'),
    JSON.stringify({
      version: '1.2.3',
      license: 'MIT',
      repository: { url: 'https://github.com/RandyNorthrup/muse-spark-code.git' },
      engines: { node: '>=22' },
      devDependencies: { '@napi-rs/keyring': '1.0.0' },
    }),
  )
  for (const file of [...required, ...baseline])
    writeFileSync(path.join(fixture.root, 'dist', file), file)
  for (const file of [
    'LICENSE',
    'docs/npm-readme.md',
    'native/windows/MuseSparkJob.cs',
    'native/windows/MuseSparkMcpJob.cs',
  ])
    writeFileSync(path.join(fixture.root, file), 'fixture')
  for (const file of ['exec-result-v1.schema.json', 'exec-event-v1.schema.json'])
    writeFileSync(path.join(fixture.root, 'docs/schemas', file), '{}')
  writeFileSync(
    path.join(fixture.root, 'dist/webview/portable/presentation.js'),
    'presentation asset',
  )
})
afterEach(() => {
  rmSync(fixture.root, { recursive: true, force: true })
})
function pack() {
  return execFileSync(process.execPath, ['scripts/package-acp.mjs'], {
    cwd: fixture.root,
    env: { ...buildEnvironment(process.env), NPM_CONFIG_OFFLINE: 'true' },
    stdio: 'pipe',
    encoding: 'utf8',
  })
}
describe('integrated ACP installable closure', () => {
  it.each(required)('refuses an absent %s before packing', (file) => {
    rmSync(path.join(fixture.root, 'dist', file))
    expect(pack).toThrow(`dist/${file} is missing`)
    expect(() =>
      readFileSync(path.join(fixture.root, 'dist/muse-spark-code-acp-1.2.3.tgz')),
    ).toThrow()
  })
  it('packs every lazy Node dependency and the complete portable tree byte-exact', () => {
    pack()
    const unpacked = path.join(fixture.root, 'unpacked')
    mkdirSync(unpacked)
    execFileSync(
      'tar',
      ['-xzf', path.join(fixture.root, 'dist/muse-spark-code-acp-1.2.3.tgz'), '-C', unpacked],
      {
        env: buildEnvironment(process.env),
      },
    )
    for (const file of [...required, ...baseline])
      expect(readFileSync(path.join(unpacked, 'package/dist', file), 'utf8')).toBe(file)
    expect(
      readFileSync(path.join(unpacked, 'package/dist/webview/portable/presentation.js'), 'utf8'),
    ).toBe('presentation asset')
  })
})
