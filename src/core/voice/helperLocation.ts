// Where the dictation helper lives on this platform, and why it does not (M9).
//
// Windows: Windows PowerShell 5.1 under %SystemRoot% runs the bundled script
// on the .NET Framework's System.Speech. macOS: the Swift helper compiled in
// CI and shipped in the .vsix. Linux: no distribution ships a speech
// recogniser and the extension adds no third-party engine, so the button
// explains itself (owner decision 2026-09-22). A remote window: the
// extension host runs on the other machine, so neither recogniser can hear
// the user (M26, PLAN.md D29).

import path from 'node:path'
import {
  DICTATION_DARWIN_APP_NAME_FLAG,
  DICTATION_DARWIN_CAPTURE_FLAG,
  DICTATION_DARWIN_HELPER_SEGMENTS,
  DICTATION_WINDOWS_CAPTURE_SEGMENTS,
  DICTATION_WINDOWS_SCRIPT_SEGMENTS,
  LINUX_RECORDERS,
  UI_TEXT,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
  WINDOWS_PSMODULEPATH_VARIABLE,
} from '../../shared/constants'
import { setEnvironmentVariable, windowsPowerShellModulePath } from '../backends/musecode/launch'
import { resolveExecutable } from '../executables'
import type { HelperInvocation } from './dictation'

export interface HelperProbe {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
  /** `%ProgramFiles%`; undefined off Windows (then derived from `systemRoot`). */
  readonly programFiles: string | undefined
  /**
   * The remote this extension host runs on (`vscode.env.remoteName` when the
   * extension runs as a workspace extension in a remote window); undefined
   * when the extension host is on the user's own machine.
   */
  readonly remoteName: string | undefined
  /**
   * The editor's own name (`vscode.env.appName`, "Visual Studio Code"): the
   * app macOS would ask for the helper's microphone and speech permissions
   * where the helper cannot disclaim it and ask under its own name (M28).
   */
  readonly appName: string
  /** The extension's `native/` folder. */
  readonly helperDir: string
  readonly fileExists: (fsPath: string) => boolean
}

export type HelperLocation =
  | { readonly isAvailable: true; readonly invocation: HelperInvocation }
  | { readonly isAvailable: false; readonly reason: string }

// `-NonInteractive` turns any prompt into an error; `-ExecutionPolicy Bypass`
// scopes to this process only, so a Restricted machine policy still runs the
// bundled script (the VS Code PowerShell extension launches the same way).
const WINDOWS_SCRIPT_ARGS = [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy',
  'Bypass',
  '-File',
] as const

/**
 * Windows PowerShell 5.1 running one bundled script, in Windows paths
 * whatever the host (the unit tests run on all three). It gets exactly
 * Windows PowerShell's own module directories: 5.1 loads (or fails to load)
 * pwsh 7's modules when an extension host started from a PowerShell 7
 * terminal hands it pwsh 7's `PSModulePath`, the trap
 * `buildChildEnvironment` closes for `muse serve` (PLAN.md D1a).
 */
function windowsScript(
  probe: HelperProbe,
  systemRoot: string,
  script: readonly string[],
): HelperInvocation {
  return {
    command: path.win32.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
    args: [...WINDOWS_SCRIPT_ARGS, path.win32.join(probe.helperDir, ...script)],
    environment: {
      [WINDOWS_PSMODULEPATH_VARIABLE]: windowsPowerShellModulePath(systemRoot, probe.programFiles),
    },
  }
}

/**
 * The bundled macOS helper with these flags and the app it names, or why
 * this build has none. macOS charges the helper's permission requests to the
 * app that started it (the extension host is VS Code's own process), so the
 * helper names that app in its refusals; a helper that dies before "ready"
 * died at a permission step or at Gatekeeper (M26, D29).
 */
function darwinHelper(
  probe: HelperProbe,
  flags: readonly string[],
):
  | { readonly isAvailable: true; readonly invocation: HelperInvocation }
  | { readonly isAvailable: false; readonly reason: string } {
  const command = path.join(probe.helperDir, ...DICTATION_DARWIN_HELPER_SEGMENTS)
  return probe.fileExists(command)
    ? {
        isAvailable: true,
        invocation: {
          command,
          args: [...flags, DICTATION_DARWIN_APP_NAME_FLAG, probe.appName],
          earlyExitHint: UI_TEXT.dictationDarwinEarlyExit,
        },
      }
    : { isAvailable: false, reason: UI_TEXT.dictationUnavailableDarwin }
}

/**
 * The bundled helper on Windows or macOS, with this script or these flags,
 * or why it cannot run here; undefined on the other platforms, which each
 * locator answers for itself.
 */
function bundledHelper(
  probe: HelperProbe,
  windowsScriptSegments: readonly string[],
  darwinFlags: readonly string[],
): HelperLocation | undefined {
  // A workspace extension in a remote window runs on the remote machine, so
  // a helper started here would listen to that machine's microphone (a
  // Windows server's), or find no recogniser (a Linux server, WSL, a
  // container). VS Code's remote-extensions guide: "Workspace Extensions run
  // on the remote machine / environment."
  if (probe.remoteName !== undefined) {
    return { isAvailable: false, reason: UI_TEXT.dictationUnavailableRemote }
  }
  if (probe.platform === 'win32') {
    return probe.systemRoot === undefined
      ? { isAvailable: false, reason: UI_TEXT.dictationUnavailableWindows }
      : {
          isAvailable: true,
          invocation: windowsScript(probe, probe.systemRoot, windowsScriptSegments),
        }
  }
  return probe.platform === 'darwin' ? darwinHelper(probe, darwinFlags) : undefined
}

export function locateDictationHelper(probe: HelperProbe): HelperLocation {
  return (
    bundledHelper(probe, DICTATION_WINDOWS_SCRIPT_SEGMENTS, []) ?? {
      isAvailable: false,
      reason:
        probe.platform === 'linux'
          ? UI_TEXT.dictationUnavailableLinux
          : UI_TEXT.dictationUnavailable,
    }
  )
}

/**
 * The helper's environment: a copy of the extension host's own with the
 * invocation's variables set. On Windows a name is case-insensitive and
 * Node passes only the first spelling in sort order when a child's
 * environment holds two ("only first (in lexicographic order) entry will be
 * passed to the subprocess", the child_process docs), so an inherited
 * `PSMODULEPATH` would beat our `PSModulePath`; `setEnvironmentVariable`
 * drops the other spellings first.
 */
export function helperEnvironment(
  base: NodeJS.ProcessEnv,
  invocation: HelperInvocation,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  const variables = Object.entries(invocation.environment ?? {})
  for (const [name, value] of variables) {
    setEnvironmentVariable(env, platform, name, value)
  }
  return env
}

/** Where Muse Voice's recording comes from (M35), or why there is none here. */
export type CaptureLocation =
  | { readonly isAvailable: true; readonly kind: 'helper'; readonly invocation: HelperInvocation }
  | {
      readonly isAvailable: true
      readonly kind: 'recorder'
      /** `arecord` or `parec`: the name the error lines use. */
      readonly name: string
      readonly command: string
      readonly args: readonly string[]
    }
  | { readonly isAvailable: false; readonly reason: string }

export interface CaptureProbe extends HelperProbe {
  /** PATH, for Linux's recorders (absolute entries only, PLAN.md D24). */
  readonly pathVariable: string | undefined
}

/**
 * The capture helper for Muse Voice (M35): Windows PowerShell running the
 * bundled capture script, the Swift helper in capture mode, or on Linux the
 * system's recorder. A remote window records nothing, as for the free engine.
 */
export function locateCaptureHelper(probe: CaptureProbe): CaptureLocation {
  const helper = bundledHelper(probe, DICTATION_WINDOWS_CAPTURE_SEGMENTS, [
    DICTATION_DARWIN_CAPTURE_FLAG,
  ])
  if (helper !== undefined) {
    return helper.isAvailable ? { ...helper, kind: 'helper' } : helper
  }
  if (probe.platform !== 'linux') {
    return { isAvailable: false, reason: UI_TEXT.dictationUnavailable }
  }
  for (const recorder of LINUX_RECORDERS) {
    const command = resolveExecutable(recorder.command, {
      platform: probe.platform,
      pathVariable: probe.pathVariable,
      fileExists: probe.fileExists,
    })
    if (command !== undefined) {
      return {
        isAvailable: true,
        kind: 'recorder',
        name: recorder.command,
        command,
        args: recorder.args,
      }
    }
  }
  return { isAvailable: false, reason: UI_TEXT.museVoiceNoRecorder }
}
