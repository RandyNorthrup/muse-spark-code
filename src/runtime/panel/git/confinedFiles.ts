// Working-tree files read under the repository's bound root (M123 lane G,
// PLAN.md D104): a new file's start for a commit-message prompt, and the
// fingerprint of the unstaged and new files a commit form shows.
//
// `O_NOFOLLOW` protects only the last component, and Windows has none. So a
// read is checked by identity at every step of its path: the root is the
// directory the service bound to; every ancestor below it is a real
// directory (not a link or junction), with its volume and file id taken
// before the open and again after it; the leaf is a regular file, and the
// handle opened is that same file. A link inside the tree, or an ancestor
// that is a link or another directory at either sample, is refused
// (`changed`). The path's text comes from git's own status and is refused
// unless every component is a plain name.
//
// Residual (PLAN.md D104's threat boundary, RVM123G2 R4): the open itself
// is path-based. A same-user process that swaps an ancestor for a link
// after the first sample and restores it before the second, while the
// open walks the path, is not detected. Node has no handle-relative
// (`openat`) walk; that process already holds the user's authority, and
// the boundary leaves it out rather than claim it.

import { createHash } from 'node:crypto'
import { constants as fsConstants, type BigIntStats } from 'node:fs'
import { open, readlink, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import {
  handleIdentity,
  identityOf,
  lstatIdentity,
  sameFile,
  type FileIdentity,
} from '../../../core/fs/fileIdentity'
import { isMissingPath } from '../../../host/canonicalPath'
import { BOUNDED_FILE_READ_CHUNK_BYTES } from '../../../shared/constants'

/** The root a read is confined to: its path and the identity it was bound with. */
export interface ConfinedRoot {
  readonly path: string
  readonly identity: FileIdentity
}

/** A confinement refusal: an ancestor or the leaf is not what it was. */
export class ConfinementError extends Error {
  public constructor() {
    super('changed')
    this.name = 'ConfinementError'
  }
}

/** Components of a path git listed, or undefined for anything but plain names. */
function componentsOf(relative: string, platform: NodeJS.Platform): readonly string[] | undefined {
  const parts = relative.split('/')
  const isPlain = parts.every(
    (part) =>
      part !== '' &&
      part !== '.' &&
      part !== '..' &&
      !part.includes('\0') &&
      (platform !== 'win32' || !/[\\:]/.test(part)),
  )
  return isPlain ? parts : undefined
}

/** A path's own entry (never followed), or undefined when it is missing. */
async function entryAt(target: string): Promise<BigIntStats | undefined> {
  try {
    return await lstatIdentity(target)
  } catch (error: unknown) {
    if (isMissingPath(error)) {
      return undefined
    }
    throw error
  }
}

/**
The root and every directory below it on the way to the leaf, by
identity; undefined when one is missing. Throws `ConfinementError` when
the root is not the bound one, or a step is a link, a junction or not a
directory.
*/
async function ancestorChain(
  root: ConfinedRoot,
  parts: readonly string[],
): Promise<readonly FileIdentity[] | undefined> {
  const chain: FileIdentity[] = []
  // The root, then each folder on the way: every component but the leaf.
  const folders = [root.path]
  const below = parts.slice(0, -1)
  for (const part of below) {
    folders.push(path.join(folders.at(-1) ?? root.path, part))
  }
  for (const folder of folders) {
    const stats = await entryAt(folder)
    if (stats === undefined) {
      return undefined
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ConfinementError()
    }
    const identity = identityOf(stats)
    if (chain.length === 0 && !sameFile(identity, root.identity)) {
      throw new ConfinementError()
    }
    chain.push(identity)
  }
  return chain
}

function isSameChain(before: readonly FileIdentity[], after: readonly FileIdentity[]): boolean {
  return (
    before.length === after.length &&
    before.every((identity, index) => {
      const other = after[index]
      return other !== undefined && sameFile(identity, other)
    })
  )
}

/** What sits at a confined path: a regular file (open), a link's text, or nothing readable. */
export type ConfinedEntry =
  | { readonly kind: 'file'; readonly handle: FileHandle; readonly size: number }
  | { readonly kind: 'link'; readonly target: string }
  | { readonly kind: 'absent' | 'other' }

/** The leaf, opened only if it is the regular file `leaf` named (O_NOFOLLOW where there is one). */
async function openLeaf(leafPath: string, leaf: BigIntStats): Promise<ConfinedEntry> {
  if (leaf.isSymbolicLink()) {
    return { kind: 'link', target: await readlink(leafPath) }
  }
  if (!leaf.isFile()) {
    return { kind: 'other' }
  }
  const handle = await open(leafPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const opened = await handleIdentity(handle)
    if (!opened.isFile() || !sameFile(identityOf(opened), identityOf(leaf))) {
      throw new ConfinementError()
    }
    return { kind: 'file', handle, size: Number(opened.size) }
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
}

/**
Opens `relative` under `root`, confined by identity (see the file
comment). `check` runs after every await. A missing file is `absent`, a
folder or a device `other`; a link's own text is read, never its target.
*/
export async function openConfined(
  root: ConfinedRoot,
  relative: string,
  check: () => void,
  platform: NodeJS.Platform = process.platform,
): Promise<ConfinedEntry> {
  const parts = componentsOf(relative, platform)
  if (parts === undefined) {
    throw new ConfinementError()
  }
  const before = await ancestorChain(root, parts)
  check()
  if (before === undefined) {
    return { kind: 'absent' }
  }
  const leafPath = path.join(root.path, ...parts)
  const leaf = await entryAt(leafPath)
  check()
  if (leaf === undefined) {
    return { kind: 'absent' }
  }
  const entry = await openLeaf(leafPath, leaf)
  try {
    // Every ancestor is still the directory it was before the open.
    const after = await ancestorChain(root, parts)
    if (after === undefined || !isSameChain(before, after)) {
      throw new ConfinementError()
    }
    check()
  } catch (error: unknown) {
    if (entry.kind === 'file') {
      await entry.handle.close()
    }
    throw error
  }
  return entry
}

/** Up to `maxBytes` from the start of a confined regular file; undefined for anything else. */
export async function readConfinedStart(
  root: ConfinedRoot,
  relative: string,
  maxBytes: number,
  check: () => void,
): Promise<{ readonly bytes: Buffer; readonly size: number } | undefined> {
  const entry = await openConfined(root, relative, check)
  if (entry.kind !== 'file') {
    return undefined
  }
  try {
    const bytes = Buffer.alloc(Math.min(maxBytes, entry.size))
    let filled = 0
    while (filled < bytes.length) {
      const { bytesRead } = await entry.handle.read(bytes, filled, bytes.length - filled, filled)
      check()
      if (bytesRead === 0) {
        break
      }
      filled += bytesRead
    }
    return { bytes: bytes.subarray(0, filled), size: entry.size }
  } finally {
    await entry.handle.close()
  }
}

/**
One digest of the working tree's bytes under these paths (git's own
status names them): each path's kind, size and every byte of a regular
file, a link's text, or its absence. Streams in bounded chunks.
*/
export async function fingerprintConfined(
  root: ConfinedRoot,
  files: readonly string[],
  check: () => void,
): Promise<string> {
  const hash = createHash('sha256')
  for (const file of files) {
    check()
    const entry = await openConfined(root, file, check)
    if (entry.kind === 'link') {
      hash.update(JSON.stringify({ file, kind: entry.kind, target: entry.target }))
      continue
    }
    if (entry.kind !== 'file') {
      hash.update(JSON.stringify({ file, kind: entry.kind }))
      continue
    }
    hash.update(JSON.stringify({ file, kind: entry.kind, size: entry.size }))
    try {
      const buffer = Buffer.alloc(BOUNDED_FILE_READ_CHUNK_BYTES)
      let bytesRead: number
      do {
        ;({ bytesRead } = await entry.handle.read(buffer, 0, buffer.length, null))
        check()
        hash.update(buffer.subarray(0, bytesRead))
      } while (bytesRead !== 0)
    } finally {
      await entry.handle.close()
    }
  }
  return hash.digest('hex')
}
