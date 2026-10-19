// Which GitHub repository a git remote names (M71, PLAN.md D49): pull
// requests go to github.com only, since VS Code ships sign-in for GitHub
// and no other forge. A remote is read in the shapes git itself accepts for
// github.com: `https://github.com/owner/repo(.git)`, the scp-like
// `git@github.com:owner/repo(.git)` and `ssh://git@github.com/owner/repo`.
// Anything else (another host, a local path, GitHub Enterprise) is not a
// GitHub remote here.
//
// Pure: the host reads the remotes through VS Code's git extension.

import { redactSecrets } from '../redact'

export interface GitHubRepository {
  readonly owner: string
  readonly name: string
}

const GITHUB_HOST = 'github.com'
const URL_SCHEMES: ReadonlySet<string> = new Set(['https:', 'ssh:', 'git:'])
// `[user@]github.com:owner/repo`, git's scp-like syntax (git-clone(1), "GIT URLS").
const SCP_LIKE = /^(?:[^@/\s]+@)?github\.com:(?<path>[^\s]+)$/i
const GIT_SUFFIX = /\.git$/i
const EDGE_SLASHES = /^\/+|\/+$/g
// GitHub's own limits: an account name is letters, digits and single inner
// hyphens, at most 39 long; a repository name is letters, digits, `.`, `_`
// and `-`, at most 100 long, never `.` or `..`.
const OWNER = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/
const REPOSITORY = /^[\w.-]{1,100}$/
const DOT_NAMES: ReadonlySet<string> = new Set(['.', '..'])
const REDACTED_USER_INFO = '[redacted]'

function repositoryOfPath(rawPath: string): GitHubRepository | undefined {
  const parts = rawPath.replaceAll(EDGE_SLASHES, '').replace(GIT_SUFFIX, '').split('/')
  const [owner, name] = parts
  if (owner === undefined || name === undefined || parts.length !== 2) {
    return undefined
  }
  return OWNER.test(owner) && REPOSITORY.test(name) && !DOT_NAMES.has(name)
    ? { owner, name }
    : undefined
}

function parsedUrl(remoteUrl: string): URL | undefined {
  try {
    return new URL(remoteUrl)
  } catch {
    // Not a URL: the scp-like form, a local path or garbage.
    return undefined
  }
}

/** The github.com repository `remoteUrl` names; undefined for any other remote. */
export function githubRepositoryOf(remoteUrl: string): GitHubRepository | undefined {
  const trimmed = remoteUrl.trim()
  const url = parsedUrl(trimmed)
  if (url !== undefined && URL_SCHEMES.has(url.protocol)) {
    return url.hostname.toLowerCase() === GITHUB_HOST ? repositoryOfPath(url.pathname) : undefined
  }
  const scp = SCP_LIKE.exec(trimmed)?.groups?.['path']
  return scp === undefined ? undefined : repositoryOfPath(scp)
}

/** `owner/name`, as GitHub writes it. */
export function repositoryLabel(repository: GitHubRepository): string {
  return `${repository.owner}/${repository.name}`
}

/** `text` percent-decoded, or as it is when it is not valid percent-encoding. */
function decoded(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch (error) {
    // Only malformed percent-encoding keeps its spelling: decoding raises
    // URIError for exactly that, so any other failure is raised, never kept.
    if (error instanceof URIError) return text
    throw error
  }
}

/**
 * Text with every credential shape the redactor knows masked, judged on
 * its percent-decoded form too (RVM123G2 R11): an encoded secret is shown
 * decoded and masked, never passed through in a spelling the redactor
 * cannot read.
 */
function redactedEither(text: string): string {
  const plain = decoded(text)
  return redactSecrets(plain !== text && redactSecrets(plain) !== plain ? plain : text)
}

/**
 * A URL's query as a confirmation shows it: each parameter's name with its
 * value masked, whatever the name or its spelling (`%74oken`). Where a
 * push goes never needs a query value.
 */
function maskedQuery(search: string): string {
  if (search === '') {
    return ''
  }
  const masked: string[] = []
  // A plain loop: VS Code 1.99's Node 20 host has no iterator helpers.
  const names = new URLSearchParams(search).keys()
  for (const name of names) {
    masked.push(`${encodeURIComponent(name)}=${REDACTED_USER_INFO}`)
  }
  return `?${masked.join('&')}`
}

/**
 * A remote URL as a confirmation shows it: an `https://` user-info part
 * (a token or a user name, which a remote may carry) masked, every query
 * value and any fragment masked, and any other credential shape the log
 * redactor knows masked too, plain or percent-encoded.
 */
export function maskRemoteUrl(remoteUrl: string): string {
  const url = parsedUrl(remoteUrl)
  if (url === undefined) {
    return redactedEither(remoteUrl)
  }
  // `ssh://git@github.com/…`: the user name is the protocol's, not a secret.
  const hasUserSecret =
    (url.username !== '' || url.password !== '') && (url.protocol !== 'ssh:' || url.password !== '')
  if (!hasUserSecret && url.search === '' && url.hash === '') {
    return redactedEither(remoteUrl)
  }
  const base = hasUserSecret
    ? `${url.protocol}//${REDACTED_USER_INFO}@${url.host}${url.pathname}`
    : (remoteUrl.split(/[?#]/, 1)[0] ?? '')
  const fragment = url.hash === '' ? '' : `#${REDACTED_USER_INFO}`
  return redactedEither(`${base}${maskedQuery(url.search)}${fragment}`)
}
