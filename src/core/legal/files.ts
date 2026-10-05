// The legal scanner's file access (M97, PLAN.md D76): every read goes
// through one injected snapshot, so the scanner itself performs no
// file-system, network or process call. Paths are workspace-relative with
// forward slashes, as the lane 0 contract requires; anything else is
// refused instead of read.

import {
  LEGAL_EVIDENCE_EXCERPT_MAX_CHARS,
  LEGAL_HEADER_LINE_WINDOW,
} from '../../shared/constants'

/**
 * A read-only view of the workspace a scan may inspect. The host (or a
 * test) enumerates `files` and serves `readFile`; the scanner never lists
 * directories, resolves links or writes. `readFile` returns the file's
 * text decoded as UTF-8, or `undefined` when the file is missing or cannot
 * be read as text. Binary content (a NUL byte) is the readers' cue to skip
 * a file, never to treat its bytes as evidence.
 */
export interface LegalFileSnapshot {
  readonly files: readonly string[]
  readFile: (path: string) => string | undefined
}

/** A scan that cannot run honestly throws this instead of guessing. */
export class LegalScanError extends Error {
  override readonly name = 'LegalScanError'
  constructor(message: string) {
    super(message)
  }
}

/** The Unicode byte-order mark, compared by code point, never as a literal. */
const BYTE_ORDER_MARK_CODE = 0xfeff
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
const PARENT_SEGMENT = '..'

/**
 * Refuse anything that is not a workspace-relative forward-slash path:
 * absolute paths, parent segments and backslashes never reach `readFile`.
 * Link escapes are the enumerator's to prevent; the scanner additionally
 * never follows a path it was not given.
 */
export function assertWorkspaceRelative(path: string): void {
  const segments = path.split('/')
  if (
    path === '' ||
    path.startsWith('/') ||
    WINDOWS_ABSOLUTE.test(path) ||
    path.includes('\\') ||
    segments.includes(PARENT_SEGMENT)
  ) {
    throw new LegalScanError(`Refused path outside the workspace: ${path}`)
  }
}

/** The file name after the last slash, for manifest and license matching. */
export function baseNameOf(path: string): string {
  return path.split('/').at(-1) ?? ''
}

/** The directory holding a path, without a trailing slash (`''` at root). */
export function dirNameOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

/**
 * The first `window` lines of a file's text, with a byte-order mark
 * removed and universal newlines. Headers live at the top of a file, past
 * shebangs and mode lines; a longer window only invites matching code as
 * headers, so the bound stays at lane 0's header window.
 */
export function topLines(text: string, window: number = LEGAL_HEADER_LINE_WINDOW): string[] {
  const withoutBom = text.charCodeAt(0) === BYTE_ORDER_MARK_CODE ? text.slice(1) : text
  return withoutBom.split(/\r\n|\r|\n/).slice(0, window)
}

/**
 * The only raw file content a finding may carry: at most the excerpt
 * bound's characters of the evidence region, never a whole file, so a
 * report stays free of secret and PII values and confidential bodies.
 */
export function excerpt(text: string, maxChars: number = LEGAL_EVIDENCE_EXCERPT_MAX_CHARS): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars)
}

const LICENSE_FILE_NAME = /^(license|licence|copying|copyright|unlicense)(\.[a-z0-9]+)?$/i

/** Whether a file name (not a path) is a project license file candidate. */
export function isLicenseFileName(base: string): boolean {
  return LICENSE_FILE_NAME.test(base)
}

/**
 * Whether text holds binary content (a NUL byte): readers skip such files
 * instead of treating their bytes as evidence. Written without a literal
 * so the source stays printable.
 */
export function containsBinary(text: string): boolean {
  return text.includes(String.fromCharCode(0))
}

const NOTICE_FILE_NAME = /^(notice|third[ _-]?party[ _-]?notices|attribution|credits)(\.[a-z0-9]+)?$/i

/** Whether a file name (not a path) is a notice or attribution file. */
export function isNoticeFileName(base: string): boolean {
  return NOTICE_FILE_NAME.test(base)
}
