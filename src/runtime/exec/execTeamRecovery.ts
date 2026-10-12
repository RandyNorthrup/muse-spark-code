// M96b headless-run recovery (RVCM96B2 P2 findings 4-6): the run's durable
// clean-up ledger, the stale-run sweep, denied-merge hold refs and the merge
// marker gate. Loads only for --team, beside execTeamEntry; never at activation.
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import { isTeamGitError, type TeamGit } from '../../core/team/teamWorkspaces'
import { teamAgentsRef, teamBranchName } from '../../core/team/refFence'
import {
  EXEC_TEAM_CLEANUP_FILE,
  EXEC_TEAM_GIT_TIMEOUT_MS,
  EXEC_TEAM_HOLD_REF_PREFIX,
  EXEC_TEAM_MARKER_SCAN_BYTES,
  EXEC_TEAM_RUN_PREFIX,
} from '../../shared/constants'

/** Who owns a run folder: the process id and its birth, against pid reuse. */
export interface CleanupOwner {
  readonly pid: number
  readonly startedAt: number
}

/** One artifact a run created: an owned ref, a held branch or a work folder. */
export interface CleanupEntry {
  readonly repo: string
  readonly role: string
  readonly taskId: string
  readonly ref: string
}

const cleanupOwnerSchema = z.object({ pid: z.number(), startedAt: z.number() })
const cleanupEntrySchema = z.object({
  repo: z.string(),
  role: z.string(),
  taskId: z.string(),
  ref: z.string(),
})
const cleanupLedgerSchema = z.object({
  owner: cleanupOwnerSchema,
  refs: z.optional(z.array(cleanupEntrySchema)),
  holds: z.optional(z.array(cleanupEntrySchema)),
})

export interface CleanupLedger {
  readonly owner: CleanupOwner
  readonly refs: readonly CleanupEntry[]
  readonly holds: readonly CleanupEntry[]
}

const ledgerFile = (folder: string): string => path.join(folder, EXEC_TEAM_CLEANUP_FILE)

async function readLedger(folder: string): Promise<CleanupLedger | undefined> {
  let raw: Uint8Array
  try {
    raw = await readFile(ledgerFile(folder))
  } catch {
    return undefined
  }
  const parsed = cleanupLedgerSchema.safeParse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) as unknown,
  )
  if (!parsed.success) return undefined
  return {
    owner: parsed.data.owner,
    refs: parsed.data.refs ?? [],
    holds: parsed.data.holds ?? [],
  }
}

async function writeLedger(folder: string, ledger: CleanupLedger): Promise<void> {
  const target = ledgerFile(folder)
  const temporary = `${target}.new`
  await writeFile(temporary, JSON.stringify(ledger))
  await rename(temporary, target)
}

const MS_PER_SECOND = 1000

/** The current process as a ledger owner (pid with its birth, against reuse). */
export function currentOwner(): CleanupOwner {
  return { pid: process.pid, startedAt: Date.now() - process.uptime() * MS_PER_SECOND }
}

/** Record the run-folder owner before anything else is created. */
export async function recordCleanupOwner(folder: string, owner: CleanupOwner): Promise<void> {
  await writeLedger(folder, { owner, refs: [], holds: [] })
}

/** Record an owned agents ref BEFORE its worker starts, so a later run sweeps it. */
export async function recordCleanupRef(folder: string, entry: CleanupEntry): Promise<void> {
  const ledger = (await readLedger(folder)) ?? {
    owner: currentOwner(),
    refs: [],
    holds: [],
  }
  if (ledger.refs.some((known) => known.ref === entry.ref && known.repo === entry.repo)) return
  await writeLedger(folder, { ...ledger, refs: [...ledger.refs, entry] })
}

/** Forget a ref the run itself removed on a normal end. */
export async function pruneCleanupRef(folder: string, repo: string, ref: string): Promise<void> {
  const ledger = await readLedger(folder)
  if (ledger === undefined) return
  const refs = ledger.refs.filter((known) => !(known.ref === ref && known.repo === repo))
  if (refs.length === ledger.refs.length) return
  await writeLedger(folder, { ...ledger, refs })
}

/**
 * The agents ref a worker run is about to own, or undefined for a bad name.
 * The same pure functions the workspace setup uses, so the sweep deletes
 * only a ref the run could have created.
 */
export function predictedAgentsRef(role: string, taskId: string): string | undefined {
  try {
    return teamAgentsRef(teamBranchName(role, taskId))
  } catch {
    return undefined
  }
}

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

/** A bounded wait timed out (never user-facing English: callers fall back). */
const GIT_TIMEOUT_MARK = 'git-timeout-ms='

function gitTimeout(timeoutMs: number): Error {
  return new Error(`${GIT_TIMEOUT_MARK}${String(timeoutMs)}`)
}

/** Whether the error is our own bounded-wait timeout rather than tool output. */
export function isGitTimeout(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(GIT_TIMEOUT_MARK)
}

/** Bounded git: the ports bound the child; this bounds the wait and the bytes kept. */
export async function withGitBounds<T>(
  work: Promise<T>,
  timeoutMs = EXEC_TEAM_GIT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(gitTimeout(timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const MARKER_CHUNK = 100
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

type MarkerKind = 'equals' | 'pipes' | 'edge'

const markerKind = (content: string): MarkerKind | undefined => {
  if (content === '=======') return 'equals'
  if (content === '|||||||') return 'pipes'
  return /^(<{7}|>{7})(?=\s|$)/.test(content) ? 'edge' : undefined
}

/**
 * The merge gate (RVCM96B2 P2-5): scan the task's own diff for unresolved
 * conflict markers. Added lines only, so markers already committed in the
 * base (a setext heading, a fixture) never refuse. Ordinary content (hard
 * breaks, trailing spaces, CRLF) passes, as does a newly added setext
 * heading: a bare '=======' refuses only beside an opening, closing or
 * diff3 marker in the same file. A refusal names file and line. Returns
 * the refusal detail, or undefined when the branch is clean. The cap is
 * structural, never prose: callers carry the byte count inside their
 * translated template.
 */
export type MarkerScan =
  | { readonly status: 'clean' }
  | { readonly status: 'markers'; readonly detail: string }
  | { readonly status: 'too-large'; readonly bytes: number }

export async function scanConflictMarkers(
  git: TeamGit,
  folder: string,
  base: string,
  head: string,
  files: readonly string[],
  maxBytes = EXEC_TEAM_MARKER_SCAN_BYTES,
): Promise<MarkerScan> {
  const names = files.map((name) => name.replaceAll('\\', '/')).filter((name) => name !== '')
  if (names.length === 0) return { status: 'clean' }
  let total = 0
  for (let at = 0; at < names.length; at += MARKER_CHUNK) {
    const chunk = names.slice(at, at + MARKER_CHUNK)
    const raw = await withGitBounds(
      git(
        ['diff', '--no-color', '--no-ext-diff', '--no-textconv', base, head, '--', ...chunk],
        folder,
      ),
    )
    total += raw.length
    if (total > maxBytes) return { status: 'too-large', bytes: total }
    let file = ''
    let line = 0
    // A bare '=======' is also an ordinary Markdown setext heading: it
    // refuses only beside an opening, closing or diff3 marker in the same
    // file (RVCM96B2D P2-13). The decision waits for the file's end.
    let kinds = new Set<MarkerKind>()
    let first = ''
    const flushFile = (): MarkerScan | undefined =>
      kinds.has('edge') || kinds.has('pipes') || kinds.size > 1
        ? { status: 'markers', detail: first }
        : undefined
    const diffLines = new TextDecoder('utf-8', { fatal: false }).decode(raw).split('\n')
    for (const rawLine of diffLines) {
      const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
      if (text.startsWith('+++ ')) {
        const refused = flushFile()
        if (refused !== undefined) return refused
        const name = text.slice('+++ '.length)
        file = name.startsWith('b/') ? name.slice(2) : name
        kinds = new Set<MarkerKind>()
        first = ''
        continue
      }
      const hunk = HUNK_HEADER.exec(text)
      if (hunk !== null) {
        line = Number(hunk[1])
        continue
      }
      if (text.startsWith('+') && !text.startsWith('+++')) {
        const kind = markerKind(text.slice(1))
        if (kind !== undefined) {
          if (first === '') first = `${file}:${String(line)}`
          kinds.add(kind)
        }
        line += 1
      } else if (text.startsWith(' ')) {
        line += 1
      }
    }
    const refused = flushFile()
    if (refused !== undefined) return refused
  }
  return { status: 'clean' }
}

/**
 * A denied merge never destroys the finished branch (RVCM96B2 P2-6): keep
 * its head under the hold prefix, outside refs/heads/agents/. Only an
 * explicit discard (`git update-ref -d <ref>`), the unmerged-task retention
 * (TEAM_UNMERGED_NOTICE_DAYS: the user's own offer to discard), or a later
 * merge of the same task (which replaces the hold) removes it. The sweep
 * never touches holds.
 */
export async function createHoldRef(
  git: TeamGit,
  repo: string,
  folder: string,
  role: string,
  taskId: string,
  head: string,
): Promise<string> {
  // Throws on a bad name before anything is created.
  teamBranchName(role, taskId)
  if (!HOLD_HEAD_PATTERN.test(head)) throw new Error(`Refused team hold head for task ${taskId}`)
  const ref = `${EXEC_TEAM_HOLD_REF_PREFIX}${role}/${taskId}`
  // The clone is `--shared`: the task commit lives only in the copy, so the
  // ref must fetch the objects, not merely point at them. A later merge of
  // the same task replaces the hold (releaseHoldRef).
  await withGitBounds(git(['fetch', folder, `${head}:${ref}`], repo))
  return ref
}

const HOLD_HEAD_MIN_CHARS = 4
const HOLD_HEAD_MAX_CHARS = 128
const HOLD_HEAD_PATTERN = new RegExp(
  `^[0-9a-f]{${String(HOLD_HEAD_MIN_CHARS)},${String(HOLD_HEAD_MAX_CHARS)}}$`,
)

/**
 * A later merge of the same task replaces its hold (RVCM96B2 P2-6
 * retention): drop the hold ref when one exists, ignore when none does.
 * Other git failures propagate.
 */
export async function releaseHoldRef(
  git: TeamGit,
  repo: string,
  role: string,
  taskId: string,
): Promise<void> {
  teamBranchName(role, taskId)
  const ref = `${EXEC_TEAM_HOLD_REF_PREFIX}${role}/${taskId}`
  try {
    await withGitBounds(git(['rev-parse', '--verify', ref], repo))
  } catch (error: unknown) {
    // A verified absence ignores; a failed read propagates (P2-8).
    if (!isUnknownRevision(error)) throw error
    return
  }
  // Deleting an absent ref succeeds, so any failure here is real (P2-8).
  await withGitBounds(git(['update-ref', '-d', ref], repo))
}

/** Record a held branch in the run ledger beside the owned refs. */
export async function recordHoldRef(folder: string, entry: CleanupEntry): Promise<void> {
  const ledger = (await readLedger(folder)) ?? {
    owner: currentOwner(),
    refs: [],
    holds: [],
  }
  if (ledger.holds.some((known) => known.ref === entry.ref && known.repo === entry.repo)) return
  await writeLedger(folder, { ...ledger, holds: [...ledger.holds, entry] })
}

/**
 * A read that proves the ref is gone (unknown revision), never a failed
 * read (RVCM96B2D P2-8): anything else (a lock, a timeout, a killed child)
 * keeps the record for a retry instead of pruning it as absent.
 */
/** `rev-parse --verify` proving the ref is gone (unknown revision). */
const GIT_UNKNOWN_REVISION_EXIT_CODE = 128

function isUnknownRevision(error: unknown): boolean {
  return (
    isTeamGitError(error) &&
    error.exitCode === GIT_UNKNOWN_REVISION_EXIT_CODE &&
    error.stderr.includes('Needed a single revision')
  )
}

/** Failed reads and deletes are recorded and retried, never treated as absence. */
const CLEANUP_GIT_ATTEMPTS = 3
const CLEANUP_GIT_RETRY_MS = 100

async function withCleanupRetry<T>(work: () => Promise<T>): Promise<T> {
  let error: unknown
  for (let attempt = 0; attempt < CLEANUP_GIT_ATTEMPTS; attempt += 1) {
    try {
      return await work()
    } catch (error_: unknown) {
      error = error_
      if (attempt + 1 < CLEANUP_GIT_ATTEMPTS) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, CLEANUP_GIT_RETRY_MS)
        })
      }
    }
  }
  throw error
}

/**
 * A normal end removes and clears the record (RVCM96B2 P2-4): after the
 * run's own discards, every owned ref the ledger still names is verified
 * gone (pruned) or removed once more, so no owned ref survives the folder.
 * Held branches are never touched. A failed read or delete is a failure:
 * the entry is kept for the next sweep and reported, never pruned as
 * absent; every entry is attempted even when an earlier one failed. Throws
 * when anything failed, after attempting the rest, so the caller keeps the
 * folder and its ledger for the next run's sweep.
 */
export async function removeStaleCleanupRefs(options: {
  readonly git: TeamGit
  readonly folder: string
  readonly onError: (error: unknown) => void
}): Promise<void> {
  let ledger: CleanupLedger | undefined
  try {
    ledger = await readLedger(options.folder)
  } catch (error: unknown) {
    options.onError(error)
    throw error
  }
  if (ledger === undefined) return
  let failures = 0
  for (const entry of ledger.refs) {
    try {
      let isPresent = true
      try {
        await withCleanupRetry(() =>
          withGitBounds(options.git(['rev-parse', '--verify', entry.ref], entry.repo)),
        )
      } catch (error: unknown) {
        if (!isUnknownRevision(error)) throw error
        isPresent = false
      }
      if (isPresent) {
        await withCleanupRetry(() =>
          withGitBounds(options.git(['update-ref', '-d', entry.ref], entry.repo)),
        )
      }
      await pruneCleanupRef(options.folder, entry.repo, entry.ref)
    } catch (error: unknown) {
      options.onError(error)
      failures += 1
    }
  }
  if (failures > 0) throw new Error(`team cleanup failures: ${String(failures)}`)
}

export interface SweepResult {
  readonly sweptFolders: readonly string[]
  readonly sweptRefs: readonly string[]
  readonly skipped: readonly string[]
  /** Folders a failed read, delete or removal kept for the next sweep (P2-8). */
  readonly failed: readonly string[]
}

const withoutTrailingSlashes = (value: string): string =>
  value.replaceAll('\\', '/').replace(/\/+$/, '')

const isWithin = (root: string, candidate: string): boolean => {
  const base = withoutTrailingSlashes(root)
  const target = withoutTrailingSlashes(candidate)
  return target === base || target.startsWith(`${base}/`)
}

/**
 * A later headless run sweeps exactly what dead runs left (RVCM96B2 P2-4):
 * folders under the run prefix whose owner is proven gone, and only the
 * owned refs their ledgers name (verified, never by name shape). Held
 * branches stay: only an explicit discard or the retention removes them.
 * One folder's failure never stops the rest (P2-12): a malformed ledger is
 * skipped, and a failed read, delete or removal keeps the folder for the
 * next sweep and records it as failed (P2-8), never as swept.
 */
export async function sweepStaleTeamRuns(options: {
  readonly tmpRoot?: string
  readonly git: TeamGit
  readonly isAlive?: (pid: number) => boolean
}): Promise<SweepResult> {
  const tmpRoot = options.tmpRoot ?? tmpdir()
  const isAlive = options.isAlive ?? isPidAlive
  const sweptFolders: string[] = []
  const sweptRefs: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  let names: string[]
  try {
    const entries = await readdir(tmpRoot)
    names = entries.filter((name) => name.startsWith(EXEC_TEAM_RUN_PREFIX))
  } catch {
    return { sweptFolders, sweptRefs, skipped, failed }
  }
  for (const name of names) {
    const folder = path.join(tmpRoot, name)
    if (!isWithin(tmpRoot, folder)) {
      skipped.push(folder)
      continue
    }
    let ledger: CleanupLedger | undefined
    try {
      ledger = await readLedger(folder)
    } catch {
      // A torn or foreign ledger must not spare later dead runs (P2-12).
      skipped.push(folder)
      continue
    }
    if (
      ledger === undefined ||
      !Number.isSafeInteger(ledger.owner.pid) ||
      ledger.owner.pid <= 0 ||
      !Number.isFinite(ledger.owner.startedAt)
    ) {
      skipped.push(folder)
      continue
    }
    if (isAlive(ledger.owner.pid)) {
      skipped.push(folder)
      continue
    }
    let hasFailed = false
    for (const entry of ledger.refs) {
      const expected = predictedAgentsRef(entry.role, entry.taskId)
      if (expected === undefined || expected !== entry.ref) continue
      let isPresent = true
      try {
        await withCleanupRetry(() =>
          withGitBounds(options.git(['rev-parse', '--verify', entry.ref], entry.repo)),
        )
      } catch (error: unknown) {
        if (!isUnknownRevision(error)) {
          hasFailed = true
          continue
        }
        isPresent = false
      }
      if (!isPresent) continue
      try {
        await withCleanupRetry(() =>
          withGitBounds(options.git(['update-ref', '-d', entry.ref], entry.repo)),
        )
        sweptRefs.push(`${entry.repo}:${entry.ref}`)
      } catch {
        // Recorded and retried above; the folder stays for the next sweep.
        hasFailed = true
      }
    }
    if (hasFailed) {
      failed.push(folder)
      continue
    }
    try {
      await rm(folder, { recursive: true, force: true })
    } catch {
      failed.push(folder)
      continue
    }
    sweptFolders.push(folder)
  }
  return { sweptFolders, sweptRefs, skipped, failed }
}
