// The injected recorder seam shared by native editors, ACP and the companion.
// A driver never sends media. Its owner must preview, then attach or discard.
import path from 'node:path'
import {
  VIDEOS_FOLDER_NAME,
  WINDOWS_CAPTURES_FOLDER,
  WINDOWS_SCREEN_RECORDINGS_FOLDER,
} from '../../../shared/constants'
import { UI_TEXT, fill, uiLocale } from '../../../shared/l10n/text'
import type { MediaInfo } from '../../../shared/media'

export interface ScreenRecordingOptions {
  /** 0 records until stopped (D121: no stop of ours); otherwise the person's whole seconds, as set. */
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

/**
Attach Latest found nothing: the sentence names the folders it searched, in
the person's words ("Videos\Screen Recordings or Videos\Captures"), joined
as alternatives in the display language.
*/
export function recordingNotFound(places: readonly string[]): string {
  return fill(UI_TEXT.media.recordingNotFound, {
    folders: new Intl.ListFormat(uiLocale(), { type: 'disjunction', style: 'long' }).format(places),
  })
}

/**
The person's names for Windows' own recorders' folders, as Attach Latest
searches them: Snipping Tool's and Xbox Game Bar's, under Videos.
*/
export function windowsRecordingPlaces(): readonly string[] {
  return [
    path.win32.join(VIDEOS_FOLDER_NAME, WINDOWS_SCREEN_RECORDINGS_FOLDER),
    path.win32.join(VIDEOS_FOLDER_NAME, WINDOWS_CAPTURES_FOLDER),
  ]
}

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
  /**
  Called only by an interactive user entry point, after its options UI.
  The tick reports seconds remaining while capped, seconds recorded while
  uncapped (maxSeconds 0); only the person stops an uncapped recording.
  */
  readonly start: (
    options: ScreenRecordingOptions,
    onCountdown: (remainingSeconds: number) => void,
  ) => Promise<ScreenRecordingRun>
}
