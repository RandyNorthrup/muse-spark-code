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

import type { GITHUB_TOKEN_SOURCE_ORDER } from '../../shared/constants'

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
