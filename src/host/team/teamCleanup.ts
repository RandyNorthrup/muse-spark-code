import { readdir, rmdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { lstatIdentity, sameFile } from '../../core/fs/fileIdentity'
import { UI_TEXT } from '../../shared/constants'
import { canonicalPath, isMissingPath } from '../canonicalPath'
import { isSamePath } from '../../core/paths'

export interface TeamCopy {
  readonly path: string
  readonly windowInstanceId: string
  readonly taskId: string | null
  readonly outcome: string | null
  readonly quarantined: boolean
}
export interface TeamCleanupDeps {
  /** Window identity/Take over, never a missing or stale hint as proof. */
  readonly mayRemove: (copy: TeamCopy) => Promise<boolean>
  readonly hasFreshHint: (windowInstanceId: string) => Promise<boolean>
  readonly confirmQuarantine: (copy: TeamCopy, isWindowPossiblyOpen: boolean) => Promise<boolean>
  readonly removeRef: (ref: string, expectedOid: string) => Promise<void>
}

/** Reject storage escapes and ancestor links, without following the final link itself. */
async function assertCopyPath(storage: string, target: string): Promise<void> {
  const relative = path.relative(storage, path.resolve(target))
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(UI_TEXT.checkpointFailed)
  const parent = await canonicalPath(path.dirname(target))
  if (!isSamePath(parent, path.dirname(target), process.platform))
    throw new Error(UI_TEXT.checkpointFailed)
}

/** Link-safe recursion: junctions/symlinks are unlinked; directories are never rm -r'd. */
async function walkCopy(storage: string, target: string, shouldRemove: boolean): Promise<number> {
  await assertCopyPath(storage, target)
  const file = path.toNamespacedPath(target)
  let held
  try {
    held = await lstatIdentity(file)
  } catch (error: unknown) {
    if (isMissingPath(error)) return 0
    throw error
  }
  if (held.isSymbolicLink() || !held.isDirectory()) {
    if (shouldRemove) {
      await assertCopyPath(storage, target)
      if (!sameFile(held, await lstatIdentity(file))) throw new Error(UI_TEXT.checkpointFailed)
      await unlink(file)
    }
    return Number(held.size)
  }
  await assertCopyPath(storage, target)
  if (
    !isSamePath(await canonicalPath(target), target, process.platform) ||
    !sameFile(held, await lstatIdentity(file))
  )
    throw new Error(UI_TEXT.checkpointFailed)
  let bytes = 0
  const names = await readdir(file)
  for (const name of names) bytes += await walkCopy(storage, path.join(target, name), shouldRemove)
  if (shouldRemove) {
    await assertCopyPath(storage, target)
    if (!sameFile(held, await lstatIdentity(file))) throw new Error(UI_TEXT.checkpointFailed)
    await rmdir(file)
  }
  return bytes
}

export class TeamCleanup {
  public constructor(
    private readonly storageRoot: string,
    private readonly deps: TeamCleanupDeps,
  ) {}

  public async diskUse(copy: string): Promise<number> {
    return await walkCopy(await canonicalPath(this.storageRoot), path.resolve(copy), false)
  }

  /** At startup: terminal copies/refs and owned orphans. Unmerged work is retained. */
  public async sweep(
    copies: readonly TeamCopy[],
    refs: readonly {
      readonly name: string
      readonly oid: string
      readonly outcome: string
      readonly owner: TeamCopy
    }[],
    isUserCleanup = false,
  ): Promise<readonly string[]> {
    const storage = await canonicalPath(this.storageRoot)
    const removed: string[] = []
    for (const copy of copies) {
      if (!(await this.deps.mayRemove(copy))) continue
      if (copy.quarantined) {
        if (
          !isUserCleanup ||
          !(await this.deps.confirmQuarantine(
            copy,
            await this.deps.hasFreshHint(copy.windowInstanceId),
          ))
        )
          continue
      } else if (copy.taskId !== null && copy.outcome !== 'merged' && copy.outcome !== 'discarded')
        continue
      await walkCopy(storage, path.resolve(copy.path), true)
      removed.push(copy.path)
    }
    for (const ref of refs) {
      if (
        !ref.name.startsWith('refs/heads/agents/') ||
        ref.name.includes('..') ||
        (ref.outcome !== 'merged' && ref.outcome !== 'discarded') ||
        !(await this.deps.mayRemove(ref.owner))
      )
        continue
      await this.deps.removeRef(ref.name, ref.oid)
    }
    return removed
  }
}
