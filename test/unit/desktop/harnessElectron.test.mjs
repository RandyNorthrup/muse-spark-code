import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_DIR,
  launchElectronApp,
  resolveElectron,
} from '../../../test/desktop/harness/lib/electronDriver.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURE_ELECTRON = path.join(FIXTURE_DIR, 'node_modules/electron/path.txt')

describe('electron resolution', () => {
  it('names every place searched when no Electron is installed', async () => {
    const emptyEnv = { ...process.env }
    delete emptyEnv.MUSE_ELECTRON
    const resolved = await resolveElectron({
      repoRoot: path.join(root, 'temp'),
      appDir: path.join(root, 'temp'),
      env: emptyEnv,
    })
    // In a checkout where an Electron is already installed somewhere the
    // resolver finds it; the refusal path is what this case can promise.
    if (resolved.path === undefined) {
      expect(resolved.missing.join(' ')).toContain('node_modules/electron')
      await expect(
        launchElectronApp({
          repoRoot: path.join(root, 'temp'),
          appDir: path.join(root, 'temp'),
          env: emptyEnv,
        }),
      ).rejects.toThrow('no Electron binary found')
    } else {
      expect(resolved.path.length).toBeGreaterThan(0)
    }
  })

  it('honours a MUSE_ELECTRON override', async () => {
    const found = await resolveElectron({
      repoRoot: root,
      appDir: FIXTURE_DIR,
      env: { ...process.env, MUSE_ELECTRON: process.execPath },
    })
    expect(found).toEqual({ path: path.resolve(process.execPath) })
  })
})

// A real Electron launch is half a minute of downloads away from a clean
// checkout: the desktop workflow installs the fixture and runs this suite
// under Xvfb. Without the fixture's Electron the suite reports skipped,
// exactly like the browserCheckLive suites without their store.
describe.skipIf(!existsSync(FIXTURE_ELECTRON))(
  'the Electron driver against the real fixture app',
  () => {
    it('opens the fixture, types through the page, and reads the result', async () => {
      const { app, window } = await launchElectronApp({
        repoRoot: root,
        appDir: FIXTURE_DIR,
      })
      try {
        expect(await window.title()).toBe('M111 QA Electron fixture')
        await window.locator('#fixture-heading').waitFor()
        await window.locator('#fixture-text').fill('through the driver')
        await window.locator('#fixture-apply').click()
        await expect
          .poll(async () => window.locator('#fixture-status').textContent())
          .toBe('applied: through the driver')
        const versions = await app.evaluate(async ({ app: electronApp }) => ({
          electron: process.versions.electron,
          name: electronApp.getName(),
        }))
        expect(versions.electron).toMatch(/^\d+\./)
      } finally {
        await app.close()
      }
    }, 60_000) // A cold real Electron launch under CI emulation; the operation, not slowness.
  },
)
