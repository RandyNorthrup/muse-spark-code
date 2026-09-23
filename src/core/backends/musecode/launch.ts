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
// so on Windows the resolver targets muse-bin-<version>.exe directly, with the
// PowerShell launcher as the fallback when the version file is missing.

import path from 'node:path'
import type { EnvironmentVariable } from '../../../shared/constants'
import {
  MUSE_BIN_PREFIX,
  MUSE_CMD_FILE,
  MUSE_CREDENTIAL_FILE_SEGMENTS,
  MUSE_LAUNCHER_PS1_FILE,
  MUSE_POSIX_EXECUTABLE,
  MUSE_POSIX_INSTALL_SEGMENTS,
  MUSE_VERSION_FILE,
  MUSE_WINDOWS_EXE_SUFFIX,
  MUSE_WINDOWS_INSTALL_SEGMENTS,
  WINDOWS_POWERSHELL_ARGS,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_PSMODULEPATH_SEGMENTS,
} from '../../../shared/constants'

export interface LaunchProbe {
  readonly platform: NodeJS.Platform
  /** `museSpark.museBinaryPath`; empty means discover. */
  readonly configuredPath: string
  /** Entries of the PATH variable, already split. */
  readonly pathEntries: readonly string[]
  readonly homeDir: string
  /** `%LOCALAPPDATA%` on Windows; undefined elsewhere. */
  readonly localAppData: string | undefined
  /** `%SystemRoot%` on Windows; undefined elsewhere. */
  readonly systemRoot: string | undefined
  readonly fileExists: (filePath: string) => boolean
  /** Returns undefined when the file cannot be read. */
  readonly readTextFile: (filePath: string) => string | undefined
  /** `serve` plus the host-posture flags (`serveArguments`, sandbox.ts). */
  readonly serveArgs: readonly string[]
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

/**
 * The PATH entries worth probing: an empty or relative entry means the
 * current directory, which for `muse serve` is the workspace (PLAN.md D24).
 */
function absoluteEntries(probe: LaunchProbe, p: path.PlatformPath): readonly string[] {
  return probe.pathEntries.filter((entry) => entry !== '' && p.isAbsolute(entry))
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
    const versionFile = p.join(dir, MUSE_VERSION_FILE)
    const version = probe.readTextFile(versionFile)?.trim()
    if (version !== undefined && version !== '') {
      const exe = p.join(dir, `${MUSE_BIN_PREFIX}${version}${MUSE_WINDOWS_EXE_SUFFIX}`)
      if (probe.fileExists(exe)) {
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
    const launcher = p.join(dir, MUSE_LAUNCHER_PS1_FILE)
    if (probe.fileExists(launcher) && probe.systemRoot !== undefined) {
      return {
        ok: true,
        launch: {
          command: p.join(probe.systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
          args: [...WINDOWS_POWERSHELL_ARGS, launcher, ...probe.serveArgs],
          serveArgs: probe.serveArgs,
          installDir: dir,
          cliPath: p.join(dir, MUSE_CMD_FILE),
        },
      }
    }
  }
  return { ok: false, searched, reason: 'Muse Code is not installed in any known location.' }
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
    reason: 'Muse Code is not installed in any known location.',
  }
}

export function resolveMuseLaunch(probe: LaunchProbe): LaunchResolution {
  // A relative setting would resolve against whatever the current directory is.
  if (probe.configuredPath !== '' && !pathModule(probe.platform).isAbsolute(probe.configuredPath)) {
    return {
      ok: false,
      searched: [probe.configuredPath],
      reason: 'museSpark.museBinaryPath must be an absolute path.',
    }
  }
  return probe.platform === 'win32' ? resolveWindows(probe) : resolvePosix(probe)
}

export interface ChildEnvironmentInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  readonly extraVariables: readonly EnvironmentVariable[]
  readonly systemRoot: string | undefined
  readonly programFiles: string | undefined
}

/**
 * Sets `name` in a copied environment. Windows names are case-insensitive
 * and Node passes the first of several spellings in sort order, so an
 * inherited `PSMODULEPATH` would beat a new `PSModulePath`: every other
 * spelling goes first.
 */
export function setEnvironmentVariable(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
  value: string,
): void {
  if (platform === 'win32') {
    const lower = name.toLowerCase()
    for (const key of Object.keys(env)) {
      if (key !== name && key.toLowerCase() === lower) {
        Reflect.deleteProperty(env, key)
      }
    }
  }
  env[name] = value
}

/** Reads `name` from a copied environment, ignoring case on Windows. */
export function environmentValue(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  name: string,
): string | undefined {
  if (platform !== 'win32') {
    return env[name]
  }
  const lower = name.toLowerCase()
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === lower)
  return key === undefined ? undefined : env[key]
}

/**
 * Windows PowerShell 5.1's own module directories. A pwsh 7 `PSModulePath`
 * inherited by powershell.exe makes it load 7.x modules it cannot use
 * (verified failure: `Get-FileHash` not recognised).
 */
export function windowsPowerShellModulePath(
  systemRoot: string,
  programFiles: string | undefined,
): string {
  const base = programFiles ?? path.win32.join(systemRoot, '..', 'Program Files')
  return [
    path.win32.join(base, ...WINDOWS_PSMODULEPATH_SEGMENTS.programFiles),
    path.win32.join(systemRoot, ...WINDOWS_PSMODULEPATH_SEGMENTS.systemRoot),
  ].join(';')
}

/**
 * The environment for `muse serve`. On Windows `PSModulePath` is reset to the
 * Windows PowerShell module directories: the CLI's launcher runs under
 * powershell.exe 5.1, which cannot load its own modules when a pwsh 7 module
 * path is inherited (verified failure: `Get-FileHash` not recognised).
 *
 * The Model API key from secret storage is deliberately NOT injected: the
 * CLI prefers `META_API_KEY` over its browser session, which would bill the
 * subscription's work to the key (PLAN.md D1, M7). A key already in the
 * user's own environment is inherited untouched, as the CLI documents.
 */
export function buildChildEnvironment(input: ChildEnvironmentInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.baseEnv }
  if (input.platform === 'win32' && input.systemRoot !== undefined) {
    setEnvironmentVariable(
      env,
      input.platform,
      'PSModulePath',
      windowsPowerShellModulePath(input.systemRoot, input.programFiles),
    )
  }
  for (const variable of input.extraVariables) {
    setEnvironmentVariable(env, input.platform, variable.name, variable.value)
  }
  return env
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
