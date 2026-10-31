// Activation carries this loader, never recorder/preview code. The preview
// and the latest-file discovery build into dist/screenRecord.js; the
// platform drivers build into dist/screenRecordDrivers.js beside it.
import type {
  ScreenRecordingDriver,
  ScreenRecordingPreview,
  ScreenRecordingResult,
} from '../../core/media/record/driver'
import type { LatestRecordingPort } from '../../core/media/record/latest'
import type { UiTable } from '../l10n'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import { UI_TEXT } from '../../shared/constants'
import type { RecordingDriverHost } from './recordingDriver'
import type {
  LatestRecordingPlatformHost,
  WindowsPrivateDirectoryDeps,
  WindowsRecordingFolders,
  WindowsVideosDeps,
} from './recordingLatest'

export const RECORDING_COMMAND_IDS = {
  attach: 'museSpark.attachScreenRecording',
  latest: 'museSpark.attachLatestScreenRecording',
}

export interface RecordingPreviewDeps {
  readonly l10n: UiTable
  readonly log: Logger
  /** true means upload lifecycle now owns the file, including eventual cleanup. */
  readonly attach: (preview: ScreenRecordingPreview, isScreenRecording: true) => Promise<boolean>
}

export interface RecordingCommandDeps extends RecordingPreviewDeps {
  readonly isRemote: boolean
  /** The platform's native recorder. Absence is an explicit refusal. */
  readonly driver?: ScreenRecordingDriver
  readonly maxSeconds: number
  /**
  Attach Latest's discovery: the newest recording in the OS recorders'
  folders, or the refusal that names where it looked (or why the copy failed).
  */
  readonly latest: () => Promise<ScreenRecordingResult>
  /**
  macOS: the permission the system refused during this command, once, so
  the refusal that says so can offer that Settings pane. Absent where no
  permission recovery exists.
  */
  readonly takeRefusedPermission?: () => 'screen' | 'microphone' | undefined
  /**
  False once the conversation that started the recording cleared or
  closed: the bundle cancels the run instead of previewing it (M105 E1
  review). Absent means the caller owns liveness (tests, other hosts).
  */
  readonly isLive?: () => boolean
  /**
  The bundle registers the driver's cancel here right after start and
  unregisters when the result settles; clear/dispose cancels what is
  still registered. Absent means nobody can cancel from outside.
  */
  readonly trackRun?: (cancel: () => Promise<void>) => () => void
}

export type LatestRecordingResolution =
  | { readonly status: 'absent'; readonly reason: string }
  | { readonly status: 'ready'; readonly preview: ScreenRecordingPreview }
  | { readonly status: 'stale' }

/**
The latest-file branch's settlement, beside the driver branch's own
checks: discovery ran, so liveness is rechecked now. A stale copy is
disposed here and never previewed (nor, once admission is wired, attached
to the replacement conversation). Nothing found keeps discovery's reason,
which names the folders it searched. No `vscode` import, so unit tests
drive it directly.
*/
export async function resolveLatestRecording(
  deps: RecordingCommandDeps,
): Promise<LatestRecordingResolution> {
  const found = await deps.latest()
  if (!found.ok) return { status: 'absent', reason: found.reason }
  const preview = found.preview
  if ((deps.isLive ?? (() => true))()) return { status: 'ready', preview }
  try {
    await preview.dispose()
  } catch {
    deps.log.warn('Recording preview cleanup failed')
  }
  return { status: 'stale' }
}

interface ScreenRecordBundle {
  readonly runScreenRecordingCommand: (
    deps: RecordingCommandDeps,
    isLatest: boolean,
  ) => Promise<void>
  /**
  Latest-file discovery lives in the bundle so activation never carries
  the scanner (activation budget): the port factories and the find call
  the latest command resolves on first use. Written out (not `typeof
  Entry.*`) so this loader never reaches the entry's vscode side.
  */
  readonly createLatestRecordingPort: (host: LatestRecordingPlatformHost) => LatestRecordingPort
  readonly findLatestRecording: (
    port: LatestRecordingPort,
    now?: number,
  ) => Promise<ScreenRecordingResult>
  /**
  The driver of this platform; undefined where the product records
  nowhere. Awaits the drivers bundle on the first recording start.
  */
  readonly createRecordingDriver: (
    host: RecordingDriverHost,
  ) => Promise<ScreenRecordingDriver | undefined>
  readonly resolveWindowsRecordingFolders: (
    deps?: WindowsVideosDeps,
    platform?: NodeJS.Platform,
  ) => Promise<WindowsRecordingFolders>
  readonly createWindowsPrivateDirectory: (
    tempRoot: string,
    deps?: WindowsPrivateDirectoryDeps,
    platform?: NodeJS.Platform,
  ) => Promise<string>
}

// Same shipped source/build; only these exports' function signatures are
// trusted (PLAN §8).
function isScreenRecordBundle(value: unknown): value is ScreenRecordBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runScreenRecordingCommand' in value &&
    typeof value.runScreenRecordingCommand === 'function' &&
    'createLatestRecordingPort' in value &&
    typeof value.createLatestRecordingPort === 'function' &&
    'findLatestRecording' in value &&
    typeof value.findLatestRecording === 'function' &&
    'createRecordingDriver' in value &&
    typeof value.createRecordingDriver === 'function' &&
    'resolveWindowsRecordingFolders' in value &&
    typeof value.resolveWindowsRecordingFolders === 'function' &&
    'createWindowsPrivateDirectory' in value &&
    typeof value.createWindowsPrivateDirectory === 'function'
  )
}

export function screenRecordLoader(
  bundlePath: string,
  log: Logger,
  loadBundle?: (file: string) => unknown,
): () => ScreenRecordBundle {
  return lazyBundleLoader({
    bundlePath,
    log,
    ...(loadBundle !== undefined && { loadBundle }),
    isBundle: isScreenRecordBundle,
    label: 'screen recording',
    // A missing bundle is a broken install with the cause in the log, never
    // the user's fault (M105 E1 review).
    unavailable: () => UI_TEXT.media.recordingFailed,
  })
}
