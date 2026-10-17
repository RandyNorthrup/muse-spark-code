// The injected recorder seam shared by native editors, ACP and the companion.
// A driver never sends media. Its owner must preview, then attach or discard.
import type { MediaInfo } from '../../../shared/media'

export interface ScreenRecordingOptions {
  readonly maxSeconds: number
  /** Both are false unless the user selects them for this recording. */
  readonly microphone: boolean
  readonly systemAudio: boolean
}

export interface ScreenRecordingPreview {
  /** Owner-only temporary file; the host keeps this path out of the webview. */
  readonly path: string
  readonly info: Extract<MediaInfo, { kind: 'video' }>
  /** Removes the temporary file after upload or discard; safe to call again. */
  readonly dispose: () => Promise<void>
}

export type ScreenRecordingResult =
  | { readonly ok: true; readonly preview: ScreenRecordingPreview }
  | { readonly ok: false; readonly reason: string }

export interface ScreenRecordingRun {
  /** Stop settles the same result as reaching the requested maximum. */
  readonly stop: () => Promise<void>
  /** Cancel deletes the temporary file and settles with an explicit refusal. */
  readonly cancel: () => Promise<void>
  readonly result: Promise<ScreenRecordingResult>
}

export interface ScreenRecordingDriver {
  /** A named refusal when permissions, an encoder or a local screen are missing. */
  readonly available: () => Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: string }
  >
  /** Called only by an interactive user entry point, after its options UI. */
  readonly start: (
    options: ScreenRecordingOptions,
    onCountdown: (remainingSeconds: number) => void,
  ) => Promise<ScreenRecordingRun>
}
