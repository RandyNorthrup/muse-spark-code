#!/usr/bin/env node
// Muse Desktop (M111, D91.20) lane IN: the generated QML singleton under
// real Qt 6. Lints the committed singleton with qmllint, then runs the
// QtTest case in test/desktop/l10n/qml/ with qmltestrunner on the offscreen
// platform. The Qt 6 binaries come from `qtpaths6 --binaries-dir`
// (overridable with QT6_BIN); both tools must exist, else this fails naming
// them. TMPDIR stays short for the module dir.
//
//   node test/desktop/l10n/qml-check.mjs

import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const singleton = path.join(root, 'desktop/crates/l10n/qml/UiText.qml')
const tst = path.join(root, 'test/desktop/l10n/qml/tstuitext.qml')
const scratch = path.join(root, 'temp/qml-l10n')
const moduleDir = path.join(scratch, 'MuseL10n')

function qtBinaries() {
  if (process.env['QT6_BIN'] !== undefined && process.env['QT6_BIN'] !== '')
    return process.env['QT6_BIN']
  try {
    return execFileSync('qtpaths6', ['--binaries-dir'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('qml-check: qtpaths6 is missing and QT6_BIN is not set')
  }
}

for (const required of [singleton, tst]) {
  if (!existsSync(required)) throw new Error(`qml-check: ${required} is missing; generate first`)
}
const bin = qtBinaries()
function tool(name) {
  const file = path.join(bin, name)
  if (!existsSync(file)) throw new Error(`qml-check: ${file} is missing`)
  return file
}
const lint = tool('qmllint')
const runner = tool('qmltestrunner')

const linted = spawnSync(lint, [singleton], { encoding: 'utf8' })
process.stdout.write(linted.stdout)
process.stderr.write(linted.stderr)
if (linted.status !== 0)
  throw new Error(`qml-check: qmllint refused ${singleton} (exit ${String(linted.status)})`)

rmSync(scratch, { recursive: true, force: true })
mkdirSync(moduleDir, { recursive: true })
copyFileSync(singleton, path.join(moduleDir, 'UiText.qml'))
copyFileSync(tst, path.join(scratch, 'tstuitext.qml'))
writeFileSync(path.join(moduleDir, 'qmldir'), 'module MuseL10n\nsingleton UiText 1.0 UiText.qml\n')

const run = spawnSync(runner, ['-input', path.join(scratch, 'tstuitext.qml')], {
  encoding: 'utf8',
  env: {
    ...process.env,
    QT_QPA_PLATFORM: 'offscreen',
    QML2_IMPORT_PATH: scratch,
  },
})
process.stdout.write(run.stdout)
process.stderr.write(run.stderr)
if (run.status !== 0)
  throw new Error(`qml-check: qmltestrunner failed (exit ${String(run.status)})`)
console.log('qml-check: qmllint clean, QtTest passed')
