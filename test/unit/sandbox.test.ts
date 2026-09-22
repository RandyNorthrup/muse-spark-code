import { describe, expect, it } from 'vitest'
import type { MuseLaunch } from '../../src/core/backends/musecode/launch'
import {
  elevatedInvocation,
  isProfileWorkspaceLimited,
  isVersionAtMost,
  museCliInvocation,
  parseSandboxCheck,
  sandboxCheckInvocation,
  sandboxSetupInvocation,
} from '../../src/core/backends/musecode/sandbox'

// Verbatim `muse sandbox windows check` output, 2026-09-22 (Muse Code 1.3.0),
// before and after the elevated setup on the owner's machine.
const SETUP_REQUIRED = [
  'backend=windows_elevated',
  'status=setup_required',
  'reason=sandbox users are not ready',
  String.raw`runner_path=C:\Users\randy\AppData\Local\Programs\muse\muse-bin-1.3.0-R3401.1.exe`,
  'runner_trusted=true',
  'sandbox_users_ready=false',
  'diagnostic=sandbox_users_missing:required Windows sandbox users are missing or stale',
  String.raw`diagnostic=setup_credentials_unavailable:open setup path without following reparse points failed for C:\ProgramData\muse: The system cannot find the file specified. (os error 2)`,
  'sandbox users are not ready',
].join('\r\n')

const READY = ['backend=windows_elevated', 'status=ready', 'wfp_ready=true'].join('\n')

const exeLaunch: MuseLaunch = {
  command: String.raw`C:\Users\randy\AppData\Local\Programs\muse\muse-bin-1.3.0-R3401.1.exe`,
  args: ['serve'],
  installDir: String.raw`C:\Users\randy\AppData\Local\Programs\muse`,
  cliPath: String.raw`C:\Users\randy\AppData\Local\Programs\muse\muse.cmd`,
}

const launcherLaunch: MuseLaunch = {
  command: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'launcher.ps1', 'serve'],
  installDir: 'dir',
  cliPath: 'dir/muse.cmd',
}

describe('parseSandboxCheck', () => {
  it('reads status, reason and every diagnostic from the setup_required report', () => {
    const report = parseSandboxCheck(SETUP_REQUIRED)
    expect(report.status).toBe('setup_required')
    expect(report.reason).toBe('sandbox users are not ready')
    expect(report.diagnostics).toHaveLength(2)
    expect(report.diagnostics[0]).toContain('sandbox_users_missing')
    // A value containing '=' keeps everything after the first separator.
    expect(report.diagnostics[1]).toContain('(os error 2)')
  })

  it('reads a ready report without reason or diagnostics', () => {
    expect(parseSandboxCheck(READY)).toEqual({
      status: 'ready',
      reason: undefined,
      diagnostics: [],
    })
  })

  it('reports unknown for an unrecognised status or no report at all', () => {
    expect(parseSandboxCheck('status=something_new').status).toBe('unknown')
    expect(parseSandboxCheck('').status).toBe('unknown')
    expect(parseSandboxCheck('=orphan\nno separator').status).toBe('unknown')
  })
})

describe('museCliInvocation', () => {
  it('swaps serve for the sandbox commands on the direct exe launch', () => {
    expect(sandboxCheckInvocation(exeLaunch)).toEqual({
      command: exeLaunch.command,
      args: ['sandbox', 'windows', 'check'],
    })
    expect(sandboxSetupInvocation(exeLaunch)).toEqual({
      command: exeLaunch.command,
      args: ['sandbox', 'windows', 'setup'],
    })
  })

  it('keeps the PowerShell launcher prefix', () => {
    expect(sandboxCheckInvocation(launcherLaunch).args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'launcher.ps1',
      'sandbox',
      'windows',
      'check',
    ])
  })

  it('refuses a launch that does not end with serve', () => {
    expect(() => museCliInvocation({ ...exeLaunch, args: ['exec'] }, ['x'])).toThrow(
      'does not end with serve',
    )
  })
})

describe('elevatedInvocation', () => {
  it('relaunches the target through Start-Process -Verb RunAs and forwards its exit code', () => {
    const invocation = elevatedInvocation(String.raw`C:\Windows`, sandboxSetupInvocation(exeLaunch))
    expect(invocation.command).toBe(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    )
    expect(invocation.args.slice(0, -1)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
    ])
    expect(invocation.args.at(-1)).toBe(
      String.raw`$process = Start-Process -FilePath 'C:\Users\randy\AppData\Local\Programs\muse\muse-bin-1.3.0-R3401.1.exe' -ArgumentList @('sandbox','windows','setup') -Verb RunAs -Wait -PassThru; exit $process.ExitCode`,
    )
  })

  it('doubles single quotes so a path with an apostrophe cannot break out of the literal', () => {
    const invocation = elevatedInvocation('C:', {
      command: String.raw`C:\Users\o'brien\muse.exe`,
      args: ["it's"],
    })
    expect(invocation.args.at(-1)).toContain(String.raw`-FilePath 'C:\Users\o''brien\muse.exe'`)
    expect(invocation.args.at(-1)).toContain("@('it''s')")
  })
})

describe('isVersionAtMost', () => {
  it.each([
    ['1.3.0', '1.3.0', true],
    ['1.3.0-R3401.1', '1.3.0', true],
    ['1.2.9', '1.3.0', true],
    ['0.9.99', '1.3.0', true],
    ['1.3.1', '1.3.0', false],
    ['1.10.0', '1.3.0', false],
    ['2.0.0', '1.3.0', false],
    ['1.3', '1.3.0', false],
    ['dev', '1.3.0', false],
  ])('%s at most %s is %s', (version, limit, expected) => {
    expect(isVersionAtMost(version, limit)).toBe(expected)
  })
})

describe('isProfileWorkspaceLimited', () => {
  const probe = {
    platform: 'win32' as const,
    userProfileDir: String.raw`C:\Users\randy`,
    serverVersion: '1.3.0',
  }

  it('is limited for a workspace under the profile on an affected version, whatever the case', () => {
    expect(
      isProfileWorkspaceLimited({ ...probe, workspaceRoot: String.raw`c:\users\RANDY\Coding\x` }),
    ).toBe(true)
    expect(isProfileWorkspaceLimited({ ...probe, workspaceRoot: String.raw`C:\Users\randy` })).toBe(
      true,
    )
  })

  it('is not limited outside the profile, for a sibling prefix, off Windows, or on a later CLI', () => {
    expect(isProfileWorkspaceLimited({ ...probe, workspaceRoot: String.raw`C:\src\x` })).toBe(false)
    expect(
      isProfileWorkspaceLimited({ ...probe, workspaceRoot: String.raw`C:\Users\randy2\x` }),
    ).toBe(false)
    expect(
      isProfileWorkspaceLimited({
        ...probe,
        platform: 'linux',
        userProfileDir: undefined,
        workspaceRoot: '/home/randy/x',
      }),
    ).toBe(false)
    expect(
      isProfileWorkspaceLimited({
        ...probe,
        serverVersion: '1.4.0',
        workspaceRoot: String.raw`C:\Users\randy\x`,
      }),
    ).toBe(false)
  })
})
