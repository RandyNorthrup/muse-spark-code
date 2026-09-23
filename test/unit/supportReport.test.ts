import { describe, expect, it } from 'vitest'
import { renderSupportReport, type SupportFacts } from '../../src/core/support/report'

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
  isBinaryPathConfigured: false,
  environmentVariableCount: 2,
  cli: {
    ok: true,
    installDir: String.raw`C:\Users\r\AppData\Local\Programs\muse`,
    version: '1.3.0',
  },
  hasCliCredentialFile: true,
  delegationMode: 'off',
  hasStoredApiKey: false,
  hasEnvironmentApiKey: false,
  dictation: { isAvailable: true },
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
        'muse binary path configured: no; environment variables: 2',
        String.raw`muse cli: found in C:\Users\r\AppData\Local\Programs\muse (version 1.3.0)`,
        'muse subagent delegation: off',
        'cli credential file: yes; stored model api key: no; META_API_KEY in environment: no',
        'voice dictation: available',
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
})
