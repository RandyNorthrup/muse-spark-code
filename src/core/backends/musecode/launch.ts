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

function windowsCandidateDirs(probe: LaunchProbe, p: path.PlatformPath): string[] {
  const dirs: string[] = []
  if (probe.configuredPath !== '') {
    dirs.push(p.dirname(probe.configuredPath))
  }
  for (const entry of probe.pathEntries) {
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
  for (const entry of probe.pathEntries) {
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
  return probe.platform === 'win32' ? resolveWindows(probe) : resolvePosix(probe)
}

export interface ChildEnvironmentInput {
  readonly platform: NodeJS.Platform
  readonly baseEnv: NodeJS.ProcessEnv
  readonly extraVariables: readonly EnvironmentVariable[]
  /** A Model API key from secret storage; injected as META_API_KEY when set. */
  readonly apiKey: string | undefined
  readonly systemRoot: string | undefined
  readonly programFiles: string | undefined
}

/**
 * The environment for `muse serve`. On Windows `PSModulePath` is reset to the
 * Windows PowerShell module directories: the CLI's launcher runs under
 * powershell.exe 5.1, which cannot load its own modules when a pwsh 7 module
 * path is inherited (verified failure: `Get-FileHash` not recognised).
 */
export function buildChildEnvironment(input: ChildEnvironmentInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...input.baseEnv }
  if (input.platform === 'win32' && input.systemRoot !== undefined) {
    const programFiles =
      input.programFiles ?? path.win32.join(input.systemRoot, '..', 'Program Files')
    env['PSModulePath'] = [
      path.win32.join(programFiles, ...WINDOWS_PSMODULEPATH_SEGMENTS.programFiles),
      path.win32.join(input.systemRoot, ...WINDOWS_PSMODULEPATH_SEGMENTS.systemRoot),
    ].join(';')
  }
  for (const variable of input.extraVariables) {
    env[variable.name] = variable.value
  }
  if (input.apiKey !== undefined) {
    env['META_API_KEY'] = input.apiKey
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
