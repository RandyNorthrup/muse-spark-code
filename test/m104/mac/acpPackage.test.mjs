import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import { brotliDecompressSync } from 'node:zlib'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
  'lsp.js',
  'runtimeWatchdog.js',
  'runtimeProcessAuthority.js',
  'conversation.js',
  'estimator.js',
  'headless.js',
  'sharingRuntime.js',
  'acpQuestions.js',
  'acpPlaybook.js',
  'runtimeQuestions.js',
  'runtimeAccounts.js',
  'questionNotes.js',
  'mcpPool.js',
  'exec.js',
  'modelApiCodeIntel.js',
  'structuredSchema.js',
  'fontsInstall.js',
  'scheduleBackground.js',
  'modelApi.js',
  'resourceAdmission.js',
  'resourceGovernor.js',
  'resourceProcess.js',
  'resourceJournal.js',
  'modelApiHooks.js',
  'modelApiMcp.js',
  'runtimeAccounting.js',
  'providerPolicy.js',
  'runtimeEngine.js',
  'modelApiBoundaries.js',
  'vault.js',
  'vaultBoundaries.js',
  'estimateContracts.js',
  'legalScan.js',
  'providers.js',
  'subscriptions.js',
  'configuredProviders.js',
  'providerCatalog.json',
  'providerCatalog.js',
  'media.js',
  'reviewer.js',
  'team.js',
  'teamRunners.js',
  'teamScheduler.js',
  'schedules.js',
  'foreignHooks.js',
  'hookRuntime.js',
  'recorder.js',
  'reporting.js',
  'reportingNetwork.js',
  'reportingDestinations.js',
  'reference.js',
  'uiText.js',
  'uiTextRuntime.js',
  'uiTextHooks.js',
  'uiTextSurfaces.js',
  'uiTextMedia.js',
  'extensionHooks.js',
  'validation.js',
  'wire.js',
  'searchWorker.js',
  'pageWorker.js',
  'imageResizeWorker.js',
  'usageService.js',
  'usageCompanion.js',
]
const fixture = { root: '' }
function prepareFixture() {
  fixture.root = mkdtempSync(path.join(os.tmpdir(), 'm104-pf-package-'))
  for (const dir of ['scripts', 'dist/webview/portable', 'docs/schemas', 'l10n', 'native/windows'])
    mkdirSync(path.join(fixture.root, dir), { recursive: true })
  copyFileSync('scripts/package-acp.mjs', path.join(fixture.root, 'scripts/package-acp.mjs'))
  // Use the real 0.17 archive and localization modules from read-only source links.
  for (const name of ['src', 'node_modules', 'l10n', 'native/runner']) {
    const target = path.join(fixture.root, name)
    rmSync(target, { recursive: true, force: true })
    symlinkSync(path.resolve(name), target, process.platform === 'win32' ? 'junction' : 'dir')
  }
  symlinkSync(
    path.resolve('scripts/lib'),
    path.join(fixture.root, 'scripts/lib'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  copyFileSync('scripts/check-l10n.mjs', path.join(fixture.root, 'scripts/check-l10n.mjs'))
  for (const name of ['dist/legal-data', 'design/fonts']) {
    mkdirSync(path.join(fixture.root, path.dirname(name)), { recursive: true })
    cpSync(name, path.join(fixture.root, name), { recursive: true })
  }
  for (const name of ['dist/meta', 'native/darwin', 'native/linux/x64', 'native/linux/arm64'])
    mkdirSync(path.join(fixture.root, name), { recursive: true })
  for (const name of [
    'native/darwin/muse-dictate',
    'native/linux/x64/muse-created',
    'native/linux/arm64/muse-created',
  ])
    writeFileSync(path.join(fixture.root, name), 'fixture helper')
  for (const name of ['usage.js', 'usage.css'])
    writeFileSync(path.join(fixture.root, 'dist/webview', name), '')
  writeFileSync(
    path.join(fixture.root, 'dist/meta/usageWebview.json'),
    JSON.stringify({
      outputs: {
        'dist/webview/usage.js': { imports: [] },
        'dist/webview/usage.css': { imports: [] },
      },
    }),
  )

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
  for (const file of baseline)
    if (file.startsWith('uiText'))
      copyFileSync(path.join('dist', file), path.join(fixture.root, 'dist', file))
  for (const file of [
    'LICENSE',
    'docs/npm-readme.md',
    'native/windows/MuseSparkJob.cs',
    'native/windows/MuseSparkMcpJob.cs',
    'native/windows/MuseSparkMcpLauncher.cs',
    'native/windows/MuseSparkVault.cs',
    'native/windows/MuseSparkVaultCng.cs',
    'native/windows/MuseSparkVaultHello.cs',
    'native/windows/MuseSparkVaultLock.cs',
    'native/windows/MuseSparkScreenRecord.cs',
  ])
    writeFileSync(path.join(fixture.root, file), 'fixture')
  for (const file of [
    'exec-result-v1.schema.json',
    'exec-event-v1.schema.json',
    'exec-result-v2.schema.json',
    'exec-event-v2.schema.json',
    'share-v1.schema.json',
    'report-v1.schema.json',
  ])
    writeFileSync(path.join(fixture.root, 'docs/schemas', file), '{}')
  writeFileSync(
    path.join(fixture.root, 'dist/webview/portable/presentation.js'),
    'presentation asset',
  )
}
beforeEach(prepareFixture)
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
  describe('production archive closure', () => {
    let prepared
    // The real archive, fifteen staged Help launches and native-export preflight run once before assertions.
    const PACKAGE_PREFLIGHT_TIMEOUT_MS = 120_000
    beforeAll(() => {
      prepareFixture()
      for (const name of [
        'package.json',
        'package.nls.json',
        ...[
          'cs',
          'de',
          'es',
          'fr',
          'hu',
          'it',
          'ja',
          'ko',
          'pl',
          'pt-br',
          'ru',
          'tr',
          'zh-cn',
          'zh-tw',
        ].map((locale) => `package.nls.${locale}.json`),
      ])
        copyFileSync(name, path.join(fixture.root, name))
      const manifest = {
        ...JSON.parse(readFileSync(path.join(fixture.root, 'package.json'), 'utf8')),
        version: '1.2.3',
      }
      writeFileSync(path.join(fixture.root, 'package.json'), JSON.stringify(manifest))
      for (const file of [...required, ...baseline])
        copyFileSync(path.join('dist', file), path.join(fixture.root, 'dist', file))
      mkdirSync(path.join(fixture.root, 'test/packaging'), { recursive: true })
      copyFileSync(
        'test/packaging/moduleExports.test.mjs',
        path.join(fixture.root, 'test/packaging/moduleExports.test.mjs'),
      )
      prepared = { root: fixture.root }
      pack()
    }, PACKAGE_PREFLIGHT_TIMEOUT_MS)
    afterAll(() => rmSync(prepared?.root ?? '', { recursive: true, force: true }))
    it('packs every lazy Node dependency and the complete portable tree byte-exact', () => {
      const unpacked = path.join(prepared.root, 'unpacked')
      mkdirSync(unpacked)
      execFileSync(
        'tar',
        ['-xzf', path.join(prepared.root, 'dist/muse-spark-code-acp-1.2.3.tgz'), '-C', unpacked],
        {
          env: buildEnvironment(process.env),
        },
      )
      const archive = JSON.parse(
        brotliDecompressSync(
          readFileSync(path.join(unpacked, 'package/dist/runtime.bundles.json.br')),
        ).toString('utf8'),
      )
      for (const file of required) {
        const packed = readFileSync(path.join(unpacked, 'package/dist', file), 'utf8')
        if (file.endsWith('.js')) {
          expect(archive.bundles[file]).toBe(readFileSync(path.join('dist', file), 'utf8'))
          expect(packed).toContain('readPackedRuntime')
        } else expect(packed).toBe(readFileSync(path.join('dist', file), 'utf8'))
      }
      expect(
        readFileSync(path.join(unpacked, 'package/dist/webview/portable/presentation.js'), 'utf8'),
      ).toBe('presentation asset')
    })
  })
})
