// Playwright's Electron driver for the desktop harness (M111 lane QA):
// launches a real Electron app (lane WB's workbench in real runs, the
// harness fixture in the driver's own tests) and hands back its first
// window. Electron resolution never guesses: an explicit override, the
// app's own node_modules, the repository's, or the fixture's — in that
// order — and a refusal naming every place searched.

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from 'playwright-core'
import { findExecutable } from './tools.mjs'

const HARNESS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURE_DIR = path.join(HARNESS_DIR, 'electron-fixture')

function electronFrom(dir) {
  try {
    const requireFrom = createRequire(path.join(dir, 'package.json'))
    const resolved = requireFrom('electron')
    return typeof resolved === 'string' ? resolved : undefined
  } catch {
    return undefined
  }
}

/**
The Electron binary for an app: $MUSE_ELECTRON when set (verified to
exist), else the electron package of the app, the repository, or the
harness fixture. Undefined when none is installed.
*/
export async function resolveElectron({ repoRoot, appDir, env = process.env }) {
  const searched = []
  if (env.MUSE_ELECTRON !== undefined) {
    searched.push(`MUSE_ELECTRON (${env.MUSE_ELECTRON})`)
    const found = await findExecutable(env.MUSE_ELECTRON, env)
    if (found !== undefined) return { path: found }
  }
  for (const dir of [appDir, repoRoot, FIXTURE_DIR]) {
    if (dir === undefined) continue
    searched.push(path.join(dir, 'node_modules/electron'))
    const resolved = electronFrom(dir)
    if (resolved === undefined) continue
    const found = await findExecutable(resolved, env)
    if (found !== undefined) return { path: found }
  }
  return { missing: searched }
}

/**
Launches the Electron app at `appDir` and resolves with the Playwright
application and its first window. The caller owns `app.close()`.
`headlessOzone` passes Chromium's headless Ozone switch for machines
with no display server; a real X/Wayland session needs no switch.
*/
export async function launchElectronApp({
  repoRoot,
  appDir,
  env = process.env,
  args = [],
  headlessOzone = false,
  timeoutMs = 30_000,
}) {
  const resolved = await resolveElectron({ repoRoot, appDir, env })
  if (resolved.path === undefined) {
    throw new Error(
      `no Electron binary found; searched ${resolved.missing.join(', ')}. Install the app's dependencies, or set MUSE_ELECTRON.`,
    )
  }
  const launchArgs = [...(headlessOzone ? ['--ozone-platform=headless'] : []), appDir, ...args]
  const app = await _electron.launch({
    executablePath: resolved.path,
    args: launchArgs,
    env,
    timeout: timeoutMs,
  })
  const window = await app.firstWindow()
  return { app, window, electronPath: resolved.path }
}
