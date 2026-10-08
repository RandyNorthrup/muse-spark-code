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

import { execFile, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { renderPackageReadme } from './check-badges.mjs'
import { packRuntimeArchive } from './lib/packageArchive.mjs'

const STAGE = path.join('dist', 'acp-package')
const BUNDLES = [
  'acp.js',
  'headless.js',
  'sharingRuntime.js',
  'acpQuestions.js',
  'runtimeQuestions.js',
  'questionNotes.js',
  'mcpPool.js',
  'exec.js',
  'modelApiCodeIntel.js',
  'structuredSchema.js',
  'modelApi.js',
  'resourceAdmission.js',
  'resourceGovernor.js',
  'modelApiHooks.js',
  'modelApiMcp.js',
  'runtimeAccounting.js',
  'providerPolicy.js',
  'runtimeEngine.js',
  'modelApiBoundaries.js',
  'legalScan.js',
  'providers.js',
  'subscriptions.js',
  'configuredProviders.js',
  'providerCatalog.json',
  'providerCatalog.js',
  'reviewer.js',
  'team.js',
  'teamRunners.js',
  'teamScheduler.js',
  'foreignHooks.js',
  'hookRuntime.js',
  'recorder.js',
  'reference.js',
  'uiText.js',
  'uiTextRuntime.js',
  'uiTextHooks.js',
  'uiTextSurfaces.js',
  'extensionHooks.js',
  'validation.js',
  'wire.js',
  'searchWorker.js',
  'pageWorker.js',
  'imageResizeWorker.js',
  'usageService.js',
  'usageCompanion.js',
]
// The C# of the shell tool's Windows job (M27), compiled on first use, as
// the extension ships it (PLAN.md D6): its own file and the half it shares.
// No MuseSparkMcpLauncher.cs: ACP forwards MCP servers to Muse Code's own
// process (src/acp/agent.ts forwardedMcp); its Model API backend runs none.
// src/runtime/backends.ts composes only shellJobAssembly, never mcpJobExecutable.
const JOB_SOURCES = [
  path.join('native', 'windows', 'MuseSparkJob.cs'),
  path.join('native', 'windows', 'MuseSparkMcpJob.cs'),
]
const DARWIN_HELPER = path.join('native', 'darwin', 'muse-dictate')
const LINUX_HELPERS = ['x64', 'arm64'].map((arch) =>
  path.join('native', 'linux', arch, 'muse-created'),
)
const NATIVE_DEPENDENCY = '@napi-rs/keyring'
const SCHEMAS = [
  'exec-result-v1.schema.json',
  'exec-event-v1.schema.json',
  'exec-result-v2.schema.json',
  'exec-event-v2.schema.json',
  'share-v1.schema.json',
]
// Standalone full Help reads the manifest's labels beside package.json.
const NLS_FILES = readdirSync('.').filter((file) => /^package\.nls(?:\.[\w-]+)?\.json$/.test(file))

/** The keyring binding's version, as this repository locks it. */
function lockedVersion(manifest) {
  const version = manifest.devDependencies?.[NATIVE_DEPENDENCY]
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
  const root = path.resolve('dist', 'webview')
  const meta = JSON.parse(readFileSync(path.join('dist', 'meta', 'usageWebview.json'), 'utf8'))
  const pending = ['dist/webview/usage.js', 'dist/webview/usage.css']
  const files = new Set()
  while (pending.length > 0) {
    const file = pending.pop()
    if (files.has(file)) continue
    const relative = path.relative(root, path.resolve(file))
    if (
      relative === '' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      !['.js', '.css'].includes(path.extname(file))
    ) {
      throw new Error('Usage asset is outside the browser bundle')
    }
    const output = meta.outputs?.[file]
    if (output === undefined || !statSync(file).isFile()) {
      throw new Error(`${file} is missing from the usage browser build`)
    }
    files.add(file)
    if (output.cssBundle !== undefined) pending.push(output.cssBundle)
    const imports = output.imports ?? []
    for (const imported of imports) {
      if (imported.external) throw new Error('Usage assets must be bundled locally')
      pending.push(imported.path)
    }
  }
  return [...files]
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const keyringVersion = lockedVersion(manifest)
requireBundles()
if (!existsSync(DARWIN_HELPER) || !statSync(DARWIN_HELPER).isFile())
  throw new Error(`Required Darwin created-path helper is missing: ${DARWIN_HELPER}`)
const PACKAGE_NAME = 'muse-spark-code-acp'
// The package's landing page (docs/npm-readme.md): npm renders
// GitHub-flavoured Markdown but does not resolve relative links or images,
// so every link and image in that file is absolute. docs/acp.md stays the
// detailed guide and is linked from the landing page instead.
const README = path.join('docs', 'npm-readme.md')
const NOTICES = 'THIRD_PARTY_NOTICES.txt'
for (const helper of LINUX_HELPERS)
  if (!existsSync(helper) || !statSync(helper).isFile())
    throw new Error(`Required Linux created-path helper is missing: ${helper}`)
const pageAssets = usageAssets()
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

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(path.join(STAGE, 'dist'), { recursive: true })
mkdirSync(path.join(STAGE, 'schemas'), { recursive: true })
for (const schema of SCHEMAS) {
  copyFileSync(path.join('docs', 'schemas', schema), path.join(STAGE, 'schemas', schema))
}
for (const bundle of BUNDLES) {
  copyFileSync(path.join('dist', bundle), path.join(STAGE, 'dist', bundle))
}
cpSync('dist/legal-data', path.join(STAGE, 'dist', 'legal-data'), { recursive: true })
for (const source of pageAssets) {
  const target = path.join(STAGE, source)
  mkdirSync(path.dirname(target), { recursive: true })
  copyFileSync(source, target)
}
for (const source of [...JOB_SOURCES, DARWIN_HELPER, ...LINUX_HELPERS]) {
  mkdirSync(path.join(STAGE, path.dirname(source)), { recursive: true })
  copyFileSync(source, path.join(STAGE, source))
}
cpSync('native/runner', path.join(STAGE, 'native/runner'), { recursive: true })
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
execFileSync(process.execPath, ['scripts/check-l10n.mjs', '--packaged-acp', STAGE], {
  stdio: 'inherit',
})
for (const file of NLS_FILES) copyFileSync(file, path.join(STAGE, file))
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
  files: ['dist', 'native', 'l10n', 'schemas', ...NLS_FILES, 'README.md', 'LICENSE', NOTICES],
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
console.log(`ACP full Help: ${NLS_FILES.length} staged languages verified`)

const packed = execFileSync('npm', ['pack', '--pack-destination', '..'], {
  cwd: path.resolve(STAGE),
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
  .trim()
  .split('\n')
  .at(-1)
execFileSync(
  process.execPath,
  ['test/packaging/moduleExports.test.mjs', 'acp', path.join('dist', String(packed))],
  { stdio: 'inherit' },
)
console.log(`dist/${String(packed)}: ${PACKAGE_NAME} ${String(manifest.version)}`)
