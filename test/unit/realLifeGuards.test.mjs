import { describe, expect, it } from 'vitest'
import { installerEnvironment } from '../../scripts/real-life/lib/install.mjs'

// Pure guards for the real-life run (scripts/real-life/): each `it` names
// the review finding it holds. Values go in as data; nothing is faked.

describe('real-life installer environment', () => {
  it('keeps no credential variable out of the child npm (4252482350)', () => {
    const env = installerEnvironment({
      PATH: '/usr/bin',
      HOME: '/home/person',
      npm_execpath: '/usr/lib/node_modules/npm/bin/npm-cli.js',
      REAL_LIFE_KEY_ANTHROPIC_FLEET_1: 'a-provider-key',
      META_API_KEY: 'a-provider-key',
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.HOME).toBe('/home/person')
    expect(env.npm_execpath).toBe('/usr/lib/node_modules/npm/bin/npm-cli.js')
    expect(env.REAL_LIFE_KEY_ANTHROPIC_FLEET_1).toBeUndefined()
    expect(env.META_API_KEY).toBeUndefined()
  })
})
