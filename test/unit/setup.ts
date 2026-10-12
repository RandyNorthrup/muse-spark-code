import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// The unit suite never touches the developer's real home: every worker
// points home, and the data/config/state/cache folders derived from it, at
// an empty temp folder. Workers end without restoring. os.homedir() reads
// $HOME on POSIX and %USERPROFILE% on Windows (falling back to
// %HOMEDRIVE%%HOMEPATH%, which no test needs); the data folder additionally
// reads XDG_DATA_HOME / %LOCALAPPDATA%.
const isolatedHome = mkdtempSync(path.join(tmpdir(), 'muse-unit-home-'))
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
