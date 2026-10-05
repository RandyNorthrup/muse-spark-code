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

  it('keeps ordinary variables and non-credential suffixes', () => {
    const env = scrubWorkerEnv({ platform: 'linux', baseEnv: BASE })
    expect(env['PATH']).toBe('/usr/bin')
    expect(env['FOO_TOKENS_TOTAL']).toBe('100')
    expect(env['TEAM_NAME']).toBe('engineering')
  })

  it('pins git to no prompt, no helper and a refusing ssh', () => {
    const env = scrubWorkerEnv({ platform: 'linux', baseEnv: BASE })
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(env['GIT_CONFIG_COUNT']).toBe('1')
    expect(env['GIT_CONFIG_KEY_0']).toBe('credential.helper')
    expect(env['GIT_CONFIG_VALUE_0']).toBe('')
    expect(env['GIT_SSH_COMMAND']).toBe('false')
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
