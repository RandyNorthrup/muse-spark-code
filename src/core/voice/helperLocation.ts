// Where the dictation helper lives on this platform, and why it does not (M9).
//
// Windows: Windows PowerShell 5.1 under %SystemRoot% runs the bundled script
// on the .NET Framework's System.Speech. macOS: the Swift helper compiled in
// CI and shipped in the .vsix. Linux: no distribution ships a speech
// recogniser and the extension adds no third-party engine, so the button
// explains itself (owner decision 2026-09-22).

import path from 'node:path'
import {
  DICTATION_DARWIN_HELPER_SEGMENTS,
  DICTATION_WINDOWS_SCRIPT_SEGMENTS,
  UI_TEXT,
  WINDOWS_POWERSHELL_RELATIVE_PATH,
} from '../../shared/constants'
import type { HelperInvocation } from './dictation'

export interface HelperProbe {
  readonly platform: NodeJS.Platform
  /** `%SystemRoot%`; undefined off Windows. */
  readonly systemRoot: string | undefined
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

export function locateDictationHelper(probe: HelperProbe): HelperLocation {
  switch (probe.platform) {
    case 'win32': {
      if (probe.systemRoot === undefined) {
        return { isAvailable: false, reason: UI_TEXT.dictationUnavailableWindows }
      }
      return {
        isAvailable: true,
        invocation: {
          command: path.join(probe.systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH),
          args: [
            ...WINDOWS_SCRIPT_ARGS,
            path.join(probe.helperDir, ...DICTATION_WINDOWS_SCRIPT_SEGMENTS),
          ],
        },
      }
    }
    case 'darwin': {
      const command = path.join(probe.helperDir, ...DICTATION_DARWIN_HELPER_SEGMENTS)
      return probe.fileExists(command)
        ? { isAvailable: true, invocation: { command, args: [] } }
        : { isAvailable: false, reason: UI_TEXT.dictationUnavailableDarwin }
    }
    case 'linux': {
      return { isAvailable: false, reason: UI_TEXT.dictationUnavailableLinux }
    }
    default: {
      return { isAvailable: false, reason: UI_TEXT.dictationUnavailable }
    }
  }
}
