import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { brotliDecompressSync } from 'node:zlib'
import * as z from 'zod/mini'
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from 'vitest'
import { withoutCredentials } from '../../src/runtime/credentialVariables'
import { noticePackageDir } from '../../scripts/lib/noticesInput.mjs'
import { layOutAcpNativeSources } from './helpers/acpPackageSources'
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

function fixture(buildRoot: string, isSuiteOwned = false) {
  const dir = mkdtempSync(path.join(process.cwd(), 'temp', 'chatgpt-package-'))
  // The once-per-suite package stage must survive every test's cleanup; a
  // per-test fixture is removed after its own test.
  if (!isSuiteOwned) roots.push(dir)
  for (const folder of ['scripts', 'dist', 'docs/schemas', 'l10n'])
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
  // The real provider catalogue the production build writes: the packager
  // requires both files and the staged help checks read them.
  for (const name of ['providerCatalog.json', 'providerCatalog.js'])
    cpSync(path.join(production, 'dist', name), path.join(dir, 'dist', name))
  // The real notices script and the two modules it imports, so the package
  // step under test runs our own code instead of a stand-in.
  for (const file of [
    'scripts/third-party-notices.mjs',
    'scripts/notices-fonts.mjs',
    path.join('scripts', 'lib', 'noticesInput.mjs'),
  ]) {
    mkdirSync(path.join(dir, path.dirname(file)), { recursive: true })
    cpSync(file, path.join(dir, file))
  }
  // The real installed packages the notices script reads licences from: a
  // junction on Windows (a plain symlink needs a privilege the test cannot
  // assume), a symlink elsewhere.
  symlinkSync(
    path.resolve('node_modules'),
    path.join(dir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
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
  layOutAcpNativeSources(dir, root)
  cpSync(path.join(production, 'dist/webview'), path.join(dir, 'dist/webview'), { recursive: true })
  // The real production metafiles the notices script attributes to packages.
  cpSync(path.join(production, 'dist/meta'), path.join(dir, 'dist/meta'), { recursive: true })
  cpSync(path.join(production, 'dist/meta-acp'), path.join(dir, 'dist/meta-acp'), {
    recursive: true,
  })
  rebaseMetafileInputs(dir, buildRoot)
  // The real font pack and validators the notices script bundles and checks.
  cpSync('design/fonts', path.join(dir, 'design/fonts'), { recursive: true })
  cpSync('src/runtime/fonts', path.join(dir, 'src/runtime/fonts'), { recursive: true })
  // The real texts the notices file reproduces.
  mkdirSync(path.join(dir, 'native'), { recursive: true })
  cpSync('native/openssl-NOTICE.txt', path.join(dir, 'native/openssl-NOTICE.txt'))
  mkdirSync(path.join(dir, 'src/core/legal/data'), { recursive: true })
  cpSync('src/core/legal/data/NOTICE.md', path.join(dir, 'src/core/legal/data/NOTICE.md'))
  cpSync('media', path.join(dir, 'media'), { recursive: true })
  cpSync('docs/schemas', path.join(dir, 'docs/schemas'), { recursive: true })
  cpSync('l10n', path.join(dir, 'l10n'), { recursive: true })
  cpSync('LICENSE', path.join(dir, 'LICENSE'))
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

/**
 * Every package the staged bundles carry code from, by name, read from the
 * production metafiles: the same staged-output filter the notices script
 * applies, mapped to package names through the real installed manifests.
 */
const metafileSchema = z.object({
  outputs: z.record(
    z.string(),
    z.object({ inputs: z.record(z.string(), z.object({ bytesInOutput: z.number() })) }),
  ),
})
const manifestNameSchema = z.object({ name: z.string() })
/**
 * Metafiles record inputs relative to the shared build root, which this
 * fixture does not share. Pointing packaged inputs at the repository's own
 * absolute paths keeps the same packages and byte counts; only the root
 * moves, so they resolve beside the linked node_modules.
 */
const rebaseableMetafile = z.looseObject({
  outputs: z.record(z.string(), z.looseObject({ inputs: z.record(z.string(), z.unknown()) })),
})

function rebaseMetafileInputs(dir: string, buildRoot: string): void {
  for (const metafileDir of ['dist/meta', 'dist/meta-acp']) {
    const metafiles = readdirSync(path.join(dir, metafileDir))
    for (const metafile of metafiles) {
      const file = path.join(dir, metafileDir, metafile)
      const meta = rebaseableMetafile.parse(JSON.parse(readFileSync(file, 'utf8')))
      const outputs: Record<string, unknown> = {}
      const outputEntries = Object.entries(meta.outputs)
      for (const [output, stats] of outputEntries) {
        const inputs: Record<string, unknown> = {}
        const inputEntries = Object.entries(stats.inputs)
        for (const [input, contribution] of inputEntries) {
          // Namespaced clones (resource-validation:…) carry absolute paths
          // already; only bare relative inputs move under the fixture root.
          const bare = input.replace(/^resource-validation:/, '')
          const isRelative =
            noticePackageDir(input) !== undefined &&
            !path.isAbsolute(bare) &&
            !/^[a-zA-Z]:[\\/]/.test(bare)
          inputs[isRelative ? path.resolve(buildRoot, input) : input] = contribution
        }
        outputs[output] = { ...stats, inputs }
      }
      writeFileSync(file, JSON.stringify({ ...meta, outputs }))
    }
  }
}

function stagedPackageNames(dir: string): string[] {
  const names = new Set<string>()
  for (const metafileDir of ['dist/meta', 'dist/meta-acp']) {
    const metafiles = readdirSync(path.join(dir, metafileDir))
    for (const metafile of metafiles) {
      const meta = metafileSchema.parse(
        JSON.parse(readFileSync(path.join(dir, metafileDir, metafile), 'utf8')),
      )
      const outputEntries = Object.entries(meta.outputs)
      for (const [output, stats] of outputEntries) {
        if (!existsSync(path.join(dir, 'dist/acp-package', output.replaceAll('\\', '/')))) continue
        const inputEntries = Object.entries(stats.inputs)
        for (const [input, contribution] of inputEntries) {
          if (contribution.bytesInOutput === 0) continue
          const directory = noticePackageDir(input)
          if (directory === undefined) continue
          const manifest = manifestNameSchema.parse(
            JSON.parse(
              readFileSync(path.join(path.resolve(dir, directory), 'package.json'), 'utf8'),
            ),
          )
          names.add(manifest.name)
        }
      }
    }
  }
  return [...names]
}

describe('ChatGPT ACP package', () => {
  let prepared: { dir: string; run: ReturnType<typeof pack> } | undefined
  let sharedRoot = ''
  beforeAll(() => {
    sharedRoot = inject(PRODUCTION_BUILD_KEY)
    buildProductionPackage(root, production, sharedRoot)
    const dir = fixture(sharedRoot, true)
    prepared = { dir, run: pack(dir) }
  }, ARCHIVE_SETUP_TIMEOUT_MS)
  afterAll(async () => {
    if (prepared !== undefined) await removeFolder(prepared.dir)
  })
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

  it('writes real third-party notices naming the staged bundles’ packages', () => {
    if (prepared === undefined) throw new Error('Missing prepared package fixture')
    const { dir, run } = prepared
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0)
    const notices = readFileSync(path.join(dir, 'dist/acp-package/THIRD_PARTY_NOTICES.txt'), 'utf8')
    expect(notices).not.toContain('test-owned notices')
    const names = stagedPackageNames(dir)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names) expect(notices, `notices miss ${name}`).toContain(name)
  })

  it('refuses a missing providers bundle before replacing the package stage', () => {
    const dir = fixture(sharedRoot)
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
