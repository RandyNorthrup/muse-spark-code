// The request the real GitHub client builds, read before it is sent.
// The fetch records that request and then fails the network: nothing is
// published, and no stand-in answers 201 for GitHub.
import { describe, expect, it } from 'vitest'
import { GitHubError } from '../../src/core/git/github'
import { publishGistShare, type GistSharePorts } from '../../src/core/sharing/gistShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { UI_TEXT } from '../../src/shared/constants'
import { recordLog } from './helpers/recordLog'
import { scriptedFetch } from './helpers/scriptedFetch'

const BEARER = 'gho_sendprooftoken'
const SECRET = `ghp_${'c'.repeat(36)}`
const USER = 'someone'

function ports(fetch: typeof globalThis.fetch): GistSharePorts & { consents: number } {
  const { log } = recordLog()
  let consents = 0
  const built: GistSharePorts & { consents: number } = {
    credential: () =>
      Promise.resolve({
        source: 'deviceFlow',
        bearer: BEARER,
        fetch,
        expiresAt: undefined,
      }),
    upgradeToGistScope: () => Promise.reject(new Error('must not upgrade')),
    confirmScope: () => {
      consents += 1
      return Promise.resolve(true)
    },
    privacy: createChatSharePrivacy({
      workspaceRoots: ['/Users/someone/work/proj'],
      home: '/Users/someone',
      userName: USER,
      redactRegisteredSecrets: (text) => text,
    }),
    userName: USER,
    userAgent: 'muse-spark-code/test',
    log,
    get consents() {
      return consents
    },
  }
  return built
}

describe('gist send boundary', () => {
  it('sends only the scrubbed file, as a secret gist, and keeps the token out of the body and the error', async () => {
    const calls: { readonly body: string; readonly authorization: string | null }[] = []
    const fetch = scriptedFetch((url, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        body: typeof init?.body === 'string' ? init.body : '',
        authorization: headers.get('Authorization'),
      })
      expect(url).toBe('https://api.github.com/gists')
      return Promise.reject(new TypeError('fetch failed'))
    })
    let failure: unknown
    try {
      await publishGistShare(
        {
          // The account is scrubbed in an identity field and in paths. A bare
          // word is not an account (the share scrub's own rule).
          description: 'account: someone',
          fileName: 'share.md',
          content: `token ${SECRET} from /Users/someone/work/proj/notes.md and /Users/someone/.ssh/id`,
        },
        ports(fetch),
        new AbortController().signal,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('network')
    expect((failure as GitHubError).message).not.toContain(BEARER)
    expect((failure as GitHubError).message).not.toContain(SECRET)
    expect(calls).toHaveLength(1)
    const sent = calls[0]?.body ?? ''
    const parsed = JSON.parse(sent) as {
      public: boolean
      files: Record<string, { content: string }>
    }
    expect(parsed.public).toBe(false)
    expect(Object.keys(parsed.files)).toEqual(['share.md'])
    expect(sent).not.toContain(BEARER)
    expect(sent).not.toContain(SECRET)
    expect(sent).not.toContain('/Users/someone')
    expect(sent).not.toContain(USER)
    expect(calls[0]?.authorization).toBe(`Bearer ${BEARER}`)
  })

  it('refuses a file name with a folder or an account before any request', async () => {
    let calls = 0
    const fetch = scriptedFetch(() => {
      calls += 1
      return Promise.reject(new TypeError('fetch failed'))
    })
    const signal = new AbortController().signal
    for (const fileName of ['../notes.md', 'someone.md', String.raw`C:\Users\someone\notes.md`]) {
      let failure: unknown
      try {
        await publishGistShare({ description: 'd', fileName, content: 'c' }, ports(fetch), signal)
      } catch (error: unknown) {
        failure = error
      }
      expect((failure as Error).message).toBe(UI_TEXT.shareGistFileUnsafe)
    }
    expect(calls).toBe(0)
  })

  it('does not ask or retry when a 404 carries no scope header', async () => {
    const built = ports(
      scriptedFetch(() =>
        Promise.resolve(Response.json({ message: 'Not Found' }, { status: 404 })),
      ),
    )
    let failure: unknown
    try {
      await publishGistShare(
        { description: 'd', fileName: 'share.md', content: 'c' },
        built,
        new AbortController().signal,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('notFound')
    expect(built.consents).toBe(0)
  })

  it('deletes an unconfirmed gist when its id can be read, and does not show a foreign link', async () => {
    const methods: string[] = []
    const gistId = 'b'.repeat(20)
    const fetch = scriptedFetch((_url, init) => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      return Promise.resolve(
        method === 'DELETE'
          ? new Response(null, { status: 204 })
          : Response.json(
              { id: gistId, html_url: 'https://evil.example/gist', public: false },
              { status: 201 },
            ),
      )
    })
    let failure: unknown
    try {
      await publishGistShare(
        { description: 'd', fileName: 'share.md', content: 'c' },
        ports(fetch),
        new AbortController().signal,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.shareGistNotSecret)
    expect((failure as Error).message).not.toContain('evil.example')
    expect(methods).toEqual(['POST', 'DELETE'])
  })

  it('refuses a create with no id and does not delete', async () => {
    const methods: string[] = []
    const fetch = scriptedFetch((_url, init) => {
      methods.push(init?.method ?? 'GET')
      return Promise.resolve(Response.json({ public: true }, { status: 201 }))
    })
    let failure: unknown
    try {
      await publishGistShare(
        { description: 'd', fileName: 'share.md', content: 'c' },
        ports(fetch),
        new AbortController().signal,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.shareGistNotSecret)
    expect(methods).toEqual(['POST'])
  })

  it('sends the stored gist grant and does not call the repository sign-in', async () => {
    const gistBearer = 'gho_gistgranttoken'
    let signIns = 0
    const calls: { readonly authorization: string | null; readonly body: string }[] = []
    const fetch = scriptedFetch((url, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        body: typeof init?.body === 'string' ? init.body : '',
        authorization: headers.get('Authorization'),
      })
      expect(url).toBe('https://api.github.com/gists')
      return Promise.reject(new TypeError('fetch failed'))
    })
    const built = ports(fetch)
    let failure: unknown
    try {
      await publishGistShare(
        { description: 'd', fileName: 'share.md', content: 'c' },
        {
          ...built,
          credential: () => {
            signIns += 1
            return Promise.reject(new Error('repository sign-in must not be read'))
          },
          gistCredential: () =>
            Promise.resolve({
              source: 'deviceFlow',
              bearer: gistBearer,
              fetch,
              expiresAt: undefined,
            }),
        },
        new AbortController().signal,
      )
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).kind).toBe('network')
    expect((failure as GitHubError).message).not.toContain(gistBearer)
    expect(signIns).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.authorization).toBe(`Bearer ${gistBearer}`)
    const parsed = JSON.parse(calls[0]?.body ?? '') as { public: boolean }
    expect(parsed.public).toBe(false)
    expect(calls[0]?.body).not.toContain(gistBearer)
  })
})
