import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { shellEnvironment } from '../../../src/host/backend/toolIo'
import { withoutCredentials, withoutKeyringRoutes } from '../../../src/runtime/credentialVariables'
import { vaultFenceEnvironment } from '../../../src/core/vault/exec/fence'
import { fakeMuseCodeManager } from '../helpers/museCodeManager'

describe('M109 X credential fence', () => {
  const canary = randomBytes(32).toString('hex')
  const source = {
    PATH: '/safe/bin',
    META_API_KEY: canary,
    arbitrary_api_key: canary,
    AWS_SECRET_ACCESS_KEY: canary,
    Gh_Token: canary,
    DBUS_SESSION_BUS_ADDRESS: canary,
    XDG_RUNTIME_DIR: '/ambient',
    SSH_AUTH_SOCK: '/ambient/agent',
    SSH_AGENT_PID: '7',
    GIT_CONFIG_COUNT: '99',
    GIT_CONFIG_KEY_8: 'credential.helper',
    GIT_CONFIG_VALUE_8: 'store',
    GIT_CONFIG_PARAMETERS: 'credential.helper=store',
    Git_Askpass: '/ambient/helper',
    SUDO_ASKPASS: '/ambient/helper',
    SSH_ASKPASS: '/ambient/helper',
    ELECTRON_RUN_AS_NODE: '1',
  }
  it('fences the existing VS Code shell path by default', () => {
    const env = shellEnvironment(source, 'linux', undefined)
    expect(JSON.stringify(env)).not.toContain(canary)
    expect(env['SSH_AUTH_SOCK']).toBeUndefined()
    expect(env['GIT_CONFIG_COUNT']).toBe('2')
    expect(env['GIT_CONFIG_VALUE_0']).toBe('')
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(env['GIT_CONFIG_PARAMETERS']).toBeUndefined()
    expect(env['GIT_CONFIG_KEY_8']).toBeUndefined()
  })
  it('fences runtime tools including git config overrides and askpass', () => {
    const env = withoutKeyringRoutes(withoutCredentials(source))
    expect(JSON.stringify(env)).not.toContain(canary)
    expect(env['GIT_CONFIG_COUNT']).toBe('2')
    expect(env['Git_Askpass']).toBeUndefined()
    expect(env['SUDO_ASKPASS']).toBe('')
  })
  it('accepts only the launcher socket and helper, with Windows case duplicates removed', () => {
    const env = vaultFenceEnvironment(
      { ...source, ssh_auth_sock: '/foreign' },
      { sshSocket: 'broker.sock', refusingHelper: '/trusted/refuse' },
    )
    expect(env['SSH_AUTH_SOCK']).toBe('broker.sock')
    expect(env['ssh_auth_sock']).toBeUndefined()
    expect(env['GIT_ASKPASS']).toBe('/trusted/refuse')
    expect(source.SSH_AUTH_SOCK).toBe('/ambient/agent')
  })
  it('preserves Muse Code credentials while replacing its ambient SSH and git', () => {
    const env = vaultFenceEnvironment(source, { museCode: true, sshSocket: 'own.sock' })
    expect(env['META_API_KEY']).toBe(canary)
    expect(env['SSH_AUTH_SOCK']).toBe('own.sock')
    expect(env['GIT_CONFIG_COUNT']).toBe('2')
    expect(env['GIT_CONFIG_PARAMETERS']).toBeUndefined()
  })
  it('binds the Muse manager to the launcher socket and honours main conversation fence off', async () => {
    const manager = fakeMuseCodeManager({
      getEnvironmentVariables: () => [
        { name: 'SSH_AUTH_SOCK', value: '/ambient/agent' },
        { name: 'META_API_KEY', value: canary },
      ],
      getVaultFence: () => ({ sshSocket: '/requester/socket' }),
    })
    const off = fakeMuseCodeManager({
      getAgentFence: () => false,
      getEnvironmentVariables: () => [{ name: 'SSH_AUTH_SOCK', value: '/ambient/agent' }],
    })
    try {
      expect(manager.childEnvironment()['SSH_AUTH_SOCK']).toBe('/requester/socket')
      expect(manager.childEnvironment()['META_API_KEY']).toBe(canary)
      expect(off.childEnvironment()['SSH_AUTH_SOCK']).toBe('/ambient/agent')
    } finally {
      await manager.dispose()
      await off.dispose()
    }
  })
})
