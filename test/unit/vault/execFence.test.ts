import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { vaultShellSecretsSchema } from '../../../src/core/vault/exec/schema'
import { hookEnvironment, createToolIo, shellEnvironment } from '../../../src/host/backend/toolIo'
import { withoutCredentials, withoutKeyringRoutes } from '../../../src/runtime/credentialVariables'
import { vaultFenceEnvironment } from '../../../src/core/vault/exec/fence'
import { shellArguments } from '../../../src/host/backend/toolIo'
import { fakeMuseCodeManager } from '../helpers/museCodeManager'

describe('M109 X credential fence', () => {
  it.each([false, true])(
    'W-X1 fence-off is honored only for interactive=%s shells',
    async (interactive) => {
      const io = createToolIo({
        platform: process.platform,
        systemRoot: process.env['SystemRoot'],
        env: () => ({
          PATH: process.env['PATH'],
          SystemRoot: process.env['SystemRoot'],
          SSH_AUTH_SOCK: '/ambient/fake-worker-route',
        }),
        agentFence: () => false,
        listFiles: () => Promise.resolve([]),
        searchWorkerPath: 'unused',
        log: () => undefined,
        unsavedFiles: () => [],
      })
      const result = await io.runShell(
        process.platform === 'win32' ? 'Get-ChildItem Env:' : 'env',
        process.cwd(),
        1000,
        undefined,
        undefined,
        undefined,
        interactive,
      )
      expect(result.exitCode).toBe(0)
      expect(result.stdout.includes('/ambient/fake-worker-route')).toBe(interactive)
    },
  )
  it.each(['GIT_PROXY_COMMAND', 'GIT_EXEC_PATH', 'GIT_EXTERNAL_DIFF'])(
    'W-X2 drops inherited %s including Muse Code and case variants',
    (name) => {
      for (const isMuseCode of [false, true])
        for (const spelling of [name, name.toLowerCase()])
          expect(
            vaultFenceEnvironment({ [spelling]: 'fake-route' }, { museCode: isMuseCode })[spelling],
          ).toBeUndefined()
    },
  )
  it.each([
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'NODE_OPTIONS',
    'NODE_PATH',
    'BASH_ENV',
    'ENV',
    'BASH_FUNC_probe',
  ])('W-X3 refuses loader/startup injection through an approved %s env name', (name) => {
    expect(
      vaultShellSecretsSchema.safeParse({ env: { [name]: 'secret://test-secret' } }).success,
    ).toBe(false)
  })
  it.each(['PGPASSWORD', 'MYSQL_PWD', 'REDISCLI_AUTH'])(
    'W-X4 strips common %s credentials from shells and hooks',
    (name) => {
      const env = { [name]: 'fake-password', [name.toLowerCase()]: 'fake-password' }
      expect(withoutCredentials(env)).toEqual({})
      expect(shellEnvironment(env, 'linux', undefined)[name]).toBeUndefined()
      expect(hookEnvironment(env, 'linux', Object.keys(env))[name]).toBeUndefined()
    },
  )
  it('W-X5 hooks reset file-based git helpers and refuse askpass routes', () => {
    const env = hookEnvironment(
      { PATH: '/bin', GIT_CONFIG_PARAMETERS: 'credential.helper=store', SSH_AUTH_SOCK: '/ambient' },
      'linux',
    )
    expect(env['GIT_CONFIG_COUNT']).toBe('2')
    expect(env['GIT_CONFIG_VALUE_0']).toBe('')
    expect(env['GIT_TERMINAL_PROMPT']).toBe('0')
    expect(env['GIT_ASKPASS']).toBe('')
    expect(env['SSH_ASKPASS']).toBe('')
    expect(env['SUDO_ASKPASS']).toBe('')
  })

  const canary = randomBytes(32).toString('hex')
  const source = {
    PATH: '/safe/bin',
    META_API_KEY: canary,
    arbitrary_api_key: canary,
    AWS_SECRET_ACCESS_KEY: canary,
    NPM_TOKEN: canary,
    AZURE_CLIENT_SECRET: canary,
    SERVICE_PASSWORD: canary,
    BASH_ENV: '/ambient/startup',
    NODE_OPTIONS: canary,
    Gh_Token: canary,
    DBUS_SESSION_BUS_ADDRESS: canary,
    XDG_RUNTIME_DIR: '/ambient',
    SSH_AUTH_SOCK: '/ambient/agent',
    SSH_AGENT_PID: '7',
    GIT_SSH_COMMAND: '/ambient/ssh',
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
    expect(env['BASH_ENV']).toBeUndefined()
    expect(env['GIT_SSH_COMMAND']).toBeUndefined()
    expect(shellArguments('linux', 'echo safe', undefined, true)).toEqual([
      '--noprofile',
      '--norc',
      '-c',
      'echo safe',
    ])
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
      { sshSocket: 'broker.sock', sshCommand: '/trusted/ssh', refusingHelper: '/trusted/refuse' },
    )
    expect(env['SSH_AUTH_SOCK']).toBe('broker.sock')
    expect(env['ssh_auth_sock']).toBeUndefined()
    expect(env['GIT_ASKPASS']).toBe('/trusted/refuse')
    expect(env['GIT_SSH_COMMAND']).toBe('/trusted/ssh')
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
