// Conversations in a worktree (M71, PLAN.md D49; M77 builds on them). A
// worktree the extension made, for a new branch or for a pull request, is
// opened in its own window, where the backends run with the worktree as
// their root (the Model API's workspace root, `muse serve`'s working
// folder), so the conversation there cannot reach the main checkout, and
// VS Code's trust and language services apply to it as to any folder.
//
// The extension keeps one record per such worktree in its global state,
// which every window reads: the window that opens the worktree knows what it
// is (its branch, or its pull request) and whether it is held.
//
// A pull request someone else wrote is adversarial content until the user
// says otherwise. Its worktree goes under the extension's own storage, and
// a window whose root is anywhere under that folder is held whatever its
// record says, unless the record says the user confirmed trust for that
// very worktree in the extension's card: the conversation stays in Plan
// mode, and the project's rules, skills, hooks and MCP servers stay off.
// VS Code may trust the folder anyway (a trusted parent, or trust switched
// off), and the extension cannot ask VS Code about a folder before it
// opens, so the hold never depends on VS Code's answer.
//
// Pure: the host reads and writes the global state and the file system.

import { createHash } from 'node:crypto'
import path from 'node:path'
import * as z from 'zod/mini'
import { PULL_REQUEST_WORKTREES_DIR } from '../shared/constants'
import type { GitHubRepository } from './git/githubRemote'
import { isSamePath, isWithinFolder } from './paths'

const pullRequestOriginSchema = z.object({
  /** `owner/name`. */
  repository: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  /** The author's GitHub login. */
  author: z.string(),
  headSha: z.string(),
  isAuthoredByUser: z.boolean(),
})

const worktreeRecordSchema = z.object({
  folder: z.string(),
  /** The main checkout the worktree belongs to. */
  repositoryRoot: z.string(),
  createdAt: z.number(),
  /** The branch it was made on; undefined for a pull request's detached head. */
  branch: z.optional(z.string()),
  pullRequest: z.optional(pullRequestOriginSchema),
  /** Someone else's pull request: held until the user confirms trust in the card. */
  isHeld: z.boolean(),
  /**
   * Epoch ms of the user's confirmation in the held-worktree card: the only
   * thing that lets a window under the held folder go.
   */
  trustConfirmedAt: z.optional(z.number()),
})

export type WorktreeRecord = z.infer<typeof worktreeRecordSchema>
export type PullRequestOrigin = z.infer<typeof pullRequestOriginSchema>

const registrySchema = z.array(worktreeRecordSchema)

// A pull request worktree's folder name: its number and a short digest of
// the repository, kept short for Windows' path limit.
const REPOSITORY_DIGEST_CHARS = 8

/**
 * The records as stored; a value an earlier version or a hand edit left
 * that does not validate reads as none (the hold is by location anyway).
 */
export function parseWorktreeRegistry(raw: unknown): readonly WorktreeRecord[] {
  const parsed = registrySchema.safeParse(raw ?? [])
  return parsed.success ? parsed.data : []
}

export function recordFor(
  records: readonly WorktreeRecord[],
  folder: string,
  platform: NodeJS.Platform,
): WorktreeRecord | undefined {
  return records.find((record) => isSamePath(record.folder, folder, platform))
}

/** The records with `record` in place of any for the same folder. */
export function withRecord(
  records: readonly WorktreeRecord[],
  record: WorktreeRecord,
  platform: NodeJS.Platform,
): readonly WorktreeRecord[] {
  return [...records.filter((entry) => !isSamePath(entry.folder, record.folder, platform)), record]
}

/** Where someone else's pull requests are checked out: under the extension's own storage. */
export function heldWorktreesRoot(storageRoot: string, platform: NodeJS.Platform): string {
  return (platform === 'win32' ? path.win32 : path.posix).join(
    storageRoot,
    PULL_REQUEST_WORKTREES_DIR,
  )
}

/** `<held root>/<number>-<digest>`: one folder per pull request of one repository. */
export function heldWorktreeFolder(
  storageRoot: string,
  repository: GitHubRepository,
  number: number,
  platform: NodeJS.Platform,
): string {
  const digest = createHash('sha256')
    .update(`${repository.owner}/${repository.name}`.toLowerCase())
    .digest('hex')
    .slice(0, REPOSITORY_DIGEST_CHARS)
  return (platform === 'win32' ? path.win32 : path.posix).join(
    heldWorktreesRoot(storageRoot, platform),
    `${String(number)}-${digest}`,
  )
}

export interface WorktreeHold {
  /** The worktree's own folder, whose record a confirmation marks. */
  readonly folder: string
  /** What the card names; undefined when the record is gone. */
  readonly pullRequest: PullRequestOrigin | undefined
}

/**
 * Whether a window whose root is `root` is held. `roots` and `heldRoots`
 * are the same paths in each spelling the host could read (as given, and
 * resolved through links): any pair that places the root under a held root
 * holds it. Only a record for that worktree whose trust the user confirmed
 * in the card lets it go; no other record does, whatever it says (a branch
 * made from the pull request inside that folder is someone else's code too).
 */
export function holdFor(
  roots: readonly string[],
  heldRoots: readonly string[],
  records: readonly WorktreeRecord[],
  platform: NodeJS.Platform,
): WorktreeHold | undefined {
  // The held root itself counts: it holds every pull request checked out there.
  for (const root of roots) {
    if (heldRoots.every((held) => !isWithinFolder(root, held, platform))) continue
    const record = records.find((entry) => isWithinFolder(root, entry.folder, platform))
    if (record?.trustConfirmedAt === undefined) {
      return { folder: record?.folder ?? root, pullRequest: record?.pullRequest }
    }
  }
  return undefined
}
