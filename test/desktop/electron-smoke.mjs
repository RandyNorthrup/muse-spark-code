#!/usr/bin/env node
// Muse Desktop (M111, D91.12) lane WB: the real-Electron smoke run. Starts
// the built workbench on a real folder under Xvfb, proves the renderer
// published its status items through the bridge (the snapshot SH1 reads),
// proves a second launch for the same workspace exits into the running
// instance, then closes the app. Run after `npm run build:desktop`:
//   TMPDIR=$PWD/temp ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node test/desktop/electron-smoke.mjs
// ELECTRON_DISABLE_SANDBOX is a rig need only (the setuid helper cannot be
// root-owned in a lane checkout); the renderer's sandbox stays on.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const rootDir = process.cwd()
const electron = path.join(rootDir, 'node_modules/electron/dist/electron')
const mainEntry = path.join(rootDir, 'dist/desktop/main.mjs')
const scratch = path.join(rootDir, 'temp/desktop-smoke')
const workspace = path.join(scratch, 'ws')
const configHome = path.join(scratch, 'config')

for (const required of [electron, mainEntry]) {
  if (!existsSync(required)) throw new Error(`smoke: ${required} missing; build first`)
}

rmSync(scratch, { recursive: true, force: true })
mkdirSync(path.join(workspace, 'src'), { recursive: true })
mkdirSync(configHome, { recursive: true })
writeFileSync(path.join(workspace, 'src/hello.ts'), 'export const hello = 1\n')
writeFileSync(path.join(workspace, 'README.md'), '# smoke workspace\n')

const env = {
  ...process.env,
  XDG_CONFIG_HOME: configHome,
  TMPDIR: path.join(rootDir, 'temp'),
}

function launch() {
  return spawn(electron, [mainEntry, '--workspace', workspace], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function findStatusSnapshot() {
  const found = []
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.json') && full.includes(`${path.sep}status${path.sep}`)) {
        found.push(full)
      }
    }
  }
  walk(configHome)
  return found
}

const first = launch()
const firstLog = { text: '' }
first.stdout.on('data', (chunk) => {
  firstLog.text += chunk
})
first.stderr.on('data', (chunk) => {
  firstLog.text += chunk
})

const deadline = Date.now() + 60_000
let snapshot = null
while (Date.now() < deadline) {
  const candidates = findStatusSnapshot()
  if (candidates.length > 0) {
    snapshot = JSON.parse(readFileSync(candidates[0], 'utf8'))
    break
  }
  if (first.exitCode !== null) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}

if (snapshot === null) {
  first.kill('SIGKILL')
  throw new Error(`smoke: no status snapshot within 60s\n${firstLog.text.slice(-2000)}`)
}
const itemIds = snapshot.items.map((item) => item.id)
if (!itemIds.includes('workbench.workspace') || !itemIds.includes('workbench.terminals')) {
  first.kill('SIGKILL')
  throw new Error(`smoke: snapshot missing workbench items: ${JSON.stringify(snapshot)}`)
}
console.log(`smoke: renderer published status items ${itemIds.join(', ')}`)

const second = launch()
const secondExit = await Promise.race([
  new Promise((resolve) => second.on('exit', (code) => resolve(code))),
  new Promise((resolve) => setTimeout(() => resolve('still-running'), 20_000)),
])
if (secondExit === 'still-running') {
  second.kill('SIGKILL')
  first.kill('SIGKILL')
  throw new Error('smoke: second instance did not hand off to the first')
}
console.log('smoke: second instance handed off to the single instance')

first.kill('SIGTERM')
await new Promise((resolve) => first.on('exit', resolve))
console.log('smoke: PASS')
