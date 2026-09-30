import { describe, expect, it } from 'vitest'
import { renderSupportReport, type SupportFacts } from '../../src/core/support/report'
import { MUSE_CONFIG_STATUS_MAX_CHARS } from '../../src/shared/constants'
import { DEFAULT_NETWORK_FACTS } from './helpers/networkFacts'

// `muse config status` as Muse Code 1.3.0 prints it with no managed
// configuration on the machine (captured 2026-09-25, M56); the digest is
// shortened here.
const CONFIG_STATUS = [
  'Enterprise configuration status',
  'Generation: sha256:0f3c',
  'Sources:',
  '  plane=defaults source_class=system_file state=absent',
  '  plane=policy source_class=system_file state=absent',
  '  plane=defaults source_class=windows_machine_policy state=absent',
  '  plane=policy source_class=windows_machine_policy state=absent',
  '',
].join('\n')

const base: SupportFacts = {
  extensionVersion: '0.2.0',
  vscodeVersion: '1.138.0',
  nodeVersion: '22.0.0',
  platform: 'win32',
  arch: 'x64',
  remoteName: undefined,
  hasWorkspace: true,
  isWorkspaceTrusted: true,
  backendSetting: 'auto',
  shellSandboxSetting: 'auto',
  shellSandboxPosture: 'sandboxed (default)',
  sandboxNetworkSetting: 'default',
  isSandboxNetworkApplied: false,
  isBinaryPathConfigured: false,
  environmentVariableCount: 2,
  cli: {
    ok: true,
    installDir: String.raw`C:\Users\r\AppData\Local\Programs\muse`,
    version: '1.3.0',
  },
  cliCredentialFile: 'inline',
  cliSignIn: 'signedIn',
  keychainItem: undefined,
  delegationMode: 'off',
  workflowTriggerMode: 'auto',
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  dictation: { isAvailable: true },
  network: DEFAULT_NETWORK_FACTS,
  managedConfiguration: { ok: true, text: CONFIG_STATUS },
  homeDir: String.raw`C:\Users\r`,
}

describe('renderSupportReport', () => {
  it('lists every fact on its own line with credentials as yes/no', () => {
    expect(renderSupportReport(base)).toBe(
      [
        'Muse Spark diagnostics',
        'extension: 0.2.0',
        'vscode: 1.138.0 (remote: none)',
        'node: 22.0.0 on win32 x64',
        'workspace: open, trusted: yes',
        'backend setting: auto',
        'shell sandbox: setting auto, posture sandboxed (default)',
        'sandbox network: setting default, not passed (Muse Code’s own default, or the shell sandbox is off)',
        'muse binary path configured: no; environment variables: 2',
        // The home directory is `~` in a report meant for a public issue (D24).
        String.raw`muse cli: found in ~\AppData\Local\Programs\muse (version 1.3.0)`,
        'muse subagent delegation: off; workflow trigger mode: auto',
        'cli credential file: inline; cli sign-in: signedIn; stored model api key: no; META_API_KEY in environment: no',
        'voice dictation: available',
        'network: http.proxy set: no; proxySupport: override; proxyStrictSSL: yes; proxyAuthorization set: no; noProxy entries: 0; proxy in environment: no',
        'certificates: system certificates: yes; NODE_EXTRA_CA_CERTS: no',
        "extension requests through VS Code's network support: fetch yes, WebSocket yes",
        'muse serve: proxy from none; SSL_CERT_FILE or SSL_CERT_DIR: no',
        'muse config status:',
        '  Enterprise configuration status',
        '  Generation: sha256:0f3c',
        '  Sources:',
        '    plane=defaults source_class=system_file state=absent',
        '    plane=policy source_class=system_file state=absent',
        '    plane=defaults source_class=windows_machine_policy state=absent',
        '    plane=policy source_class=windows_machine_policy state=absent',
      ].join('\n'),
    )
  })

  it('names what is missing: no workspace, no CLI, no version, no dictation, a remote', () => {
    const text = renderSupportReport({
      ...base,
      remoteName: 'ssh-remote',
      hasWorkspace: false,
      isWorkspaceTrusted: false,
      cli: { ok: false, reason: 'Muse Code is not installed in any known location.' },
      hasStoredApiKey: true,
      dictation: { isAvailable: false, reason: 'no recogniser on linux' },
    })
    expect(text).toContain('vscode: 1.138.0 (remote: ssh-remote)')
    expect(text).toContain('workspace: none, trusted: no')
    expect(text).toContain('muse cli: not found: Muse Code is not installed in any known location.')
    expect(text).toContain('stored model api key: yes')
    expect(text).toContain('voice dictation: unavailable: no recogniser on linux')
    expect(
      renderSupportReport({
        ...base,
        cli: { ok: true, installDir: '/opt/muse', version: undefined },
      }),
    ).toContain('(version unknown)')
  })

  // PLAN.md D26 (2026-09-27): the CLI's credential file by its structure,
  // and on macOS whether the Keychain holds its item; never a value.
  it('describes the CLI’s sign-in by the file’s structure and the Keychain item', () => {
    expect(
      renderSupportReport({
        ...base,
        platform: 'darwin',
        cliCredentialFile: 'keychain',
        cliSignIn: 'unknown',
        keychainItem: 'absent',
      }),
    ).toContain('cli credential file: keychain; cli sign-in: unknown;')
    expect(renderSupportReport({ ...base, keychainItem: 'present' })).toContain(
      'macOS Keychain item ai.meta.dev.credentials: present',
    )
    expect(renderSupportReport(base)).not.toContain('Keychain item')
    expect(
      renderSupportReport({ ...base, cliCredentialFile: 'empty', cliSignIn: 'signedOut' }),
    ).toContain('cli credential file: empty; cli sign-in: signedOut;')
  })

  // M56 (PLAN.md D43): the network posture, as yes/no and counts only.
  it('states a corporate network’s posture without its addresses', () => {
    const text = renderSupportReport({
      ...base,
      sandboxNetworkSetting: 'restricted',
      isSandboxNetworkApplied: true,
      network: {
        isProxySet: true,
        proxySupport: 'on',
        isProxyStrictSsl: false,
        isProxyAuthorizationSet: true,
        noProxyCount: 3,
        isSystemCertificatesOn: false,
        isFetchSupportOn: false,
        isWebSocketSupportOn: true,
        fetchRouting: 'routed',
        webSocketRouting: 'routed',
        hasEnvironmentProxy: true,
        hasExtraCaCertificates: true,
        museProxySource: 'vscode',
        hasMuseCertificateOverride: true,
      },
    })
    expect(text).toContain('sandbox network: setting restricted, passed to muse serve')
    expect(text).toContain(
      'network: http.proxy set: yes; proxySupport: on; proxyStrictSSL: no; proxyAuthorization set: yes; noProxy entries: 3; proxy in environment: yes',
    )
    expect(text).toContain('certificates: system certificates: no; NODE_EXTRA_CA_CERTS: yes')
    expect(text).toContain('fetch no, WebSocket yes')
    expect(text).toContain(
      'muse serve: proxy from VS Code’s http.proxy; SSL_CERT_FILE or SSL_CERT_DIR: yes',
    )
    expect(
      renderSupportReport({
        ...base,
        network: { ...base.network, museProxySource: 'environment' },
      }),
    ).toContain('muse serve: proxy from its environment;')
  })

  // M62 (PLAN.md D43): below VS Code 1.112 an extension's WebSocket is not
  // routed, and on Node 20 there is none; the settings do not change that.
  it('never claims a route the editor does not give a global', () => {
    const olderVsCode = renderSupportReport({
      ...base,
      network: { ...base.network, webSocketRouting: 'notRouted' },
    })
    expect(olderVsCode).toContain(
      "extension requests through VS Code's network support: fetch yes, WebSocket no (this editor does not route it; VS Code does from 1.112)",
    )
    const node20 = renderSupportReport({
      ...base,
      network: { ...base.network, webSocketRouting: 'absent' },
    })
    expect(node20).toContain('fetch yes, WebSocket none in this extension host')
    const otherEditor = renderSupportReport({
      ...base,
      network: { ...base.network, fetchRouting: 'notRouted', webSocketRouting: 'notRouted' },
    })
    expect(otherEditor).toContain('fetch no (this editor does not route it), WebSocket no (')
  })

  it('shows captured status fields and omits unrecognized lines that may contain secrets', () => {
    const managed = renderSupportReport({
      ...base,
      managedConfiguration: {
        ok: true,
        text: [
          'Sources:',
          '  plane=policy source_class=system_file state=absent',
          '  plane=policy source_class=system_file state=absent token=abc123',
          String.raw`plane=policy source=C:\Users\r\policy.json password="two words"`,
        ].join('\n'),
      },
    })
    expect(managed).toContain('    plane=policy source_class=system_file state=absent')
    expect(managed).toContain('  [unrecognized status line omitted]')
    expect(managed).not.toContain('abc123')
    expect(managed).not.toContain('two words')
    expect(managed).not.toContain('policy.json')
    const long = renderSupportReport({
      ...base,
      managedConfiguration: {
        ok: true,
        text: Array.from({ length: MUSE_CONFIG_STATUS_MAX_CHARS }, () => 'Sources:').join('\n'),
      },
    })
    expect(long).toContain('…')
    expect(long).not.toContain('  Sources:\n'.repeat(MUSE_CONFIG_STATUS_MAX_CHARS))
    expect(
      renderSupportReport({
        ...base,
        managedConfiguration: { ok: false, reason: 'exit code 2: password=swordfish' },
      }),
    ).toContain('muse config status: could not read status')
  })
})
