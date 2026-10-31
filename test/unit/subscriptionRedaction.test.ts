// C-M95-SUB P1-2: the headless session writer scrubs the credential
// actually sent (subscription or pasted), never only the pasted key.
// Real temp auth files, the real CredentialStore and the real file
// session store; only the OS/VS Code secret storage behind the store
// stays a Map, the external no unit test can own.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeSubscriptionAuthFile } from './helpers/subscriptionAuthFile'
import { redactSecrets } from '../../src/shared/redact'
import { withCredentialRedaction } from '../../src/runtime/backends'
import type { SessionStore, StoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { createFileSessionStore } from '../../src/host/backend/fileSessionStore'
import type { Logger } from '../../src/host/logger'
import { SubscriptionCredential } from '../../src/host/auth/subscriptionCredential'
import { CredentialStore } from '../../src/host/auth/credentialStore'
import { SECRET_KEYS } from '../../src/shared/constants'
import { mapSecretsBacked } from './helpers/mapSecrets'
import { usingTempDir } from './helpers/temporaryFolders'

// Opaque values no shape pattern matches: only the exact literals read
// from the credentials can scrub them.
const SUB = 'opaque subscription value 9d4e1a'
const PASTED = 'opaque pasted value 3b7c2e'

async function credential(root: string, text: string | undefined): Promise<SubscriptionCredential> {
  if (text !== undefined) await writeSubscriptionAuthFile(root, text)
  const secrets = new Map<string, string>([[SECRET_KEYS.modelApiKey, PASTED]])
  return new SubscriptionCredential({
    credentials: new CredentialStore(mapSecretsBacked(secrets), () => undefined),
    isEnabled: () => true,
    platform: 'linux',
    homeDir: '/none',
    xdgConfigHome: root,
  })
}

function fileText(accessToken: string): string {
  return JSON.stringify({ schema_version: 1, providers: { meta: { access_token: accessToken } } })
}

const silent: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function storeIn(directory: string): SessionStore {
  return createFileSessionStore({
    directory,
    log: silent,
    retentionDays: () => 0,
    now: Date.now,
    sleep: () => Promise.resolve(),
  })
}

function transcript(): StoredSession {
  return {
    version: 1,
    sessionId: 'redaction-session',
    workspaceRoot: '/workspace',
    modelId: 'muse-spark-1.3',
    approvalMode: 'promptUnmatched',
    effort: 'high',
    createdAt: '2026-10-17T10:00:00.000Z',
    lastActivityAt: '2026-10-17T10:05:00.000Z',
    turnIds: ['turn'],
    todos: [],
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
    transcript: [],
    outputs: {},
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
  }
}

/** The persisted session file carries neither credential literally. */
async function expectScrubbed(directory: string, leaked: readonly string[]): Promise<void> {
  const raw = await readFile(path.join(directory, 'redaction-session.json'), 'utf8')
  for (const secret of leaked) expect(raw).not.toContain(secret)
}

describe('headless credential redaction', () => {
  it('scrubs key A on the second save after rotation to key B', async () => {
    await usingTempDir('subred-config-', async (root) => {
      await usingTempDir('subred-sessions-', async (directory) => {
        const keys = await credential(root, fileText(SUB))
        const writer = withCredentialRedaction(storeIn(directory), () => keys.redactionKeys())
        await keys.getApiKey()
        const snapshot = transcript()
        await writer.save(snapshot)
        const rotated = 'opaque rotation value a173d9'
        await writeSubscriptionAuthFile(root, fileText(rotated))
        await keys.getApiKey()
        await writer.save(snapshot)
        const loaded = await storeIn(directory).load('redaction-session')
        expect(loaded).toBeDefined()
        expect(JSON.stringify(loaded)).not.toContain(SUB)
        await expectScrubbed(directory, [SUB, PASTED, rotated])
        expect(redactSecrets(`previous ${SUB}; current ${rotated}`)).not.toContain(SUB)
        expect(redactSecrets(`previous ${SUB}; current ${rotated}`)).not.toContain(rotated)
      })
    })
  })
  it('scrubs the actually-sent subscription key from saved transcripts', async () => {
    await usingTempDir('subred-config-', async (root) => {
      await usingTempDir('subred-sessions-', async (directory) => {
        const wrapper = withCredentialRedaction(storeIn(directory), async () => {
          const keys = await credential(root, fileText(SUB))
          const found = await keys.redactionKeys()
          return found
        })
        const snapshot = transcript()
        await wrapper.save(snapshot)
        const loaded = await storeIn(directory).load('redaction-session')
        expect(loaded).toBeDefined()
        expect(JSON.stringify(loaded)).not.toContain(SUB)
        expect(JSON.stringify(loaded)).not.toContain(PASTED)
        await expectScrubbed(directory, [SUB, PASTED])
        // The caller's copy is untouched: only the persisted copy is scrubbed.
        expect(JSON.stringify(snapshot)).toContain(SUB)
      })
    })
  })
  it('scrubs a literal only the keys callback knows', async () => {
    // The plumbing, apart from the credential: this literal is never
    // tracked, so only the callback's keys can scrub it.
    const UNTRACKED = 'untracked callback literal c41d8e'
    await usingTempDir('subred-sessions-', async (directory) => {
      const wrapper = withCredentialRedaction(storeIn(directory), () =>
        Promise.resolve([UNTRACKED]),
      )
      const snapshot: StoredSession = {
        ...transcript(),
        replay: [
          {
            turnId: 'turn',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: `debug this with ${UNTRACKED} inline` }],
            },
          },
        ],
      }
      expect(redactSecrets(`saw ${UNTRACKED} in a log line`)).toContain(UNTRACKED)
      await wrapper.save(snapshot)
      const loaded = await storeIn(directory).load('redaction-session')
      expect(loaded).toBeDefined()
      expect(JSON.stringify(loaded)).not.toContain(UNTRACKED)
      await expectScrubbed(directory, [UNTRACKED])
    })
  })
  it('still saves when the sign-in is unreadable', async () => {
    await usingTempDir('subred-config-', async (root) => {
      await usingTempDir('subred-sessions-', async (directory) => {
        const wrapper = withCredentialRedaction(storeIn(directory), async () => {
          const keys = await credential(root, undefined)
          const found = await keys.redactionKeys()
          return found
        })
        await wrapper.save(transcript())
        const loaded = await storeIn(directory).load('redaction-session')
        expect(loaded).toBeDefined()
        expect(JSON.stringify(loaded)).not.toContain(PASTED)
        await expectScrubbed(directory, [PASTED])
      })
    })
  })
})
