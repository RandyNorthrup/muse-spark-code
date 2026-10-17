// What a `/review` looks at, read from git (M70, PLAN.md D49): the
// uncommitted changes, a branch against its base, or one commit. Each diff
// runs with no external diff driver, no text conversion and no fsmonitor
// hook the repository configures, relative to the workspace folder, and
// without the files that may hold secrets, which are named instead. Git runs
// only in a trusted workspace (the caller refuses first: Restricted Mode runs
// no git, D13). Pure over an injected git runner, so real git and fakes both
// drive it.

import {
  PRIVATE_ATTACHMENT_EXTENSIONS,
  PRIVATE_ATTACHMENT_NAMES,
  PRIVATE_ENV_PREFIX,
  REVIEW_DEFAULT_BASES,
  REVIEW_DIFF_MAX_CHARS,
  REVIEW_DIFF_OPTIONS,
  REVIEW_PICK_BRANCHES_MAX,
  REVIEW_PICK_COMMITS_MAX,
} from '../../shared/constants'
import { isPrivateFileName } from '../../shared/privateFiles'

/** One git call in the workspace folder; rejects on a non-zero exit. */
export type ReviewGit = (args: readonly string[]) => Promise<string>

export type ReviewSubject =
  | { readonly kind: 'uncommitted'; readonly hasCommits: boolean }
  | {
      readonly kind: 'branch'
      readonly branch: string
      readonly base: string
      readonly mergeBase: string
    }
  | { readonly kind: 'commit'; readonly commit: string; readonly message: string }

export interface ReviewMaterial {
  readonly subject: ReviewSubject
  /** The diff, cut after its last whole line within REVIEW_DIFF_MAX_CHARS when it was longer. */
  readonly diff: string
  /** How long the diff was when it had to be cut; undefined when it is whole. */
  readonly fullLength: number | undefined
  /** The changed files' paths (a rename as `old → new`), the private files left out. */
  readonly changedFiles: readonly string[]
  readonly untracked: readonly string[]
  /** Changed or untracked files that may hold secrets: named, never diffed. */
  readonly privateFiles: readonly string[]
}

export type ReviewRefusal =
  | 'notRepository'
  | 'noChanges'
  | 'onlyPrivate'
  | 'noBase'
  | 'unknownRevision'
  | 'noCommits'
  | 'gitFailed'

export type MaterialOutcome =
  | { readonly ok: true; readonly material: ReviewMaterial }
  | { readonly ok: false; readonly refusal: ReviewRefusal }

type ReviewFiles = Pick<ReviewMaterial, 'changedFiles' | 'untracked' | 'privateFiles'>

export interface BaseChoices {
  readonly branches: readonly string[]
  /** `origin/HEAD`'s branch, else main or master; undefined when none exists. */
  readonly defaultBase: string | undefined
}

export interface CommitChoice {
  readonly commit: string
  readonly shortCommit: string
  readonly subject: string
}

const LINE_BREAK = /\r?\n/
// `-z` output: every field ends with NUL and no path is quoted.
const NUL = '\u{0}'
// A rename or a copy names two paths, the old one first.
const TWO_PATH_STATUS = /^[CR]/
const RENAMED = ' → '
const FIELD_SEPARATOR = '\u{1F}'
const HEAD = 'HEAD'
const COMMIT_SUFFIX = '^{commit}'
const TRUE_WORD = 'true'
const ORIGIN_HEAD = 'refs/remotes/origin/HEAD'
// The files that may hold secrets (shared/privateFiles.ts), left out of every
// diff by git's own pathspec magic; `.` comes first, the positive pattern the
// exclusions subtract from.
const EXCLUDE = ':(exclude,glob,icase)**/'
const GLOB_ANY = '*'
const PRIVATE_PATHSPECS: readonly string[] = [
  '.',
  ...Array.from(PRIVATE_ATTACHMENT_NAMES, (name) => `${EXCLUDE}${name}`),
  `${EXCLUDE}${PRIVATE_ENV_PREFIX}${GLOB_ANY}`,
  ...Array.from(PRIVATE_ATTACHMENT_EXTENSIONS, (extension) => `${EXCLUDE}${GLOB_ANY}${extension}`),
]
const PATHSPEC_START = '--'
const OPTION_START = '-'

function linesOf(output: string): readonly string[] {
  return output.split(LINE_BREAK).filter((line) => line !== '')
}

/** One changed file: its path, and how it is listed (a rename or copy as `old → new`). */
interface Change {
  readonly path: string
  readonly listed: string
}

/** The changes `--name-status -z` prints; output it cannot read is a git failure. */
function changesOf(output: string): readonly Change[] {
  const fields = output.split(NUL)
  const changes: Change[] = []
  let at = 0
  while (at < fields.length && fields[at] !== '') {
    const count = TWO_PATH_STATUS.test(fields[at] ?? '') ? 2 : 1
    const paths = fields.slice(at + 1, at + 1 + count)
    const path = paths.at(-1)
    if (path === undefined || paths.length < count || paths.includes('')) {
      throw new Error('git printed a name status without its path')
    }
    changes.push({ path, listed: paths.join(RENAMED) })
    at += 1 + count
  }
  return changes
}

/** The changed and untracked files, split by whether they may hold secrets. */
function filesFrom(changes: readonly Change[], untracked: readonly string[]): ReviewFiles {
  return {
    changedFiles: changes
      .filter((change) => !isPrivateFileName(change.path))
      .map((change) => change.listed),
    untracked: untracked.filter((file) => !isPrivateFileName(file)),
    privateFiles: [...changes.map((change) => change.path), ...untracked].filter((file) =>
      isPrivateFileName(file),
    ),
  }
}

/**
 * The diff within REVIEW_DIFF_MAX_CHARS, cut after the last whole line that
 * fits (its line break the last character kept). Git's diff opens with a
 * short `diff --git` line, so one always fits; text with no line break
 * before the cap would be cut at the cap itself.
 */
function bounded(diff: string): { readonly diff: string; readonly fullLength: number | undefined } {
  if (diff.length <= REVIEW_DIFF_MAX_CHARS) {
    return { diff, fullLength: undefined }
  }
  const lineEnd = diff.lastIndexOf('\n', REVIEW_DIFF_MAX_CHARS - 1)
  return {
    diff: diff.slice(0, lineEnd > 0 ? lineEnd + 1 : REVIEW_DIFF_MAX_CHARS),
    fullLength: diff.length,
  }
}

/** A git call's output without the line break it ends with. */
async function trimmed(git: ReviewGit, args: readonly string[]): Promise<string> {
  const output = await git(args)
  return output.trim()
}

/** Whether a git call exits 0. */
async function isSuccessful(git: ReviewGit, args: readonly string[]): Promise<boolean> {
  try {
    await git(args)
    return true
  } catch {
    return false
  }
}

/**
 * The full commit a revision names; undefined when git knows no such commit.
 * A revision that would read as an option is none (the request schema
 * refuses it too).
 */
async function commitOf(git: ReviewGit, revision: string): Promise<string | undefined> {
  if (revision.startsWith(OPTION_START)) {
    return undefined
  }
  try {
    const commit = await trimmed(git, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${revision}${COMMIT_SUFFIX}`,
    ])
    return commit === '' ? undefined : commit
  } catch {
    return undefined
  }
}

/** The files a diff range touches, and the untracked ones, split by whether they may hold secrets. */
async function filesOf(git: ReviewGit, range: readonly string[]): Promise<ReviewFiles> {
  const changes = changesOf(
    await git([
      'diff',
      '--name-status',
      '-z',
      ...REVIEW_DIFF_OPTIONS,
      ...range,
      PATHSPEC_START,
      '.',
    ]),
  )
  const listing = await git([
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
    PATHSPEC_START,
    '.',
  ])
  return filesFrom(
    changes,
    listing.split(NUL).filter((file) => file !== ''),
  )
}

function diffArgs(range: readonly string[]): readonly string[] {
  return ['diff', ...REVIEW_DIFF_OPTIONS, ...range, PATHSPEC_START, ...PRIVATE_PATHSPECS]
}

function outcome(subject: ReviewSubject, diff: string, files: ReviewFiles): MaterialOutcome {
  const hasReviewable = diff !== '' || files.untracked.length > 0
  if (!hasReviewable) {
    return { ok: false, refusal: files.privateFiles.length > 0 ? 'onlyPrivate' : 'noChanges' }
  }
  return { ok: true, material: { subject, ...bounded(diff), ...files } }
}

/** Whether the workspace folder is inside a git work tree. */
async function isRepository(git: ReviewGit): Promise<boolean> {
  try {
    return (await trimmed(git, ['rev-parse', '--is-inside-work-tree'])) === TRUE_WORD
  } catch {
    return false
  }
}

/** Refuses outside a repository, and turns a failed git call into `gitFailed`. */
async function inRepository(
  git: ReviewGit,
  collect: () => Promise<MaterialOutcome>,
): Promise<MaterialOutcome> {
  if (!(await isRepository(git))) {
    return { ok: false, refusal: 'notRepository' }
  }
  try {
    return await collect()
  } catch {
    return { ok: false, refusal: 'gitFailed' }
  }
}

/** The uncommitted changes, staged and unstaged, against HEAD (or all of them before the first commit). */
export async function uncommittedMaterial(git: ReviewGit): Promise<MaterialOutcome> {
  return await inRepository(git, async () => {
    const hasCommits = (await commitOf(git, HEAD)) !== undefined
    const subject: ReviewSubject = { kind: 'uncommitted', hasCommits }
    if (hasCommits) {
      return outcome(subject, await git(diffArgs([HEAD])), await filesOf(git, [HEAD]))
    }
    // Before the first commit there is no HEAD: what is staged, then what changed since.
    const staged = await git(diffArgs(['--cached']))
    const unstaged = await git(diffArgs([]))
    const stagedFiles = await filesOf(git, ['--cached'])
    const unstagedFiles = await filesOf(git, [])
    return outcome(subject, `${staged}${unstaged}`, {
      changedFiles: [...stagedFiles.changedFiles, ...unstagedFiles.changedFiles],
      untracked: unstagedFiles.untracked,
      privateFiles: [...new Set([...stagedFiles.privateFiles, ...unstagedFiles.privateFiles])],
    })
  })
}

/** The branch against `base`: from their merge base to the working tree. */
export async function branchMaterial(git: ReviewGit, base: string): Promise<MaterialOutcome> {
  return await inRepository(git, async () => {
    const baseCommit = await commitOf(git, base)
    if (baseCommit === undefined) {
      return { ok: false, refusal: 'unknownRevision' }
    }
    if ((await commitOf(git, HEAD)) === undefined) {
      return { ok: false, refusal: 'noCommits' }
    }
    const mergeBase = await trimmed(git, ['merge-base', HEAD, baseCommit])
    const branch = await trimmed(git, ['rev-parse', '--abbrev-ref', HEAD])
    return outcome(
      { kind: 'branch', branch, base, mergeBase },
      await git(diffArgs([mergeBase])),
      await filesOf(git, [mergeBase]),
    )
  })
}

/** One commit: its message, and its change against its first parent (or everything, for a root). */
export async function commitMaterial(git: ReviewGit, revision: string): Promise<MaterialOutcome> {
  return await inRepository(git, async () => {
    const commit = await commitOf(git, revision)
    if (commit === undefined) {
      return { ok: false, refusal: 'unknownRevision' }
    }
    const parents = await trimmed(git, ['rev-list', '--parents', '-n', '1', commit])
    // The commit, then its first parent; a root commit has none.
    const [, parent] = parents.split(' ', 2)
    const message = await trimmed(git, ['log', '-1', '--format=%B', commit])
    const subject: ReviewSubject = { kind: 'commit', commit, message }
    if (parent !== undefined) {
      return outcome(subject, await git(diffArgs([parent, commit])), {
        ...(await filesOf(git, [parent, commit])),
        untracked: [],
      })
    }
    // A root commit has no parent to compare with: its whole tree is its change.
    const root = await git([
      'show',
      '--format=',
      ...REVIEW_DIFF_OPTIONS,
      commit,
      PATHSPEC_START,
      ...PRIVATE_PATHSPECS,
    ])
    const changes = changesOf(
      await git([
        'show',
        '--format=',
        '--name-status',
        '-z',
        ...REVIEW_DIFF_OPTIONS,
        commit,
        PATHSPEC_START,
        '.',
      ]),
    )
    return outcome(subject, root, filesFrom(changes, []))
  })
}

/** The branches a base can be picked from, and the one to suggest. */
export async function baseChoices(git: ReviewGit): Promise<BaseChoices | undefined> {
  if (!(await isRepository(git))) {
    return undefined
  }
  const listed = linesOf(
    await git([
      'for-each-ref',
      `--count=${String(REVIEW_PICK_BRANCHES_MAX)}`,
      '--format=%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ]),
  ).filter((name) => !name.endsWith(`/${HEAD}`))
  let defaultBase: string | undefined
  try {
    defaultBase =
      (await trimmed(git, ['symbolic-ref', '--quiet', '--short', ORIGIN_HEAD])) || undefined
  } catch {
    defaultBase = undefined
  }
  for (const candidate of REVIEW_DEFAULT_BASES) {
    if (defaultBase !== undefined) {
      break
    }
    if (await isSuccessful(git, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`])) {
      defaultBase = candidate
    }
  }
  const branches =
    defaultBase === undefined
      ? listed
      : [defaultBase, ...listed.filter((name) => name !== defaultBase)]
  return { branches, defaultBase }
}

/** The latest commits of HEAD, newest first, for the commit picker. */
export async function commitChoices(git: ReviewGit): Promise<readonly CommitChoice[] | undefined> {
  if (!(await isRepository(git)) || (await commitOf(git, HEAD)) === undefined) {
    return undefined
  }
  const format = ['%H', '%h', '%s'].join(FIELD_SEPARATOR)
  return linesOf(
    await git(['log', '-n', String(REVIEW_PICK_COMMITS_MAX), `--format=${format}`, HEAD]),
  ).flatMap((line) => {
    const [commit, shortCommit, subject] = line.split(FIELD_SEPARATOR)
    return commit === undefined || shortCommit === undefined
      ? []
      : [{ commit, shortCommit, subject: subject ?? '' }]
  })
}
