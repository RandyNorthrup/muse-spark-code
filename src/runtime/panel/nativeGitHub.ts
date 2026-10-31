// D104's source (a) in the runtime panel (M123, PLAN.md D104 §2): the
// editor's own GitHub sign-in, borrowed by lease over MHP. The token never
// leaves the editor: the runtime asks `auth/githubLease` (`ask` or
// `silent`) and gets an opaque lease id bound to this connection, and each
// call goes out as `github/request`, which the editor answers with GitHub's
// status and body after adding the token.
//
// - The lease id is the credential's bearer: it crosses MHP as the call's
//   own lease field, never as an `Authorization` header (the REST client's
//   header is dropped at the lease's `fetch`, which reads the address, the
//   method, the body and the signal only).
// - A lease the editor answers `null` for is no credential: the sign-in
//   falls through to the device flow, as D104's order says.
// - A 401 forgets nothing stored: the lease lives only in the credential
//   the call used, so dropping the credential drops the lease and the next
//   call asks the editor again. Signing out of the editor's own sign-in is
//   the editor's.
// - GitHub's answers arrive without headers, so a 403 for a spent rate
//   limit reads `invalid` instead of `rateLimited` (the log line only: the
//   user's words come from GitHub's body either way), and the scopes a
//   token lacks are never named (`missingScopes` reads undefined for a
//   lease's answer, as designed).
// - The methods' own schemas refuse what they must before anything is
//   sent: only GET and POST, only api.github.com's `/user` and `/repos/…`
//   paths, only bodies the envelope cap holds. A call the REST client
//   builds for any other method never leaves this module.

import { randomUUID } from 'node:crypto'
import {
  leaseExpiresAt,
  type GitHubCredential,
  type GitHubTokenSource,
} from '../../core/git/tokenSource'
import { UI_TEXT } from '../../shared/constants'
import { jsonValueSchema } from '../../shared/hostApi/data'
import type { HostServices } from '../../shared/hostApi/methods'

export interface EditorLeaseSourceDeps {
  /** The connection to the editor (`auth/githubLease`, `github/request`). */
  readonly host: HostServices
  /** The workspace, as the lease params name it. */
  readonly workspaceUri: string
  readonly now: () => number
}

/**
D104's source (a) for one panel connection: the editor's GitHub sign-in
by lease. The owner id it is made with binds every lease it asks for to
this connection, so each lease ends with it. Pure: the host, the
workspace and the clock are injected.
*/
/** The request's address, whatever form `fetch` was given it in. */
function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

export function editorLeaseSource(deps: EditorLeaseSourceDeps): GitHubTokenSource {
  const ownerId = randomUUID()

  /** The REST client's `fetch` over one lease: the address, method, body and signal cross MHP; no header does. */
  const leaseFetch = (leaseId: string): typeof fetch => {
    return async (input, init) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'
      if (method !== 'GET' && method !== 'POST') {
        throw new TypeError(UI_TEXT.gitHubFailed)
      }
      const answer = await deps.host.request(
        'github/request',
        {
          leaseId,
          ownerId,
          url,
          method,
          ...(typeof init?.body === 'string' && {
            body: jsonValueSchema.parse(JSON.parse(init.body)),
          }),
        },
        init?.signal ?? undefined,
      )
      return new Response(answer.body, { status: answer.status })
    }
  }

  return {
    kind: 'editorLease',
    async credential(
      mode: 'ask' | 'silent',
      signal: AbortSignal,
    ): Promise<GitHubCredential | undefined> {
      const grantedAt = deps.now()
      const answer = await deps.host.request(
        'auth/githubLease',
        { workspaceUri: deps.workspaceUri, ownerId, mode },
        signal,
      )
      if (answer.leaseId === null) {
        return undefined
      }
      // The frozen row carries no `expiresAt`, so the lease runs out at
      // the grant plus the TTL; a revision that adds the field plugs in here.
      const leaseId: string = answer.leaseId
      return {
        source: 'editorLease',
        bearer: leaseId,
        fetch: leaseFetch(leaseId),
        expiresAt: leaseExpiresAt(grantedAt, undefined),
      }
    },
    // The lease lives only in the credential the call used: dropping the
    // credential drops the lease, and the next call asks the editor again.
    rejected: () => Promise.resolve(),
    // The editor's sign-in is the editor's (its own accounts); nothing of ours is held.
    signOut: () => Promise.resolve(),
  }
}
