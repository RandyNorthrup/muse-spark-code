// Activation carries this loader, never recorder/preview code. W builds
// previewPanel.ts with R1–R3 into dist/screenRecord.js and budgets that chunk.
import type { ScreenRecordingDriver, ScreenRecordingPreview } from '../../core/media/record/driver'
import type { UiTable } from '../l10n'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import { UI_TEXT } from '../../shared/constants'

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
  /** R1–R3's native binding. Absence is an explicit refusal. */
  readonly driver?: ScreenRecordingDriver
  readonly maxSeconds: number
  readonly latest?: () => Promise<ScreenRecordingPreview | undefined>
}

interface ScreenRecordBundle {
  readonly runScreenRecordingCommand: (
    deps: RecordingCommandDeps,
    isLatest: boolean,
  ) => Promise<void>
}

// Same shipped source/build; only this export's function signature is trusted (PLAN §8).
function isScreenRecordBundle(value: unknown): value is ScreenRecordBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'runScreenRecordingCommand' in value &&
    typeof value.runScreenRecordingCommand === 'function'
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
    unavailable: () => UI_TEXT.media.recordingUserOnly,
  })
}
