// M118 phase 2 (D242): Share to a secret gist asks for the gist scope only
// at Share time, publishes only scrubbed bytes, and unpublishes. The
// GitHub client and the share builders below are real; only the `fetch`
// transport and the sign-in/consent ports are injected, as designed.
import { describe, expect, it } from 'vitest'
import { DeviceFlowFailure } from '../../src/core/git/deviceFlow'
import { GitHubError } from '../../src/core/git/github'
import { GitHubSignIn } from '../../src/core/git/githubSignIn'
import type { GitHubCredential, GitHubTokenSource } from '../../src/core/git/tokenSource'
import { buildChatShare, renderChatShare } from '../../src/core/sharing/chatShare'
import {
  gistShareCredential,
  parseGistTarget,
  publishGistShare,
  unpublishGistShare,
  type GistSharePorts,
} from '../../src/core/sharing/gistShare'
import { createChatSharePrivacy } from '../../src/core/sharing/privacy'
import { UI_TEXT } from '../../src/shared/constants'
import type { SharePrivacyPort } from '../../src/shared/share'
import { fill } from '../../src/shared/l10n/text'
import { redactSecrets } from '../../src/shared/redact'
import { recordLog } from './helpers/recordLog'

interface ScriptedCall {
  readonly authorization: string | undefined
  readonly body: unknown
}

const privacy: SharePrivacyPort = createChatSharePrivacy({
  workspaceRoots: [],
  home: '/Users/does-not-appear',
  userName: 'does-not-appear',
  redactRegisteredSecrets: (text) => text,
})

function credential(
  bearer: string,
  calls: ScriptedCall[],
  status: number,
  body: unknown,
): GitHubCredential {
  return {
    source: 'deviceFlow',
    bearer,
    fetch: ((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const text = typeof init?.body === 'string' ? init.body : undefined
      calls.push({
        authorization: headers.get('Authorization') ?? undefined,
        body: text === undefined ? undefined : (JSON.parse(text) as unknown),
      })
      return Promise.resolve(
        body === undefined
          ? new Response(null, { status })
          : Response.json(body, { status, headers: { 'X-OAuth-Scopes': 'repo' } }),
      )
    }) as typeof fetch,
    expiresAt: undefined,
  }
}

function portsFor(options: {
  readonly calls: ScriptedCall[]
  readonly first: { readonly status: number; readonly body: unknown }
  readonly retry?: { readonly status: number; readonly body: unknown }
  readonly consent: boolean
}): GistSharePorts & { readonly consents: number } {
  const { log } = recordLog()
  let consents = 0
  const ports: GistSharePorts = {
    credential: () =>
      Promise.resolve(
        credential('first-token', options.calls, options.first.status, options.first.body),
      ),
    upgradeToGistScope: () => {
      const retry = options.retry ?? options.first
      return Promise.resolve(credential('gist-token', options.calls, retry.status, retry.body))
    },
    confirmScope: () => {
      consents += 1
      return Promise.resolve(options.consent)
    },
    privacy,
    userName: 'does-not-appear',
    userAgent: 'muse-spark-code/test',
    log,
  }
  return {
    ...ports,
    get consents() {
      return consents
    },
  }
}

/** Ports where GitHub wrongly answers a public gist, then `onDelete` for the delete. */
function publicGistPorts(methods: string[], onDelete: () => Response): GistSharePorts {
  const { log } = recordLog()
  return {
    credential: () =>
      Promise.resolve({
        source: 'deviceFlow',
        bearer: 'first-token',
        fetch: ((_url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET'
          methods.push(method)
          return Promise.resolve(
            method === 'DELETE'
              ? onDelete()
              : Response.json({ ...CREATED, public: true }, { status: 201 }),
          )
        }) as typeof fetch,
        expiresAt: undefined,
      }),
    upgradeToGistScope: () => Promise.reject(new Error('must not upgrade')),
    confirmScope: () => Promise.resolve(true),
    privacy,
    userName: 'does-not-appear',
    userAgent: 'muse-spark-code/test',
    log,
  }
}

// A fake gist id, built at runtime so no secret-shaped literal sits in source.
const GIST_ID = 'a'.repeat(32)
const GIST_URL = `https://gist.github.com/someone/${GIST_ID}`

const CREATED = {
  id: GIST_ID,
  html_url: GIST_URL,
  public: false,
}
const GIST = {
  description: 'muse-weekly-sync-2026-10-23.md',
  fileName: 'muse-weekly-sync-2026-10-23.md',
  content: '# Weekly sync\n',
}

describe('publishGistShare', () => {
  it('publishes on the sign-in credential without asking when the scope is there', async () => {
    const calls: ScriptedCall[] = []
    const ports = portsFor({ calls, first: { status: 201, body: CREATED }, consent: true })
    const published = await publishGistShare(GIST, ports, new AbortController().signal)
    expect(published).toEqual({
      id: GIST_ID,
      url: GIST_URL,
    })
    expect(ports.consents).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.authorization).toBe('Bearer first-token')
    expect(calls[0]?.body).toMatchObject({ public: false })
  })

  it('asks once for the scope on a missing-scope 404 and retries on the fresh grant', async () => {
    const calls: ScriptedCall[] = []
    const ports = portsFor({
      calls,
      first: { status: 404, body: { message: 'Not Found' } },
      retry: { status: 201, body: CREATED },
      consent: true,
    })
    const published = await publishGistShare(GIST, ports, new AbortController().signal)
    expect(published.url).toContain('https://gist.github.com/')
    expect(ports.consents).toBe(1)
    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer first-token',
      'Bearer gist-token',
    ])
  })

  it('refuses only the gist route when the scope is declined', async () => {
    const calls: ScriptedCall[] = []
    const ports = portsFor({
      calls,
      first: { status: 404, body: { message: 'Not Found' } },
      consent: false,
    })
    let failure: unknown
    try {
      await publishGistShare(GIST, ports, new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.shareGistDeclined)
    expect(calls).toHaveLength(1)
  })

  it('says a 404 as it came when the token already carries the scope', async () => {
    const seen: string[] = []
    const { log } = recordLog()
    const ports: GistSharePorts = {
      credential: () =>
        Promise.resolve({
          source: 'deviceFlow',
          bearer: 'scoped-token',
          fetch: () =>
            Promise.resolve(
              Response.json(
                { message: 'Not Found' },
                { status: 404, headers: { 'X-OAuth-Scopes': 'repo, gist' } },
              ),
            ),
          expiresAt: undefined,
        }),
      upgradeToGistScope: () => Promise.reject(new Error('must not upgrade')),
      confirmScope: () => {
        seen.push('consent')
        return Promise.resolve(true)
      },
      privacy,
      userName: 'does-not-appear',
      userAgent: 'muse-spark-code/test',
      log,
    }
    let failure: unknown
    try {
      await publishGistShare(GIST, ports, new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(GitHubError)
    expect((failure as GitHubError).message).toBe('Not Found')
    expect(seen).toEqual([])
  })

  it('deletes and refuses a gist GitHub did not make secret', async () => {
    const methods: string[] = []
    const ports = publicGistPorts(methods, () => new Response(null, { status: 204 }))
    let failure: unknown
    try {
      await publishGistShare(GIST, ports, new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.shareGistNotSecret)
    expect(methods).toEqual(['POST', 'DELETE'])
  })

  it('names the link when a public gist cannot be deleted', async () => {
    const methods: string[] = []
    const ports = publicGistPorts(methods, () =>
      Response.json({ message: 'Bad gateway' }, { status: 502 }),
    )
    let failure: unknown
    try {
      await publishGistShare(GIST, ports, new AbortController().signal)
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(
      fill(UI_TEXT.shareGistLeftPublic, { url: CREATED.html_url }),
    )
    expect(methods).toEqual(['POST', 'DELETE'])
  })

  it('publishes a transcript holding a key, a registered value and paths redacted', async () => {
    const key = `ghp_${'b'.repeat(30)}`
    const registered = `vault-material-${'x'.repeat(16)}`
    const privacy = createChatSharePrivacy({
      workspaceRoots: ['/Users/someone/work/proj'],
      home: '/Users/someone',
      userName: 'someone',
      redactRegisteredSecrets: (text) => redactSecrets(text, [registered]),
    })
    const doc = buildChatShare(
      {
        sessionId: 's1',
        title: 'Weekly sync',
        exportedAt: '2026-10-23T10:00:00.000Z',
        items: [
          {
            itemId: 'u1',
            kind: 'userMessage',
            status: 'sent',
            text: `deploy with ${key} from /etc/secret/key.pem`,
          },
          {
            itemId: 'a1',
            kind: 'agentMessage',
            status: 'sent',
            text: `author: someone stored ${registered} under /Users/someone/.ssh/id`,
          },
        ],
      },
      {
        target: 'chat',
        sessionId: 's1',
        mode: 'conversation',
        format: 'md',
        destination: 'gist',
        options: { codeBlocks: true, attachmentNames: true, diffs: false, attachmentContents: [] },
      },
      privacy,
    )
    const content = renderChatShare(doc, 'md')
    const calls: ScriptedCall[] = []
    const ports = portsFor({ calls, first: { status: 201, body: CREATED }, consent: true })
    await publishGistShare(
      { description: 'share.md', fileName: 'share.md', content },
      ports,
      new AbortController().signal,
    )
    const sent = JSON.stringify(calls[0]?.body)
    expect(sent).not.toContain(key)
    expect(sent).not.toContain(registered)
    expect(sent).not.toContain('/etc/secret/key.pem')
    expect(sent).not.toContain('/Users/someone')
    expect(sent).not.toContain('author: someone')
    expect(sent).toContain('[redacted]')
    expect(sent).toContain('[path]')
    expect(sent).toContain('[home]')
    expect(sent).toContain('[user]')
  })
})

describe('unpublishGistShare', () => {
  it('deletes without asking when the credential serves', async () => {
    const calls: ScriptedCall[] = []
    const ports = portsFor({ calls, first: { status: 204, body: undefined }, consent: true })
    await unpublishGistShare({ id: GIST_ID, url: undefined }, ports, new AbortController().signal)
    expect(ports.consents).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('asks once for the scope on a missing-scope 404 and retries the delete', async () => {
    const calls: ScriptedCall[] = []
    const ports = portsFor({
      calls,
      first: { status: 404, body: { message: 'Not Found' } },
      retry: { status: 204, body: undefined },
      consent: true,
    })
    await unpublishGistShare({ id: GIST_ID, url: undefined }, ports, new AbortController().signal)
    expect(ports.consents).toBe(1)
    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer first-token',
      'Bearer gist-token',
    ])
  })
})

describe('parseGistTarget', () => {
  it.each([
    [GIST_ID, GIST_ID, undefined],
    [GIST_URL, GIST_ID, GIST_URL],
    [`gist.github.com/someone/${GIST_ID}/`, GIST_ID, `gist.github.com/someone/${GIST_ID}/`],
  ])('reads %s', (value, id, url) => {
    expect(parseGistTarget(value)).toEqual({ id, url })
  })

  it.each([
    '',
    ' '.repeat(3),
    'not a gist',
    'https://github.com/someone/repo',
    // Any non-https scheme is refused; ftp stands in because the lint rule
    // forbids an http literal even in a test that refuses it.
    `ftp://gist.github.com/someone/${GIST_ID}`,
    `https://gist.github.com/${GIST_ID}`,
    'https://evil-gist.github.com.evil.test/someone/id',
  ])('refuses %s in words', (value) => {
    let failure: unknown
    try {
      parseGistTarget(value)
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.shareGistInvalid)
  })
})

function signInWith(sources: () => GitHubTokenSource[]): GitHubSignIn {
  const { log } = recordLog()
  return new GitHubSignIn({
    sources,
    now: () => 0,
    login: () => Promise.resolve(undefined),
    log,
  })
}

describe('gistShareCredential', () => {
  it('says when the sign-in is not given', async () => {
    const signIn = signInWith(() => [])
    let failure: unknown
    try {
      await gistShareCredential(signIn, new AbortController().signal, 'signIn')
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.gitHubSignInDeclined)
  })

  it('says a denied sign-in in the sign-in words', async () => {
    const signIn = signInWith(() => [
      {
        kind: 'deviceFlow',
        credential: () => Promise.reject(new DeviceFlowFailure('denied')),
        rejected: () => Promise.resolve(),
        signOut: () => Promise.resolve(),
      },
    ])
    let failure: unknown
    try {
      await gistShareCredential(signIn, new AbortController().signal, 'signIn')
    } catch (error: unknown) {
      failure = error
    }
    expect((failure as Error).message).toBe(UI_TEXT.githubSignIn.failures.denied)
  })
})
