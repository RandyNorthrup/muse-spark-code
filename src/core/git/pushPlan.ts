// What a push sends, decided before anything runs (M71, PLAN.md D49): the
// remote, the refspec and whether the branch starts tracking it. The
// extension never force-pushes, on any path:
//
// - the push goes through VS Code's git extension with no force mode (the
//   host passes exactly three arguments);
// - a refspec is the branch name, or `branch:upstream`, and a name that
//   would change its meaning is refused: `+` in front is git's own force
//   marker ("+<src>:<dst>", git-push(1)), `-` in front would read as an
//   option, and `:` or whitespace would split it; so is a remote's name,
//   which git receives just before it (a remote named `--force` would be
//   the option);
// - a branch behind its upstream is refused rather than pushed over: a
//   plain push would be rejected, and the only way through is a force, so
//   pulling first is left to the user.
//
// Pure: the host reads the branch and remotes from VS Code's git extension.

export interface UpstreamFacts {
  readonly remote: string
  /** The branch on the remote, without the remote's name. */
  readonly name: string
}

export interface HeadFacts {
  /** Undefined on a detached HEAD. */
  readonly branch: string | undefined
  readonly upstream: UpstreamFacts | undefined
  /** Commits the branch has that its upstream lacks; undefined when unknown. */
  readonly ahead: number | undefined
  /** Commits the upstream has that the branch lacks. */
  readonly behind: number | undefined
}

export interface RemoteFacts {
  readonly name: string
  readonly fetchUrl?: string | undefined
  readonly pushUrl?: string | undefined
}

export type PushRefusal =
  'detached' | 'unsafeName' | 'behind' | 'upToDate' | 'noRemote' | 'chooseRemote'

export type PushPlan =
  | {
      readonly ok: true
      readonly remote: string
      /** Where the commits go, as the confirmation shows it; undefined when git knows no URL. */
      readonly remoteUrl: string | undefined
      readonly branch: string
      /** The branch on the remote. */
      readonly target: string
      /** Exactly what git receives: `branch`, or `branch:target`. */
      readonly refspec: string
      /** A first push makes the remote branch the upstream (`-u`). */
      readonly setUpstream: boolean
      /** Commits that go; undefined on a first push, when git cannot count them. */
      readonly commits: number | undefined
    }
  | { readonly ok: false; readonly refusal: PushRefusal; readonly remotes?: readonly string[] }

// git-push(1): "+<src>:<dst>" forces; a leading "-" would be an option.
const FORCE_MARK = '+'
const OPTION_MARK = '-'
const REFSPEC_SEPARATOR = ':'
const WHITESPACE = /\s/
const DEFAULT_REMOTE = 'origin'

/** A ref name that means only itself in a refspec. */
export function isPlainRefName(name: string): boolean {
  return (
    name !== '' &&
    !name.startsWith(FORCE_MARK) &&
    !name.startsWith(OPTION_MARK) &&
    !name.includes(REFSPEC_SEPARATOR) &&
    !WHITESPACE.test(name)
  )
}

/** A refspec that can only fast-forward: plain names, at most one `:`, no force mark. */
export function isPlainRefspec(refspec: string): boolean {
  const sides = refspec.split(REFSPEC_SEPARATOR)
  return sides.length <= 2 && sides.every((side) => isPlainRefName(side))
}

function remoteUrlOf(remotes: readonly RemoteFacts[], name: string): string | undefined {
  const remote = remotes.find((candidate) => candidate.name === name)
  return remote?.pushUrl ?? remote?.fetchUrl
}

/** The remote a first push goes to, or why none can be picked without asking. */
function firstPushRemote(
  remotes: readonly RemoteFacts[],
  chosen: string | undefined,
): { readonly remote: string } | { readonly refusal: 'noRemote' | 'chooseRemote' } {
  if (chosen !== undefined) {
    return remotes.some((remote) => remote.name === chosen)
      ? { remote: chosen }
      : { refusal: 'noRemote' }
  }
  const [only] = remotes
  if (only === undefined) {
    return { refusal: 'noRemote' }
  }
  if (remotes.length === 1) {
    return { remote: only.name }
  }
  return remotes.some((remote) => remote.name === DEFAULT_REMOTE)
    ? { remote: DEFAULT_REMOTE }
    : { refusal: 'chooseRemote' }
}

/**
 * The push for `head`: to its upstream when it has one, else a first push
 * (with `-u`) to `chosenRemote`, the only remote, or `origin`. Never a
 * force: see the file comment for every refusal.
 */
export function planPush(
  head: HeadFacts,
  remotes: readonly RemoteFacts[],
  chosenRemote?: string,
): PushPlan {
  const { branch, upstream } = head
  if (branch === undefined) {
    return { ok: false, refusal: 'detached' }
  }
  if (!isPlainRefName(branch) || (upstream !== undefined && !isPlainRefName(upstream.name))) {
    return { ok: false, refusal: 'unsafeName' }
  }
  if ((head.behind ?? 0) > 0) {
    return { ok: false, refusal: 'behind' }
  }
  if (upstream !== undefined) {
    if (head.ahead === 0) {
      return { ok: false, refusal: 'upToDate' }
    }
    if (!isPlainRefName(upstream.remote)) {
      return { ok: false, refusal: 'unsafeName' }
    }
    const refspec =
      upstream.name === branch ? branch : `${branch}${REFSPEC_SEPARATOR}${upstream.name}`
    return {
      ok: true,
      remote: upstream.remote,
      remoteUrl: remoteUrlOf(remotes, upstream.remote),
      branch,
      target: upstream.name,
      refspec,
      setUpstream: false,
      commits: head.ahead,
    }
  }
  const first = firstPushRemote(remotes, chosenRemote)
  if ('refusal' in first) {
    return {
      ok: false,
      refusal: first.refusal,
      remotes: remotes.map((remote) => remote.name),
    }
  }
  if (!isPlainRefName(first.remote)) {
    return { ok: false, refusal: 'unsafeName' }
  }
  return {
    ok: true,
    remote: first.remote,
    remoteUrl: remoteUrlOf(remotes, first.remote),
    branch,
    target: branch,
    refspec: branch,
    setUpstream: true,
    commits: undefined,
  }
}
