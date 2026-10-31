#!/usr/bin/env node
// Muse Desktop (M111, D91.20) lane IN: captures the pinned Electron's IME
// flags from a real run. Launches Electron with exactly the switches the
// workbench passes (--enable-wayland-ime --wayland-text-input-version=3)
// and fails unless the running app carries both with the version parsed.
// The receipt of the capture is test/desktop/l10n/ime-flags.json; proving
// a text-input-v3 session under Hyprland with fcitx5 in Chinese, Japanese
// and Korean needs the image, so it belongs to image CI, not this rig.
//
// Electron comes from $ELECTRON_BIN, else the installed package's binary
// (node_modules/electron/dist/electron, once lane WB merges). Run under
// Xvfb; on a rig without a setuid sandbox and font cache, as here:
//
//   ELECTRON_BIN=<path> ELECTRON_DISABLE_SANDBOX=1 XDG_CACHE_HOME=<tmp> \
//     xvfb-run -a node test/desktop/l10n/ime-flags.mjs

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const IME_SWITCHES = ['--enable-wayland-ime', '--wayland-text-input-version=3']

function electronBinary() {
  const fromEnv = process.env['ELECTRON_BIN']
  if (fromEnv !== undefined && fromEnv !== '') {
    if (!existsSync(fromEnv)) throw new Error(`ime-flags: ELECTRON_BIN=${fromEnv} is missing`)
    return fromEnv
  }
  const packaged = path.join(root, 'node_modules/electron/dist/electron')
  if (!existsSync(packaged)) {
    throw new Error('ime-flags: set ELECTRON_BIN (the electron package is not installed)')
  }
  return packaged
}

const probeDir = path.join(root, 'temp/ime-flags-probe')
rmSync(probeDir, { recursive: true, force: true })
mkdirSync(probeDir, { recursive: true })
const probe = path.join(probeDir, 'main.js')
writeFileSync(
  probe,
  `const { app } = require('electron')\n` +
    `app.whenReady().then(() => {\n` +
    `  const record = {\n` +
    `    electron: process.versions.electron,\n` +
    `    chrome: process.versions.chrome,\n` +
    `    node: process.versions.node,\n` +
    `    platform: process.platform,\n` +
    `    enableWaylandIme: app.commandLine.hasSwitch('enable-wayland-ime'),\n` +
    `    textInputVersion: app.commandLine.getSwitchValue('wayland-text-input-version'),\n` +
    `  }\n` +
    `  console.log('IME-FLAGS ' + JSON.stringify(record))\n` +
    `  app.exit(0)\n` +
    `})\n`,
)

const binary = electronBinary()
const run = spawnSync(binary, [probe, ...IME_SWITCHES], {
  encoding: 'utf8',
  timeout: 120_000,
  env: process.env,
})
if (run.error !== undefined)
  throw new Error(`ime-flags: Electron did not start: ${run.error.message}`)
if (run.status !== 0) {
  process.stderr.write(run.stderr)
  throw new Error(`ime-flags: Electron exited ${String(run.status)}`)
}
const line = run.stdout.split('\n').find((candidate) => candidate.startsWith('IME-FLAGS '))
if (line === undefined) {
  process.stderr.write(run.stderr)
  throw new Error('ime-flags: the probe never reported (Electron did not reach ready)')
}
const record = JSON.parse(line.slice('IME-FLAGS '.length))
for (const version of ['electron', 'chrome', 'node']) {
  if (typeof record[version] !== 'string' || record[version] === '') {
    throw new Error(`ime-flags: Electron reported no ${version} version`)
  }
}
if (record.enableWaylandIme !== true || record.textInputVersion !== '3') {
  throw new Error(`ime-flags: the running app lost the IME switches: ${line}`)
}
console.log(
  `ime-flags: Electron ${record.electron} (Chromium ${record.chrome}) carries --enable-wayland-ime --wayland-text-input-version=3`,
)
