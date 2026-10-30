// M118 phase 2 (D218): a share as a secret gist, and its unpublish.
//
// The gist scope is asked only here, only after the person pressed Share to
// a secret gist and consented with the scope words in front of them; sign-in
// itself never asks. A gist grant already stored is the only token these
// calls send. Otherwise the attempt goes out on the sign-in's credential,
// so a token that already carries the scope never asks again. When GitHub
// answers 404 and the scopes header is present and lacks `gist` (its
// documented answer for a missing gist scope), the consent runs once and
// the call is retried once on the fresh grant; a missing header is not that
// answer. Anything else is said as it came. Declining refuses only the gist
// route: copy, file and browser never meet this code.
//
// The bytes are scrubbed again at the send. One file, `public: false`
// always. A file name with a folder, a home or an account is refused
// before any request. A reply that is not a confirmed secret gist at
// gist.github.com is deleted when its id can be read, and refused.
import { GitHubClient, GitHubError } from '../git/github'
import type { GitHubSignIn } from '../git/githubSignIn'
import { missingScopes, type GitHubCredential } from '../git/tokenSource'
import { GITHUB_GIST_SCOPE, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { SCRUB_MARKERS, scrubShareText, type SharePrivacyPort } from '../../shared/share'
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
  D218's upgrade after consent: a fresh grant carrying `gist` alone,
  throwing said words when no source can ask or the grant is not given.
  */
  readonly upgradeToGistScope: (signal: AbortSignal) => Promise<GitHubCredential>
  /** The consent question with the scope words; true only for an explicit yes. */
  readonly confirmScope: (signal: AbortSignal) => Promise<boolean>
  /**
  A gist grant already stored apart from the repository sign-in.
  Absent, or resolving undefined: the sign-in credential is tried, and
  a missing gist scope can still ask.
  */
  readonly gistCredential?: (signal: AbortSignal) => Promise<GitHubCredential | undefined>
  /** Scrub again at the send. The same port the preview used. */
  readonly privacy: SharePrivacyPort
  /** The account name, so a file name cannot carry it. */
  readonly userName: string
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
  // The header absent means nothing: a lease, a token that does not
  // report scopes, or a 404 that is not about the gist scope. Do not
  // ask and do not retry.
  const missing = missingScopes(error.scopes, [GITHUB_GIST_SCOPE])
  return missing?.includes(GITHUB_GIST_SCOPE) === true
}

/** A gist link we may show: https on gist.github.com, with no userinfo. */
function isGistWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const link = new URL(value)
  return (
    link.protocol === 'https:' &&
    link.host === 'gist.github.com' &&
    link.username === '' &&
    link.password === ''
  )
}

/** One file name: no folder, no home, no account, no scrub marker. */
function isUnsafeGistFileName(name: string, account: string): boolean {
  if (
    ['', '.', '..'].includes(name) ||
    /[/\\]/u.test(name) ||
    name.includes('..') ||
    SCRUB_MARKERS.some((marker) => name.includes(marker))
  ) {
    return true
  }
  const user = account.trim()
  if (user === '') return false
  const escaped = user.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the account name is quoted; the boundaries are fixed (PLAN.md §8).
  const segment = new RegExp(String.raw`(?<![\p{L}\p{N}_])${escaped}(?![\p{L}\p{N}_])`, 'iu')
  return segment.test(name)
}

/**
Create the gist, refusing (and deleting) anything that is not a confirmed
secret gist at gist.github.com. A reply we cannot confirm is deleted when
its id can be read; the person is never handed a link we did not confirm.
*/
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
  if (
    created.isPublic === false &&
    created.url !== undefined &&
    isGistWebUrl(created.url) &&
    created.id !== ''
  ) {
    return { id: created.id, url: created.url }
  }
  if (created.id === '') throw new Error(UI_TEXT.shareGistNotSecret)
  try {
    await client.deleteGist(token, created.id, signal)
  } catch (error: unknown) {
    // A confirmed gist.github.com link is the only url this sentence names.
    // Anything else stays unnamed: the person is not sent to it.
    const url = created.url
    if (url !== undefined && created.isPublic === true && isGistWebUrl(url)) {
      throw new Error(fill(UI_TEXT.shareGistLeftPublic, { url }), { cause: error })
    }
    throw new Error(UI_TEXT.shareGistNotSecret, { cause: error })
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
  // The gist grant, when one is stored, is the only token these calls
  // send. The repository sign-in is tried only until that grant exists.
  const stored = await ports.gistCredential?.(signal)
  const first = stored ?? (await ports.credential(signal))
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
  // Scrub at the send, even when the preview was already scrubbed. One
  // file, and its name cannot carry a folder, a home or an account.
  const description = scrubShareText(gist.description, ports.privacy)
  const content = scrubShareText(gist.content, ports.privacy)
  const fileName = scrubShareText(gist.fileName, ports.privacy)
  if (isUnsafeGistFileName(fileName, ports.userName)) throw new Error(UI_TEXT.shareGistFileUnsafe)
  return await withGistScope(
    ports,
    signal,
    async (client, token) =>
      await createSecretGist(client, token, { description, fileName, content }, signal),
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
