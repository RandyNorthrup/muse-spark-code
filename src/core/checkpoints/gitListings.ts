// What the checkpoint store's git commands print (M72, PLAN.md D51), read
// into plain values. Every command runs with `-z`, so a path is taken
// byte for byte (no quoting); the formats are git's documented porcelain
// and plumbing output. Pure: no git, no file system.

import { Buffer } from 'node:buffer'
import { GIT_MISSING_OBJECT } from '../../shared/constants'

const NUL = '\0'
const FOLDER_MARK = '/'
// `git status --porcelain=v1`: two status letters and a space, then the path.
const STATUS_PREFIX_LENGTH = 3
const UNTRACKED = '??'
const IGNORED = '!!'
const SPACE = ' '
// `git diff-tree --raw`: `:<mode> <mode> <oid> <oid> <status>`.
const RAW_MARK = ':'
const ABSENT_MODE = '000000'
const LINE_FEED = 0x0a

/** The non-empty fields of `-z` output. */
export function splitNul(output: string): readonly string[] {
  return output.split(NUL).filter((field) => field !== '')
}

/**
 * `git status --porcelain=v1 -z --ignored=matching --untracked-files=all`
 * over an empty index: every file outside the ignore rules is untracked.
 * A folder (`dir/`) among the untracked is a repository of its own; among
 * the ignored, a folder an ignore rule names whole (`node_modules/`).
 */
export interface StatusListing {
  readonly files: readonly string[]
  readonly repositories: readonly string[]
  readonly ignoredFiles: readonly string[]
  readonly ignoredFolders: readonly string[]
}

export function parseStatusListing(output: string): StatusListing {
  const files: string[] = []
  const repositories: string[] = []
  const ignoredFiles: string[] = []
  const ignoredFolders: string[] = []
  for (const entry of splitNul(output)) {
    const code = entry.slice(0, 2)
    const entryPath = entry.slice(STATUS_PREFIX_LENGTH)
    const isFolder = entryPath.endsWith(FOLDER_MARK)
    const bare = isFolder ? entryPath.slice(0, -FOLDER_MARK.length) : entryPath
    if (code === UNTRACKED) {
      ;(isFolder ? repositories : files).push(bare)
    } else if (code === IGNORED) {
      ;(isFolder ? ignoredFolders : ignoredFiles).push(bare)
    }
  }
  return { files, repositories, ignoredFiles, ignoredFolders }
}

/** A blob in a tree: its mode and object name. */
export interface BlobRef {
  readonly mode: string
  readonly oid: string
}

/** One path that differs between two trees; `undefined` on the side it is absent from. */
export interface TreeChange {
  readonly path: string
  readonly before: BlobRef | undefined
  readonly after: BlobRef | undefined
}

/** `git diff-tree -r -z --no-renames <a> <b>`: a raw header, then the path. */
export function parseDiffTree(output: string): readonly TreeChange[] {
  const fields = splitNul(output)
  const changes: TreeChange[] = []
  for (let index = 0; index < fields.length; index += 1) {
    const header = fields[index] ?? ''
    if (!header.startsWith(RAW_MARK)) {
      continue
    }
    const changedPath = fields[index + 1]
    if (changedPath === undefined) {
      break
    }
    index += 1
    const [beforeMode = '', afterMode = '', beforeOid = '', afterOid = ''] = header
      .slice(RAW_MARK.length)
      .split(SPACE)
    changes.push({
      path: changedPath,
      before: beforeMode === ABSENT_MODE ? undefined : { mode: beforeMode, oid: beforeOid },
      after: afterMode === ABSENT_MODE ? undefined : { mode: afterMode, oid: afterOid },
    })
  }
  return changes
}

/**
 * `git cat-file --batch`: for each object asked, `<oid> <type> <size>` LF,
 * the bytes and LF; or `<name> missing` LF. Missing objects map to undefined.
 */
export function parseCatFileBatch(output: Buffer): ReadonlyMap<string, Buffer | undefined> {
  const objects = new Map<string, Buffer | undefined>()
  let offset = 0
  while (offset < output.length) {
    const lineEnd = output.indexOf(LINE_FEED, offset)
    if (lineEnd === -1) {
      break
    }
    const [name = '', type = '', sizeText = ''] = output
      .subarray(offset, lineEnd)
      .toString('utf8')
      .split(SPACE)
    offset = lineEnd + 1
    if (type === GIT_MISSING_OBJECT) {
      objects.set(name, undefined)
      continue
    }
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || offset + size > output.length) {
      throw new Error(`git cat-file answered a malformed header for ${name}`)
    }
    objects.set(name, Buffer.from(output.subarray(offset, offset + size)))
    offset += size + 1
  }
  return objects
}
