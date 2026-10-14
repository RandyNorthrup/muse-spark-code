// Where the GitHub REST client's credential comes from outside VS Code's
// own path (M123, PLAN.md D104): a port each source implements, the order
// they are tried in, and the rules every source shares.
//
// - (a) `editorLease`: the editor's own GitHub sign-in. The runtime holds an
//   opaque lease id bound to its owner, never the token; each call goes out
//   as MHP `github/request` and the editor adds the token.
// - (b) `deviceFlow`: the runtime's own sign-in with the project's OAuth
//   App, the token kept in the vault (or the OS keychain).
// - (c) `ghLogin`: the user's existing `gh` login, only while
//   `museSpark.github.useGhLogin` is on in user or machine settings.
//
// A credential is used for one call and never logged, returned to the
// model, put in MHP, a file, an argument or an environment. The panel shows
// the source in use and the account's login, never the credential.
//
// Pure: the sources themselves are injected (lanes A and L).

import { GITHUB_TOKEN_SOURCE_ORDER } from '../../shared/constants'
import { GitHubError } from './github'

export type GitHubTokenSourceKind = (typeof GITHUB_TOKEN_SOURCE_ORDER)[number]

/** One call's credential, and the `fetch` that carries it to GitHub. */
export interface GitHubCredential {
  readonly source: GitHubTokenSourceKind
  /**
   * The `Authorization: Bearer` value: a lease id for `editorLease`, the
   * token for the others. Never logged, returned or forwarded.
   */
  readonly bearer: string
  /** MHP `github/request` for a lease; the network for the others. */
  readonly fetch: typeof fetch
  /** Epoch ms from which the credential is not used; undefined when it does not expire. */
  readonly expiresAt: number | undefined
}

export interface GitHubTokenSource {
  readonly kind: GitHubTokenSourceKind
  /**
   * The credential, if this source has one. `silent` only reads what is
   * there; `ask` may show the source's own sign-in.
   */
  credential(mode: 'ask' | 'silent', signal: AbortSignal): Promise<GitHubCredential | undefined>
  /** GitHub answered 401 to `credential`: drop it, so the user signs in again. */
  rejected(credential: GitHubCredential): Promise<void>
  /** Sign out: forget what this source holds. */
  signOut(): Promise<void>
}

export type GitHubTokenSourceRefusal = 'clientIdUnset' | 'sourceOrder' | 'scopeRefused'

/** A contract the caller broke; `message` is the reason word, for the log. */
export class GitHubTokenSourceError extends Error {
  public constructor(public readonly reason: GitHubTokenSourceRefusal) {
    super(reason)
    this.name = 'GitHubTokenSourceError'
  }
}

/** The sources in D104's order; a kind given twice is refused. */
export function orderedSources(
  sources: readonly GitHubTokenSource[],
): readonly GitHubTokenSource[] {
  const kinds = new Set(sources.map((source) => source.kind))
  if (kinds.size !== sources.length) {
    throw new GitHubTokenSourceError('sourceOrder')
  }
  return sources.toSorted(
    (left, right) =>
      GITHUB_TOKEN_SOURCE_ORDER.indexOf(left.kind) - GITHUB_TOKEN_SOURCE_ORDER.indexOf(right.kind),
  )
}

export function isCredentialLive(credential: GitHubCredential, now: number): boolean {
  return credential.expiresAt === undefined || now < credential.expiresAt
}

export interface CredentialRequest {
  readonly mode: 'ask' | 'silent'
  readonly signal: AbortSignal
  readonly now: () => number
  /** The source the user chose to sign in with; the first in order otherwise. */
  readonly askWith?: GitHubTokenSourceKind
}

/**
 * The first source in order that already has a live credential wins. Only
 * when none has one, and the call may ask, is one source asked: the user's
 * pick, or the first. So the user never sees one sign-in after another.
 */
export async function resolveGitHubCredential(
  sources: readonly GitHubTokenSource[],
  request: CredentialRequest,
): Promise<GitHubCredential | undefined> {
  const ordered = orderedSources(sources)
  for (const source of ordered) {
    request.signal.throwIfAborted()
    const credential = await source.credential('silent', request.signal)
    if (credential !== undefined && isCredentialLive(credential, request.now())) {
      return credential
    }
  }
  if (request.mode === 'silent') {
    return
  }
  const asked =
    request.askWith === undefined
      ? ordered[0]
      : ordered.find((source) => source.kind === request.askWith)
  request.signal.throwIfAborted()
  const credential = await asked?.credential('ask', request.signal)
  return credential !== undefined && isCredentialLive(credential, request.now())
    ? credential
    : undefined
}

/**
 * A 401 drops the credential at its source, so the user signs in again.
 * True when `error` was GitHub's sign-in refusal.
 */
export async function didDropRejectedCredential(
  sources: readonly GitHubTokenSource[],
  credential: GitHubCredential,
  error: unknown,
): Promise<boolean> {
  if (!(error instanceof GitHubError && error.kind === 'signIn')) {
    return false
  }
  await sources.find((source) => source.kind === credential.source)?.rejected(credential)
  return true
}
