// M105 RLF-RECORDING: the screen recorder the product binds, one per
// platform. Windows records with Windows.Graphics.Capture through the
// helper the inbox compiler builds once; macOS with ScreenCaptureKit
// through the signed helper app; Linux through the desktop's ScreenCast
// portal and GStreamer. Each driver says in words when it cannot record on
// this computer (`available()`), and none starts without the interactive
// command that built it. Creating a driver touches nothing.
import type { ScreenRecordingDriver } from '../../core/media/record/driver'
import {
  LINUX_RECORDING_HELPER_MAX_BYTES,
  linuxRecordingDriver,
} from '../../core/media/record/linux'
import {
  MACOS_RECORDING_HELPER_MAX_BYTES,
  macosScreenRecordingDriver,
} from '../../core/media/record/macos'
import {
  WINDOWS_RECORDING_HELPER_MAX_BYTES,
  windowsScreenRecorder,
} from '../../core/media/record/windows'
import type { UiTable } from '../l10n'
import { createLinuxRecorderPort } from './linuxRecorderPort'
import { createMacosRecorderDeps, type MacosRecorderHost } from './macosRecorderDeps'
import { createWindowsRecorderDeps } from './windowsRecorderDeps'

export interface RecordingDriverHost {
  readonly platform: NodeJS.Platform
  readonly arch: string
  /** The extension's folder: the shipped helpers are read from under it. */
  readonly extensionPath: string
  /** The host's trusted storage for the Windows helper built on first use. */
  readonly storageDir: string
  /** The host's trusted temp root for the recordings' private folders. */
  readonly tempRoot: string
  readonly environment: NodeJS.ProcessEnv
  /** The remote this window runs on (`vscode.env.remoteName`); undefined on the user's own machine. */
  readonly remoteName: string | undefined
  /** The caller's language, installed before the sniffer reads a refusal. */
  readonly l10n: UiTable
  /** Aborted when the window closes: it ends a picker and any run. */
  readonly lifetime: AbortSignal
  /** The person's upload cap in bytes, or 0 when they set none (read at each start). */
  readonly personMaxBytes: () => number
  /** The editor's recovery action for a macOS permission the system refused. */
  readonly onPermissionDenied?: MacosRecorderHost['onPermissionDenied']
}

/**
The recording's byte bound: the person's upload cap when set, else the
helper's own bound. A cap above the helper's own is the helper's.
*/
function recordingBytes(personBytes: number, helperBytes: number): number {
  return personBytes > 0 ? Math.min(personBytes, helperBytes) : helperBytes
}

/** The driver of this platform, or undefined where the product records nowhere. */
export function createRecordingDriver(
  host: RecordingDriverHost,
): ScreenRecordingDriver | undefined {
  if (host.platform === 'win32') {
    const systemRoot = host.environment['SystemRoot']
    if (systemRoot === undefined) return undefined
    const deps = createWindowsRecorderDeps({
      extensionPath: host.extensionPath,
      storageDir: host.storageDir,
      tempRoot: host.tempRoot,
      systemRoot,
      l10n: host.l10n,
    })
    return windowsScreenRecorder({
      ...deps,
      isLocal: host.remoteName === undefined,
      // The only way to this driver is the interactive recording command.
      isInteractiveUserAction: () => true,
      onShutdown: (cancel) => {
        host.lifetime.addEventListener('abort', cancel, { once: true })
        return () => {
          host.lifetime.removeEventListener('abort', cancel)
        }
      },
      // Read at each start: the person's cap can change between recordings.
      get maxBytes() {
        return recordingBytes(host.personMaxBytes(), WINDOWS_RECORDING_HELPER_MAX_BYTES)
      },
    })
  }
  if (host.platform === 'darwin') {
    return macosScreenRecordingDriver(
      createMacosRecorderDeps({
        extensionPath: host.extensionPath,
        tempRoot: host.tempRoot,
        arch: host.arch,
        remoteName: host.remoteName,
        environment: host.environment,
        l10n: host.l10n,
        maxBytes: () => recordingBytes(host.personMaxBytes(), MACOS_RECORDING_HELPER_MAX_BYTES),
        ...(host.onPermissionDenied !== undefined && {
          onPermissionDenied: host.onPermissionDenied,
        }),
      }),
    )
  }
  if (host.platform === 'linux') {
    return linuxRecordingDriver(
      createLinuxRecorderPort({
        extensionPath: host.extensionPath,
        tempRoot: host.tempRoot,
        arch: host.arch,
        environment: host.environment,
        remoteName: host.remoteName,
        signal: host.lifetime,
        l10n: host.l10n,
        maxBytes: () => recordingBytes(host.personMaxBytes(), LINUX_RECORDING_HELPER_MAX_BYTES),
      }),
    )
  }
  return undefined
}
