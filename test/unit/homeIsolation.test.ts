import { homedir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The unit suite must not read the developer's real home folder: the
 * per-worker setup redirects it at an empty temp folder. Red drill: unset
 * the redirect and this guard fails.
 */
describe('unit home isolation', () => {
  it('runs with the home folder redirected at an empty temp folder', () => {
    const home = homedir()
    // Without the setup redirect this is the developer's real home.
    expect(home).toContain('muse-unit-home-')
    expect(process.env['HOME']).toBe(home)
    for (const variable of [
      'XDG_DATA_HOME',
      'XDG_CONFIG_HOME',
      'XDG_STATE_HOME',
      'XDG_CACHE_HOME',
    ] as const) {
      const value = process.env[variable] ?? ''
      expect(value.startsWith(`${home}${path.sep}`)).toBe(true)
    }
    if (process.platform === 'win32') {
      expect(process.env['USERPROFILE']).toBe(home)
    }
  })
})
