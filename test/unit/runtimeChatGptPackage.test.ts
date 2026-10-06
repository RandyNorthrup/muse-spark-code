import { spawnSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'
import * as z from 'zod/mini'
import { afterEach, describe, expect, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { removeFolder } from './helpers/temporaryFolders'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => removeFolder(dir)))
})

function fixture() {
  const dir = mkdtempSync(path.join(process.cwd(), 'temp', 'chatgpt-package-'))
  roots.push(dir)
  for (const folder of ['scripts', 'dist', 'docs/schemas', 'l10n', 'native/windows'])
    mkdirSync(path.join(dir, folder), { recursive: true })
  const script = readFileSync('scripts/package-acp.mjs', 'utf8')
    .replace("'./lib/packageArchive.mjs'", () =>
      JSON.stringify(pathToFileURL(path.resolve('scripts/lib/packageArchive.mjs')).href),
    )
    .replace("'scripts/check-l10n.mjs'", () =>
      JSON.stringify(path.resolve('scripts/check-l10n.mjs')),
    )
    .replace("'test/packaging/moduleExports.test.mjs'", () =>
      JSON.stringify(path.resolve('test/packaging/moduleExports.test.mjs')),
    )
  writeFileSync(path.join(dir, 'scripts/package-acp.mjs'), script)
  cpSync('src/shared', path.join(dir, 'src/shared'), { recursive: true })
  cpSync('src/core/whatsNew', path.join(dir, 'src/core/whatsNew'), { recursive: true })
  for (const name of readdirSync('.')) {
    if (/^package\.nls.*\.json$/.test(name)) cpSync(name, path.join(dir, name))
  }
  writeFileSync(path.join(dir, 'dist/providerCatalog.json'), '{"providers":{}}\n')
  writeFileSync(
    path.join(dir, 'scripts/third-party-notices.mjs'),
    'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[3], "test-owned notices");\n',
  )
  writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      ...JSON.parse(readFileSync('package.json', 'utf8')),
      version: '0.0.0',
    }),
  )
  for (const name of [
    'acp',
    'modelApi',
    'providers',
    'subscriptions',
    'configuredProviders',
    'reviewer',
    'foreignHooks',
    'hookRuntime',
    'recorder',
    'extensionHooks',
    'uiTextRuntime',
    'uiTextHooks',
    'uiTextSurfaces',
    'wire',
    'uiText',
    'validation',
    'searchWorker',
    'pageWorker',
  ])
    cpSync(path.join('dist', `${name}.js`), path.join(dir, 'dist', `${name}.js`))
  for (const name of ['MuseSparkJob.cs', 'MuseSparkMcpJob.cs'])
    writeFileSync(path.join(dir, 'native/windows', name), '// test-owned native fixture\n')
  cpSync('docs/schemas', path.join(dir, 'docs/schemas'), { recursive: true })
  cpSync('l10n', path.join(dir, 'l10n'), { recursive: true })
  writeFileSync(path.join(dir, 'LICENSE'), 'test-owned licence\n')
  writeFileSync(path.join(dir, 'docs/npm-readme.md'), '# Test-owned npm page\n')
  return dir
}

function pack(dir: string) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/package-acp.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    env: withoutCredentials(process.env),
  })
}

describe('ChatGPT ACP package', () => {
  it('ships the lazy ChatGPT runtime in the actual npm tarball', () => {
    const dir = fixture()
    const run = pack(dir)
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const archive = path.join(dir, 'dist/muse-spark-code-acp-0.0.0.tgz')
    const extracted = spawnSync('tar', ['-xOzf', archive, 'package/dist/runtime.bundles.json.br'])
    expect(extracted.status, extracted.stderr.toString()).toBe(0)
    const members = z
      .object({ bundles: z.record(z.string(), z.string()) })
      .parse(JSON.parse(brotliDecompressSync(extracted.stdout).toString('utf8')))
    for (const name of ['providers', 'subscriptions', 'configuredProviders'])
      expect(members.bundles[`${name}.js`]).toBe(
        readFileSync(path.join(dir, 'dist', `${name}.js`), 'utf8'),
      )
  })

  it('refuses a missing providers bundle before replacing the package stage', () => {
    const dir = fixture()
    rmSync(path.join(dir, 'dist/providers.js'))
    const stage = path.join(dir, 'dist/acp-package')
    mkdirSync(stage)
    writeFileSync(path.join(stage, 'sentinel'), 'preserve')
    const run = pack(dir)
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('providers.js is missing')
    expect(readFileSync(path.join(stage, 'sentinel'), 'utf8')).toBe('preserve')
  })
})
