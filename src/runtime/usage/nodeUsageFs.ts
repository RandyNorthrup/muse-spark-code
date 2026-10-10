// The same private data folder is injected by VSIX, ACP, native runtimes and CLI.
import { randomUUID } from 'node:crypto'
import { constants, type BigIntStats, type Dirent } from 'node:fs'
import { link, lstat, mkdir, open, readdir, readFile, rename, rm, rmdir } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHECKPOINT_STORAGE_MODE,
  CHECKPOINT_JOURNAL_FILE_MODE,
  USAGE_FOLDER,
  USAGE_REMOVE_RETRIES,
  USAGE_TRASH_SWEEP_MS,
} from '../../shared/constants'
import type { UsageFs, UsageFileStat, UsageLock } from '../../core/usage/journalStore'
import { createFileExclusively, isNameTaken, writeFileAtomically } from '../../host/fsAtomic'
import { canonicalPath } from '../../host/canonicalPath'
import { fileIdentityKey, lstatIdentity } from '../../core/fs/fileIdentity'

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}
// A quarantined entry: `.removing-<epoch ms>.<uuid>.<original name>`, or an
// earlier build's `.removing-<uuid>` (RVM107W2H P2-1): no time (always stale)
// and no original name (it may be any entry of its folder).
const TRASH_PATTERN = /^\.removing-(?:(\d{1,16})\.)?[\da-f-]{36}(?:\.([\w.-]+))?$/u
interface TrashEntry {
  readonly name: string
  readonly atMs: number
  readonly target: string | undefined
}
function trashEntry(name: string): TrashEntry | undefined {
  const match = TRASH_PATTERN.exec(name)
  return match === null ? undefined : { name, atMs: Number(match[1] ?? 0), target: match[2] }
}
/** The entry's own (no-follow) stat, or undefined when nothing is there. */
async function lstatEntry(file: string): Promise<BigIntStats | undefined> {
  try {
    return await lstatIdentity(file)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
}
async function isAbsent(file: string): Promise<boolean> {
  return (await lstatEntry(file)) === undefined
}
/** Deletes `file` and proves it gone; a leftover is a failure, never a success. */
async function erase(file: string): Promise<void> {
  await rm(file, { recursive: true, force: true, maxRetries: USAGE_REMOVE_RETRIES })
  if (!(await isAbsent(file))) throw new Error('usageRemoveIncomplete')
}
/**
 * Moves `from` back to the name `to` without replacing an entry that took it
 * (RVM107W2H P2-5): a file by `link` (no-replace everywhere), then unlink. A
 * directory on POSIX claims the name with an exclusive `mkdir` first, so the
 * rename can replace only an empty directory, and a failed rename gives the
 * claim back (`rmdir`, empty only). Windows never renames over a directory but
 * does over a file, and cannot claim a name: the name is checked free right
 * before the rename (the residual window in SECURITY). A taken name throws.
 */
async function restore(from: string, to: string, isDirectory: boolean): Promise<void> {
  if (!isDirectory) {
    await link(from, to)
    await rm(from)
    return
  }
  if (process.platform === 'win32') {
    if (!(await isAbsent(to))) throw new Error('usageNameTaken')
    await rename(from, to)
    return
  }
  await mkdir(to)
  try {
    await rename(from, to)
  } catch (error) {
    try {
      await rmdir(to)
    } catch {
      // No longer our empty claim: left as it is.
    }
    throw error
  }
}
/**
 * On Windows, runs `action` holding a handle on `file`, proved to be
 * `identity`. Windows refuses to rename a directory while any handle under it
 * is open, so no ancestor of `file` can be swapped for a link meanwhile; our
 * own rename and delete of `file` still work. Linux pins the parent instead
 * (inParent); macOS has neither (the documented residual).
 */
async function pinned<T>(file: string, identity: string, action: () => Promise<T>): Promise<T> {
  if (process.platform !== 'win32') return await action()
  const handle = await open(file, constants.O_RDONLY)
  try {
    if (fileIdentityKey(await handle.stat({ bigint: true })) !== identity)
      throw new Error('usagePathChanged')
    return await action()
  } finally {
    await handle.close()
  }
}
export class NodeUsageFs implements UsageFs {
  private root: Promise<string> | undefined
  public constructor(
    private readonly dataFolder: string,
    private readonly now: () => number = Date.now,
  ) {}
  private trustedRoot(): Promise<string> {
    // Resolve trusted ancestors once (e.g. macOS /var → /private/var), before
    // checking each component inside the store for links on every operation.
    return (this.root ??= canonicalPath(this.dataFolder))
  }
  private async resolve(relative: string): Promise<string> {
    const parts = relative.split('/')
    if (
      parts[0] !== USAGE_FOLDER ||
      parts.some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
    ) {
      throw new Error('invalidUsagePath')
    }
    return path.join(await this.trustedRoot(), ...parts)
  }
  /** Refuse linked ancestors, including on reads, so another folder is never consulted. */
  private async checkPath(file: string): Promise<void> {
    const root = await this.trustedRoot()
    let current = root
    for (const part of ['', ...path.relative(root, file).split(path.sep)]) {
      current = path.join(current, part)
      try {
        const stat = await lstat(current)
        if (stat.isSymbolicLink()) throw new Error('linkedUsagePath')
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error
      }
    }
  }
  private async prepare(file: string): Promise<void> {
    await this.checkPath(file)
    await mkdir(path.dirname(file), { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    await this.checkPath(file)
  }
  /**
   * Runs `action` against a validated parent directory. On Linux the parent is
   * opened (no follow) and pinned through `/proc/self/fd/<fd>`, so every rename,
   * stat and delete below acts on that verified inode whatever happens to the
   * path above it. Elsewhere Node has no openat/renameat: `base` is the parent's
   * path, and the parent's identity is re-proved around each step instead
   * (Windows also pins each entry it renames or deletes: `pinned`).
   * `proveParent` throws `usagePathChanged` once the parent is not the same.
   */
  private async inParent<T>(
    parent: string,
    action: (base: string, proveParent: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    await this.checkPath(parent)
    const sample = await lstatIdentity(parent)
    const identity = fileIdentityKey(sample)
    if (identity === undefined || sample.isSymbolicLink() || !sample.isDirectory())
      throw new Error('unsafeUsagePath')
    const proveParent = async (): Promise<void> => {
      let isSame = false
      try {
        await this.checkPath(parent)
        const current = await lstatIdentity(parent)
        isSame = !current.isSymbolicLink() && fileIdentityKey(current) === identity
      } catch {
        // Unreadable counts as changed.
      }
      if (!isSame) throw new Error('usagePathChanged')
    }
    if (process.platform !== 'linux') return await action(parent, proveParent)
    const handle = await open(
      parent,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    )
    try {
      if (fileIdentityKey(await handle.stat({ bigint: true })) !== identity)
        throw new Error('usagePathChanged')
      return await action(`/proc/self/fd/${String(handle.fd)}`, proveParent)
    } finally {
      await handle.close()
    }
  }
  /** Deletes one quarantined entry; it must still be our trash name, not a link. */
  private async purge(base: string, entry: TrashEntry): Promise<void> {
    const trash = path.join(base, entry.name)
    const sample = await lstatEntry(trash)
    if (sample === undefined) return
    const identity = fileIdentityKey(sample)
    if (identity === undefined || sample.isSymbolicLink()) throw new Error('unsafeUsagePath')
    await pinned(trash, identity, () => erase(trash))
  }
  /** Removes matching quarantined entries in a validated parent; any failure throws. */
  private async sweepIn(
    base: string,
    proveParent: () => Promise<void>,
    isWanted: (entry: TrashEntry) => boolean,
  ): Promise<void> {
    const names = await readdir(base)
    for (const name of names) {
      const entry = trashEntry(name)
      if (entry === undefined || !isWanted(entry)) continue
      await proveParent()
      await this.purge(base, entry)
    }
  }
  /** Quarantined entries old enough that no removal in any process still owns them. */
  private isStale(entry: TrashEntry | undefined): boolean {
    return entry !== undefined && this.now() - entry.atMs >= USAGE_TRASH_SWEEP_MS
  }
  private async lockState(relative: string) {
    const folder = relative.slice(0, relative.lastIndexOf('/'))
    const content = await readFile(await this.resolve(`${relative}.epoch`), 'utf8')
    const epoch = content.trim()
    if (!/^[\w-]+$/.test(epoch)) throw new Error('invalidUsageLock')
    const name = `${path.basename(relative)}.${epoch}`
    const names = await this.list(folder)
    const claims = names.filter(
      (entry) => entry.startsWith(`${name}.`) && /^\d+$/.test(entry.slice(name.length + 1)),
    )
    let generation = 0
    for (const entry of claims)
      generation = Math.max(generation, Number(entry.slice(name.length + 1)))
    if (!Number.isSafeInteger(generation + 1)) throw new Error('invalidUsageLock')
    return {
      folder,
      names,
      epoch,
      generation,
      claim: `${relative}.${epoch}.${String(generation)}`,
    }
  }
  public async list(folder: string): Promise<readonly string[]> {
    const file = await this.resolve(folder)
    await this.checkPath(file)
    let entries: Dirent[]
    try {
      entries = await readdir(file, { withFileTypes: true })
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    if (entries.some((entry) => this.isStale(trashEntry(entry.name)))) {
      try {
        await this.sweep(folder)
      } catch {
        // A read never fails on cleanup; remove() and retention report it.
      }
    }
    return entries
      .filter((entry) => !entry.isSymbolicLink() && trashEntry(entry.name) === undefined)
      .map((entry) => entry.name)
      .toSorted((a, b) => a.localeCompare(b))
  }
  /** Strictly removes stale quarantined entries in `folder`; a failure throws. */
  public async sweep(folder: string): Promise<void> {
    const file = await this.resolve(folder)
    if (await isAbsent(file)) return
    await this.inParent(file, async (base, proveParent) => {
      await this.sweepIn(base, proveParent, (entry) => this.isStale(entry))
    })
  }
  public async stat(relative: string): Promise<UsageFileStat | undefined> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    try {
      const stat = await lstat(file)
      if (!stat.isFile()) throw new Error('invalidUsageFile')
      return { size: stat.size, mtimeMs: stat.mtimeMs }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return undefined
      throw error
    }
  }
  public async read(relative: string, offset: number, length?: number): Promise<Uint8Array> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    const handle = await open(
      file,
      constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
    )
    try {
      if (length === undefined) return await handle.readFile()
      const bytes = new Uint8Array(length)
      let count = 0
      while (count < length) {
        const result = await handle.read(bytes, count, length - count, offset + count)
        if (result.bytesRead === 0) break
        count += result.bytesRead
      }
      return bytes.subarray(0, count)
    } finally {
      await handle.close()
    }
  }
  /** `commit` (a fence) runs on the opened file, immediately before the write. */
  public async append(
    relative: string,
    line: string,
    isDurable = false,
    commit?: () => Promise<void>,
  ): Promise<void> {
    const file = await this.resolve(relative)
    await this.prepare(file)
    const handle = await open(
      file,
      constants.O_WRONLY |
        constants.O_APPEND |
        constants.O_CREAT |
        (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
      CHECKPOINT_JOURNAL_FILE_MODE,
    )
    try {
      await commit?.()
      await handle.writeFile(line, 'utf8')
      if (isDurable) await handle.sync()
    } finally {
      await handle.close()
    }
  }
  /** `commit` (a fence) runs on the flushed stage, immediately before its rename. */
  public async writeFileAtomically(
    relative: string,
    text: string,
    commit?: () => Promise<void>,
  ): Promise<void> {
    const file = await this.resolve(relative)
    await this.prepare(file)
    await writeFileAtomically(file, text, {
      sleep: delay,
      expectedCanonicalPath: file,
      // Flush the closed stage through its own handle before atomic publication.
      // The helper retains its identity/path/mode guards and Windows retries;
      // no retry unlinks the destination or writes through its live path.
      rename: async (from, to) => {
        const handle = await open(
          from,
          constants.O_WRONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
        )
        try {
          await handle.sync()
        } finally {
          await handle.close()
        }
        await commit?.()
        await rename(from, to)
      },
    })
  }
  /**
   * Race-safe removal (RVM107W2 P1, RVM107W2G P2-1/P2-3).
   *
   * - A checked pathname is never deleted by name: the entry is renamed to a
   *   fresh quarantine name in its validated parent, and deleted only once that
   *   name proves to be the validated entry (dev/ino) in the same parent.
   * - Success means the entry and every quarantine of the same name (in either
   *   format) are gone, so a retry never reports a leftover as removed.
   * - `commit` (a fence) runs on the proven quarantine, immediately before the
   *   delete; a refusal puts the entry back.
   * - Linux pins the parent by descriptor and Windows pins every ancestor by a
   *   handle on the entry, so a swapped ancestor cannot redirect the rename or
   *   the delete. macOS has neither: a swap during the rename itself can move
   *   an outside entry to a quarantine name in its own directory. That entry is
   *   not deleted by this call (the identity proof fails first) and is put back
   *   only when it is reachable from the validated parent. The residuals are
   *   listed in docs/certification/m107-w-history.md.
   */
  public async remove(relative: string, commit?: () => Promise<void>): Promise<void> {
    const file = await this.resolve(relative)
    await this.checkPath(file)
    const name = path.basename(file)
    await this.inParent(path.dirname(file), async (base, proveParent) => {
      const source = path.join(base, name)
      const target = await lstatEntry(source)
      if (target !== undefined) {
        const targetIdentity = fileIdentityKey(target)
        if (targetIdentity === undefined || target.isSymbolicLink())
          throw new Error('unsafeUsagePath')
        await pinned(source, targetIdentity, async () => {
          await proveParent()
          const trash = path.join(base, `.removing-${String(this.now())}.${randomUUID()}.${name}`)
          try {
            await rename(source, trash)
          } catch (error) {
            // Already gone, from a parent that is still the validated one.
            if (errorCode(error) !== 'ENOENT') throw error
            await proveParent()
            return
          }
          let refusal: Error | undefined
          try {
            const moved = await lstatIdentity(trash)
            await proveParent()
            if (moved.isSymbolicLink() || fileIdentityKey(moved) !== targetIdentity)
              refusal = new Error('usagePathChanged')
          } catch {
            refusal = new Error('usagePathChanged')
          }
          // The fence refuses with its own error (RVM107W2L): only an identity
          // or parent change is reported as usagePathChanged.
          if (refusal === undefined)
            try {
              await commit?.()
            } catch (error) {
              refusal = error instanceof Error ? error : new Error(String(error), { cause: error })
            }
          if (refusal !== undefined) {
            // Put back what this rename moved into the validated parent, never
            // over a replacement, then refuse.
            try {
              const moved = await lstatEntry(trash)
              if (moved !== undefined) await restore(trash, source, moved.isDirectory())
            } catch {
              // Left under its quarantine name; the refusal below still stands.
            }
            throw refusal
          }
          await erase(trash)
        })
      }
      // Then every quarantine of this name, of any age or format: success means
      // nothing of it is left. A swap during removal is reported, never a success.
      await this.sweepIn(base, proveParent, (entry) => (entry.target ?? name) === name)
      await proveParent()
    })
  }
  public async acquireLock(relative: string, staleMs: number): Promise<UsageLock | undefined> {
    await this.prepare(await this.resolve(relative))
    const anchor = `${relative}.epoch`
    if ((await this.stat(anchor)) === undefined) {
      const legacy = await this.stat(relative)
      if (legacy !== undefined && this.now() - legacy.mtimeMs <= staleMs) return undefined
      try {
        await createFileExclusively(await this.resolve(anchor), randomUUID(), {
          mode: CHECKPOINT_JOURNAL_FILE_MODE,
          expectedDirectory: path.dirname(await this.resolve(relative)),
          warn: (_file, _isPublished, error) => {
            throw error
          },
        })
      } catch (error) {
        if (!isNameTaken(error)) throw error
      }
    }
    const previous = await this.lockState(relative)
    const stat = await this.stat(previous.claim)
    if (stat !== undefined) {
      let previousToken: string
      try {
        const content = await readFile(await this.resolve(previous.claim), 'utf8')
        previousToken = content.trim()
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return undefined
        throw error
      }
      if (previousToken !== '' && !/^[\w-]+$/.test(previousToken))
        throw new Error('invalidUsageLock')
      const isReleased =
        previousToken !== '' &&
        (await this.stat(`${previous.claim}.${previousToken}.released`)) !== undefined
      if (!isReleased && this.now() - stat.mtimeMs <= staleMs) return undefined
    }
    const generation = previous.generation + 1
    const claim = `${relative}.${previous.epoch}.${String(generation)}`
    const file = await this.resolve(claim)
    const token = randomUUID()
    try {
      const handle = await open(file, 'wx', CHECKPOINT_JOURNAL_FILE_MODE)
      try {
        await handle.writeFile(token, 'utf8')
      } finally {
        await handle.close()
      }
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return undefined
      throw error
    }
    const isHeld = async (): Promise<boolean> => {
      try {
        const current = await this.lockState(relative)
        return (
          current.generation === generation &&
          current.epoch === previous.epoch &&
          (await readFile(file, 'utf8')) === token &&
          (await this.stat(`${claim}.${token}.released`)) === undefined
        )
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return false
        throw error
      }
    }
    // Publishing the successor comes first. Cleanup touches only observed
    // older generation names; delayed contenders must pass isHeld too.
    if (!(await isHeld())) return undefined
    for (const name of previous.names) {
      const prefix = `${path.basename(relative)}.${previous.epoch}.`
      if (name.startsWith(prefix) && /^\d+(?:\.|$)/.test(name.slice(prefix.length))) {
        await this.remove(`${previous.folder}/${name}`)
      }
    }
    if (!(await isHeld())) return undefined
    return {
      token,
      generation,
      isHeld,
      release: async () => {
        // Even if this owner pauses after the check, only its own immutable
        // token gets a release marker. It never unlinks a shared lock path.
        if (await isHeld()) await this.append(`${claim}.${token}.released`, '')
      },
    }
  }
}
