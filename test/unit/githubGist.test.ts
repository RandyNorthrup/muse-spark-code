// M118 phase 2 (D218): the gist calls on the GitHub REST client, and the
// scopes each sign-in path may ask. The client is real; only its `fetch`
// transport is injected, as the client's own tests do. Reply shapes follow
// GitHub's documented gist schemas (docs/certification/rlf-m118.md names
// the live capture for the lead).
import { describe, expect, it } from 'vitest'
import { GitHubClient, GitHubError } from '../../src/core/git/github'
import {
  signInWithDeviceFlow,
  signInWithDeviceFlowForGistShare,
} from '../../src/core/git/deviceFlow'
import {
  assertGistShareScopes,
  assertPermittedScopes,
  GitHubTokenSourceError,
} from '../../src/core/git/tokenSource'
import {
  GITHUB_API_BASE_URL,
  GITHUB_DEVICE_CODE_URL,
  GITHUB_GIST_SCOPES,
} from '../../src/shared/constants'
import { recordLog } from './helpers/recordLog'

// A fake gist id, built at runtime so no secret-shaped literal sits in source.
const GIST_ID = 'a'.repeat(32)
const GIST_URL = `https://gist.github.com/someone/${GIST_ID}`

interface RecordedCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

function recordingFetch(
  calls: RecordedCall[],
  respond: (call: RecordedCall) => Response,
): typeof fetch {
  const recorded: typeof fetch = ((url: string, init?: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return Promise.resolve(respond(call))
  }) as typeof fetch
  return recorded
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return headers === undefined
    ? Response.json(body, { status })
    : Response.json(body, { status, headers })
}

/** The device flow must not present before GitHub's code answer arrives. */
function failingPresent(): Promise<never> {
  return Promise.reject(new Error('must not present before GitHub answers'))
}

describe('GitHubClient secret gists', () => {
  it('creates a secret gist with the share as its one file', async () => {
    const calls: RecordedCall[] = []
    const { log } = recordLog()
    const client = new GitHubClient({
      fetch: recordingFetch(calls, () =>
        jsonResponse(201, {
          id: GIST_ID,
          html_url: GIST_URL,
          public: false,
          description: 'ignored',
        }),
      ),
      userAgent: 'muse-spark-code/test',
      log,
    })
    const gist = await client.createGist('first-token', {
      description: 'muse-weekly-sync-2026-10-23.md',
      fileName: 'muse-weekly-sync-2026-10-23.md',
      content: '# Weekly sync\n',
    })
    expect(gist).toEqual({
      id: GIST_ID,
      url: GIST_URL,
      isPublic: false,
    })
    expect(calls).toHaveLength(1)
    const [call] = calls
    expect(call?.url).toBe(`${GITHUB_API_BASE_URL}/gists`)
    const init = call?.init as { method: string; headers: Record<string, string>; body: string }
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer first-token')
    expect(JSON.parse(init.body)).toEqual({
      description: 'muse-weekly-sync-2026-10-23.md',
      public: false,
      files: { 'muse-weekly-sync-2026-10-23.md': { content: '# Weekly sync\n' } },
    })
  })

  it('deletes a gist and reads the granted scopes off a refusal', async () => {
    const calls: RecordedCall[] = []
    const { log, warnings } = recordLog()
    const client = new GitHubClient({
      fetch: recordingFetch(calls, (call) =>
        call.url.endsWith('/gists/missing')
          ? jsonResponse(404, { message: 'Not Found' }, { 'X-OAuth-Scopes': 'repo' })
          : new Response(null, { status: 204 }),
      ),
      userAgent: 'muse-spark-code/test',
      log,
    })
    await client.deleteGist('first-token', GIST_ID)
    let failure: unknown
    try {
      await client.deleteGist('first-token', 'missing')
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('notFound')
    expect((failure as GitHubError).scopes).toBe('repo')
    expect(calls.map((call) => call.url)).toEqual([
      `${GITHUB_API_BASE_URL}/gists/${GIST_ID}`,
      `${GITHUB_API_BASE_URL}/gists/missing`,
    ])
    expect(calls[0]?.init).toMatchObject({ method: 'DELETE' })
    expect(warnings.join('\n')).not.toContain('first-token')
  })

  it('leaves scopes null when the call never reached GitHub', async () => {
    const { log } = recordLog()
    const client = new GitHubClient({
      fetch: () => Promise.reject(new TypeError('fetch failed')),
      userAgent: 'muse-spark-code/test',
      log,
    })
    let failure: unknown
    try {
      await client.createGist('first-token', {
        description: 'd',
        fileName: 'f.md',
        content: 'c',
      })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('network')
    expect((failure as GitHubError).scopes).toBeNull()
  })
})

describe('gist scope guards', () => {
  it('refuses gist at sign-in and allows only the exact Share-time set', () => {
    expect(() => {
      assertPermittedScopes(['repo'])
    }).not.toThrow()
    expect(() => {
      assertPermittedScopes(['gist'])
    }).toThrow(GitHubTokenSourceError)
    expect(() => {
      assertPermittedScopes(['repo', 'gist'])
    }).toThrow(GitHubTokenSourceError)
    expect(() => {
      assertGistShareScopes([...GITHUB_GIST_SCOPES])
    }).not.toThrow()
    expect(GITHUB_GIST_SCOPES).toEqual(['gist'])
    for (const scopes of [['gist', 'repo'], ['repo'], ['repo', 'gist', 'workflow'], []]) {
      expect(() => {
        assertGistShareScopes(scopes)
      }).toThrow(GitHubTokenSourceError)
    }
    try {
      assertGistShareScopes(['repo', 'gist'])
      expect.unreachable()
    } catch (error: unknown) {
      expect((error as GitHubTokenSourceError).reason).toBe('scopeRefused')
    }
  })

  it('asks for the gist scope only on the Share-time device flow', async () => {
    const bodies: string[] = []
    const deps = {
      fetch: ((url: string, init?: RequestInit) => {
        bodies.push(new URL(url).pathname)
        const body = (init as { body?: string } | undefined)?.body
        if (typeof body === 'string') bodies.push(body)
        return Promise.reject(new TypeError('fetch failed'))
      }) as typeof fetch,
      now: () => 0,
      sleep: () => Promise.resolve(),
    }
    await expect(
      signInWithDeviceFlowForGistShare(deps, failingPresent, new AbortController().signal),
    ).rejects.toThrow('network')
    expect(bodies[0]).toBe(new URL(GITHUB_DEVICE_CODE_URL).pathname)
    expect(bodies[1]).toContain('scope=gist')
    expect(bodies[1]).not.toContain('repo')
  })

  it('refuses gist on the sign-in device flow without calling GitHub', async () => {
    let calls = 0
    const deps = {
      fetch: (() => {
        calls += 1
        return Promise.resolve(Response.json({}))
      }) as typeof fetch,
      now: () => 0,
      sleep: () => Promise.resolve(),
    }
    await expect(
      signInWithDeviceFlow(deps, ['gist'], () => Promise.resolve(), new AbortController().signal),
    ).rejects.toThrow(GitHubTokenSourceError)
    expect(calls).toBe(0)
  })
})
