// The working tree's state through the user's own `git` (M123,
// PLAN.md D104): one `status` read, parsed without a shell, for every
// editor outside VS Code (and a VS Code-family host without `vscode.git`).
// The runner is injected (the runtime passes the bounded `createGitProcess`
// from `src/host/git.ts`; type-only here, so no bundle carries it), and the
// environment with it: reads keep the quiet environment, a push or a fetch
// the user's own (D104's named exception, owned by the runtime service).
//
// Pure besides the injected run: `parseStatusV2` and `parseRemoteV` read
// git's words, `toPushHead` matches the upstream against the remotes git
// knows. Nothing here logs, shows, or forwards a credential: a remote URL
// is data for the caller to mask before it is shown.

import path from 'node:path'
import { isGitExitError, type GitProcess } from '../../host/git'
import { isPlainRefName, type HeadFacts, type RemoteFacts } from './pushPlan'

/** Fixed arguments: the subcommand and every flag, no user text. */
export function nativeStatusArgs(): readonly string[] {
  return ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']
}

/** Fixed arguments: the remote names git knows. */
export function nativeRemoteNamesArgs(): readonly string[] {
  return ['remote']
}

/**
Whether a remote's URLs may be read: a plain config section name, so the
`remote.<name>.url` key built from it cannot surprise the allowlist. An
exotic name keeps its remote (push still judges the name itself) but no
URL is read for it.
*/
export function isReadableRemoteName(name: string): boolean {
  // `!` through `~` without a leading dash: no space, control, DEL or
  // non-ASCII name (its URL stays unread, the remote itself still pushes).
  // Written as a range so no escape names a control.
  return name !== '' && !name.startsWith('-') && !/[^!-~]/.test(name)
}

/** Fixed shape: one configuration value, with the remote named by git's own list. */
export function remoteFetchUrlArgs(name: string): readonly string[] {
  return ['config', '--get', `remote.${name}.url`]
}

/** Fixed shape: the push URL override, unset (exit 1) on most remotes. */
export function remotePushUrlArgs(name: string): readonly string[] {
  return ['config', '--get', `remote.${name}.pushurl`]
}

/**
Fixed shape: every URL a push to `name` goes to, as git itself resolves
it (`pushurl` or `url`, every value, `insteadOf` and `pushInsteadOf`
applied). A push's confirmation shows these, so a rewrite in a
repository's configuration cannot send it somewhere the user did not see
(RVM123G2). The pull request's repository keeps M71's raw read below.
*/
export function remotePushUrlsArgs(name: string): readonly string[] {
  return ['remote', 'get-url', '--push', '--all', name]
}

/** Fixed arguments: every configuration entry's origin, NUL-separated, values left out. */
export function configOriginsArgs(): readonly string[] {
  return ['config', '--list', '--show-origin', '--name-only', '-z']
}

/**
The configuration files git read, from `configOriginsArgs`' output:
`file:` origins only, resolved against `cwd` (git names the
repository's own relative to it), each once, in git's order.
*/
function parseConfigOrigins(output: string, cwd: string): string[] {
  const fields = output.split('\0')
  const files: string[] = []
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const origin = fields[index] ?? ''
    if (!origin.startsWith(CONFIG_FILE_ORIGIN)) {
      continue
    }
    const file = path.resolve(cwd, origin.slice(CONFIG_FILE_ORIGIN.length))
    if (!files.includes(file)) {
      files.push(file)
    }
  }
  return files
}

/** What the caller runs git with: the confined root, the chosen environment. */
export interface NativeGitContext {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly signal?: AbortSignal | undefined
}

/** The branch and its files, as the commit form and the push plan read them. */
export interface NativeStatusSnapshot {
  /** Undefined on a detached HEAD (or while rebasing onto none). */
  readonly branch: string | undefined
  /** `origin/main`: the upstream as git names it, or undefined without one. */
  readonly upstream: string | undefined
  readonly ahead: number | undefined
  readonly behind: number | undefined
  /** The HEAD commit, for noticing a changed repository. */
  readonly headOid: string | undefined
  readonly staged: readonly string[]
  readonly unstaged: readonly string[]
  readonly untracked: readonly string[]
  /**
  Every change record as git wrote it: the modes and the HEAD and index
  object names beside each path, so a form's stamp changes when different
  bytes are staged under the same name (the working tree's bytes are
  fingerprinted by the service, which reads them confined).
  */
  readonly records: readonly string[]
  /** The changed paths that are submodules (`S…` records): their own content stays theirs. */
  readonly submodules: readonly string[]
}

const CONFIG_FILE_ORIGIN = 'file:'
const SUBMODULE_MARK = 'S'
const DETACHED_HEAD = '('
const UNTRACKED_MARK = '?'
const UNMODIFIED_MARK = '.'
/** Leading fields before the path in an ordinary (`1`) status record. */
const ORDINARY_PATH_FIELD = 8
/** Leading fields before the path in a renamed (`2`) status record. */
const RENAMED_PATH_FIELD = 9
/**
Leading fields before the path in an unmerged (`u`) status record:
`u XY sub m1 m2 m3 mW h1 h2 h3 path` (git-status(1), porcelain v2).
*/
const UNMERGED_PATH_FIELD = 10

function branchOf(head: string): string | undefined {
  return head === '' || head.startsWith(DETACHED_HEAD) ? undefined : head
}

/** How many fields precede the path in a tracked change of this kind (`1`, `2` or `u`). */
function pathFieldOf(kind: string): number {
  if (kind === 'u') {
    return UNMERGED_PATH_FIELD
  }
  return kind === '2' ? RENAMED_PATH_FIELD : ORDINARY_PATH_FIELD
}

/** A tracked change's path, marks and submodule field, from the fields before its path. */
function trackedChange(
  record: string,
  pathField: number,
): { file: string; marks: string; isSubmodule: boolean } {
  const fields = record.split(' ')
  const marks = fields[1] ?? ''
  const file = fields.slice(pathField).join(' ')
  if (file === '' || marks.length !== 2) {
    throw new Error(`Unexpected git status record: ${record}`)
  }
  return { file, marks, isSubmodule: fields[2]?.startsWith(SUBMODULE_MARK) === true }
}

/**
`git status --porcelain=v2 -z`: NUL-separated records, `?` for a new
file, `1`/`2`/`u` for a tracked change (staged when the first status
letter moves, unstaged when the second does). A `u` record (a merge
conflict) has ten fields before its path, the three stages' object
names among them. A `2` record's renamed path follows as its own record
and is skipped there. Anything else is refused: the caller runs a fixed
command, so an unknown record means git's words changed, not user text.
*/
export function parseStatusV2(output: string): NativeStatusSnapshot {
  let branch: string | undefined
  let upstream: string | undefined
  let ahead: number | undefined
  let behind: number | undefined
  let headOid: string | undefined
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []
  const changeRecords: string[] = []
  const submodules: string[] = []
  const records = output.split('\0')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? ''
    if (record === '') {
      continue
    }
    if (!record.startsWith('# ')) {
      changeRecords.push(record)
    }
    if (record.startsWith('# branch.head ')) {
      branch = branchOf(record.slice('# branch.head '.length))
    } else if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length) || undefined
    } else if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
      if (match === null) {
        throw new Error(`Unexpected git status header: ${record}`)
      }
      ahead = Number(match[1])
      behind = Number(match[2])
    } else if (record.startsWith('# branch.oid ')) {
      headOid = record.slice('# branch.oid '.length) || undefined
    } else if (record.startsWith('# ')) {
      // Another header git added: not needed here, and never a file.
    } else if (record.startsWith(`${UNTRACKED_MARK} `)) {
      untracked.push(record.slice(2))
    } else if (record.startsWith('1 ') || record.startsWith('2 ') || record.startsWith('u ')) {
      const { file, marks, isSubmodule } = trackedChange(record, pathFieldOf(record.charAt(0)))
      if (isSubmodule) {
        submodules.push(file)
      }
      if (record.startsWith('2 ')) {
        // The renamed-from path is the next record; it names no change
        // itself, but it belongs to this change's stamp.
        index += 1
        changeRecords.push(records[index] ?? '')
      }
      const [indexMark, worktreeMark] = marks
      if (indexMark !== UNMODIFIED_MARK) {
        staged.push(file)
      }
      if (worktreeMark !== UNMODIFIED_MARK) {
        unstaged.push(file)
      }
    } else {
      throw new Error(`Unexpected git status record: ${record}`)
    }
  }
  return {
    branch,
    upstream,
    ahead,
    behind,
    headOid,
    staged,
    unstaged,
    untracked,
    records: changeRecords,
    submodules,
  }
}

/**
`git remote`: one name per line, in git's order. Names are data for an
exact-membership check before any URL is read under them.
*/
export function parseRemoteNames(output: string): string[] {
  return output.split('\n').filter((line) => line !== '')
}

/**
One configuration value: the trimmed text, or undefined when git has no
such value (exit 1). Anything else is git failing to answer, and is
rethrown. The key comes from `nativeRemoteNamesArgs`' own list or the
fixed signing keys; the allowlist rechecks its shape at spawn.
*/
export async function readConfigValue(
  run: GitProcess,
  context: NativeGitContext,
  key: string,
): Promise<string | undefined> {
  try {
    const output = await run(['config', '--get', key], {
      cwd: context.cwd,
      env: context.env,
      ...(context.signal !== undefined && { signal: context.signal }),
    })
    const value = output.toString('utf8').trim()
    return value === '' ? undefined : value
  } catch (error: unknown) {
    if (isGitExitError(error) && error.exitCode === 1) {
      return undefined
    }
    throw error
  }
}

/**
The remotes git knows, with the URLs from the configuration itself (as
M71 reads them): `git remote -v` and `get-url` apply `insteadOf`
rewrites, which would name the wrong repository for a pull request.
URLs stay whole; the caller masks them for display.
*/
export async function readNativeRemotes(
  run: GitProcess,
  context: NativeGitContext,
): Promise<RemoteFacts[]> {
  const namesBytes = await run(nativeRemoteNamesArgs(), {
    cwd: context.cwd,
    env: context.env,
    ...(context.signal !== undefined && { signal: context.signal }),
  })
  const names = parseRemoteNames(namesBytes.toString('utf8'))
  const remotes: RemoteFacts[] = []
  for (const name of names) {
    if (!isReadableRemoteName(name)) {
      remotes.push({ name })
      continue
    }
    const [fetchUrl, pushUrl] = await Promise.all([
      readConfigValue(run, context, `remote.${name}.url`),
      readConfigValue(run, context, `remote.${name}.pushurl`),
    ])
    remotes.push({
      name,
      ...(fetchUrl !== undefined && { fetchUrl }),
      ...(pushUrl !== undefined && { pushUrl }),
    })
  }
  return remotes
}

export type NativeHead =
  | { readonly ok: true; readonly head: HeadFacts }
  | { readonly ok: false; readonly reason: 'unmatchedUpstream' }

/**
The push plan's head facts: the upstream split into the longest remote
name git knows (a remote's name may itself hold a `/`) and the branch
there. An upstream no remote answers is refused rather than guessed:
pushing it elsewhere would send the commits to the wrong place.
*/
export function toPushHead(
  snapshot: Pick<NativeStatusSnapshot, 'branch' | 'upstream' | 'ahead' | 'behind'>,
  remotes: readonly RemoteFacts[],
): NativeHead {
  if (snapshot.upstream === undefined) {
    return {
      ok: true,
      head: {
        branch: snapshot.branch,
        upstream: undefined,
        ahead: snapshot.ahead,
        behind: snapshot.behind,
      },
    }
  }
  const remote = remotes
    .filter(
      (candidate) =>
        snapshot.upstream === candidate.name ||
        (snapshot.upstream?.startsWith(`${candidate.name}/`) === true &&
          isPlainRefName(candidate.name)),
    )
    .toSorted((left, right) => right.name.length - left.name.length)
    .at(0)
  if (remote === undefined) {
    return { ok: false, reason: 'unmatchedUpstream' }
  }
  const name =
    snapshot.upstream === remote.name
      ? snapshot.branch
      : snapshot.upstream.slice(remote.name.length + 1)
  return {
    ok: true,
    head: {
      branch: snapshot.branch,
      upstream: { remote: remote.name, name: name ?? '' },
      ahead: snapshot.ahead,
      behind: snapshot.behind,
    },
  }
}

async function runText(
  run: GitProcess,
  args: readonly string[],
  context: NativeGitContext,
): Promise<string> {
  const output = await run(args, {
    cwd: context.cwd,
    env: context.env,
    ...(context.signal !== undefined && { signal: context.signal }),
  })
  return output.toString('utf8')
}

/** The status snapshot alone, in the caller's environment. */
export async function readStatusSnapshot(
  run: GitProcess,
  context: NativeGitContext,
): Promise<NativeStatusSnapshot> {
  return parseStatusV2(await runText(run, nativeStatusArgs(), context))
}

/** Every URL a push to `name` goes to, rewrites applied (`remotePushUrlsArgs`). */
export async function readPushUrls(
  run: GitProcess,
  context: NativeGitContext,
  name: string,
): Promise<string[]> {
  const output = await runText(run, remotePushUrlsArgs(name), context)
  return output.split(/\r?\n/).filter((line) => line !== '')
}

/** The configuration files git reads here (`configOriginsArgs`), resolved. */
export async function readConfigFiles(
  run: GitProcess,
  context: NativeGitContext,
): Promise<string[]> {
  return parseConfigOrigins(await runText(run, configOriginsArgs(), context), context.cwd)
}

/** The status snapshot and the remotes, in the caller's environment. */
export async function readNativeStatus(
  run: GitProcess,
  context: NativeGitContext,
): Promise<{ readonly snapshot: NativeStatusSnapshot; readonly remotes: RemoteFacts[] }> {
  const [status, remotes] = await Promise.all([
    runText(run, nativeStatusArgs(), context),
    readNativeRemotes(run, context),
  ])
  return { snapshot: parseStatusV2(status), remotes }
}
