#!/usr/bin/env node
// Third-party notices for the .vsix (M26, PLAN.md D29). The shipped bundles
// carry code from npm packages (React, zod, highlight.js, the markdown
// stack, the Muse SDK), and their licences (MIT, ISC, BSD-3-Clause) ask for
// their copyright and permission notices to travel with that code. The
// production build writes each bundle's esbuild metafile (dist/meta/); this
// script takes every package that contributed an input to a shipped
// bundle, reads the licence file the package itself ships, and renders
// THIRD_PARTY_NOTICES.txt, which .vscodeignore puts in the package.
//
//   node scripts/third-party-notices.mjs          check (the build runs this):
//                                                 exit 1 when the file is stale
//   node scripts/third-party-notices.mjs --write  regenerate it (npm run notices)
//   node scripts/third-party-notices.mjs --acp <file>
//                                                 the ACP agent's package (M63,
//                                                 PLAN.md D62): its two bundles'
//                                                 packages, written to <file>
//                                                 by scripts/package-acp.mjs
//
// Versions are left out on purpose: a routine version bump changes no
// licence and passes, while a package that enters a bundle, or a licence
// text that changes, fails the build until the file is regenerated and the
// diff reviewed. A licence outside the allow-list below, or a package
// without a licence file, fails either way: that needs a person.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const METAFILE_DIR = path.join('dist', 'meta')
// The ACP agent ships acp.js and the search worker (scripts/build.mjs).
const ACP_METAFILES = [
  path.join('dist', 'meta-acp', 'acp.json'),
  path.join(METAFILE_DIR, 'searchWorker.json'),
]
const ACP_FLAG = '--acp'
const NODE_MODULES = 'node_modules/'
const LICENCE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i
const NOTICE_FILE = /^notice(\.(md|txt))?$/i
// Permissive licences whose terms are met by reproducing the notice.
const ALLOWED_LICENCES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
])
const RULE = '='.repeat(72)
const THIN_RULE = '-'.repeat(72)

const HEADER = `THIRD-PARTY SOFTWARE NOTICES
Muse Spark Code (Unofficial)

The extension's bundles (dist/extension.js, dist/searchWorker.js,
dist/webview/main.js and dist/webview/main.css) include code from the
packages below, each under its own licence, reproduced here as the package
ships it. The macOS dictation helper links only Apple's system frameworks
and the Windows helper is a PowerShell script of this project; neither
includes third-party code.

Generated from the production build by scripts/third-party-notices.mjs;
"npm run notices" regenerates this file.
`

const ACP_HEADER = `THIRD-PARTY SOFTWARE NOTICES
muse-spark-code-acp, Muse Spark Code (Unofficial) for editors that speak the
Agent Client Protocol

The agent's bundles (dist/acp.js and dist/searchWorker.js) include code
from the packages below, each under its own licence, reproduced here as
the package ships it. The keyring binding (@napi-rs/keyring) is installed
beside it as a dependency, with its own licence.

Generated from the production build by scripts/third-party-notices.mjs.
`

/** The package directory of an esbuild input under node_modules (the innermost one). */
function packageDirOf(input) {
  const at = input.lastIndexOf(NODE_MODULES) + NODE_MODULES.length
  const [scopeOrName = '', name = ''] = input.slice(at).split('/', 2)
  const packageName = scopeOrName.startsWith('@') ? `${scopeOrName}/${name}` : scopeOrName
  return input.slice(0, at) + packageName
}

function shippedPackageDirs(metafiles) {
  const missing = metafiles.find((file) => !existsSync(file))
  if (missing !== undefined) {
    throw new Error(`${missing} is missing: run "node scripts/build.mjs --production" first`)
  }
  const dirs = new Set()
  for (const file of metafiles) {
    const metafile = JSON.parse(readFileSync(file, 'utf8'))
    for (const output of Object.values(metafile.outputs)) {
      const packageInputs = Object.keys(output.inputs).filter((input) =>
        input.includes(NODE_MODULES),
      )
      for (const input of packageInputs) {
        dirs.add(packageDirOf(input))
      }
    }
  }
  return [...dirs]
}

function normalise(text) {
  return text
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

function sourceUrl(manifest) {
  const repository =
    typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
  return typeof repository === 'string'
    ? repository
        .replace(/^git\+/, '')
        .replace(/^git:\/\//, 'https://')
        .replace(/^github:/, 'https://github.com/')
        .replace(/\.git$/, '')
        .replace(/^([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
    : (manifest.homepage ?? `https://www.npmjs.com/package/${manifest.name}`)
}

function describePackage(dir, problems) {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const files = readdirSync(dir)
  const licenceFile = files.find((file) => LICENCE_FILE.test(file))
  const noticeFile = files.find((file) => NOTICE_FILE.test(file))
  if (!ALLOWED_LICENCES.has(manifest.license)) {
    problems.push(
      `${manifest.name}: licence "${String(manifest.license)}" is not on the allow-list`,
    )
  }
  if (licenceFile === undefined) {
    problems.push(`${manifest.name}: ships no licence file`)
  }
  const texts = [licenceFile, noticeFile]
    .filter((file) => file !== undefined)
    .map((file) => normalise(readFileSync(path.join(dir, file), 'utf8')))
  return {
    name: manifest.name,
    licence: manifest.license,
    url: sourceUrl(manifest),
    text: texts.join(`\n\n${THIN_RULE}\n\n`),
  }
}

/** One block per distinct licence text, naming every package that ships it. */
function render(packages, isAcp) {
  const header = isAcp ? ACP_HEADER : HEADER
  const sorted = packages.toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
  const groups = Map.groupBy(sorted, (entry) => entry.text)
  const blocks = [...groups].map(([text, group]) => {
    const names = group.map((entry) => `${entry.name} (${entry.licence})\n  ${entry.url}`)
    return `${RULE}\n${names.join('\n')}\n${THIN_RULE}\n\n${text}\n`
  })
  return `${header}\n${blocks.join('\n')}`
}

/** The file `--acp` names; undefined without the flag. */
function acpOutputFile() {
  const index = process.argv.indexOf(ACP_FLAG)
  if (index === -1) {
    return
  }
  const file = process.argv[index + 1]
  if (file === undefined) {
    throw new Error(`${ACP_FLAG} needs the file to write`)
  }
  return file
}

const acpOutput = acpOutputFile()
const metafiles =
  acpOutput === undefined
    ? readdirSync(METAFILE_DIR).map((file) => path.join(METAFILE_DIR, file))
    : ACP_METAFILES
const problems = []
const packages = shippedPackageDirs(metafiles).map((dir) => describePackage(dir, problems))
if (problems.length > 0) {
  console.error(`third-party notices: ${String(problems.length)} package(s) need a review:`)
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  process.exit(1)
}
const OUTPUT = 'THIRD_PARTY_NOTICES.txt'
const expected = render(packages, acpOutput !== undefined)

if (acpOutput !== undefined) {
  writeFileSync(acpOutput, expected)
  console.log(`${acpOutput}: ${String(packages.length)} packages written`)
} else if (process.argv.includes('--write')) {
  writeFileSync(OUTPUT, expected)
  console.log(`${OUTPUT}: ${String(packages.length)} packages written`)
} else {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8').replaceAll('\r\n', '\n') : ''
  if (current !== expected) {
    console.error(
      `${OUTPUT} does not match the packages in the production bundles; run "npm run notices" and review the diff`,
    )
    process.exit(1)
  }
  console.log(`ok   ${OUTPUT}: ${String(packages.length)} bundled packages`)
}
