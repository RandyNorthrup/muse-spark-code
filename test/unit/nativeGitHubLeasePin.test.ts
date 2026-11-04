// The lease's endpoint pin over the real MHP connection and the real REST
// client (RVHOSTS2's open P3): the method's schema refuses any address but
// GitHub's own API, and the client puts a failed fetch's message in the
// sentence the person reads, so the lease refuses first, in words. Every REST
// body is M71's recorded capture (helpers/githubCapture.ts).
import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import { editorLeaseSource } from '../../src/runtime/panel/nativeGitHub'
import { stderrLogger } from '../../src/runtime/stderrLog'
import { GITHUB_API_BASE_URL, UI_TEXT } from '../../src/shared/constants'
import { isGitHubLeaseUrl } from '../../src/shared/hostApi/githubLeaseUrl'
import { CAPTURED_USER } from './helpers/githubCapture'
import { connectedWire } from './helpers/panelWire'

/** The lease id the editor answers with, in the shape the contract parses. */
const LEASE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const log = stderrLogger(() => undefined, 'warn')

async function leased() {
  const { connection, editor } = await connectedWire(['lifecycle', 'auth'])
  const calls: unknown[] = []
  editor.serve('auth/githubLease', () => ({ leaseId: LEASE_ID }))
  editor.serve('github/request', (params) => {
    calls.push(params)
    return { status: 200, body: JSON.stringify(CAPTURED_USER) }
  })
  const credential = await editorLeaseSource({
    host: connection,
    workspaceUri: 'file:///workspace',
    now: Date.now,
  }).credential('silent', new AbortController().signal)
  if (credential === undefined) throw new Error('the editor answered a lease')
  return { connection, calls, credential }
}

describe('the editor lease endpoint pin', () => {
  it('refuses another address in words, before anything crosses to the editor', async () => {
    const { connection, calls, credential } = await leased()
    try {
      const client = new GitHubClient({
        fetch: credential.fetch,
        userAgent: 'muse-spark-code/test',
        log,
        baseUrl: 'https://github.example.invalid',
      })
      const refused = client.currentUser(credential.bearer)
      await expect(refused).rejects.toBeInstanceOf(GitHubError)
      await expect(refused).rejects.toMatchObject({
        kind: 'network',
        message: UI_TEXT.gitHubLeaseEndpointRefused,
      })
      expect(calls).toEqual([])
    } finally {
      connection.close()
    }
  })

  it('carries the pinned address to the editor', async () => {
    const { connection, calls, credential } = await leased()
    try {
      const client = new GitHubClient({
        fetch: credential.fetch,
        userAgent: 'muse-spark-code/test',
        log,
      })
      await expect(client.currentUser(credential.bearer)).resolves.toMatchObject({
        login: CAPTURED_USER.login,
      })
      expect(calls).toMatchObject([
        { leaseId: LEASE_ID, method: 'GET', url: `${GITHUB_API_BASE_URL}/user` },
      ])
    } finally {
      connection.close()
    }
  })

  it.each([
    [`${GITHUB_API_BASE_URL}/user`, true],
    [`${GITHUB_API_BASE_URL}/repos/owner/name/pulls`, true],
    [`${GITHUB_API_BASE_URL}/user/repos`, false],
    [`${GITHUB_API_BASE_URL}/gists`, false],
    ['https://user:secret@api.github.com/user', false],
    [`${GITHUB_API_BASE_URL}/user#fragment`, false],
    [`${GITHUB_API_BASE_URL.replace('https:', 'http:')}/user`, false],
    ['not a url', false],
  ])('reads %s as %s', (url, expected) => {
    expect(isGitHubLeaseUrl(url)).toBe(expected)
  })
})
