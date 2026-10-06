// "Open a pull request in a conversation…" (M71): what the user typed, `51`
// or `#51`, or a pull request's page on github.com, which names its
// repository too. The host then picks the remote that repository is
// fetched from. Pure.

import type { GitHubRepository } from './githubRemote'

export type PullRequestRef =
  | {
      readonly ok: true
      readonly number: number
      /** Named by a page URL; undefined for a bare number. */
      readonly repository: GitHubRepository | undefined
    }
  | { readonly ok: false }

const NUMBER = /^#?(?<number>[1-9]\d{0,9})$/
// https://github.com/<owner>/<name>/pull/<n>, then optionally a tab of the page.
const PAGE =
  /^https:\/\/(?:www\.)?github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+)\/pull\/(?<number>[1-9]\d{0,9})(?:\/[\w-]*)?\/?(?:[?#]\S*)?$/i

export function pullRequestRefFrom(input: string): PullRequestRef {
  const trimmed = input.trim()
  const bare = NUMBER.exec(trimmed)?.groups?.['number']
  if (bare !== undefined) {
    return { ok: true, number: Number(bare), repository: undefined }
  }
  const page = PAGE.exec(trimmed)?.groups
  const owner = page?.['owner']
  const name = page?.['name']
  const number = page?.['number']
  return owner === undefined || name === undefined || number === undefined
    ? { ok: false }
    : { ok: true, number: Number(number), repository: { owner, name } }
}

/** Whether two repositories are the same on GitHub, where names ignore case. */
export function isSameRepository(left: GitHubRepository, right: GitHubRepository): boolean {
  return (
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.name.toLowerCase() === right.name.toLowerCase()
  )
}

export interface GitHubRemote {
  readonly name: string
  readonly repository: GitHubRepository
}

// A fork's convention: `upstream` is the repository its pull requests live in.
const UPSTREAM_REMOTE = 'upstream'
const DEFAULT_REMOTE = 'origin'

/**
 * The remote a pull request is fetched from. A page URL names its
 * repository, and only a remote of that repository will do. A bare number
 * is read in `upstream`, else the remote the branch tracks, else `origin`,
 * else the only GitHub remote; undefined when none of those is one.
 */
export function remoteForPullRequest(
  remotes: readonly GitHubRemote[],
  wanted: GitHubRepository | undefined,
  tracked: string | undefined,
): GitHubRemote | undefined {
  const preferred = [UPSTREAM_REMOTE, tracked, DEFAULT_REMOTE].flatMap((name) => {
    const remote = remotes.find((candidate) => candidate.name === name)
    return remote === undefined ? [] : [remote]
  })
  const ordered = [...preferred, ...remotes.filter((remote) => !preferred.includes(remote))]
  if (wanted !== undefined) {
    return ordered.find((remote) => isSameRepository(remote.repository, wanted))
  }
  const [first] = preferred
  if (first !== undefined) {
    return first
  }
  const [only] = remotes
  return remotes.length === 1 ? only : undefined
}
