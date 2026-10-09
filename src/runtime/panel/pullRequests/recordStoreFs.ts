// The file operations under the worktree records' lock and generations
// (M123, PLAN.md M123's lock protocol): node's own, or a test's wrapper that
// pauses one call to stand two windows' interleaving exactly where it
// matters (a delayed old owner, a takeover between a read and a rename).

import type { BigIntStats } from 'node:fs'
import { link, lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'

export interface RecordStoreFs {
  /** Makes the folder and its parents; an existing folder is fine. */
  mkdir(folder: string): Promise<void>
  readdir(folder: string): Promise<readonly string[]>
  readFile(file: string): Promise<Buffer>
  /** Creates `file` exclusively (O_EXCL) with `content`, flushed; EEXIST when taken. */
  createExclusive(file: string, content: string): Promise<void>
  /** Publishes `existing` under `target` only while `target` is free; EEXIST when taken. */
  link(existing: string, target: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(file: string): Promise<void>
  /** The entry itself (a link is not followed), with exact native ids. */
  lstat(file: string): Promise<BigIntStats>
}

export const nodeRecordStoreFs: RecordStoreFs = {
  mkdir: async (folder) => {
    await mkdir(folder, { recursive: true })
  },
  readdir: (folder) => readdir(folder),
  readFile: (file) => readFile(file),
  createExclusive: (file, content) => writeFile(file, content, { flag: 'wx', flush: true }),
  link: (existing, target) => link(existing, target),
  rename: (from, to) => rename(from, to),
  unlink: (file) => unlink(file),
  lstat: (file) => lstat(file, { bigint: true }),
}

/** A lock instance moved aside by a takeover or release, removed right after (or swept). */
export const RETIRED_LOCK_SUFFIX = '.retired'

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

// What Windows answers while a scanner or an indexer holds a file.
const BUSY_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY'])

/** A refusal that clears once the holder lets go: try again later. */
export function isBusy(error: unknown): boolean {
  const code = errorCode(error)
  return code !== undefined && BUSY_CODES.has(code)
}
