// Someone else's pull request, written by the extension rather than by git's
// checkout (M71, PLAN.md D49). A checkout runs the user's clean, smudge and
// process filters and conversions, which the pull request's own attributes
// select, configured anywhere git's configuration reaches, including
// includes that apply only inside the new worktree: no list of drivers to
// switch off can be shown to be complete. So the held worktree is added with
// no checkout, and the commit's files are written exactly as it stores them,
// from the listing this reads: `git ls-tree -r -z --full-tree --long`.
//
// A listing is refused whole when any path could land outside the worktree,
// in a `.git`, on a name the platform cannot hold, or on another path where
// letter case does not count; or when it holds more than a held checkout
// writes. A symbolic link becomes a file holding its target (as git writes
// one where links are off) and a submodule an empty folder.
//
// Pure: the host runs git and writes the files.

import {
  GIT_MODE_EXECUTABLE,
  GIT_MODE_FILE,
  GIT_MODE_GITLINK,
  GIT_MODE_SYMLINK,
  HELD_CHECKOUT_MAX_BYTES,
  HELD_CHECKOUT_MAX_ENTRIES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes } from '../../shared/l10n/text'
import { windowsPathProblem } from '../windowsPathSpelling'

export type HeldEntryKind = 'file' | 'executable' | 'link' | 'submodule'

export interface HeldEntry {
  /** As the commit names it, folders separated by `/`. */
  readonly path: string
  readonly kind: HeldEntryKind
  readonly oid: string
  /** The blob's size in bytes; 0 for a submodule, whose commit is not here. */
  readonly size: number
}

export type HeldTree =
  | { readonly ok: true; readonly entries: readonly HeldEntry[] }
  | { readonly ok: false; readonly reason: string }

// One record of the listing: `<mode> <type> <oid> <size, or - for a
// submodule>`, a tab, then the path as stored (no quoting under -z).
const LISTING_RECORD = /^(\d{6}) (blob|commit) ([\da-f]{40}(?:[\da-f]{24})?) +(-|\d+)\t(.+)$/su
const SUBMODULE_SIZE = '-'
const KINDS: ReadonlyMap<string, HeldEntryKind> = new Map([
  [GIT_MODE_FILE, 'file'],
  [GIT_MODE_EXECUTABLE, 'executable'],
  [GIT_MODE_SYMLINK, 'link'],
  [GIT_MODE_GITLINK, 'submodule'],
])
const SUBMODULE_TYPE = 'commit'
const BLOB_TYPE = 'blob'
const SEPARATOR = '/'
const NUL = '\0'
const TAB = '\t'
// What a byte that is not UTF-8 became when git's output was read as text:
// the name on disk could not be the one the commit stores.
const UNDECODABLE = '\u{FFFD}'
// A separator on Windows; git refuses it in a name everywhere (core.protectNTFS).
const BACKSLASH = '\\'
// What HFS+ ignores in a name, so `.g\u200Cit` is `.git` there (git's utf8.c).
const HFS_IGNORED = /[\u{200C}-\u{200F}\u{202A}-\u{202E}\u{206A}-\u{206F}\u{FEFF}]/gu
// `.git`, or its NTFS short name, with the dots and spaces Windows drops
// (git's is_ntfs_dotgit), in any letter case.
const DOT_GIT = /^(?:\.git|git~1)[. ]*$/iu
// What Windows refuses in a name, beside the control characters.
const WINDOWS_FORBIDDEN = /[<>:"|?*]/u
const FIRST_PRINTABLE = 0x20
// Platforms whose usual file systems tell names apart neither by letter
// case nor (macOS) by Unicode composition.
const NAME_FOLDING_PLATFORMS: ReadonlySet<NodeJS.Platform> = new Set(['win32', 'darwin'])

/** A path as the platform's file system compares it, so two that fold alike are one file. */
export function foldName(name: string, platform: NodeJS.Platform): string {
  return NAME_FOLDING_PLATFORMS.has(platform) ? name.normalize('NFC').toLowerCase() : name
}

function hasControlCharacter(name: string): boolean {
  for (const character of name) {
    if ((character.codePointAt(0) ?? 0) < FIRST_PRINTABLE) {
      return true
    }
  }
  return false
}

/** Whether one folder or file name of a path can be written as itself, inside the worktree. */
function isWritableName(name: string, platform: NodeJS.Platform): boolean {
  const isRefusedEverywhere =
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes(BACKSLASH) ||
    name.includes(UNDECODABLE) ||
    DOT_GIT.test(name.replaceAll(HFS_IGNORED, ''))
  const isRefusedOnWindows =
    platform === 'win32' &&
    (WINDOWS_FORBIDDEN.test(name) ||
      hasControlCharacter(name) ||
      windowsPathProblem(name, platform) !== undefined)
  return !isRefusedEverywhere && !isRefusedOnWindows
}

/** The reason for a path that is not written, in words for the user. */
export function unsafePathReason(entryPath: string): string {
  return fill(UI_TEXT.openPullRequestUnsafePath, { path: JSON.stringify(entryPath) })
}

function refused(reason: string): HeldTree {
  return { ok: false, reason }
}

/** A record's path, past the first tab, to name a record that does not parse. */
function pathOf(record: string): string {
  return record.slice(record.indexOf(TAB) + 1)
}

/**
 * The entries of `git ls-tree -r -z --full-tree --long <commit>` to write,
 * in its order, or why none is.
 */
export function heldTree(listing: string, platform: NodeJS.Platform): HeldTree {
  // Every folder and file the paths name, folded: what is already there.
  const names = new Map<string, { readonly spelling: string; readonly isFolder: boolean }>()
  const entries: HeldEntry[] = []
  let bytes = 0
  for (const record of listing.split(NUL)) {
    if (record === '') {
      continue
    }
    const [, mode = '', type = '', oid = '', sizeText = '', entryPath = pathOf(record)] =
      LISTING_RECORD.exec(record) ?? []
    const kind = KINDS.get(mode)
    const isSubmodule = kind === 'submodule'
    const size = isSubmodule ? 0 : Number(sizeText)
    if (
      kind === undefined ||
      type !== (isSubmodule ? SUBMODULE_TYPE : BLOB_TYPE) ||
      (sizeText === SUBMODULE_SIZE) !== isSubmodule ||
      !Number.isSafeInteger(size)
    ) {
      return refused(unsafePathReason(entryPath))
    }
    const segments = entryPath.split(SEPARATOR)
    if (segments.some((name) => !isWritableName(name, platform))) {
      return refused(unsafePathReason(entryPath))
    }
    let spelling = ''
    for (const [index, name] of segments.entries()) {
      spelling = index === 0 ? name : `${spelling}${SEPARATOR}${name}`
      const isFolder = index < segments.length - 1
      const key = foldName(spelling, platform)
      const known = names.get(key)
      if (known === undefined) {
        names.set(key, { spelling, isFolder })
      } else if (!isFolder || !known.isFolder || known.spelling !== spelling) {
        // Two spellings of one name, a file where a folder is, or the same file twice.
        return refused(
          fill(UI_TEXT.openPullRequestPathCollision, {
            first: JSON.stringify(known.spelling),
            second: JSON.stringify(spelling),
          }),
        )
      }
    }
    bytes += size
    entries.push({ path: entryPath, kind, oid, size })
    if (entries.length > HELD_CHECKOUT_MAX_ENTRIES || bytes > HELD_CHECKOUT_MAX_BYTES) {
      return refused(
        fill(UI_TEXT.openPullRequestTooLarge, {
          files: HELD_CHECKOUT_MAX_ENTRIES,
          size: formatBytes(HELD_CHECKOUT_MAX_BYTES),
        }),
      )
    }
  }
  return { ok: true, entries }
}
