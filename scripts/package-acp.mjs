#!/usr/bin/env node
// The ACP agent's npm package (M63, PLAN.md D62): `muse-spark-code-acp`,
// laid out in dist/acp-package/ and packed with `npm pack` into
// dist/muse-spark-code-acp-<version>.tgz, which each GitHub Release carries
// and `npm install -g` installs. The bundles come from the production build:
// the agent, the Model API backend it loads when that backend first starts
// (the extension's own dist/modelApi.js, M57, PLAN.md D6), and the search
// and page-converter workers;
// the package's manifest is written here, with the extension's version, the
// agent's command and the one dependency it does not bundle, the native
// keyring binding (D61), at the version this repository locks.
//
//   node scripts/build.mjs --production && node scripts/package-acp.mjs
//   (npm run package:acp)
// Add `--target <platform>-<arch>` (the six desktop targets, as for the
// .vsix) to stage only that target's native pieces instead of every
// platform's: `node scripts/package-acp.mjs --target linux-x64`.

import { execFile, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { renderPackageReadme } from './check-badges.mjs'
import { CI_LAUNCHER_SOURCES, RUNNER_HELPERS, acpNativeFiles } from './lib/acpNativeSources.mjs'
import { stageCiLauncher } from './lib/ciStageLayout.mjs'
import { targetFromArgs } from './lib/vsixTargets.mjs'
import { packLegalDataArchive } from './lib/legalArchive.mjs'
import { packRuntimeArchive } from './lib/packageArchive.mjs'
import { ACP_BUNDLES as BUNDLES, acpUsageAssets } from './lib/acpBundles.mjs'
import { removePackageStage, writeStageReceipt } from './lib/packageStage.mjs'

const STAGE = path.join('dist', 'acp-package')

const NATIVE_DEPENDENCY = '@napi-rs/keyring'
const SCHEMAS = [
  'exec-result-v1.schema.json',
  'exec-event-v1.schema.json',
  'exec-result-v2.schema.json',
  'exec-event-v2.schema.json',
  'share-v1.schema.json',
  'report-v1.schema.json',
]
// Standalone full Help reads the manifest's labels beside package.json.
const NLS_FILES = readdirSync('.').filter((file) => /^package\.nls(?:\.[\w-]+)?\.json$/.test(file))

/** The keyring binding's version, as this repository locks it. */
function lockedVersion(manifest) {
  // A runtime dependency (the vault's OS store loads it in every product);
  // never a devDependency.
  const version = manifest.dependencies?.[NATIVE_DEPENDENCY]
  if (typeof version !== 'string') {
    throw new TypeError(`package.json does not lock ${NATIVE_DEPENDENCY}`)
  }
  return version
}

function requireBundles() {
  const missing = BUNDLES.find((bundle) => !existsSync(path.join('dist', bundle)))
  if (missing !== undefined) {
    throw new Error(`dist/${missing} is missing: run "node scripts/build.mjs --production" first`)
  }
}

/** Ship only the usage entry's transitive assets, never chat code or maps. */
function usageAssets() {
  return acpUsageAssets()
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const keyringVersion = lockedVersion(manifest)
requireBundles()
// One package per platform: a targeted package stages only its own
// platform's native pieces, so it never demands a helper only another OS
// builds. The universal package (no flag) keeps every platform's helpers.
const target = targetFromArgs(process.argv.slice(2))
const nativeFiles = acpNativeFiles(target)
for (const helper of nativeFiles)
  if (!existsSync(helper) || !statSync(helper).isFile())
    throw new Error(
      `Required native helper is missing for ${target ?? 'the universal package'}: ${helper}`,
    )
const PACKAGE_NAME = 'muse-spark-code-acp'
// The package's landing page (docs/npm-readme.md): npm renders
// GitHub-flavoured Markdown but does not resolve relative links or images,
// so every link and image in that file is absolute. docs/acp.md stays the
// detailed guide and is linked from the landing page instead.
const README = path.join('docs', 'npm-readme.md')
const NOTICES = 'THIRD_PARTY_NOTICES.txt'
const pageAssets = [
  ...usageAssets(),
  'dist/webview/voiceCompanion.js',
  'dist/webview/voiceCompanion.css',
]
// Every installed display language needs the usage family too (lane L).
for (const table of readdirSync('l10n')) {
  if (!/^ui\..+\.json$/u.test(table)) continue
  const source = path.join('l10n', table.replace(/^ui\./u, 'usage.'))
  if (!statSync(source).isFile()) throw new Error(`${source} is missing`)
  JSON.parse(readFileSync(source, 'utf8'))
}
for (const schema of SCHEMAS) {
  const source = path.join('docs', 'schemas', schema)
  if (!statSync(source).isFile()) {
    throw new Error(`${source} is not a regular file: run "npm run schema:exec" first`)
  }
  // A missing or malformed contract must stop packaging, never ship silently.
  JSON.parse(readFileSync(source, 'utf8'))
}

try {
  removePackageStage(STAGE)
  mkdirSync(path.join(STAGE, 'dist'), { recursive: true })
  mkdirSync(path.join(STAGE, 'schemas'), { recursive: true })
  for (const schema of SCHEMAS) {
    copyFileSync(path.join('docs', 'schemas', schema), path.join(STAGE, 'schemas', schema))
  }
  for (const bundle of BUNDLES) {
    copyFileSync(path.join('dist', bundle), path.join(STAGE, 'dist', bundle))
  }
  cpSync('dist/legal-data', path.join(STAGE, 'dist', 'legal-data'), { recursive: true })
  stageCiLauncher(process.cwd(), STAGE, CI_LAUNCHER_SOURCES)
  for (const source of pageAssets) {
    const staged = path.join(STAGE, source)
    mkdirSync(path.dirname(staged), { recursive: true })
    copyFileSync(source, staged)
  }
  for (const source of nativeFiles) {
    mkdirSync(path.join(STAGE, path.dirname(source)), { recursive: true })
    copyFileSync(source, path.join(STAGE, source))
  }
  // The darwin app bundles and vault helpers ship only where darwin pieces
  // do: the universal package (both architectures, like the Linux helpers)
  // and the darwin targets (their own architecture only). Their absence
  // elsewhere is the target working as designed, never a missing file.
  // Keep every signed resource and executable mode when macOS CI supplied it.
  // Linux-only packages retain the runtime's honest missing-helper refusal.
  // Arch names mirror src/shared/constants.ts (darwinDictationApp and friends).
  const darwinArches = []
  if (target === undefined) darwinArches.push('arm64', 'x64')
  else if (target.startsWith('darwin-')) darwinArches.push(target.split('-', 2)[1])
  for (const arch of darwinArches) {
    const screenBundle = path.join('native', 'darwin', `muse-dictate-screen-${arch}.app`)
    if (existsSync(screenBundle)) {
      cpSync(screenBundle, path.join(STAGE, screenBundle), { recursive: true })
    }
  }
  for (const arch of darwinArches) {
    for (const helper of [
      path.join('dist', 'native', 'darwin', `muse-vault-${arch}`),
      path.join('native', 'darwin', `muse-vault-peer-${arch}`),
    ]) {
      if (!existsSync(helper)) {
        continue
      }

      const staged = path.join(STAGE, helper)
      mkdirSync(path.dirname(staged), { recursive: true })
      copyFileSync(helper, staged)
    }
  }
  cpSync(RUNNER_HELPERS, path.join(STAGE, RUNNER_HELPERS), { recursive: true })
  const tables = readdirSync('l10n')
    .filter((file) => /^ui\.[^/]+\.json$/.test(file))
    .map((file) => [
      file.slice('ui.'.length, -'.json'.length),
      JSON.parse(readFileSync(path.join('l10n', file), 'utf8')),
    ])
  await packRuntimeArchive(
    process.cwd(),
    STAGE,
    BUNDLES.map((bundle) => `dist/${bundle}`),
    tables,
  )
  // The pinned legal texts ship as one solid brotli archive (VSIXFIT A):
  // NOTICE.md and provenance.json stay loose beside it.
  packLegalDataArchive(STAGE)
  execFileSync(process.execPath, ['scripts/check-l10n.mjs', '--packaged-acp', STAGE], {
    stdio: 'inherit',
  })
  for (const file of NLS_FILES) copyFileSync(file, path.join(STAGE, file))
  mkdirSync(path.join(STAGE, 'design', 'fonts'), { recursive: true })
  copyFileSync('design/fonts/manifest.json', path.join(STAGE, 'design', 'fonts', 'manifest.json'))
  copyFileSync('LICENSE', path.join(STAGE, 'LICENSE'))
  writeFileSync(
    path.join(STAGE, 'README.md'),
    renderPackageReadme(readFileSync(README, 'utf8'), manifest.version),
  )
  execFileSync(
    process.execPath,
    ['scripts/third-party-notices.mjs', '--acp', path.join(STAGE, NOTICES)],
    { stdio: 'inherit' },
  )

  const agentManifest = {
    name: PACKAGE_NAME,
    version: manifest.version,
    description:
      "Muse Spark Code (Unofficial) brings Meta's Muse Spark to ACP editors and headless runs. Not endorsed by Meta.",
    license: manifest.license,
    homepage: `${manifest.repository.url.replace(/\.git$/, '')}#readme`,
    repository: manifest.repository,
    bugs: manifest.bugs,
    // The root package.json has no `author`, so none is claimed here. `funding`
    // reuses the root manifest's donate link when it names one.
    ...(typeof manifest.sponsor?.url === 'string' && { funding: manifest.sponsor.url }),
    keywords: [
      'muse spark',
      'muse code',
      'agent client protocol',
      'acp',
      'coding agent',
      'zed',
      'jetbrains',
      'neovim',
      'emacs',
      'jupyter',
      'ai',
      'agent',
      'cli',
      'meta',
      'llm',
    ],
    bin: { [PACKAGE_NAME]: 'dist/acp.js' },
    files: [
      'ci',
      'dist',
      'design',
      'native',
      'l10n',
      'schemas',
      ...NLS_FILES,
      'README.md',
      'LICENSE',
      NOTICES,
    ],
    engines: { node: manifest.engines.node },
    dependencies: { [NATIVE_DEPENDENCY]: keyringVersion },
  }
  writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(agentManifest, null, 2)}\n`)
  execFileSync(process.execPath, ['scripts/check-badges.mjs', '--packaged-acp', STAGE], {
    stdio: 'inherit',
  })
  // Exercise the real staged CLI without credentials, a server or a model call.
  const HELP_WORKERS = 3
  const runFile = promisify(execFile)
  for (let first = 0; first < NLS_FILES.length; first += HELP_WORKERS) {
    // Help checks only read the staged package. Settle each bounded batch so a
    // rejected language does not leave another check running past its failure.
    const results = await Promise.allSettled(
      NLS_FILES.slice(first, first + HELP_WORKERS).map((file) => {
        const locale =
          file === 'package.nls.json' ? 'en' : file.slice('package.nls.'.length, -'.json'.length)
        return runFile(process.execPath, [path.join(STAGE, 'dist', 'acp.js'), 'help', '--all'], {
          env: { ...process.env, LC_ALL: locale },
        })
      }),
    )
    for (const result of results) if (result.status === 'rejected') throw result.reason
  }

  const packed = execFileSync('npm', ['pack', '--pack-destination', '..'], {
    cwd: path.resolve(STAGE),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
    .trim()
    .split('\n')
    .at(-1)
  // The release SBOM runs after the stage is gone: the receipt names every
  // staged file for its membership check, for the universal package the
  // release ships as well as for a targeted one.
  writeStageReceipt(STAGE, path.join('dist', 'acp-stage-files.json'))
  // A targeted package says its target in its filename, as the targeted
  // .vsix does, so two platforms' artifacts never share a name.
  let packedName = String(packed)
  if (target !== undefined) {
    const targeted = `${packedName.slice(0, packedName.length - '.tgz'.length)}-${target}.tgz`
    renameSync(path.join('dist', packedName), path.join('dist', targeted))
    packedName = targeted
  }
  execFileSync(
    process.execPath,
    ['test/packaging/moduleExports.test.mjs', 'acp', path.join('dist', packedName)],
    { stdio: 'inherit' },
  )
} finally {
  // The stage is build output, never an artifact: a stale stage poisons
  // later gates’ scans of dist/, so it goes on success and on failure.
  removePackageStage(STAGE)
}
