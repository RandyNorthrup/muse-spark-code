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

import * as z from 'zod/mini'
import {
  GITHUB_GIST_SCOPES,
  GITHUB_LEASE_TTL_MS,
  GITHUB_OAUTH_CLIENT_ID,
  GITHUB_PERMITTED_SCOPES,
  GITHUB_TOKEN_SOURCE_ORDER,
} from '../../shared/constants'

export type GitHubTokenSourceKind = (typeof GITHUB_TOKEN_SOURCE_ORDER)[number]

/** One call's credential, and the `fetch` that carries it to GitHub. */
export interface GitHubCredential {
  readonly source: GitHubTokenSourceKind
  /**
  The `Authorization: Bearer` value: a lease id for `editorLease`, the
  token for the others. Never logged, returned or forwarded.
  */
  readonly bearer: string
  /** MHP `github/request` for a lease; the network for the others. */
  readonly fetch: typeof fetch
  /** Epoch ms from which the credential is not used; undefined when it does not expire. */
  readonly expiresAt: number | undefined
  /** The account's login, when the source knows it (an editor's session names its account). */
  readonly login?: string | undefined
}

export interface GitHubTokenSource {
  readonly kind: GitHubTokenSourceKind
  /**
  The credential, if this source has one. `silent` only reads what is
  there; `ask` may show the source's own sign-in.
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
The first source in order that already has a live credential wins. Only
when none has one, and the call may ask, is one source asked: the user's
pick, or the first. So the user never sees one sign-in after another.
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
`auth/githubLease`'s result, with M123's additive `expiresAt` (epoch ms).
The runtime-side mirror of M104's MHP row until M104 merges (PLAN.md
M123, lane 0); its `methods.ts` row takes the same field then.
@unwired M123 GitHub lease result shape
*/
export const githubLeaseResultSchema = z.strictObject({
  leaseId: z.nullable(z.string().check(z.uuid())),
  expiresAt: z.optional(z.int().check(z.positive())),
})

/**
When a lease granted at `grantedAt` stops being used: the editor's
`expiresAt`, but never later than GITHUB_LEASE_TTL_MS after the grant.
@unwired M123 GitHub lease expiry
*/
export function leaseExpiresAt(grantedAt: number, expiresAt: number | undefined): number {
  const limit = grantedAt + GITHUB_LEASE_TTL_MS
  return expiresAt === undefined ? limit : Math.min(expiresAt, limit)
}

/**
The scopes a request may ask for: `repo`, and `read:org` once a lane has
proved the need. Anything else (`workflow`, `admin:*`, `gist`…) is refused.
*/
export function assertPermittedScopes(scopes: readonly string[]): void {
  if (scopes.some((scope) => !GITHUB_PERMITTED_SCOPES.includes(scope))) {
    throw new GitHubTokenSourceError('scopeRefused')
  }
}

/**
D242's one exception: Share asks for the gist scope only at the moment the
person presses Share to a secret gist, never at sign-in. The set is exact
— `gist` alone — and no other caller may pass it. The repository sign-in
is a different grant and is not widened here.
*/
export function assertGistShareScopes(scopes: readonly string[]): void {
  const wanted = new Set(scopes)
  if (
    wanted.size !== GITHUB_GIST_SCOPES.length ||
    GITHUB_GIST_SCOPES.some((scope) => !wanted.has(scope))
  ) {
    throw new GitHubTokenSourceError('scopeRefused')
  }
}

/**
A source that can run D242's Share-time sign-in: a fresh grant carrying
`gist` alone, stored apart from the repository sign-in. Only the
device-flow source implements this; the editor's session and `gh` keep
theirs, so a Share-time grant never widens them.
*/
export interface GitHubGistScopeSource extends GitHubTokenSource {
  signInForGistShare(signal: AbortSignal): Promise<GitHubCredential | undefined>
  /**
  The stored gist grant, or undefined when there is none still fresh.
  Never starts a device flow and never reads the repository slot.
  */
  storedGistGrant(signal: AbortSignal): Promise<GitHubCredential | undefined>
}

export function canAskGistScope(source: GitHubTokenSource): source is GitHubGistScopeSource {
  return 'signInForGistShare' in source && typeof source.signInForGistShare === 'function'
}

/**
The `required` scopes a token lacks, from GitHub's `X-OAuth-Scopes`
header; undefined when the header is absent (a lease's answer, or a
token type that does not report scopes), so nothing is guessed.
M118 phase 2 (D242) reads it to tell a missing gist scope from a real
404.
*/
export function missingScopes(
  header: string | null,
  required: readonly string[],
): readonly string[] | undefined {
  if (header === null) {
    return
  }
  const granted = new Set(
    header
      .split(',')
      .map((scope) => scope.trim())
      .filter((scope) => scope !== ''),
  )
  return required.filter((scope) => !granted.has(scope))
}

/** The OAuth App's client id (Q-M123); an empty one is refused, so no request goes out without it. */
export function requireOAuthClientId(): string {
  if (GITHUB_OAUTH_CLIENT_ID.trim() === '') {
    throw new GitHubTokenSourceError('clientIdUnset')
  }
  return GITHUB_OAUTH_CLIENT_ID
}

/** A setting's values by scope, as an editor's `inspect` reports them. */
export interface SettingInspection {
  readonly globalValue?: unknown
  readonly workspaceValue?: unknown
  readonly workspaceFolderValue?: unknown
}

/**
Whether `museSpark.github.useGhLogin` is on: only the user's (or the
machine's) own `true` counts. A repository's or folder's value is ignored,
whatever it says, so a cloned project cannot read the user's `gh` token.
*/
export function isGhLoginEnabled(setting: SettingInspection | undefined): boolean {
  return setting?.globalValue === true
}
