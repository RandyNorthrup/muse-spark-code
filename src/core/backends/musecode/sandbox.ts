// Muse Code's OS sandbox for shell tools. On Windows the CLI needs a one-time
// elevated `muse sandbox windows setup` (it creates the local sandbox users,
// their capabilities and a Windows Filtering Platform rule under
// C:\ProgramData\muse); until then every shell tool call fails with
// "sandbox enforcement unavailable". `muse sandbox windows check` prints
// `key=value` lines and exits 1 while setup is required (verified 2026-09-22
// on Muse Code 1.3.0). Linux and macOS have no sandbox subcommand and need no
// setup. The posture, invocation and parsing helpers here are pure and the
// host runs the processes they describe; the one exception is
// probeLinuxSandboxShell (F91), which runs the fixed bwrap probe itself so
// every host measures the sandbox the same way.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveExecutable } from '../../executables'
import {
  LINUX_SANDBOX_NAMESPACE_MARKER,
  LINUX_SANDBOX_PROBE_ARGS,
  LINUX_SANDBOX_PROBE_COMMAND,
  LINUX_SANDBOX_PROBE_TIMEOUT_MS,
  MUSE_CONTRIBUTOR_MODE_ARG,
  MUSE_CONTRIBUTOR_MODE_ON,
  MUSE_DISABLE_SANDBOX_ARG,
  MUSE_DISABLE_SHELL_ARG,
  MUSE_SANDBOX_CHECK_ARGS,
  MUSE_SANDBOX_NETWORK_ARG,
  MUSE_SANDBOX_SETUP_ARGS,
  MUSE_SERVE_ARGS,
  MUSE_TRUST_WORKSPACE_ARG,
  type SandboxNetworkMode,
  SANDBOX_STATUS_READY,
  SANDBOX_STATUS_SETUP_REQUIRED,
  type ShellSandboxMode,
  WINDOWS_POWERSHELL_COMMAND_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../../shared/constants'
import type { MuseLaunch } from './launch'

const SANDBOX_STATUS_UNKNOWN = 'unknown'

export type SandboxStatus =
  typeof SANDBOX_STATUS_READY | typeof SANDBOX_STATUS_SETUP_REQUIRED | typeof SANDBOX_STATUS_UNKNOWN

export interface SandboxCheck {
  readonly status: SandboxStatus
  /** The CLI's `reason=` line, present while setup is required. */
  readonly reason: string | undefined
  /** The `diagnostic=` lines, one per finding. */
  readonly diagnostics: readonly string[]
}

export interface CliInvocation {
  readonly command: string
  readonly args: readonly string[]
}

const STATUS_KEY = 'status'
const REASON_KEY = 'reason'
const DIAGNOSTIC_KEY = 'diagnostic'
const LINE_BREAK = /\r?\n/
const KEY_VALUE_SEPARATOR = '='

function toStatus(value: string): SandboxStatus {
  return value === SANDBOX_STATUS_READY || value === SANDBOX_STATUS_SETUP_REQUIRED
    ? value
    : SANDBOX_STATUS_UNKNOWN
}

interface SandboxCheckDraft {
  status: SandboxStatus
  reason: string | undefined
  readonly diagnostics: string[]
}

/** Folds one `key=value` line into the draft; lines without a key are noise. */
function applyReportLine(draft: SandboxCheckDraft, line: string): void {
  const separator = line.indexOf(KEY_VALUE_SEPARATOR)
  if (separator <= 0) {
    return
  }
  const key = line.slice(0, separator).trim()
  const value = line.slice(separator + 1).trim()
  switch (key) {
    case STATUS_KEY: {
      draft.status = toStatus(value)
      break
    }
    case REASON_KEY: {
      draft.reason = value
      break
    }
    case DIAGNOSTIC_KEY: {
      draft.diagnostics.push(value)
      break
    }
    default: {
      break
    }
  }
}

/** Parses the `key=value` report of `muse sandbox windows check`. */
export function parseSandboxCheck(output: string): SandboxCheck {
  const draft: SandboxCheckDraft = {
    status: SANDBOX_STATUS_UNKNOWN,
    reason: undefined,
    diagnostics: [],
  }
  for (const line of output.split(LINE_BREAK)) {
    applyReportLine(draft, line)
  }
  return draft
}

/**
 * The CLI the backend spawns, running `args` instead of its `serve …`
 * arguments. Keeps the PowerShell-launcher prefix when the resolver fell
 * back to it.
 */
export function museCliInvocation(launch: MuseLaunch, args: readonly string[]): CliInvocation {
  const prefixLength = launch.args.length - launch.serveArgs.length
  const suffix = launch.args.slice(prefixLength)
  if (suffix.join(' ') !== launch.serveArgs.join(' ')) {
    throw new Error(`Muse launch does not end with ${launch.serveArgs.join(' ')}`)
  }
  return { command: launch.command, args: [...launch.args.slice(0, prefixLength), ...args] }
}

export function sandboxCheckInvocation(launch: MuseLaunch): CliInvocation {
  return museCliInvocation(launch, MUSE_SANDBOX_CHECK_ARGS)
}

export function sandboxSetupInvocation(launch: MuseLaunch): CliInvocation {
  return museCliInvocation(launch, MUSE_SANDBOX_SETUP_ARGS)
}

/** Why Muse Code's Linux sandbox cannot start here, as the probe measured. */
export type LinuxSandboxBlockReason = 'userNamespacesBlocked' | 'bwrapFailed'

export interface LinuxSandboxProbeRun {
  /** The probe's exit code; undefined when `bwrap` never ran (missing, refused). */
  readonly exitCode: number | undefined
  /** The probe's stderr, as captured. */
  readonly stderr: string
}

export interface LinuxSandboxReadiness {
  readonly canStart: boolean
  /** The measured cause while it cannot start; absent while it can. */
  readonly reason: LinuxSandboxBlockReason | undefined
  /**
   * The probe's own words: bwrap's first stderr line, or how the spawn
   * itself failed. Fixed words for the log; the notice stays UI_TEXT.
   */
  readonly detail: string | undefined
}

/**
 * Reads one finished `bwrap` probe run (LINUX_SANDBOX_PROBE_*): exit 0
 * starts a user namespace, so the sandbox can start; the namespace marker
 * is the kernel or an outer sandbox refusing it (the one proven
 * cannot-start: isLinuxSandboxBlocked); anything else is a system-bwrap
 * measurement that failed, with the probe's own first line as the detail.
 */
export function parseLinuxSandboxProbe(run: LinuxSandboxProbeRun): LinuxSandboxReadiness {
  if (run.exitCode === 0) {
    return { canStart: true, reason: undefined, detail: undefined }
  }
  const firstLine = run.stderr.split(LINE_BREAK).find((line) => line.trim() !== '')
  return {
    canStart: false,
    reason: run.stderr.includes(LINUX_SANDBOX_NAMESPACE_MARKER)
      ? 'userNamespacesBlocked'
      : 'bwrapFailed',
    detail: firstLine,
  }
}

/**
 * Whether the probe PROVED Muse Code's Linux sandbox cannot start here.
 * Only the kernel (or an outer sandbox) refusing the user namespace proves
 * that, whichever bwrap Muse Code ends up running: its own message names a
 * capability-valid system bwrap "and no usable embedded fallback", so a
 * missing or otherwise failing system bwrap leaves the embedded fallback
 * unmeasured. Surfaces may say "cannot start" (and name the user-namespace
 * cause, as UI_TEXT.sandboxCannotStartNotice and the model note do) only
 * where this holds; a `bwrapFailed` readiness is a failed measurement of
 * the system bwrap, fit for Diagnostics, not for that claim.
 */
export function isLinuxSandboxBlocked(readiness: LinuxSandboxReadiness | undefined): boolean {
  return readiness?.canStart === false && readiness.reason === 'userNamespacesBlocked'
}

/**
 * Runs the Linux capability probe: the same `bwrap` user-namespace
 * mechanism Muse Code's sandbox uses, minimally. Never throws: a probe that
 * cannot run (no bwrap on PATH, a refused spawn, a timeout) resolves as
 * `bwrapFailed` with how the spawn failed as the detail (not proof the
 * sandbox cannot start: see isLinuxSandboxBlocked). The host runs this once
 * per start, only while sandboxed on Linux.
 *
 * The probe binary is resolved with `resolveExecutable` (absolute PATH
 * entries only, SECURITY.md "Programs the extension starts"): a bare
 * `bwrap` name would search an empty or relative PATH entry — the working
 * directory, the workspace — so an executable a repository plants could run
 * as the editor user before any command approval. A binary that does not
 * resolve, or resolves inside the workspace, is refused as `bwrapFailed`
 * without spawning anything.
 */
export function probeLinuxSandboxShell(workspaceRoot?: string): Promise<LinuxSandboxReadiness> {
  const command = resolveExecutable(LINUX_SANDBOX_PROBE_COMMAND, {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: existsSync,
  })
  if (
    command === undefined ||
    (workspaceRoot !== undefined && isInsideDirectory(workspaceRoot, command))
  ) {
    return Promise.resolve({
      canStart: false,
      reason: 'bwrapFailed',
      // Fixed words only: the detail reaches the Diagnostics report (and
      // the log that carries it), which may be pasted into a public issue,
      // so it never carries the resolved path — a workspace path under the
      // person's profile (AGENTS.md rule 8).
      detail:
        command === undefined
          ? `${LINUX_SANDBOX_PROBE_COMMAND}: not found on absolute PATH entries`
          : `${LINUX_SANDBOX_PROBE_COMMAND}: inside the workspace, refused`,
    })
  }
  return new Promise((resolve) => {
    execFile(
      command,
      [...LINUX_SANDBOX_PROBE_ARGS],
      { timeout: LINUX_SANDBOX_PROBE_TIMEOUT_MS, windowsHide: true },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve({ canStart: true, reason: undefined, detail: undefined })
          return
        }
        const code = 'code' in error ? error.code : undefined
        if (typeof code === 'number') {
          resolve(parseLinuxSandboxProbe({ exitCode: code, stderr }))
          return
        }
        resolve({
          canStart: false,
          reason: 'bwrapFailed',
          // The spawn error's message embeds the resolved absolute path;
          // only its code word may reach the detail (see above).
          detail: `${LINUX_SANDBOX_PROBE_COMMAND}: ${typeof code === 'string' ? code : 'the probe could not be started'}`,
        })
      },
    )
  })
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const root = path.win32.resolve(directory).toLowerCase()
  const target = path.win32.resolve(candidate).toLowerCase()
  return target === root || target.startsWith(`${root}${path.win32.sep}`)
}

/**
 * A Windows workspace under `C:\Users\<user>`, where Muse Code's sandbox does
 * not reliably run shell commands (meta-models/muse-code-sdk#26). 1.3.0 and
 * 1.4.0 started them in PowerShell's own folder (verified live on 2026-09-22
 * and 2026-09-27). 1.4.2-R4684.1 ran them in place on the owner's machine,
 * but on a freshly set-up Windows 11 rig its sandboxed command never
 * finished, even after Muse Code's read-access worker had run (2026-10-04,
 * docs/certification/musecode-write-asks.md). So this holds for every
 * version until one is verified on a fresh setup.
 */
export function isProfileWorkspace(
  platform: NodeJS.Platform,
  workspaceRoot: string,
  userProfileDir: string | undefined,
): boolean {
  return (
    platform === 'win32' &&
    userProfileDir !== undefined &&
    isInsideDirectory(userProfileDir, workspaceRoot)
  )
}

export interface ShellSandboxProbe {
  /** `museSpark.shellSandbox`. */
  readonly mode: ShellSandboxMode
  readonly platform: NodeJS.Platform
  readonly workspaceRoot: string | undefined
  readonly userProfileDir: string | undefined
}

/**
 * Why the sandbox is on or off: the setting said so, `auto` turned it off
 * for a Windows profile workspace, or nothing spoke and the CLI default
 * (sandbox on) stands.
 */
export type ShellSandboxReason = 'setting' | 'profileWorkspace' | 'default'

export interface ShellSandboxPosture {
  readonly isSandboxed: boolean
  readonly reason: ShellSandboxReason
  /**
   * A Windows profile workspace (#26): the sandbox, when the setting forces
   * it on, may start commands in PowerShell's folder here or never finish them.
   */
  readonly isUnsupportedWorkspace: boolean
}

export interface SandboxAvailabilityReport {
  /** `sandboxAvailability` from the `initialize` result; unknown on older hosts. */
  readonly availability: string | undefined
  /** `sandboxUnavailableReason`; sent only while unavailable, never inferred. */
  readonly unavailableReason: string | undefined
}

/**
 * What the backend manager warns after the handshake (PR206W1 T10): the
 * window asked for the sandbox but this host cannot enforce it. Available
 * and unknown (older hosts predate the field) stay silent, as does a
 * window that turned the sandbox off (its own warning already fired).
 */
export function sandboxAvailabilityWarning(
  posture: ShellSandboxPosture,
  report: SandboxAvailabilityReport,
): string | undefined {
  // The known words are the SDK's `SandboxAvailability` (1.4.7); a future
  // word reads as unknown, never as unavailable.
  if (!posture.isSandboxed || report.availability !== 'unavailable') {
    return undefined
  }
  return report.unavailableReason === undefined
    ? 'muse serve reports the sandbox is unavailable on this host while the shell sandbox is on: commands run without sandbox enforcement'
    : `muse serve reports the sandbox is unavailable on this host while the shell sandbox is on (${report.unavailableReason}): commands run without sandbox enforcement`
}

/** The `muse serve` posture for this window (fixed for the host's lifetime). */
export function resolveShellSandbox(probe: ShellSandboxProbe): ShellSandboxPosture {
  const isUnsupportedWorkspace =
    probe.workspaceRoot !== undefined &&
    isProfileWorkspace(probe.platform, probe.workspaceRoot, probe.userProfileDir)
  if (probe.mode === 'muse') {
    return { isSandboxed: true, reason: 'setting', isUnsupportedWorkspace }
  }
  if (probe.mode === 'off') {
    return { isSandboxed: false, reason: 'setting', isUnsupportedWorkspace }
  }
  return isUnsupportedWorkspace
    ? { isSandboxed: false, reason: 'profileWorkspace', isUnsupportedWorkspace }
    : { isSandboxed: true, reason: 'default', isUnsupportedWorkspace }
}

/**
 * Whether `museSpark.sandboxNetwork` reaches the host (M56, PLAN.md D43):
 * a mode other than `default`, while the shell sandbox is on. Without the
 * sandbox Muse Code ignores the flag ("--disable-sandbox turns the sandbox
 * off entirely, so no sandbox network policy applies", captured 2026-09-25)
 * and commands have the network the user has.
 */
export function isSandboxNetworkApplied(
  mode: SandboxNetworkMode,
  posture: ShellSandboxPosture,
): boolean {
  return mode !== 'default' && posture.isSandboxed
}

/**
 * The `serve` arguments that install `posture`, the sandbox's network and
 * the workspace's trust on the host. A trusted workspace loads its rules and
 * skills (Muse Code's `--trust-workspace`); an untrusted one gets no rules,
 * no skills and no workspace shell, VS Code's Restricted Mode contract
 * (PLAN.md D13). `isContributorMode` is the person's own Muse Code settings
 * (`contributor_mode_enabled`); absent reads as off, never defaulted on.
 */
export function serveArguments(
  posture: ShellSandboxPosture,
  isWorkspaceTrusted: boolean,
  network: SandboxNetworkMode,
  isContributorMode = false,
): readonly string[] {
  return [
    ...MUSE_SERVE_ARGS,
    ...(posture.isSandboxed ? [] : [MUSE_DISABLE_SANDBOX_ARG]),
    ...(isSandboxNetworkApplied(network, posture) ? [MUSE_SANDBOX_NETWORK_ARG, network] : []),
    ...(isContributorMode ? [MUSE_CONTRIBUTOR_MODE_ARG, MUSE_CONTRIBUTOR_MODE_ON] : []),
    isWorkspaceTrusted ? MUSE_TRUST_WORKSPACE_ARG : MUSE_DISABLE_SHELL_ARG,
  ]
}

/** A PowerShell single-quoted literal; the only escape is a doubled quote. */
function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Runs `target` through Windows PowerShell's `Start-Process -Verb RunAs`, the
 * UAC prompt, and waits for it. The elevated process's exit code becomes the
 * PowerShell exit code; a declined prompt makes `Start-Process` throw, which
 * `-NonInteractive` turns into exit code 1. Its output is not capturable
 * across the elevation boundary, so the caller re-runs the check afterwards.
 */
export function elevatedInvocation(systemRoot: string, target: CliInvocation): CliInvocation {
  const argumentList = target.args.map((argument) => powerShellLiteral(argument)).join(',')
  const script = [
    `$process = Start-Process -FilePath ${powerShellLiteral(target.command)}`,
    `-ArgumentList @(${argumentList}) -Verb RunAs -Wait -PassThru;`,
    'exit $process.ExitCode',
  ].join(' ')
  return {
    command: path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
    args: [...WINDOWS_POWERSHELL_COMMAND_ARGS, script],
  }
}
