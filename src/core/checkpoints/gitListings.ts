// What the checkpoint store's git commands print (M72, M86; PLAN.md D51,
// D63), read into plain values, and the object name git gives bytes. The
// formats are git's documented plumbing output. Pure: no git, no file system.

import { Buffer } from 'node:buffer'
import { createHash, type Hash } from 'node:crypto'
import { GIT_MISSING_OBJECT } from '../../shared/constants'

const NUL = '\0'
const SPACE = ' '
const LINE_FEED = 0x0a
// The shadow repository's object format (git's default; it runs with no
// global or system config that could change it).
const BLOB_HASH = 'sha1'
const BLOB_TYPE = 'blob'

/** A blob in a tree: its mode and object name. */
export interface BlobRef {
  readonly mode: string
  readonly oid: string
}

/**
 * `git cat-file --batch-check`: `<oid> <type> <size>` per object asked, or
 * `<name> missing`. Object name to size; a missing object is absent.
 */
export function parseBatchCheck(output: string): ReadonlyMap<string, number> {
  const sizes = new Map<string, number>()
  for (const line of output.split('\n')) {
    const [name = '', type = '', sizeText = ''] = line.split(SPACE)
    const size = Number(sizeText)
    if (name !== '' && type !== GIT_MISSING_OBJECT && Number.isSafeInteger(size)) {
      sizes.set(name, size)
    }
  }
  return sizes
}

/**
 * The object name git gives these bytes as a blob (SHA-1 of `blob <size>`,
 * NUL and the bytes): the shadow repository's object format, so a file can
 * be compared with what a capture holds without running git.
 */
export function gitBlobOid(bytes: Uint8Array): string {
  return gitBlobHash(bytes.length).update(bytes).digest('hex')
}

/** `gitBlobOid` of `size` bytes fed in parts (M86: a file too large to hold), in order. */
export function gitBlobHash(size: number): Hash {
  return createHash(BLOB_HASH).update(`${BLOB_TYPE}${SPACE}${String(size)}${NUL}`)
}

/** One answer of `git cat-file --batch`: the name it gave and the bytes (undefined: missing). */
export interface CatFileEntry {
  readonly name: string
  readonly content: Buffer | undefined
}

/**
 * `git cat-file --batch`: for each object asked, `<oid> <type> <size>` LF,
 * the bytes and LF; or `<name> missing` LF. The answers in the order asked.
 */
export function parseCatFileEntries(output: Buffer): readonly CatFileEntry[] {
  const entries: CatFileEntry[] = []
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
      entries.push({ name, content: undefined })
      continue
    }
    const size = Number(sizeText)
    if (!Number.isSafeInteger(size) || offset + size > output.length) {
      throw new Error(`git cat-file answered a malformed header for ${name}`)
    }
    entries.push({ name, content: Buffer.from(output.subarray(offset, offset + size)) })
    offset += size + 1
  }
  return entries
}

/** `git cat-file --batch` by object name; missing objects map to undefined. */
export function parseCatFileBatch(output: Buffer): ReadonlyMap<string, Buffer | undefined> {
  return new Map(parseCatFileEntries(output).map((entry) => [entry.name, entry.content]))
}
