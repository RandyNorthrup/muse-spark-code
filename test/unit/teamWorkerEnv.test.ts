// The credential-free worker environment (M96 lane W, acceptance 24 and
// the T5 fence): nothing credential-shaped survives the scrub except a
// profile-declared passthrough, and git cannot prompt or ssh anywhere.

import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
    expect(env['GIT_CONFIG_KEY_1']).toBe('core.askPass')
    expect(env['GIT_CONFIG_VALUE_1']).toBe('')
    expect(env['GIT_SSH_COMMAND']).toBe('false')
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
    }
    for (const platform of ['linux', 'darwin', 'win32'] as const) {
      const env = scrubWorkerEnv({
        platform,
        baseEnv: { ...BASE, ...dangerous },
        passthrough: Object.keys(dangerous).filter((name) => name !== 'NODE_OPTIONS'),
      })
      expect(env['GIT_CONFIG_PARAMETERS']).toBeUndefined()
      expect(env['GIT_CONFIG_SYSTEM']).toBeUndefined()
      expect(env['GIT_CONFIG_COUNT']).toBe('2')
      expect(env['GIT_CONFIG_KEY_0']).toBe('credential.helper')
      expect(env['GIT_CONFIG_VALUE_0']).toBe('')
      expect(env['GIT_CONFIG_GLOBAL']).toBe(platform === 'win32' ? 'NUL' : '/dev/null')
      expect(env['GIT_SSH_COMMAND']).toBe('false')
      expect(env['GIT_ASKPASS']).toBeUndefined()
      expect(env['SSH_ASKPASS']).toBeUndefined()
      expect(env['SSH_AUTH_SOCK']).toBeUndefined()
      expect(env['NODE_OPTIONS']).toBeUndefined()
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

const slash = (given: string): string => given.replaceAll('\\', '/')

describe('W-F3 real Git transport fences', () => {
  let fixture: string
  let marker: string
  const git = (args: readonly string[], env = process.env, input?: string) =>
    spawnSync('git', [...args], { cwd: fixture, env, input, encoding: 'utf8', windowsHide: true })
  beforeAll(async () => {
    const base = path.resolve('temp')
    await mkdir(base, { recursive: true })
    fixture = await mkdtemp(path.join(base, 'worker-git-'))
    marker = path.join(fixture, 'helper-marker')
    const askpass = path.join(fixture, 'askpass.sh')
    await writeFile(askpass, `#!/bin/sh\necho invoked >> '${slash(marker)}'\necho synthetic\n`)
    expect(git(['init', '--quiet']).status).toBe(0)
    expect(git(['config', 'core.askPass', `sh '${slash(askpass)}'`]).status).toBe(0)
    expect(git(['config', 'credential.helper', `!echo helper >> '${slash(marker)}'`]).status).toBe(
      0,
    )
  })
  afterAll(async () => {
    await rm(fixture, { recursive: true, force: true })
  })
  it('RVM96W2C-N9 never runs clone-config core.askPass or credential.helper', async () => {
    const env = scrubWorkerEnv({ platform: process.platform, baseEnv: process.env })
    const result = git(['credential', 'fill'], env, 'protocol=https\nhost=example.invalid\n\n')
    expect(result.status).toBe(128)
    expect(result.stderr).toContain('terminal prompts disabled')
    await expect(access(marker)).rejects.toThrow()
    expect(git(['config', '--get', 'core.askPass'], env).stdout.trim()).toBe('')
  })
  it('RVM96W2C-N10 refuses SSH cleanly without starting interactive cmd.exe', () => {
    const result = spawnSync('git', ['ls-remote', 'ssh://git@example.invalid/x.git'], {
      env: scrubWorkerEnv({ platform: process.platform, baseEnv: process.env }),
      encoding: 'utf8',
      windowsHide: true,
    })
    expect(result.status).toBe(128)
    expect(result.stderr).toContain('Could not read from remote repository')
    expect(result.stdout).not.toContain('Microsoft Windows')
    expect(result.stderr).not.toContain('bad line length character')
  })
})
