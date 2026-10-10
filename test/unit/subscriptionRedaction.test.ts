// C-M95-SUB P1-2: the headless session writer scrubs the credential
// actually sent (subscription or pasted), never only the pasted key.
// Fakes only: an in-memory auth file and a capturing inner store.
import { describe, expect, it } from 'vitest'
import { withCredentialRedaction } from '../../src/runtime/backends'
import type { SessionStore, StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { SubscriptionKeySource } from '../../src/core/backends/modelapi/subscriptionKey'

// Opaque values no shape pattern matches: only the exact literals read
// from the credentials can scrub them.
const SUB = 'opaque subscription value 9d4e1a'
const PASTED = 'opaque pasted value 3b7c2e'

function credential(text: string | undefined, pasted: string | undefined) {
  const files = new Map<string, string>()
  const source = new SubscriptionKeySource({
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    readFile: (file: string) => {
      const found = files.get(file)
      return found === undefined
        ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' }))
        : Promise.resolve(found)
    },
    stat: (file: string) =>
      files.has(file)
        ? Promise.resolve({ size: 8 })
        : Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })),
  })
  if (text !== undefined) files.set(source.path(), text)
  return new SubscriptionCredential({
    credentials: { getApiKey: () => Promise.resolve(pasted) },
    isEnabled: () => true,
    platform: 'linux',
    homeDir: '/home/u',
    xdgConfigHome: undefined,
    source,
  })
}

function subscriptionFile(accessToken: string): string {
  return JSON.stringify({ schema_version: 1, providers: { meta: { access_token: accessToken } } })
}

function capturingStore(saved: unknown[]): SessionStore {
  return {
    list: () => Promise.resolve([]),
    load: () => Promise.resolve(undefined),
    save: (session: StoredSession) => {
      saved.push(session)
      return Promise.resolve()
    },
    remove: () => Promise.resolve(),
  }
}

function transcript(): StoredSession {
  return {
    sessionId: 'session',
    workspaceRoot: '/workspace',
    createdAt: 'now',
    lastActivityAt: 'now',
    turnIds: [],
    outputs: {},
    replay: [
      {
        turnId: 'turn',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: `debug this with ${SUB} inline` }],
        },
      },
      {
        turnId: 'turn',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `tried Bearer ${PASTED} twice` }],
        },
      },
    ],
  } as unknown as StoredSession
}

describe('headless credential redaction', () => {
  it('scrubs the actually-sent subscription key from saved transcripts', async () => {
    const saved: unknown[] = []
    const wrapper = withCredentialRedaction(capturingStore(saved), () =>
      credential(subscriptionFile(SUB), PASTED).redactionKeys(),
    )
    const snapshot = transcript()
    await wrapper.save(snapshot)
    expect(JSON.stringify(saved)).not.toContain(SUB)
    expect(JSON.stringify(saved)).not.toContain(PASTED)
    // The caller's copy is untouched: only the persisted copy is scrubbed.
    expect(JSON.stringify(snapshot)).toContain(SUB)
  })
  it('still saves when the sign-in is unreadable', async () => {
    const saved: unknown[] = []
    const wrapper = withCredentialRedaction(capturingStore(saved), () =>
      credential(undefined, PASTED).redactionKeys(),
    )
    await wrapper.save(transcript())
    expect(saved).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain(PASTED)
  })
})
