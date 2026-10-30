// M110os RLF-MUSESETUP (D227): the first-boot setup's Muse Code step.
// The install target resolves from Meta's own knob or the setup home;
// a relative home or an unusable timeout is refused with fixed words;
// a spent bound answers timed-out without touching the network; and
// where Meta answers, a home that cannot take the install is said as
// install-failed. The full live install walks through the serving
// setup server next door, so the whole step is proven where the
// person runs it.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MUSE_INSTALL_SCRIPT_URL } from '../../src/shared/constants'
import { canReachUrl, hasTool, scratch } from './helpers/nodeOs'
import {
  installMuseCode,
  resolveMuseInstallDir,
} from '../../src/runtime/node/firstBoot/installMuseCode'

const PROBE_TIMEOUT_MS = 30_000
const CAN_INSTALL =
  process.platform !== 'win32' &&
  hasTool('bash', ['--version']) &&
  hasTool('curl', ['--version']) &&
  (await canReachUrl(MUSE_INSTALL_SCRIPT_URL, PROBE_TIMEOUT_MS))

describe('muse install target', () => {
  it("honours Meta's install-dir knob, else the setup home's bin", () => {
    expect(resolveMuseInstallDir('/home/setup', {})).toBe('/home/setup/.local/bin')
    expect(resolveMuseInstallDir('/home/setup', { MUSE_INSTALL_DIR: '' })).toBe(
      '/home/setup/.local/bin',
    )
    expect(resolveMuseInstallDir('/home/setup', { MUSE_INSTALL_DIR: '/opt/muse' })).toBe(
      '/opt/muse',
    )
  })

  it('refuses a relative home and an unusable timeout', async () => {
    await expect(installMuseCode({ homeDir: 'relative', timeoutMs: 1000 })).rejects.toThrow(
      'setup muse home is not absolute',
    )
    await expect(installMuseCode({ homeDir: '/home/setup', timeoutMs: 0 })).rejects.toThrow(
      'setup muse timeout is not usable',
    )
  })

  it('answers timed-out on a spent bound without installing anything', async () => {
    const home = path.join(scratch('node-os-muse-timeout-'), 'home')
    const outcome = await installMuseCode({ homeDir: home, timeoutMs: 1, env: {} })
    expect(outcome).toEqual({ ok: false, reason: 'timed-out' })
  })

  it.runIf(CAN_INSTALL)('says install-failed when the home cannot take the install', async () => {
    // A file for a home: Meta's real installer downloads, then cannot
    // run under it, and the step says so. The rig's own environment
    // runs the attempt, minus Meta's knob, so the failure is the
    // home's and nothing else's.
    const root = scratch('node-os-muse-blocked-')
    const home = path.join(root, 'home')
    writeFileSync(home, 'not a directory')
    const env = { ...process.env }
    delete env.MUSE_INSTALL_DIR
    const outcome = await installMuseCode({ homeDir: home, timeoutMs: 120_000, env })
    expect(outcome).toEqual({ ok: false, reason: 'install-failed' })
  })
})
