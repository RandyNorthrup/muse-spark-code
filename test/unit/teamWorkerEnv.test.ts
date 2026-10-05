// The credential-free worker environment (M96 lane W, acceptance 24 and
// the T5 fence): nothing credential-shaped survives the scrub except a
// profile-declared passthrough, and git cannot prompt or ssh anywhere.

import { describe, expect, it } from 'vitest'
import { scrubWorkerEnv } from '../../src/core/team/workers/workerEnv'

const BASE: NodeJS.ProcessEnv = {
  PATH: '/usr/bin',
  HOME: '/home/user',
  META_API_KEY: 'key-1',
  OPENAI_KEY: 'key-2',
  AWS_ACCESS_KEY_ID: 'key-3',
  GITHUB_TOKEN: 'key-4',
  SSH_AUTH_SOCK: '/run/agent.sock',
  GIT_ASKPASS: '/ask',
  CUSTOM_SERVICE_API_KEY: 'key-5',
  FOO_TOKENS_TOTAL: '100',
  TEAM_NAME: 'engineering',
}

describe('scrubWorkerEnv', () => {
  it('drops every credential variable shape', () => {
    const env = scrubWorkerEnv({ platform: 'linux', baseEnv: BASE })
    for (const name of [
      'META_API_KEY',
      'OPENAI_KEY',
      'AWS_ACCESS_KEY_ID',
      'GITHUB_TOKEN',
      'SSH_AUTH_SOCK',
      'GIT_ASKPASS',
      'CUSTOM_SERVICE_API_KEY',
    ]) {
      expect(env[name], name).toBeUndefined()
    }
  })

  it('starts empty and inherits only the safe runtime allowlist', () => {
    const env = scrubWorkerEnv({ platform: 'linux', baseEnv: BASE })
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['HOME']).toBe('/home/user')
    expect(env['FOO_TOKENS_TOTAL']).toBeUndefined()
    expect(env['TEAM_NAME']).toBeUndefined()
  })

  it('pins git to no prompt, no helper and a refusing ssh', () => {
    const env = scrubWorkerEnv({ platform: 'linux', baseEnv: BASE })
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(env['GIT_CONFIG_COUNT']).toBe('2')
    expect(env['GIT_CONFIG_KEY_0']).toBe('credential.helper')
    expect(env['GIT_CONFIG_VALUE_0']).toBe('')
    expect(env['GIT_SSH_COMMAND']).toBe('muse-spark-refuses-ssh')
    expect(env['GIT_CONFIG_KEY_1']).toBe('core.askpass')
    expect(env['GIT_CONFIG_VALUE_1']).toBe('')
    expect(env['GIT_CONFIG_NOSYSTEM']).toBe('1')
    expect(env['GIT_CONFIG_GLOBAL']).toBe('/dev/null')
  })

  it('RVM96A-5 cannot restore Git config or credential transports through passthrough', () => {
    const dangerous = {
      GIT_CONFIG_PARAMETERS: "'credential.helper=synthetic-helper'",
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: 'synthetic-helper',
      GIT_CONFIG_SYSTEM: '/fake/config',
      GIT_CONFIG_GLOBAL: '/fake/config',
      GIT_SSH_COMMAND: 'synthetic-ssh',
      GIT_ASKPASS: '/fake/askpass',
      SSH_AUTH_SOCK: '/fake/socket',
      SSH_ASKPASS: '/fake/askpass',
      NODE_OPTIONS: '--require=/fake/module',
      LD_PRELOAD: '/fake/module',
      DYLD_INSERT_LIBRARIES: '/fake/module',
      BASH_ENV: '/fake/startup',
      ENV: '/fake/startup',
    }
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const env = scrubWorkerEnv({
        platform,
        baseEnv: { ...BASE, ...dangerous },
        passthrough: Object.keys(dangerous),
      })
      expect(env['NODE_OPTIONS']).toBeUndefined()
      expect(env['LD_PRELOAD']).toBeUndefined()
      expect(env['DYLD_INSERT_LIBRARIES']).toBeUndefined()
      expect(env['BASH_ENV']).toBeUndefined()
      expect(env['ENV']).toBeUndefined()
      expect(env['GIT_CONFIG_PARAMETERS']).toBeUndefined()
      expect(env['GIT_CONFIG_SYSTEM']).toBe(platform === 'win32' ? 'NUL' : '/dev/null')
      expect(env['GIT_CONFIG_COUNT']).toBe('2')
      expect(env['GIT_CONFIG_KEY_0']).toBe('credential.helper')
      expect(env['GIT_CONFIG_VALUE_0']).toBe('')
      expect(env['GIT_CONFIG_GLOBAL']).toBe(platform === 'win32' ? 'NUL' : '/dev/null')
      expect(env['GIT_SSH_COMMAND']).toBe('muse-spark-refuses-ssh')
      expect(env['GIT_ASKPASS']).toBeUndefined()
      expect(env['SSH_ASKPASS']).toBeUndefined()
      expect(env['SSH_AUTH_SOCK']).toBeUndefined()
    }
  })

  it('restores only the profile-declared passthrough names', () => {
    const env = scrubWorkerEnv({
      platform: 'linux',
      baseEnv: BASE,
      passthrough: ['META_API_KEY'],
    })
    expect(env['META_API_KEY']).toBe('key-1')
    expect(env['GITHUB_TOKEN']).toBeUndefined()
  })

  it('does not mutate the base environment', () => {
    const base = { ...BASE }
    scrubWorkerEnv({ platform: 'linux', baseEnv: base })
    expect(base).toEqual(BASE)
  })

  it('matches names case-insensitively on Windows', () => {
    const env = scrubWorkerEnv({
      platform: 'win32',
      baseEnv: { Path: String.raw`c:\bin`, Meta_Api_Key: 'key-1' },
    })
    expect(env['Meta_Api_Key']).toBeUndefined()
    expect(env['Path']).toBe(String.raw`c:\bin`)
  })
})
