#!/usr/bin/env node
// Muse Desktop (M111, D91.12) lane WB: assembles a runnable desktop-app
// folder from the pinned Electron download and dist/desktop, then flips
// the fuses the folder layout supports. Signing, asar integrity and the
// installer belong to the packaging lanes (M111i/IM); this script is the
// development package the smoke run and the Debian VM use.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses'

const electronDist = 'node_modules/electron/dist'
const appBuild = 'dist/desktop'
const outdir = 'dist/desktop-app'

for (const required of [electronDist, appBuild]) {
  if (!existsSync(required)) {
    throw new Error(`package-desktop-app: ${required} is missing; build first`)
  }
}

rmSync(outdir, { recursive: true, force: true })
mkdirSync(outdir, { recursive: true })
cpSync(electronDist, outdir, { recursive: true })

const resourcesApp = path.join(outdir, 'resources', 'app')
mkdirSync(resourcesApp, { recursive: true })
cpSync(appBuild, resourcesApp, { recursive: true })
writeFileSync(
  path.join(resourcesApp, 'package.json'),
  `${JSON.stringify({ name: 'muse-desktop', version: '0.0.0', main: 'main.mjs', type: 'module', private: true })}\n`,
)

const binaryName = process.platform === 'win32' ? 'electron.exe' : 'electron'
const binaryPath = path.join(outdir, binaryName)
await flipFuses(binaryPath, {
  version: FuseVersion.V1,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  [FuseV1Options.OnlyLoadAppFromAsar]: false,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
})

console.log(`package-desktop-app: ${outdir} ready (fuses flipped on ${binaryName})`)
