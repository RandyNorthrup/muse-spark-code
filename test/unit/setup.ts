import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { MILLISECONDS_PER_DAY } from '../../src/shared/constants'

// The unit suite never touches the developer's real home: every worker
// points home, and the data/config/state/cache folders derived from it, at
// one temp folder per WORKER (shared by that worker's files), removed when
// the worker's process ends. Tool lookups (a browser, bun, the Muse Code
// CLI) still need the real machine: their locations are captured BEFORE the
// redirect below, in test/unit/helpers/realMachine.ts's variables.
// os.homedir() reads $HOME on POSIX and %USERPROFILE% on Windows (falling
// back to %HOMEDRIVE%%HOMEPATH%, which no test needs); the data folder
// additionally reads XDG_DATA_HOME / %LOCALAPPDATA%.
const savedReal: Record<string, string | undefined> = {
  MUSE_UNIT_REAL_HOME: process.env['HOME'] ?? process.env['USERPROFILE'],
  MUSE_UNIT_REAL_USERPROFILE: process.env['USERPROFILE'],
  MUSE_UNIT_REAL_LOCALAPPDATA: process.env['LOCALAPPDATA'],
  MUSE_UNIT_REAL_XDG_DATA_HOME: process.env['XDG_DATA_HOME'],
}
for (const [key, value] of Object.entries(savedReal)) {
  if (value !== undefined && process.env[key] === undefined) process.env[key] = value
}

const workerState = globalThis as unknown as {
  __museUnitHome?: string
  __museUnitHomeRegistered?: boolean
}
if (workerState.__museUnitHome === undefined) {
  workerState.__museUnitHome = mkdtempSync(path.join(tmpdir(), 'muse-unit-home-'))
  // A killed worker never runs its exit handler: sweep folders its
  // predecessors left behind, older than a day so live workers keep theirs.
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith('muse-unit-home-')) continue
      const folder = path.join(tmpdir(), entry)
      if (folder === workerState.__museUnitHome) continue
      try {
        if (Date.now() - statSync(folder).mtimeMs > MILLISECONDS_PER_DAY)
          rmSync(folder, { recursive: true, force: true })
      } catch {
        // Racing another worker's sweep or exit: leave it for the next run.
      }
    }
  } catch {
    // An unreadable temp folder still gets the redirect below.
  }
}
const isolatedHome: string = workerState.__museUnitHome
if (workerState.__museUnitHomeRegistered !== true) {
  workerState.__museUnitHomeRegistered = true
  process.once('exit', () => {
    try {
      rmSync(isolatedHome, { recursive: true, force: true })
    } catch {
      // Best effort: the next run's sweep removes leftovers older than a day.
    }
  })
}
process.env['HOME'] = isolatedHome
process.env['XDG_DATA_HOME'] = path.join(isolatedHome, '.local', 'share')
process.env['XDG_CONFIG_HOME'] = path.join(isolatedHome, '.config')
process.env['XDG_STATE_HOME'] = path.join(isolatedHome, '.local', 'state')
process.env['XDG_CACHE_HOME'] = path.join(isolatedHome, '.cache')
if (process.platform === 'win32') {
  process.env['USERPROFILE'] = isolatedHome
  process.env['APPDATA'] = path.join(isolatedHome, 'AppData', 'Roaming')
  process.env['LOCALAPPDATA'] = path.join(isolatedHome, 'AppData', 'Local')
}

// Testing Library only auto-unmounts when vitest exposes globals; this project
// keeps globals off, so unmount explicitly or renders leak across tests.
afterEach(() => {
  cleanup()
})

// jsdom does not implement scrollIntoView; the palette calls it on the
// active row, and the tests only care that the row is marked active.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => {
    // no layout in jsdom
  }
}
