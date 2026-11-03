// One frame-path scrub for crash and journal records (M93's flight
// recorder and M111 lane OB's crash store): a path a record may hold is
// relative, with no empty, dot or dot-dot segments, no backslashes, no
// drive root and no URI scheme. A path the redactor changes (a
// secret-shaped value) never lands: the frame is dropped, not repaired.
import { REPORT_FRAME_PATH_MAX_CHARS } from './constants'
import { redactSecrets } from './redact'

/** A URI scheme prefix (`https:`, `file:`): never a frame path. */
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/
/** A Windows drive root (`C:/`): never a frame path. */
const DRIVE_ROOT = /^[A-Za-z]:\//

// A frame path a record may hold, or undefined when the frame must be
// dropped. Callers with a narrower vocabulary (the journal's package
// files) check membership themselves first.
export function scrubFramePath(path: string): string | undefined {
  const scrubbed = redactSecrets(path)
  if (
    scrubbed !== path ||
    scrubbed.length === 0 ||
    scrubbed.length > REPORT_FRAME_PATH_MAX_CHARS ||
    scrubbed.includes('\\') ||
    scrubbed.startsWith('/') ||
    DRIVE_ROOT.test(scrubbed) ||
    URI_SCHEME.test(scrubbed)
  )
    return undefined
  const segments = scrubbed.split('/')
  return segments.some((segment) => ['', '.', '..'].includes(segment)) ? undefined : scrubbed
}
