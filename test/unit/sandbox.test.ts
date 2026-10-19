import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExecutable } from '../../src/core/executables'
import type { MuseLaunch } from '../../src/core/backends/musecode/launch'
import {
  elevatedInvocation,
  isLinuxSandboxBlocked,
  isProfileWorkspace,
  museCliInvocation,
  parseLinuxSandboxProbe,
  parseSandboxCheck,
  probeLinuxSandboxShell,
  resolveShellSandbox,
  sandboxAvailabilityWarning,
  sandboxCheckInvocation,
  sandboxSetupInvocation,
  serveArguments,
  isSandboxNetworkApplied,
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
  serveArgs: ['serve'],
  installDir: String.raw`C:\Users\randy\AppData\Local\Programs\muse`,
  cliPath: String.raw`C:\Users\randy\AppData\Local\Programs\muse\muse.cmd`,
}

const launcherLaunch: MuseLaunch = {
  command: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'launcher.ps1', 'serve'],
  serveArgs: ['serve'],
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
    // A host started without the sandbox still swaps its whole serve tail.
    const unsandboxed = {
      ...exeLaunch,
      args: ['serve', '--disable-sandbox'],
      serveArgs: ['serve', '--disable-sandbox'],
    }
    expect(sandboxCheckInvocation(unsandboxed).args).toEqual(['sandbox', 'windows', 'check'])
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

describe('sandboxAvailabilityWarning', () => {
  const on = { isSandboxed: true, reason: 'setting', isUnsupportedWorkspace: false } as const
  const off = { isSandboxed: false, reason: 'setting', isUnsupportedWorkspace: false } as const

  it('warns with the host reason when a sandboxed window meets an unavailable host', () => {
    const warning = sandboxAvailabilityWarning(on, {
      availability: 'unavailable',
      unavailableReason: 'sandbox users are not ready',
    })
    expect(warning).toContain('unavailable')
    expect(warning).toContain('sandbox users are not ready')
  })

  it('warns generically when the host sends no reason, and never invents one', () => {
    const warning = sandboxAvailabilityWarning(on, {
      availability: 'unavailable',
      unavailableReason: undefined,
    })
    expect(warning).toContain('unavailable')
    expect(warning).not.toContain('undefined')
  })

  it('stays silent when enforcement is available, unknown, off, or from the future', () => {
    expect(
      sandboxAvailabilityWarning(on, { availability: 'available', unavailableReason: undefined }),
    ).toBeUndefined()
    // Older hosts predate the field: unknown reads as unknown, never as unavailable.
    expect(
      sandboxAvailabilityWarning(on, { availability: undefined, unavailableReason: undefined }),
    ).toBeUndefined()
    expect(
      sandboxAvailabilityWarning(on, {
        availability: 'something_new',
        unavailableReason: undefined,
      }),
    ).toBeUndefined()
    // The sandbox-off path already warns on its own; no second warning here.
    expect(
      sandboxAvailabilityWarning(off, {
        availability: 'unavailable',
        unavailableReason: 'sandbox users are not ready',
      }),
    ).toBeUndefined()
  })
})

describe('isProfileWorkspace', () => {
  const profile = String.raw`C:\Users\randy`

  it('is true for a Windows workspace under the profile, whatever the case', () => {
    expect(isProfileWorkspace('win32', String.raw`c:\users\RANDY\Coding\x`, profile)).toBe(true)
    expect(isProfileWorkspace('win32', String.raw`C:\Users\randy`, profile)).toBe(true)
  })

  it('is false outside the profile, for a sibling prefix, and off Windows', () => {
    expect(isProfileWorkspace('win32', String.raw`C:\src\x`, profile)).toBe(false)
    expect(isProfileWorkspace('win32', String.raw`C:\Users\randy2\x`, profile)).toBe(false)
    expect(isProfileWorkspace('linux', '/home/randy/x', undefined)).toBe(false)
  })
})

describe('resolveShellSandbox', () => {
  const windows = {
    platform: 'win32' as const,
    userProfileDir: String.raw`C:\Users\randy`,
  }

  // #26 holds for every version so far: 1.4.2 ran a sandboxed command in a
  // profile workspace on one machine and never finished it on a fresh rig
  // (musecode-write-asks, 2026-10-04).
  it('turns the sandbox off for a Windows profile workspace under auto, and on elsewhere', () => {
    expect(
      resolveShellSandbox({
        ...windows,
        mode: 'auto',
        workspaceRoot: String.raw`c:\users\RANDY\Coding\x`,
      }),
    ).toEqual({ isSandboxed: false, reason: 'profileWorkspace', isUnsupportedWorkspace: true })
    expect(
      resolveShellSandbox({ ...windows, mode: 'auto', workspaceRoot: String.raw`C:\src\x` }),
    ).toEqual({ isSandboxed: true, reason: 'default', isUnsupportedWorkspace: false })
    expect(resolveShellSandbox({ ...windows, mode: 'auto', workspaceRoot: undefined })).toEqual({
      isSandboxed: true,
      reason: 'default',
      isUnsupportedWorkspace: false,
    })
    expect(
      resolveShellSandbox({
        mode: 'auto',
        platform: 'linux',
        userProfileDir: undefined,
        workspaceRoot: '/home/randy/x',
      }),
    ).toEqual({ isSandboxed: true, reason: 'default', isUnsupportedWorkspace: false })
  })

  it('obeys an explicit setting on any platform, and says where the sandbox may not run', () => {
    const profile = String.raw`C:\Users\randy\x`
    expect(resolveShellSandbox({ ...windows, mode: 'muse', workspaceRoot: profile })).toEqual({
      isSandboxed: true,
      reason: 'setting',
      isUnsupportedWorkspace: true,
    })
    expect(
      resolveShellSandbox({ ...windows, mode: 'muse', workspaceRoot: String.raw`C:\src\x` }),
    ).toEqual({ isSandboxed: true, reason: 'setting', isUnsupportedWorkspace: false })
    expect(
      resolveShellSandbox({ ...windows, mode: 'off', workspaceRoot: String.raw`C:\src\x` }),
    ).toEqual({
      isSandboxed: false,
      reason: 'setting',
      isUnsupportedWorkspace: false,
    })
  })

  it('maps the posture and the workspace trust onto the serve arguments', () => {
    expect(
      serveArguments(
        { isSandboxed: true, reason: 'default', isUnsupportedWorkspace: false },
        true,
        'default',
      ),
    ).toEqual(['serve', '--trust-workspace'])
    expect(
      serveArguments(
        { isSandboxed: false, reason: 'setting', isUnsupportedWorkspace: false },
        true,
        'default',
      ),
    ).toEqual(['serve', '--disable-sandbox', '--trust-workspace'])
    // Restricted Mode: no rules, no skills, no workspace shell (PLAN.md D13).
    expect(
      serveArguments(
        { isSandboxed: true, reason: 'default', isUnsupportedWorkspace: false },
        false,
        'default',
      ),
    ).toEqual(['serve', '--disable-shell'])
    expect(
      serveArguments(
        { isSandboxed: false, reason: 'profileWorkspace', isUnsupportedWorkspace: true },
        false,
        'default',
      ),
    ).toEqual(['serve', '--disable-sandbox', '--disable-shell'])
  })

  // M56 (PLAN.md D43): `muse serve --help` names restricted|enabled|proxy-only.
  it('passes the sandbox network mode while the sandbox is on, and only then', () => {
    const sandboxed = {
      isSandboxed: true,
      reason: 'default',
      isUnsupportedWorkspace: false,
    } as const
    for (const mode of ['proxy-only', 'restricted', 'enabled'] as const) {
      expect(serveArguments(sandboxed, true, mode)).toEqual([
        'serve',
        '--sandbox-network',
        mode,
        '--trust-workspace',
      ])
      expect(isSandboxNetworkApplied(mode, sandboxed)).toBe(true)
    }
    expect(serveArguments(sandboxed, false, 'restricted')).toEqual([
      'serve',
      '--sandbox-network',
      'restricted',
      '--disable-shell',
    ])
    // Without the sandbox Muse Code ignores the flag (it says so on stderr).
    const unsandboxed = {
      isSandboxed: false,
      reason: 'profileWorkspace',
      isUnsupportedWorkspace: true,
    } as const
    expect(serveArguments(unsandboxed, true, 'restricted')).toEqual([
      'serve',
      '--disable-sandbox',
      '--trust-workspace',
    ])
    expect(isSandboxNetworkApplied('restricted', unsandboxed)).toBe(false)
    // `default` leaves Muse Code's own default or a managed configuration's.
    expect(isSandboxNetworkApplied('default', sandboxed)).toBe(false)
  })
})

// Verbatim `bwrap --unshare-user -- /bin/true` output, measured 2026-10-15 on
// the linuxlt rig (bubblewrap 0.11.0, exit 1): the kernel refuses the user
// namespace, which is the same refusal Muse Code's Linux sandbox meets (F91).
const BWRAP_NAMESPACE_REFUSED = [
  'bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.',
  '',
].join('\n')

describe('parseLinuxSandboxProbe', () => {
  it('reads a started user namespace as a sandbox that can start', () => {
    expect(parseLinuxSandboxProbe({ exitCode: 0, stderr: '' })).toEqual({
      canStart: true,
      reason: undefined,
      detail: undefined,
    })
  })

  it('reads the kernel refusing the user namespace as blocked namespaces', () => {
    expect(parseLinuxSandboxProbe({ exitCode: 1, stderr: BWRAP_NAMESPACE_REFUSED })).toEqual({
      canStart: false,
      reason: 'userNamespacesBlocked',
      detail:
        'bwrap: No permissions to create new namespace, likely because the kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap> or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.',
    })
  })

  it('reads a bwrap that never ran as a failed probe, without guessing why', () => {
    expect(parseLinuxSandboxProbe({ exitCode: undefined, stderr: '' })).toEqual({
      canStart: false,
      reason: 'bwrapFailed',
      detail: undefined,
    })
  })

  it('keeps another bwrap failure as failed, with its own first line', () => {
    expect(
      parseLinuxSandboxProbe({
        exitCode: 1,
        stderr: '\nbwrap: Cannot mkdir /run: permission denied\n',
      }),
    ).toEqual({
      canStart: false,
      reason: 'bwrapFailed',
      detail: 'bwrap: Cannot mkdir /run: permission denied',
    })
  })
})

// Only the kernel refusing the user namespace proves Muse Code's sandbox
// cannot start, whichever bwrap it runs; its own message names an embedded
// fallback, so a missing or otherwise failing system bwrap must never be
// said as cannot-start (RVSANDBOXSAY).
describe('isLinuxSandboxBlocked', () => {
  it('holds only for the proven user-namespace refusal', () => {
    expect(
      isLinuxSandboxBlocked({
        canStart: false,
        reason: 'userNamespacesBlocked',
        detail: 'bwrap: No permissions to create new namespace, likely because …',
      }),
    ).toBe(true)
    expect(
      isLinuxSandboxBlocked({ canStart: false, reason: 'bwrapFailed', detail: 'bwrap: ENOENT' }),
    ).toBe(false)
    expect(isLinuxSandboxBlocked({ canStart: true, reason: undefined, detail: undefined })).toBe(
      false,
    )
    expect(isLinuxSandboxBlocked(undefined)).toBe(false)
  })
})

// The probe itself, against the machine's real bwrap (or its real absence).
// The verdict depends on the machine, so this asserts only what must hold
// everywhere: the promise resolves (never throws, never hangs past its
// budget) and the shape is coherent. The success path needs a machine where
// unprivileged user namespaces work (the lead's real-life scenario 4); the
// argument list that makes success possible at all (--ro-bind / / into
// bwrap's otherwise empty root, RVSANDBOXSAY P1) is exercised here either
// way, because the refusal measured on blocked rigs happens after it.
describe('probeLinuxSandboxShell', () => {
  it('resolves with a coherent readiness against the real bwrap', async () => {
    const readiness = await probeLinuxSandboxShell()
    if (readiness.canStart) {
      expect(readiness.reason).toBeUndefined()
      expect(readiness.detail).toBeUndefined()
    } else {
      expect(['userNamespacesBlocked', 'bwrapFailed']).toContain(readiness.reason)
    }
  })

  // The planted-binary refusal, against the machine's own bwrap: where the
  // real binary resolves, its own folder as the workspace refuses the probe
  // without spawning; where nothing resolves, the probe is refused the same
  // way. Either way nothing inside the workspace runs.
  it('refuses a bwrap resolved inside the workspace without spawning', async () => {
    const resolved = resolveExecutable('bwrap', {
      platform: process.platform,
      pathVariable: process.env['PATH'],
      fileExists: existsSync,
    })
    const readiness = await probeLinuxSandboxShell(
      resolved === undefined ? path.sep : path.dirname(resolved),
    )
    expect(readiness.canStart).toBe(false)
    expect(readiness.reason).toBe('bwrapFailed')
    // The detail reaches the Diagnostics report, which a person may paste
    // into a public issue: it must never carry the resolved path (a
    // workspace path under their profile), only fixed words.
    if (resolved === undefined) {
      return
    }

    expect(readiness.detail).not.toContain(resolved)
    expect(readiness.detail).not.toContain(path.dirname(resolved))
  })
})
