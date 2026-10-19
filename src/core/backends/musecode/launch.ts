// Locating the Muse Code CLI and shaping the child process per platform.
// Pure: every filesystem and environment fact is injected, so the Windows,
// macOS and Linux branches are all unit-tested on any OS (PLAN.md D1a).
//
// Verified layouts (Muse Code 1.3.0, 2026-09-22):
//   Windows  %LOCALAPPDATA%\Programs\muse\  muse.cmd, .muse-launcher.ps1,
//            .muse-version, muse-bin-<version>.exe
//   POSIX    ~/.local/bin/                   muse (bash launcher),
//            .muse-version, muse-bin-<version>
// Node refuses to spawn a .cmd without a shell, and a shell string is banned,
// so on Windows the resolver targets muse-bin-<version>.exe directly: the one
// `.muse-version` names, else the newest `muse-bin-*.exe` in the folder. The
// PowerShell launcher is never the command (PLAN.md D25): Windows can only
// end the direct child, so closing a launcher left muse-bin running.

import path from 'node:path'
import type { EnvironmentVariable } from '../../../shared/constants'
import {
  LOOPBACK_NO_PROXY_ENTRIES,
  MUSE_BIN_PREFIX,
  MUSE_CMD_FILE,
  MUSE_CREDENTIAL_FILE_SEGMENTS,
  MUSE_POSIX_EXECUTABLE,
  MUSE_POSIX_INSTALL_SEGMENTS,
  MUSE_VERSION_FILE,
  MUSE_WINDOWS_EXE_SUFFIX,
  MUSE_WINDOWS_INSTALL_SEGMENTS,
  NO_PROXY_SEPARATOR,
  NO_PROXY_SPELLINGS,
  NO_PROXY_VARIABLE,
  PROXY_VARIABLE_SPELLINGS,
  UI_TEXT,
} from '../../../shared/constants'
import { type ExecutableScope } from '../../executables'
import { absoluteEntries, environmentValue, setEnvironmentVariable } from '../../execGuard'

export interface LaunchProbe {
  readonly platform: NodeJS.Platform
  /** `museSpark.museBinaryPath`; empty means discover. */
  readonly configuredPath: string
  /** Entries of the PATH variable, already split. */
  readonly pathEntries: readonly string[]
  readonly homeDir: string
  /** `%LOCALAPPDATA%` on Windows; undefined elsewhere. */
  readonly localAppData: string | undefined
  readonly fileExists: (filePath: string) => boolean
  /** Returns undefined when the file cannot be read. */
  readonly readTextFile: (filePath: string) => string | undefined
  /** The file names in a directory; empty when it cannot be read. */
  readonly listDirectory: (directory: string) => readonly string[]
  /** `serve` plus the host-posture flags (`serveArguments`, sandbox.ts). */
  readonly serveArgs: readonly string[]
  /**
   * The workspace the child runs in: PATH entries inside it are never
   * probed (resolved through links), so a planted `muse` on an absolute
   * workspace PATH entry never resolves. REQUIRED.
   */
  readonly scope: ExecutableScope
}

export interface MuseLaunch {
  readonly command: string
  readonly args: readonly string[]
  /** The trailing `serve …` part of `args`, for callers that swap it out. */
  readonly serveArgs: readonly string[]
  /** Directory the CLI was found in (for diagnostics and `muse login`). */
  readonly installDir: string
  /** The command a user-facing terminal should run (`muse.cmd` / `muse`). */
  readonly cliPath: string
}

export type LaunchResolution =
  | { readonly ok: true; readonly launch: MuseLaunch }
  | { readonly ok: false; readonly searched: readonly string[]; readonly reason: string }

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

function windowsCandidateDirs(probe: LaunchProbe, p: path.PlatformPath): string[] {
  const dirs: string[] = []
  if (probe.configuredPath !== '') {
    dirs.push(p.dirname(probe.configuredPath))
  }
  for (const entry of absoluteEntries(probe, p)) {
    if (probe.fileExists(p.join(entry, MUSE_CMD_FILE))) {
      dirs.push(entry)
    }
  }
  if (probe.localAppData !== undefined) {
    dirs.push(p.join(probe.localAppData, ...MUSE_WINDOWS_INSTALL_SEGMENTS))
  }
  return dirs
}

function resolveWindows(probe: LaunchProbe): LaunchResolution {
  const p = path.win32
  const searched: string[] = []
  if (probe.configuredPath.toLowerCase().endsWith(MUSE_WINDOWS_EXE_SUFFIX)) {
    if (probe.fileExists(probe.configuredPath)) {
      const installDir = p.dirname(probe.configuredPath)
      return {
        ok: true,
        launch: {
          command: probe.configuredPath,
          args: probe.serveArgs,
          serveArgs: probe.serveArgs,
          installDir,
          cliPath: p.join(installDir, MUSE_CMD_FILE),
        },
      }
    }
    searched.push(probe.configuredPath)
  }
  for (const dir of windowsCandidateDirs(probe, p)) {
    searched.push(dir)
    const exe = windowsExecutableIn(probe, p, dir)
    if (exe !== undefined) {
      return {
        ok: true,
        launch: {
          command: exe,
          args: probe.serveArgs,
          serveArgs: probe.serveArgs,
          installDir: dir,
          cliPath: p.join(dir, MUSE_CMD_FILE),
        },
      }
    }
  }
  return { ok: false, searched, reason: UI_TEXT.cliNotFound }
}

/**
 * The `muse-bin-<version>.exe` of an install folder: the version
 * `.muse-version` names, else the newest one present (version order, so
 * 1.10 beats 1.9); undefined when there is none.
 */
function windowsExecutableIn(
  probe: LaunchProbe,
  p: path.PlatformPath,
  dir: string,
): string | undefined {
  const version = probe.readTextFile(p.join(dir, MUSE_VERSION_FILE))?.trim()
  if (version !== undefined && version !== '') {
    const named = p.join(dir, `${MUSE_BIN_PREFIX}${version}${MUSE_WINDOWS_EXE_SUFFIX}`)
    if (probe.fileExists(named)) {
      return named
    }
  }
  const newest = probe
    .listDirectory(dir)
    .filter((name) => {
      const lower = name.toLowerCase()
      return lower.startsWith(MUSE_BIN_PREFIX) && lower.endsWith(MUSE_WINDOWS_EXE_SUFFIX)
    })
    .toSorted((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    .at(0)
  return newest === undefined ? undefined : p.join(dir, newest)
}

function resolvePosix(probe: LaunchProbe): LaunchResolution {
  const p = path.posix
  const candidates: string[] = []
  if (probe.configuredPath !== '') {
    candidates.push(probe.configuredPath)
  }
  for (const entry of absoluteEntries(probe, p)) {
    candidates.push(p.join(entry, MUSE_POSIX_EXECUTABLE))
  }
  candidates.push(p.join(probe.homeDir, ...MUSE_POSIX_INSTALL_SEGMENTS, MUSE_POSIX_EXECUTABLE))
  for (const candidate of candidates) {
    if (probe.fileExists(candidate)) {
      return {
        ok: true,
        launch: {
          command: candidate,
          args: probe.serveArgs,
          serveArgs: probe.serveArgs,
          installDir: p.dirname(candidate),
          cliPath: candidate,
        },
      }
    }
  }
  return {
    ok: false,
    searched: candidates,
    reason: UI_TEXT.cliNotFound,
  }
}

export function resolveMuseLaunch(probe: LaunchProbe): LaunchResolution {
  // A relative setting would resolve against whatever the current directory is.
  if (probe.configuredPath !== '' && !pathModule(probe.platform).isAbsolute(probe.configuredPath)) {
    return {
      ok: false,
      searched: [probe.configuredPath],
      reason: UI_TEXT.cliPathNotAbsolute,
    }
  }
  return probe.platform === 'win32' ? resolveWindows(probe) : resolvePosix(probe)
}

/**
 * `museSpark.environmentVariables` for a terminal that runs the CLI (`muse
 * logout`, `muse mcp login`, Open in Terminal). VS Code adds them to the
 * terminal's own environment, so the CLI there reads the same config home
 * as `muse serve` (the review of PR #49). On Windows one spelling per name,
 * the last one given winning, as for `muse serve`.
 */
export function terminalEnvironment(
  variables: readonly EnvironmentVariable[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const variable of variables) {
    setEnvironmentVariable(env, platform, variable.name, variable.value)
  }
  return env
}

/**
 * Keeps loopback off the proxy (M56, PLAN.md D43). Muse Code sends every
 * HTTP request through the proxy its environment names, including its
 * connection to the extension's `ide` server on 127.0.0.1, which a corporate
 * proxy cannot reach (captured 2026-09-25: `POST http://127.0.0.1:<port>/mcp`
 * arrived at the proxy until NO_PROXY listed the address). So wherever a
 * proxy is set, from VS Code or the user's own environment, the loopback
 * names are added to each NO_PROXY spelling already there, or to a new
 * NO_PROXY; entries already listed stay as they are.
 */
export function withLoopbackBypass<T extends NodeJS.ProcessEnv>(
  env: T,
  platform: NodeJS.Platform,
): T {
  // Adding loopback names to NO_PROXY cannot introduce a workspace PATH
  // entry: a guarded environment stays guarded.
  const isProxied = PROXY_VARIABLE_SPELLINGS.some(
    (name) => (environmentValue(env, platform, name) ?? '') !== '',
  )
  if (!isProxied) {
    return env
  }
  const bypassed: T = { ...env }
  const present = NO_PROXY_SPELLINGS.filter(
    (name) => environmentValue(bypassed, platform, name) !== undefined,
  )
  // On Windows the two spellings are one variable.
  const targets = platform === 'win32' || present.length === 0 ? [NO_PROXY_VARIABLE] : present
  for (const name of targets) {
    const entries = (environmentValue(bypassed, platform, name) ?? '')
      .split(NO_PROXY_SEPARATOR)
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
    const missing = LOOPBACK_NO_PROXY_ENTRIES.filter((entry) => !entries.includes(entry))
    setEnvironmentVariable(
      bypassed,
      platform,
      name,
      [...entries, ...missing].join(NO_PROXY_SEPARATOR),
    )
  }
  return bypassed
}

export interface CredentialPathInput {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
}

/**
 * Where the CLI stores its browser-login credential. The binary honours
 * `XDG_CONFIG_HOME` on every platform (Windows included) and otherwise uses
 * `~/.config`; `MUSE_AUTH_PATH` is honoured only by the POSIX launcher, so it
 * is deliberately not consulted here.
 */
export function credentialFilePath(input: CredentialPathInput): string {
  const p = pathModule(input.platform)
  const configHome = input.xdgConfigHome ?? p.join(input.homeDir, '.config')
  return p.join(configHome, ...MUSE_CREDENTIAL_FILE_SEGMENTS)
}
