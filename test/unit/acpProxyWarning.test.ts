import { describe, expect, it } from 'vitest'
import { type EnvProxyInput, envProxyWarning } from '../../src/runtime/proxyWarning'

// PLAN.md Q66: the agent says once, at start, when a proxy variable is set
// but the Model API backend's requests will not use it: Node's switch off,
// or a Node without the switch. The versions and the switch's spellings are
// the ones measured against a local proxy (pr32-integration.md).

const PROXY = 'http://user:secret@127.0.0.1:8080'

function warning(overrides: Partial<EnvProxyInput> = {}): string | undefined {
  return envProxyWarning({
    backend: 'modelApi',
    platform: 'linux',
    env: { HTTPS_PROXY: PROXY },
    execArgv: [],
    nodeVersion: 'v22.23.3',
    ...overrides,
  })
}

describe('envProxyWarning', () => {
  it('says nothing without a proxy variable, or on the Muse Code backend', () => {
    expect(warning({ env: {} })).toBeUndefined()
    expect(warning({ env: { HTTPS_PROXY: '' } })).toBeUndefined()
    // ALL_PROXY is not one Node's switch reads; Muse Code reads it itself.
    expect(warning({ env: { ALL_PROXY: PROXY } })).toBeUndefined()
    expect(warning({ backend: 'museCode' })).toBeUndefined()
  })

  it.each(['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'])(
    'warns for %s set with the switch off, naming the variable and not its value',
    (name) => {
      const said = warning({ env: { [name]: PROXY } })
      expect(said).toContain(`${name} is set, but NODE_USE_ENV_PROXY is not 1`)
      expect(said).toContain('go to Meta directly, bypassing the proxy')
      expect(said).toContain('Set NODE_USE_ENV_PROXY=1')
      expect(said).not.toContain('127.0.0.1')
      expect(said).not.toContain('secret')
    },
  )

  it('names each variable set once: both spellings on Linux, one on Windows, where they are one', () => {
    const both = { HTTPS_PROXY: PROXY, https_proxy: PROXY, HTTP_PROXY: PROXY }
    expect(warning({ env: both })).toMatch(/^HTTPS_PROXY, https_proxy, HTTP_PROXY are set, but/)
    expect(warning({ platform: 'win32', env: both })).toMatch(
      /^HTTPS_PROXY, HTTP_PROXY are set, but/,
    )
  })

  it('says nothing once the switch is on: the variable, the flag, or the flag in NODE_OPTIONS', () => {
    expect(warning({ env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' } })).toBeUndefined()
    expect(warning({ execArgv: ['--use-env-proxy'] })).toBeUndefined()
    expect(
      warning({
        env: { HTTPS_PROXY: PROXY, NODE_OPTIONS: '--max-old-space-size=4096  --use-env-proxy' },
      }),
    ).toBeUndefined()
    expect(
      warning({ nodeVersion: 'v24.5.0', env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' } }),
    ).toBeUndefined()
  })

  it('still warns for a switch Node does not take: only "1" turns it on', () => {
    for (const value of ['true', '0', 'yes']) {
      expect(warning({ env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: value } })).toContain(
        'NODE_USE_ENV_PROXY is not 1',
      )
    }
    expect(
      warning({ env: { HTTPS_PROXY: PROXY, NODE_OPTIONS: '--use-env-proxy-x' } }),
    ).toBeDefined()
  })

  it.each(['v22.0.0', 'v22.20.0', 'v23.11.1', 'v20.18.3', 'not a version'])(
    'warns that Node %s is too old for any proxy, even with the switch on',
    (nodeVersion) => {
      const said = warning({
        nodeVersion,
        env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' },
      })
      expect(said).toContain(`Node ${nodeVersion} cannot send the Model API backend's requests`)
      expect(said).toContain('Node 22.21 or later, or 24, can, with NODE_USE_ENV_PROXY=1')
    },
  )

  it.each(['v24.0.0', 'v24.4.0'])(
    'warns that Node %s sends page requests directly even when Meta requests use the proxy',
    (nodeVersion) => {
      const said = warning({ nodeVersion, env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' } })
      expect(said).toContain('Meta requests use the proxy')
      expect(said).toContain('sends web_fetch page requests directly, bypassing it')
      expect(said).toContain('Node 24.5 or later')
      expect(said).not.toContain(PROXY)
    },
  )

  it.each(['v22.21.0', 'v22.23.3', 'v24.5.0', 'v24.20.0', 'v25.1.0'])(
    'takes Node %s as one with the switch',
    (nodeVersion) => {
      expect(warning({ nodeVersion })).toContain('NODE_USE_ENV_PROXY is not 1')
      expect(
        warning({ nodeVersion, env: { HTTPS_PROXY: PROXY, NODE_USE_ENV_PROXY: '1' } }),
      ).toBeUndefined()
    },
  )
})
