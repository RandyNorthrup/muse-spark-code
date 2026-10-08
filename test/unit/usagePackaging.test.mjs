import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const folders = []
// Cold archive preparation and npm pack run once outside five-second assertions.
const ARCHIVE_SETUP_TIMEOUT_MS = 60_000
const TAR =
  process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
    : 'tar'
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function fixture() {
  mkdirSync('temp', { recursive: true })
  const root = mkdtempSync(path.resolve('temp', 'usage-package-'))
  folders.push(root)
  const put = (file, content) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  put(
    'package.json',
    JSON.stringify({
      name: 'fixture',
      version: '0.0.0',
      license: 'MIT',
      repository: { type: 'git', url: 'https://example.com/test.git' },
      bugs: { url: 'https://example.com/issues' },
      engines: { node: '>=20.18' },
      devDependencies: { '@napi-rs/keyring': '2.1.0' },
    }),
  )
  for (const bundle of [
    'acp',
    'headless',
    'sharingRuntime',
    'modelApi',
    'modelApiHooks',
    'modelApiMcp',
    'runtimeAccounting',
    'acpQuestions',
    'runtimeQuestions',
    'questionNotes',
    'mcpPool',
    'exec',
    'modelApiCodeIntel',
    'structuredSchema',
    'resourceAdmission',
    'resourceGovernor',
    'runtimeEngine',
    'providerPolicy',
    'modelApiBoundaries',
    'legalScan',
    'imageResizeWorker',
    'team',
    'teamScheduler',
    'teamRunners',
    'providers',
    'subscriptions',
    'configuredProviders',
    'reviewer',
    'foreignHooks',
    'hookRuntime',
    'recorder',
    'reference',
    'uiText',
    'uiTextRuntime',
    'uiTextHooks',
    'uiTextSurfaces',
    'extensionHooks',
    'validation',
    'wire',
    'searchWorker',
    'pageWorker',
    'usageService',
    'usageCompanion',
  ])
    put(`dist/${bundle}.js`, 'exports.EN = {}')
  for (const file of ['MuseSparkJob', 'MuseSparkMcpJob'])
    put(`native/windows/${file}.cs`, '// test source')
  put('LICENSE', 'MIT')
  put('dist/providerCatalog.json', '{"providers":{}}')
  put('dist/providerCatalog.js', 'module.exports={providers:{}};')
  put('dist/legal-data/licenses.json', '{}')
  put('native/runner/runner-helper.sh', '# fixture')
  put('native/darwin/muse-dictate', 'test-owned inert helper')
  for (const arch of ['x64', 'arm64'])
    put(`native/linux/${arch}/muse-created`, 'test-owned inert helper')
  put('docs/npm-readme.md', '# Test package')
  for (const schema of [
    'exec-result-v1',
    'exec-event-v1',
    'exec-result-v2',
    'exec-event-v2',
    'share-v1',
  ])
    put(`docs/schemas/${schema}.schema.json`, '{}')
  put(
    'scripts/third-party-notices.mjs',
    `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[3], 'test notices')`,
  )
  put(
    'scripts/package-acp.mjs',
    readFileSync('scripts/package-acp.mjs', 'utf8')
      .replace("'./check-badges.mjs'", () =>
        JSON.stringify(pathToFileURL(path.resolve('scripts/check-badges.mjs')).href),
      )
      .replace("'./lib/packageArchive.mjs'", () =>
        JSON.stringify(pathToFileURL(path.resolve('scripts/lib/packageArchive.mjs')).href),
      ),
  )
  // This fixture tests package membership; strict table/export gates run over
  // the real stage separately and need complete production data.
  put('scripts/check-l10n.mjs', '')
  put('scripts/check-badges.mjs', '')
  put('test/packaging/moduleExports.test.mjs', '')
  for (const file of readdirSync('l10n'))
    if (/^ui\..+\.json$/u.test(file)) {
      put(`l10n/${file}`, '{}')
      put(`l10n/${file.replace(/^ui\./u, 'usage.')}`, '{"title":"test"}')
    }
  put('l10n/untranslated.json', '{}')
  const outputs = {
    'dist/webview/usage.js': {
      imports: [
        { path: 'dist/webview/chunks/shared.js' },
        { path: 'dist/webview/chunks/detail.js' },
      ],
    },
    'dist/webview/usage.css': {},
    'dist/webview/chunks/shared.js': { imports: [{ path: 'dist/webview/chunks/react.js' }] },
    'dist/webview/chunks/detail.js': {
      imports: [{ path: 'dist/webview/chunks/shared.js' }],
      cssBundle: 'dist/webview/chunks/detail.css',
    },
    'dist/webview/chunks/detail.css': {},
    'dist/webview/chunks/react.js': {},
  }
  for (const file of Object.keys(outputs)) put(file, '/* usage asset */')
  put('dist/webview/main.js', '/* chat must not ship */')
  put('dist/webview/usage.js.map', '/* private source paths must not ship */')
  put('dist/meta/usageWebview.json', JSON.stringify({ outputs }))
  return {
    root,
    put,
    outputs,
    run: () =>
      spawnSync(process.execPath, ['scripts/package-acp.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_offline: 'true', npm_config_ignore_scripts: 'true' },
      }),
  }
}

describe('usage assets in the ACP package', () => {
  let prepared
  beforeAll(() => {
    const f = fixture()
    prepared = { f, result: f.run() }
  }, ARCHIVE_SETUP_TIMEOUT_MS)
  it('ships the service, companion, transitive page chunks and every usage table in the actual tarball', () => {
    const { f, result } = prepared
    expect(result.status, result.stdout + result.stderr).toBe(0)
    const tarball = path.join(f.root, 'dist', 'muse-spark-code-acp-0.0.0.tgz')
    const files = execFileSync(TAR, ['-tzf', tarball], { encoding: 'utf8' }).split(/\r?\n/u)
    for (const file of [
      'dist/usageService.js',
      'dist/usageCompanion.js',
      ...Object.keys(f.outputs),
    ])
      expect(files).toContain(`package/${file}`)
    const stage = path.join(f.root, 'dist', 'acp-package')
    const tables = readdirSync(path.join(f.root, 'l10n'))
    const archived = JSON.parse(
      brotliDecompressSync(readFileSync(path.join(stage, 'l10n', 'usage.tables.json.br'))),
    )
    expect(files).toContain('package/l10n/usage.tables.json.br')
    for (const file of tables)
      if (file.startsWith('usage.'))
        expect(archived[file.slice('usage.'.length, -'.json'.length)]).toEqual(
          JSON.parse(readFileSync(path.join(f.root, 'l10n', file), 'utf8')),
        )
    expect(files).not.toContain('package/dist/webview/main.js')
    expect(files).not.toContain('package/dist/webview/usage.js.map')
    expect(files).not.toContain('package/l10n/untranslated.json')
  })

  it.each([
    'dist/usageService.js',
    'dist/usageCompanion.js',
    'dist/webview/chunks/detail.js',
    'l10n/usage.de.json',
  ])('refuses missing usage asset before packaging: %s', (file) => {
    const f = fixture()
    rmSync(path.join(f.root, file))
    expect(f.run().status, file).not.toBe(0)
  })

  it.each([
    { path: 'dist/outside.js' },
    { path: 'dist/webview/private.txt' },
    { path: 'https://foreign.example/script.js', external: true },
    { path: 'dist/webview/chunks/react.js', external: true },
  ])('refuses a foreign or external browser import: $path', (imported) => {
    const f = fixture()
    if (!imported.external) {
      f.outputs[imported.path] = {}
      f.put(imported.path, 'private fixture')
    }
    f.outputs['dist/webview/usage.js'].imports = [imported]
    f.put('dist/meta/usageWebview.json', JSON.stringify({ outputs: f.outputs }))
    expect(f.run().status).not.toBe(0)
  })

  it.each(['metadata', 'directory', 'json'])(
    'keeps the prior package stage intact with invalid %s',
    (problem) => {
      const f = fixture()
      f.put('dist/acp-package/prior.txt', 'prior package')
      if (problem === 'metadata') {
        delete f.outputs['dist/webview/chunks/detail.js']
        f.put('dist/meta/usageWebview.json', JSON.stringify({ outputs: f.outputs }))
      } else if (problem === 'directory') {
        rmSync(path.join(f.root, 'dist/webview/chunks/detail.js'))
        mkdirSync(path.join(f.root, 'dist/webview/chunks/detail.js'))
      } else f.put('l10n/usage.de.json', '{invalid')
      expect(f.run().status, problem).not.toBe(0)
      expect(readFileSync(path.join(f.root, 'dist/acp-package/prior.txt'), 'utf8')).toBe(
        'prior package',
      )
    },
  )
})
