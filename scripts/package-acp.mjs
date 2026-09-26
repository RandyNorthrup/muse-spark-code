#!/usr/bin/env node
// The ACP agent's npm package (M63, PLAN.md D62): `muse-spark-code-acp`,
// laid out in dist/acp-package/ and packed with `npm pack` into
// dist/muse-spark-code-acp-<version>.tgz, which each GitHub Release carries
// and `npm install -g` installs. The bundles come from the production build;
// the package's manifest is written here, with the extension's version, the
// agent's command and the one dependency it does not bundle, the native
// keyring binding (D61), at the version this repository locks.
//
//   node scripts/build.mjs --production && node scripts/package-acp.mjs
//   (npm run package:acp)

import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const STAGE = path.join('dist', 'acp-package')
const BUNDLES = ['acp.js', 'searchWorker.js']
const NATIVE_DEPENDENCY = '@napi-rs/keyring'
const PACKAGE_NAME = 'muse-spark-code-acp'
const README = path.join('docs', 'acp.md')
const NOTICES = 'THIRD_PARTY_NOTICES.txt'

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

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const keyringVersion = lockedVersion(manifest)
requireBundles()

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(path.join(STAGE, 'dist'), { recursive: true })
for (const bundle of BUNDLES) {
  copyFileSync(path.join('dist', bundle), path.join(STAGE, 'dist', bundle))
}
cpSync('l10n', path.join(STAGE, 'l10n'), {
  recursive: true,
  filter: (source) => !source.endsWith('untranslated.json'),
})
copyFileSync('LICENSE', path.join(STAGE, 'LICENSE'))
copyFileSync(README, path.join(STAGE, 'README.md'))
execFileSync(
  process.execPath,
  ['scripts/third-party-notices.mjs', '--acp', path.join(STAGE, NOTICES)],
  { stdio: 'inherit' },
)

const agentManifest = {
  name: PACKAGE_NAME,
  version: manifest.version,
  description:
    'Muse Spark Code (Unofficial) for editors that speak the Agent Client Protocol: Zed, JetBrains IDEs, Xcode, Neovim, Emacs and more. Not endorsed by Meta.',
  license: manifest.license,
  homepage: `${manifest.repository.url.replace(/\.git$/, '')}/blob/main/docs/acp.md`,
  repository: manifest.repository,
  bugs: manifest.bugs,
  keywords: ['muse spark', 'muse code', 'agent client protocol', 'acp', 'coding agent'],
  bin: { [PACKAGE_NAME]: 'dist/acp.js' },
  files: ['dist', 'l10n', 'README.md', 'LICENSE', NOTICES],
  engines: { node: manifest.engines.node },
  dependencies: { [NATIVE_DEPENDENCY]: keyringVersion },
}
writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(agentManifest, null, 2)}\n`)

const packed = execFileSync('npm', ['pack', path.resolve(STAGE), '--pack-destination', 'dist'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
  .trim()
  .split('\n')
  .at(-1)
console.log(`dist/${String(packed)}: ${PACKAGE_NAME} ${String(manifest.version)}`)
