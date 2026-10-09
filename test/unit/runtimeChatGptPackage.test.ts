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
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { removeFolder } from './helpers/temporaryFolders'
import {
  PRODUCTION_BUILD_KEY,
  buildProductionPackage,
  packageImagePreload,
} from './helpers/productionPackage'

const roots: string[] = []
const root = process.cwd()
mkdirSync(path.join(root, 'temp'), { recursive: true })
const production = mkdtempSync(path.join(root, 'temp', 'chatgpt-build-'))
afterAll(async () => {
  await removeFolder(production)
})
// Cold solid-archive compression and native export checks exceed five seconds.
const ARCHIVE_SETUP_TIMEOUT_MS = 60_000
// Drive-letter archive names require native bsdtar; Git's GNU tar treats
// their colon as a remote host when Git Bash is on the hook PATH.
const TAR =
  process.platform === 'win32'
    ? path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
    : 'tar'
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => removeFolder(dir)))
})

function fixture() {
  const dir = mkdtempSync(path.join(process.cwd(), 'temp', 'chatgpt-package-'))
  roots.push(dir)
  for (const folder of ['scripts', 'dist', 'docs/schemas', 'l10n', 'native/windows'])
    mkdirSync(path.join(dir, folder), { recursive: true })
  const script = readFileSync('scripts/package-acp.mjs', 'utf8')
    .replace("'./check-badges.mjs'", () =>
      JSON.stringify(pathToFileURL(path.resolve('scripts/check-badges.mjs')).href),
    )
    .replace("'./lib/packageArchive.mjs'", () =>
      JSON.stringify(pathToFileURL(path.resolve('scripts/lib/packageArchive.mjs')).href),
    )
    .replace("'scripts/check-l10n.mjs'", () =>
      JSON.stringify(path.resolve('scripts/check-l10n.mjs')),
    )
    .replace("'scripts/check-badges.mjs'", () =>
      JSON.stringify(path.resolve('scripts/check-badges.mjs')),
    )
    .replace("'test/packaging/moduleExports.test.mjs'", () =>
      JSON.stringify(path.resolve('test/packaging/moduleExports.test.mjs')),
    )
  writeFileSync(path.join(dir, 'scripts/package-acp.mjs'), script)
  cpSync('media', path.join(dir, 'media'), { recursive: true })
  cpSync('src/shared', path.join(dir, 'src/shared'), { recursive: true })
  mkdirSync(path.join(dir, 'src/runtime/estimator'), { recursive: true })
  cpSync('src/runtime/estimator/options.ts', path.join(dir, 'src/runtime/estimator/options.ts'))
  cpSync('src/runtime/cliOptions.ts', path.join(dir, 'src/runtime/cliOptions.ts'))
  cpSync('src/core/whatsNew', path.join(dir, 'src/core/whatsNew'), { recursive: true })
  mkdirSync(path.join(dir, 'src/core/judge'), { recursive: true })
  cpSync('src/core/judge/engine.ts', path.join(dir, 'src/core/judge/engine.ts'))
  for (const name of readdirSync('.')) {
    if (/^package\.nls.*\.json$/.test(name)) cpSync(name, path.join(dir, name))
  }
  writeFileSync(path.join(dir, 'dist/providerCatalog.json'), '{"providers":{}}\n')
  writeFileSync(path.join(dir, 'dist/providerCatalog.js'), 'module.exports={providers:{}};\n')
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
  const productionFiles = readdirSync(path.join(production, 'dist'))
  for (const name of productionFiles) {
    if (name.endsWith('.js'))
      cpSync(path.join(production, 'dist', name), path.join(dir, 'dist', name))
  }
  cpSync(path.join(production, 'dist/legal-data'), path.join(dir, 'dist/legal-data'), {
    recursive: true,
  })
  for (const platform of ['darwin', 'linux/x64', 'linux/arm64']) {
    const folder = path.join(dir, 'native', platform)
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      path.join(folder, platform === 'darwin' ? 'muse-dictate' : 'muse-created'),
      'test-owned inert helper',
    )
  }
  cpSync('native/runner', path.join(dir, 'native/runner'), { recursive: true })
  cpSync(path.join(production, 'dist/webview'), path.join(dir, 'dist/webview'), { recursive: true })
  mkdirSync(path.join(dir, 'dist/meta'), { recursive: true })
  cpSync(
    path.join(production, 'dist/meta/usageWebview.json'),
    path.join(dir, 'dist/meta/usageWebview.json'),
  )
  for (const name of [
    'MuseSparkJob.cs',
    'MuseSparkMcpJob.cs',
    'MuseSparkScreenRecord.cs',
    'MuseSparkVault.cs',
    'MuseSparkVaultCng.cs',
    'MuseSparkVaultHello.cs',
    'MuseSparkVaultLock.cs',
  ])
    writeFileSync(path.join(dir, 'native/windows', name), '// test-owned native fixture\n')
  mkdirSync(path.join(dir, 'design/fonts'), { recursive: true })
  cpSync('design/fonts/manifest.json', path.join(dir, 'design/fonts/manifest.json'))
  cpSync('media', path.join(dir, 'media'), { recursive: true })
  cpSync('docs/schemas', path.join(dir, 'docs/schemas'), { recursive: true })
  cpSync('l10n', path.join(dir, 'l10n'), { recursive: true })
  writeFileSync(path.join(dir, 'LICENSE'), 'test-owned licence\n')
  for (const file of ['README.md', 'docs/npm-readme.md', 'docs/marketplace-readme.md'])
    cpSync(file, path.join(dir, file))
  cpSync('media', path.join(dir, 'media'), { recursive: true })
  packageImagePreload(path.join(dir, 'images.cjs'), dir, path.join(dir, 'images.jsonl'))
  return dir
}

function pack(dir: string) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/package-acp.mjs')], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...withoutCredentials(process.env),
      BADGE_CHECK_SKIP_NETWORK: undefined,
      NODE_OPTIONS: `--require ${JSON.stringify(path.join(dir, 'images.cjs'))}`,
    },
  })
}

describe('ChatGPT ACP package', () => {
  let prepared: { dir: string; run: ReturnType<typeof pack> } | undefined
  beforeAll(() => {
    buildProductionPackage(root, production, inject(PRODUCTION_BUILD_KEY))
    const dir = fixture()
    prepared = { dir, run: pack(dir) }
  }, ARCHIVE_SETUP_TIMEOUT_MS)
  it('ships the lazy ChatGPT runtime in the actual npm tarball', () => {
    if (prepared === undefined) throw new Error('Missing prepared package fixture')
    const { dir, run } = prepared
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const archive = path.join(dir, 'dist/muse-spark-code-acp-0.0.0.tgz')
    const extracted = spawnSync(TAR, ['-xOzf', archive, 'package/dist/runtime.bundles.json.br'])
    expect(extracted.status, extracted.stderr.toString()).toBe(0)
    const members = z
      .object({ bundles: z.record(z.string(), z.string()) })
      .parse(JSON.parse(brotliDecompressSync(extracted.stdout).toString('utf8')))
    for (const name of [
      'providers',
      'subscriptions',
      'configuredProviders',
      'runtimeAccounts',
      'media',
      'vault',
      'vaultBoundaries',
      'estimator',
      'estimateContracts',
    ])
      expect(members.bundles[`${name}.js`]).toBe(
        readFileSync(path.join(dir, 'dist', `${name}.js`), 'utf8'),
      )
    for (const name of ['headless', 'providerPolicy']) {
      const preflight = spawnSync(TAR, ['-xOzf', archive, `package/dist/${name}.js`])
      expect(preflight.status).toBe(0)
      expect(preflight.stdout.toString('utf8')).toBe(
        readFileSync(path.join(dir, 'dist', `${name}.js`), 'utf8'),
      )
    }
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
