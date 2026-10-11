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
//                                                 PLAN.md D62): its staged bundles'
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
import { contributedPackageDirs, noticePackageDir } from './lib/noticesInput.mjs'
import { assertFontBundleSplit, fontNotices } from './notices-fonts.mjs'

const METAFILE_DIR = path.join('dist', 'meta')
const ACP_METAFILE_DIR = path.join('dist', 'meta-acp')
const ACP_STAGE = path.join('dist', 'acp-package')
const ACP_FLAG = '--acp'
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

The extension's bundles (dist/extension.js, dist/modelApi.js,
dist/resourceGovernor.js, dist/resourceAdmission.js, dist/sessionBoard.js, dist/reviewer.js, dist/team.js, dist/teamScheduler.js, dist/teamRunners.js, dist/foreignHooks.js, dist/hookRuntime.js,
dist/pluginHooks.js, dist/planMarkdown.js, dist/checkpointStore.js,
dist/review.js, dist/agentImport.js, dist/conversationGit.js, dist/modelApiSessions.js, dist/codeIntel.js, dist/voice.js, dist/webFetch.js,
dist/museCodeReviewer.js, dist/browserCheck.js, dist/browserRuntime.js, dist/bundledSkills.js,
dist/conversation.js, dist/whatsNew.js, dist/report.js, dist/recorder.js, dist/uiText.js, dist/uiTextRuntime.js, dist/uiTextHooks.js, dist/uiTextSurfaces.js, dist/validation.js, dist/wire.js, dist/searchWorker.js, dist/pageWorker.js,
dist/webview/main.js, dist/webview/resourceSurface.js, dist/webview/resourceHistory.js, dist/webview/resourceHistory.css, its ESM chunks, dist/webview/main.css, dist/webview/whatsNew.js and dist/webview/whatsNew.css)
include code from the packages below, each under its own licence,
reproduced here as the package ships it. The vendored
high-quality-projects-skill workflow package and the vendored models.dev
provider catalogue are also included below.
The separately distributed optional standalone font pack is also listed below;
no font is shipped in the VSIX. The macOS dictation helper links
only Apple's system frameworks and the Windows helper is a PowerShell
script of this project; neither includes third-party code.
The Linux created-path helper statically links OpenSSL SHA-256 routines;
its copyright notices and Apache 2.0 licence follow the package notices.

Generated from the production build by scripts/third-party-notices.mjs;
"npm run notices" regenerates this file.
`

const ACP_HEADER = `THIRD-PARTY SOFTWARE NOTICES
muse-spark-code-acp, Muse Spark Code (Unofficial) for editors that speak the
Agent Client Protocol

The agent's bundles (dist/acp.js, dist/fontsInstall.js, dist/acpQuestions.js, dist/runtimeQuestions.js, dist/questionNotes.js, dist/resourceGovernor.js, dist/resourceAdmission.js, dist/modelApi.js, dist/reviewer.js, dist/team.js, dist/teamScheduler.js, dist/teamRunners.js, dist/foreignHooks.js, dist/hookRuntime.js, dist/recorder.js, dist/uiText.js, dist/uiTextRuntime.js, dist/uiTextHooks.js, dist/uiTextSurfaces.js, dist/validation.js, dist/wire.js, dist/searchWorker.js and
dist/pageWorker.js and dist/legalScan.js) include code from the packages below, each under its
own licence, reproduced here as the package ships it. The keyring binding (@napi-rs/keyring) is installed
beside it as a dependency, with its own licence. The optional standalone font
pack is described below; fonts install verifies its separately downloaded assets.

Generated from the production build by scripts/third-party-notices.mjs.
`

function shippedPackageDirs(metafiles) {
  const missing = metafiles.find((file) => !existsSync(file))
  if (missing !== undefined) {
    throw new Error(`${missing} is missing: run "node scripts/build.mjs --production" first`)
  }
  const dirs = new Set()
  for (const file of metafiles) {
    const metafile = JSON.parse(readFileSync(file, 'utf8'))
    for (const output of Object.values(metafile.outputs)) {
      for (const input of Object.keys(output.inputs)) {
        const directory = noticePackageDir(input)
        if (directory !== undefined) dirs.add(path.resolve(directory))
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
  const native = `${RULE}\nOpenSSL (Linux native helper, Apache-2.0)\n${THIN_RULE}\n\n${readFileSync(path.join('native', 'openssl-NOTICE.txt'), 'utf8').trimEnd()}\n`
  const legalData = normalise(readFileSync('src/core/legal/data/NOTICE.md', 'utf8'))
  return `${header}\n${native}\n${blocks.join('\n')}\n${RULE}\nSPDX identifier data\n${THIN_RULE}\n\n${legalData}\n`
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
const extensionMeta = readdirSync(METAFILE_DIR).map((file) => path.join(METAFILE_DIR, file))
if (acpOutput !== undefined && !existsSync(path.join(ACP_STAGE, 'dist', 'acp.js')))
  throw new Error('ACP bundle stage is missing: stage the package before generating notices')
const metafiles =
  acpOutput === undefined
    ? extensionMeta
    : [
        ...extensionMeta,
        ...readdirSync(ACP_METAFILE_DIR).map((file) => path.join(ACP_METAFILE_DIR, file)),
      ]
const directories =
  acpOutput === undefined
    ? shippedPackageDirs(extensionMeta)
    : [
        ...contributedPackageDirs(metafiles, readFileSync, (file) =>
          existsSync(path.join(ACP_STAGE, file)),
        ),
      ].map((directory) => path.resolve(directory))
const problems = []
const packages = directories.map((dir) => describePackage(dir, problems))
if (acpOutput === undefined) {
  packages.push(
    {
      name: 'high-quality-projects-skill',
      licence: 'MIT',
      url: 'https://github.com/RandyNorthrup/high-quality-projects-skill',
      text: normalise(readFileSync('vendor/high-quality-projects-skill/LICENSE', 'utf8')),
    },
    // M95 (PLAN.md D74): the provider catalogue is models.dev data, vendored
    // with its MIT notice. Whether the ACP agent's package ships the catalogue
    // is lane X's decision; until it does, only the extension's notices name it.
    {
      name: 'models.dev',
      licence: 'MIT',
      url: 'https://models.dev',
      text: normalise(readFileSync('vendor/models-dev/LICENSE', 'utf8')),
    },
  )
}
assertFontBundleSplit(
  JSON.parse(readFileSync(path.join('dist', 'meta-acp', 'acp.json'), 'utf8')),
  JSON.parse(readFileSync(path.join('dist', 'meta-acp', 'fontsInstall.json'), 'utf8')),
)
const fonts = await fontNotices()
packages.push(...fonts.map((font) => ({ ...font, text: normalise(font.text) })))
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
  console.log(
    `ok   ${OUTPUT}: ${String(packages.length)} third-party notices (${String(fonts.length)} optional fonts)`,
  )
}
