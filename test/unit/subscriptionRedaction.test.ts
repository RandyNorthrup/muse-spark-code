// C-M95-SUB P1-2: the headless session writer scrubs the credential
// actually sent (subscription or pasted), never only the pasted key.
// Real code only: the writer and the redactor over opaque canaries, with
// a capturing session store and auth-file bytes through the owned seams.
import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/shared/redact'
import { withCredentialRedaction } from '../../src/runtime/backends'
import type { SessionStore, StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { memorySubscriptionFile } from './helpers/subscriptionFile'

// Opaque values no shape pattern matches: only the exact literals read
// from the credentials can scrub them.
const SUB = 'opaque subscription value 9d4e1a'
const PASTED = 'opaque pasted value 3b7c2e'

function credential(text: string | undefined) {
  const file = memorySubscriptionFile()
  if (text !== undefined) file.writeText(text)
  const source = file.source
  return new SubscriptionCredential({
    credentials: { getApiKey: () => Promise.resolve(PASTED) },
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
  it('scrubs key A on the second save after rotation to key B', async () => {
    const file = memorySubscriptionFile()
    file.writeAccessToken(SUB)
    const keys = new SubscriptionCredential({
      credentials: { getApiKey: () => Promise.resolve(PASTED) },
      isEnabled: () => true,
      platform: 'linux',
      homeDir: '/home/rotation',
      xdgConfigHome: undefined,
      source: file.source,
    })
    const saved: unknown[] = []
    const writer = withCredentialRedaction(capturingStore(saved), () => keys.redactionKeys())
    await keys.getApiKey()
    const snapshot = transcript()
    await writer.save(snapshot)
    const rotated = 'opaque rotation value a173d9'
    file.writeAccessToken(rotated)
    await keys.getApiKey()
    await writer.save(snapshot)
    expect(saved).toHaveLength(2)
    expect(JSON.stringify(saved)).not.toContain(SUB)
    expect(redactSecrets(`previous ${SUB}; current ${rotated}`)).not.toContain(SUB)
    expect(redactSecrets(`previous ${SUB}; current ${rotated}`)).not.toContain(rotated)
  })
  it('scrubs the actually-sent subscription key from saved transcripts', async () => {
    const saved: unknown[] = []
    const wrapper = withCredentialRedaction(capturingStore(saved), () =>
      credential(subscriptionFile(SUB)).redactionKeys(),
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
      credential(undefined).redactionKeys(),
    )
    await wrapper.save(transcript())
    expect(saved).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain(PASTED)
  })
})
