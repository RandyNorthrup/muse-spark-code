import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  hostRouting,
  liveFetch,
  managedConfiguration,
  type MuseNetworkPosture,
  readNetworkFacts,
  readProxySettings,
} from '../../src/host/networkPosture'
import { DEFAULT_NETWORK_FACTS } from './helpers/networkFacts'

const MUSE: MuseNetworkPosture = {
  proxySource: () => 'none',
  hasCertificateOverride: () => false,
}

function unused(): undefined {
  return undefined
}

// The extension host's globals as each VS Code leaves them (proxyResolver.ts
// at each tag, M62): 1.112.0 on patches both and marks each; 1.101 to 1.111
// patch `fetch` only, with Node 22's own WebSocket; 1.99 and 1.100 run Node
// 20, which has no WebSocket; an editor without VS Code's extension host
// marks neither.
const VSCODE_1_112 = {
  fetch: unused,
  WebSocket: unused,
  __vscodeOriginalFetch: unused,
  __vscodeOriginalWebSocket: unused,
}
const VSCODE_1_101 = { fetch: unused, WebSocket: unused, __vscodeOriginalFetch: unused }
const VSCODE_1_99 = { fetch: unused, __vscodeOriginalFetch: unused }
const UNPATCHED_HOST = { fetch: unused, WebSocket: unused }

/** VS Code's `http` section as a settings source. */
function httpSettings(values: Record<string, unknown>) {
  return { get: (section: string): unknown => values[section] }
}

describe('readProxySettings (M56, PLAN.md D43)', () => {
  it('passes valid proxy settings through to the Muse Code environment', () => {
    expect(
      readProxySettings(
        httpSettings({ proxy: 'https://proxy.corp:8443', noProxy: ['.corp', 'localhost'] }),
      ),
    ).toEqual({ proxy: 'https://proxy.corp:8443', noProxy: ['.corp', 'localhost'] })
  })

  it('rejects malformed settings before they reach a child process', () => {
    expect(readProxySettings(httpSettings({ proxy: 42, noProxy: ['.corp', 42] }))).toEqual({
      proxy: '',
      noProxy: [],
    })
    expect(readProxySettings(httpSettings({ proxy: undefined, noProxy: 'localhost' }))).toEqual({
      proxy: '',
      noProxy: [],
    })
  })
})

describe('hostRouting (M62, PLAN.md D43)', () => {
  it('claims a route only where the extension host marked its proxy-aware global', () => {
    expect(hostRouting(VSCODE_1_112, 'fetch')).toBe('routed')
    expect(hostRouting(VSCODE_1_112, 'webSocket')).toBe('routed')
    expect(hostRouting(VSCODE_1_101, 'fetch')).toBe('routed')
    expect(hostRouting(VSCODE_1_101, 'webSocket')).toBe('notRouted')
    expect(hostRouting(VSCODE_1_99, 'fetch')).toBe('routed')
    expect(hostRouting(VSCODE_1_99, 'webSocket')).toBe('absent')
    expect(hostRouting(UNPATCHED_HOST, 'fetch')).toBe('notRouted')
    expect(hostRouting(UNPATCHED_HOST, 'webSocket')).toBe('notRouted')
  })
})

describe('readNetworkFacts (M56, PLAN.md D43)', () => {
  it('reads VS Code’s defaults when nothing is set', () => {
    expect(readNetworkFacts(httpSettings({}), {}, 'linux', MUSE, VSCODE_1_112)).toEqual(
      DEFAULT_NETWORK_FACTS,
    )
  })

  it('says which globals this editor routes, whatever the settings say', () => {
    expect(readNetworkFacts(httpSettings({}), {}, 'linux', MUSE, VSCODE_1_101)).toMatchObject({
      isWebSocketSupportOn: true,
      fetchRouting: 'routed',
      webSocketRouting: 'notRouted',
    })
    expect(readNetworkFacts(httpSettings({}), {}, 'linux', MUSE, VSCODE_1_99)).toMatchObject({
      webSocketRouting: 'absent',
    })
  })

  it('states a corporate setup as yes/no and counts, never the proxy itself', () => {
    const facts = readNetworkFacts(
      httpSettings({
        proxy: 'https://me:hunter2@proxy.corp:8443',
        proxySupport: 'on',
        proxyStrictSSL: false,
        proxyAuthorization: 'Basic abc',
        noProxy: ['localhost', '.corp'],
        systemCertificates: false,
        fetchAdditionalSupport: false,
        webSocketAdditionalSupport: false,
      }),
      { https_proxy: 'https://proxy.corp:8443', NODE_EXTRA_CA_CERTS: '/etc/corp-root.pem' },
      'linux',
      { proxySource: () => 'vscode', hasCertificateOverride: () => true },
      VSCODE_1_112,
    )
    expect(facts).toEqual({
      isProxySet: true,
      proxySupport: 'on',
      isProxyStrictSsl: false,
      isProxyAuthorizationSet: true,
      noProxyCount: 2,
      isSystemCertificatesOn: false,
      isFetchSupportOn: false,
      isWebSocketSupportOn: false,
      fetchRouting: 'routed',
      webSocketRouting: 'routed',
      hasEnvironmentProxy: true,
      hasExtraCaCertificates: true,
      museProxySource: 'vscode',
      hasMuseCertificateOverride: true,
    })
    expect(JSON.stringify(facts)).not.toContain('hunter2')
  })

  it('reads the environment in any case on Windows, and ignores malformed values', () => {
    const facts = readNetworkFacts(
      httpSettings({
        proxy: 42,
        proxySupport: 'password=swordfish',
        noProxy: 'localhost',
        systemCertificates: 'no',
      }),
      { Https_Proxy: 'http://p:1', node_extra_ca_certs: String.raw`C:\corp.pem` },
      'win32',
      MUSE,
      VSCODE_1_112,
    )
    expect(facts).toMatchObject({
      isProxySet: false,
      proxySupport: 'override',
      noProxyCount: 0,
      isSystemCertificatesOn: true,
      hasEnvironmentProxy: true,
      hasExtraCaCertificates: true,
    })
    // An empty variable is not a proxy.
    expect(
      readNetworkFacts(httpSettings({}), { HTTPS_PROXY: '' }, 'linux', MUSE, VSCODE_1_112),
    ).toMatchObject({
      hasEnvironmentProxy: false,
    })
  })
})

describe('managedConfiguration (M56)', () => {
  it('returns what `muse config status` printed, or why there is nothing', async () => {
    await expect(managedConfiguration(undefined)).resolves.toEqual({
      ok: false,
      reason: 'not run: the Muse Code CLI was not found',
    })
    const printed = 'Enterprise configuration status\nSources:\n'
    await expect(
      managedConfiguration(() => Promise.resolve({ exitCode: 0, stdout: printed, stderr: '' })),
    ).resolves.toEqual({ ok: true, text: printed })
    await expect(
      managedConfiguration(() =>
        Promise.resolve({ exitCode: 2, stdout: '', stderr: 'Usage: muse config status\n' }),
      ),
    ).resolves.toEqual({ ok: false, reason: 'exit code 2' })
    // A timeout or a crash exposes only its exit code, never partial output.
    await expect(
      managedConfiguration(() => Promise.resolve({ exitCode: -1, stdout: 'partial', stderr: '' })),
    ).resolves.toEqual({ ok: false, reason: 'exit code -1' })
    await expect(
      managedConfiguration(() => Promise.reject(new Error('password=swordfish'))),
    ).resolves.toEqual({ ok: false, reason: 'could not read status' })
  })
})

describe('liveFetch (M56)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the global fetch as it stands at each call, as VS Code installs it', async () => {
    const patched = vi.fn(() => Promise.resolve(new Response('through VS Code')))
    vi.stubGlobal('fetch', patched)
    const response = await liveFetch('https://api.meta.ai/v1/models', { method: 'GET' })
    await expect(response.text()).resolves.toBe('through VS Code')
    expect(patched).toHaveBeenCalledWith('https://api.meta.ai/v1/models', { method: 'GET' })
  })
})
