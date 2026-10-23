// M118 phase 2 (D217): a share as a secret gist, and its unpublish.
//
// The gist scope is asked only here, only after the person pressed Share to
// a secret gist and consented with the scope words in front of them; sign-in
// itself never asks. The attempt goes out on the sign-in's credential
// first, so a token that already carries the scope never asks again. When
// GitHub answers 404 without the scope on the token (its documented answer
// for a missing gist scope), the consent runs once and the call is retried
// once on the fresh grant; anything else is said as it came. Declining
// refuses only the gist route: copy, file and browser never meet this code.
//
// Only the exact scrubbed preview bytes are sent, as one file, `public:
// false` always. A reply that is not secret is deleted and refused.
import { GitHubClient, GitHubError } from '../git/github'
import type { GitHubSignIn } from '../git/githubSignIn'
import { missingScopes, type GitHubCredential } from '../git/tokenSource'
import { GITHUB_GIST_SCOPE, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { CoreLogger } from '../logging'

/** The gist GitHub made: its id and the link the person gets. */
export interface PublishedGist {
  readonly id: string
  readonly url: string
}

/** An unpublish target: the id to delete, and the person's link when it parsed from one. */
export interface GistTarget {
  readonly id: string
  readonly url: string | undefined
}

export interface GistSharePorts {
  /**
  The sign-in's credential for one GitHub call (`ask`), throwing said
  words when the sign-in is not given (`gistShareCredential` says them).
  Repo scopes only; the gist scope is never on this path.
  */
  readonly credential: (signal: AbortSignal) => Promise<GitHubCredential>
  /**
  D217's upgrade after consent: a fresh grant carrying the gist scope,
  throwing said words when no source can ask or the grant is not given.
  */
  readonly upgradeToGistScope: (signal: AbortSignal) => Promise<GitHubCredential>
  /** The consent question with the scope words; true only for an explicit yes. */
  readonly confirmScope: (signal: AbortSignal) => Promise<boolean>
  readonly userAgent: string
  readonly log: CoreLogger
}

/**
A credential for one gist call, saying in fixed words why a sign-in did
not finish: the sign-in's own sentence, or that it was not given. Cancel
still aborts the call.
*/
export async function gistShareCredential(
  signIn: GitHubSignIn,
  signal: AbortSignal,
  scope: 'signIn' | 'gist',
): Promise<GitHubCredential> {
  let credential: GitHubCredential | undefined
  try {
    credential =
      scope === 'gist'
        ? await signIn.credentialForGistShare(signal)
        : await signIn.credential('ask', signal)
  } catch (error: unknown) {
    signal.throwIfAborted()
    throw new Error(signIn.failureText(error) ?? UI_TEXT.gitHubSignInDeclined, { cause: error })
  }
  if (credential === undefined) throw new Error(UI_TEXT.gitHubSignInDeclined)
  return credential
}

/** Whether `error` is GitHub's documented answer to a missing gist scope (404, scope not granted). */
function isGistScopeMissing(error: GitHubError): boolean {
  const missing = missingScopes(error.scopes, [GITHUB_GIST_SCOPE])
  return missing === undefined || missing.includes(GITHUB_GIST_SCOPE)
}

/** Create the gist, refusing (and deleting) anything GitHub did not make secret. */
async function createSecretGist(
  client: GitHubClient,
  token: string,
  gist: { readonly description: string; readonly fileName: string; readonly content: string },
  signal: AbortSignal,
): Promise<PublishedGist> {
  const created = await client.createGist(
    token,
    { description: gist.description, fileName: gist.fileName, content: gist.content },
    signal,
  )
  if (!created.isPublic) return { id: created.id, url: created.url }
  try {
    await client.deleteGist(token, created.id, signal)
  } catch (error: unknown) {
    // The gist stands public on GitHub: the person must delete it by hand,
    // at the link only this failure names.
    throw new Error(fill(UI_TEXT.shareGistLeftPublic, { url: created.url }), { cause: error })
  }
  throw new Error(UI_TEXT.shareGistNotSecret)
}

/**
One gist call on the sign-in's credential, then, only when GitHub's
answer is its documented missing-scope 404 and only after the person's
consent, one more on a fresh gist-scoped grant. Anything else is said as
it came; declining refuses only the gist route.
*/
async function withGistScope<T>(
  ports: GistSharePorts,
  signal: AbortSignal,
  operation: (client: GitHubClient, token: string) => Promise<T>,
): Promise<T> {
  const first = await ports.credential(signal)
  const client = new GitHubClient({
    fetch: first.fetch,
    userAgent: ports.userAgent,
    log: ports.log,
  })
  try {
    return await operation(client, first.bearer)
  } catch (error: unknown) {
    if (
      !(error instanceof GitHubError) ||
      error.kind !== 'notFound' ||
      !isGistScopeMissing(error)
    ) {
      throw error
    }
    signal.throwIfAborted()
    if (!(await ports.confirmScope(signal)))
      throw new Error(UI_TEXT.shareGistDeclined, { cause: error })
    const upgraded = await ports.upgradeToGistScope(signal)
    signal.throwIfAborted()
    const retry = new GitHubClient({
      fetch: upgraded.fetch,
      userAgent: ports.userAgent,
      log: ports.log,
    })
    return await operation(retry, upgraded.bearer)
  }
}

/**
Publish the exact scrubbed preview bytes as a secret gist. Returns the
link to show the person.
*/
export async function publishGistShare(
  gist: { readonly description: string; readonly fileName: string; readonly content: string },
  ports: GistSharePorts,
  signal: AbortSignal,
): Promise<PublishedGist> {
  return await withGistScope(
    ports,
    signal,
    async (client, token) => await createSecretGist(client, token, gist, signal),
  )
}

/**
Read a gist id or link the person gave: a bare id, or an
`https://gist.github.com/<user>/<id>` link (the scheme may be omitted).
Anything else is said, never sent: only structure is checked here, and
GitHub judges whether the gist exists.
*/
export function parseGistTarget(value: string): GistTarget {
  const text = value.trim()
  if (text === '') throw new Error(UI_TEXT.shareGistInvalid)
  if (!text.includes('/')) {
    if (!/^[A-Za-z0-9]+$/.test(text)) throw new Error(UI_TEXT.shareGistInvalid)
    return { id: text, url: undefined }
  }
  const candidate = text.includes('://') ? text : `https://${text}`
  if (!URL.canParse(candidate)) throw new Error(UI_TEXT.shareGistInvalid)
  const link = new URL(candidate)
  if (link.protocol !== 'https:' || link.host !== 'gist.github.com') {
    throw new Error(UI_TEXT.shareGistInvalid)
  }
  const segments = link.pathname.split('/').filter((segment) => segment !== '')
  const [user, id] = segments
  if (user === undefined || id === undefined || segments.length !== 2) {
    throw new Error(UI_TEXT.shareGistInvalid)
  }
  return { id, url: text }
}

/** Delete the person's gist. */
export async function unpublishGistShare(
  target: GistTarget,
  ports: GistSharePorts,
  signal: AbortSignal,
): Promise<void> {
  await withGistScope(ports, signal, async (client, token) => {
    await client.deleteGist(token, target.id, signal)
  })
}
