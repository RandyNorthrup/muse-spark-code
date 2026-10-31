// Attach Latest's discovery: the newest recording across the OS recordings
// locations, whatever its age, with the person's names for the places it
// searched. The recording command's bundle carries this for the discovery;
// the drivers reach it only for the place names. Shared leaf, owned by
// neither bundle's file list.
import path from 'node:path'
import {
  MEDIA_FILE_ID_MIN_BYTES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  VIDEOS_FOLDER_NAME,
  WINDOWS_CAPTURES_FOLDER,
  WINDOWS_SCREEN_RECORDINGS_FOLDER,
} from '../../../shared/constants'
import { UI_TEXT, fill, uiLocale } from '../../../shared/l10n/text'
import { mediaInfoSchema } from '../../../shared/media'
import type { ScreenRecordingPreview, ScreenRecordingResult } from './driver'

export interface LatestRecordingPort {
  /** The OS recordings locations: Linux Videos roots, Windows Screen
  Recordings and Captures, or the macOS Desktop default. The host factory
  sets them. */
  readonly roots: readonly string[]
  /**
  The person's names for those locations (`Videos\\Screen Recordings`,
  `Desktop`), never a profile path: the not-found sentence names them.
  */
  readonly places: readonly string[]
  /**
  An extra per-platform file-name gate for a general-purpose directory:
  macOS scans the Desktop, so only Screenshot names qualify. Absent means
  every media file qualifies (Linux Videos, Windows Screen Recordings and
  Captures are dedicated recordings folders).
  */
  readonly isRecordingFileName?: (fileName: string) => boolean
  /** Nonrecursive, confined regular files only; reject symlinks/special files. */
  readonly list: (
    root: string,
  ) => Promise<readonly { readonly path: string; readonly modifiedAt: number }[]>
  /** Copy privately under a hard byte cap, then sniff; source is never deleted.
  WebM is retained as WebM for M1's explicit conversion offer. */
  readonly copyForPreview: (source: string, maxBytes: number) => Promise<ScreenRecordingPreview>
}

/**
Whether a discovered file sits directly inside a recordings root. Both
sides normalize to forward slashes first, so Windows drive-letter roots
confine the same way POSIX ones do; anything else (relative, traversal
outside the root) fails closed.
*/
export function isWithinRecordingRoot(root: string, file: string): boolean {
  const normalRoot = root.replaceAll('\\', '/').replace(/\/$/u, '')
  const normalFile = file.replaceAll('\\', '/')
  return (
    (path.posix.isAbsolute(normalRoot) || path.win32.isAbsolute(root)) &&
    path.posix.dirname(normalFile) === normalRoot
  )
}

/**
Attach Latest found nothing: the sentence names the folders it searched, in
the person's words ("Videos\\Screen Recordings or Videos\\Captures"), joined
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

/**
Explicit Attach latest action; never walks arbitrary home/workspace trees.
D121: no age cutoff of ours. The newest recording across the roots wins,
whatever its age (the preview shows the person what they attach); only a
file dated in the future is refused.
*/
export async function findLatestRecording(
  port: LatestRecordingPort,
  now = Date.now(),
): Promise<ScreenRecordingResult> {
  const candidates: { readonly path: string; readonly modifiedAt: number }[] = []
  for (const root of port.roots) {
    try {
      const files = await port.list(root)
      for (const file of files) {
        const normalFile = file.path.replaceAll('\\', '/')
        const fileName = normalFile.slice(normalFile.lastIndexOf('/') + 1)
        if (
          isWithinRecordingRoot(root, file.path) &&
          /\.(?:mp4|mov|webm)$/iu.test(normalFile) &&
          (port.isRecordingFileName?.(fileName) ?? true) &&
          file.modifiedAt <= now
        )
          candidates.push(file)
      }
    } catch {
      /* A missing recordings directory does not hide the other ones. */
    }
  }
  candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
  const latest = candidates[0]
  if (latest === undefined) return { ok: false, reason: recordingNotFound(port.places) }
  try {
    const preview = await port.copyForPreview(
      latest.path,
      MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES,
    )
    const parsed = mediaInfoSchema.safeParse(preview.info)
    if (
      !parsed.success ||
      parsed.data.kind !== 'video' ||
      parsed.data.sizeBytes === 0 ||
      parsed.data.sizeBytes > MEDIA_MAX_UPLOAD_DEFAULT_MIB * MEDIA_FILE_ID_MIN_BYTES
    ) {
      await preview.dispose()
      return {
        ok: false,
        reason: fill(UI_TEXT.media.recordingUnavailable, { reason: 'mp4 / WebM' }),
      }
    }
    return { ok: true, preview }
  } catch {
    return { ok: false, reason: fill(UI_TEXT.media.recordingUnavailable, { reason: 'mp4 / WebM' }) }
  }
}
