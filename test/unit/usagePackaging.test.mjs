import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const folders = []
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
      version: '0.0.0-test',
      license: 'MIT',
      repository: { type: 'git', url: 'https://example.com/test.git' },
      bugs: { url: 'https://example.com/issues' },
      engines: { node: '>=20.18' },
      devDependencies: { '@napi-rs/keyring': '2.1.0' },
    }),
  )
  for (const bundle of [
    'acp',
    'modelApi',
    'providers',
    'reviewer',
    'uiText',
    'validation',
    'searchWorker',
    'pageWorker',
    'usageService',
    'usageCompanion',
  ])
    put(`dist/${bundle}.js`, 'module.exports = {}')
  for (const file of ['MuseSparkJob', 'MuseSparkMcpJob'])
    put(`native/windows/${file}.cs`, '// test source')
  put('LICENSE', 'MIT')
  put('docs/npm-readme.md', '# Test package')
  for (const schema of ['exec-result-v1', 'exec-event-v1'])
    put(`docs/schemas/${schema}.schema.json`, '{}')
  put(
    'scripts/third-party-notices.mjs',
    `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[3], 'test notices')`,
  )
  put('scripts/package-acp.mjs', readFileSync('scripts/package-acp.mjs'))
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
  put('dist/meta/webview.json', JSON.stringify({ outputs }))
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
  it('ships the service, companion, transitive page chunks and every usage table in the actual tarball', () => {
    const f = fixture()
    const result = f.run()
    expect(result.status, result.stderr).toBe(0)
    const tarball = path.join(f.root, 'dist', 'muse-spark-code-acp-0.0.0-test.tgz')
    const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split(/\r?\n/u)
    for (const file of [
      'dist/usageService.js',
      'dist/usageCompanion.js',
      ...Object.keys(f.outputs),
    ])
      expect(files).toContain(`package/${file}`)
    const stage = path.join(f.root, 'dist', 'acp-package')
    const tables = readdirSync(path.join(f.root, 'l10n'))
    for (const file of tables)
      if (file.startsWith('usage.'))
        expect(readFileSync(path.join(stage, 'l10n', file), 'utf8')).toBe(
          readFileSync(path.join(f.root, 'l10n', file), 'utf8'),
        )
    expect(files).not.toContain('package/dist/webview/main.js')
    expect(files).not.toContain('package/dist/webview/usage.js.map')
    expect(files).not.toContain('package/l10n/untranslated.json')
  })

  it('refuses missing usage bundles, page dependencies and language tables before packaging', () => {
    for (const file of [
      'dist/usageService.js',
      'dist/usageCompanion.js',
      'dist/webview/chunks/detail.js',
      'l10n/usage.de.json',
    ]) {
      const f = fixture()
      rmSync(path.join(f.root, file))
      expect(f.run().status, file).not.toBe(0)
    }
  })

  it('refuses a browser asset outside the page directory or any external import', () => {
    for (const imported of [
      { path: 'dist/outside.js' },
      { path: 'dist/webview/private.txt' },
      { path: 'https://foreign.example/script.js', external: true },
      { path: 'dist/webview/chunks/react.js', external: true },
    ]) {
      const f = fixture()
      if (!imported.external) {
        f.outputs[imported.path] = {}
        f.put(imported.path, 'private fixture')
      }
      f.outputs['dist/webview/usage.js'].imports = [imported]
      f.put('dist/meta/webview.json', JSON.stringify({ outputs: f.outputs }))
      expect(f.run().status).not.toBe(0)
    }
  })

  it('keeps the prior package stage intact when metadata, asset files or usage JSON are invalid', () => {
    for (const problem of ['metadata', 'directory', 'json']) {
      const f = fixture()
      f.put('dist/acp-package/prior.txt', 'prior package')
      if (problem === 'metadata') {
        delete f.outputs['dist/webview/chunks/detail.js']
        f.put('dist/meta/webview.json', JSON.stringify({ outputs: f.outputs }))
      } else if (problem === 'directory') {
        rmSync(path.join(f.root, 'dist/webview/chunks/detail.js'))
        mkdirSync(path.join(f.root, 'dist/webview/chunks/detail.js'))
      } else f.put('l10n/usage.de.json', '{invalid')
      expect(f.run().status, problem).not.toBe(0)
      expect(readFileSync(path.join(f.root, 'dist/acp-package/prior.txt'), 'utf8')).toBe(
        'prior package',
      )
    }
  })
})
