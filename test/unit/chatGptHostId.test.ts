// The ChatGPT host id OpenAI accepts: `urn:uuid:<UUIDv4>`, persisted per
// host, with an old bare-random id migrated in place. Pure logic through the
// real modules, with values passed in as data and a real temporary folder
// for the host-id file. No stand-ins: every assertion fails when a person
// would be hurt (a refused sign-in, a lost host id, a masked refusal).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildChatGptAuthorizeUrl,
  ChatGptSignInError,
  parseChatGptCallback,
  resolveChatGptHostId,
} from '../../src/core/providers/subscriptions/chatgpt'
import {
  createChatGptHostId,
  isChatGptHostId,
} from '../../src/core/providers/subscriptions/chatgptHostId'
import { createPkcePair } from '../../src/core/providers/pkce'
import { loadChatGptHostId } from '../../src/host/providers/chatgptHostId'
import { chatGptCommandText } from '../../src/runtime/chatGptProviderCommands'

const REDIRECT = 'http://127.0.0.1:49152/auth/callback'
const STATE = 'synthetic_state_123456'
const NONCE = 'synthetic_nonce_123456'
/** The previous bare-random form OpenAI answers with `invalid_authorize_request`. */
const OLD_HOST_ID = 'synthetic_host_12345678'

const scratch = { folder: '' }
beforeAll(async () => {
  scratch.folder = await mkdtemp(path.join(tmpdir(), 'muse-host-id-'))
})
afterAll(async () => {
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

function refusalOf(value: string, redirectUri: string, state: string): ChatGptSignInError {
  try {
    parseChatGptCallback(value, redirectUri, state)
  } catch (error) {
    expect(error).toBeInstanceOf(ChatGptSignInError)
    if (error instanceof ChatGptSignInError) return error
  }
  throw new Error('the callback did not refuse')
}

describe('ChatGPT host id', () => {
  it('creates a stable documented value, distinct per host', () => {
    const first = createChatGptHostId()
    const second = createChatGptHostId()
    expect(first).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    )
    expect(second).not.toBe(first)
    expect(isChatGptHostId(first)).toBe(true)
  })

  it.each([OLD_HOST_ID, '', 'email@example.test', 'urn:uuid:not-a-uuid', 'urn:uuid:'])(
    'rejects a non-documented host id %s',
    (value) => {
      expect(isChatGptHostId(value)).toBe(false)
    },
  )

  it('sends the documented host id and refuses the old bare-random one', () => {
    const pair = createPkcePair()
    const hostId = createChatGptHostId()
    const url = new URL(
      buildChatGptAuthorizeUrl({ ...pair, redirectUri: REDIRECT, hostId, nonce: NONCE }),
    )
    expect(url.searchParams.get('ext_agent_host_id')).toBe(hostId)
    expect(() =>
      buildChatGptAuthorizeUrl({
        ...pair,
        redirectUri: REDIRECT,
        hostId: OLD_HOST_ID,
        nonce: NONCE,
      }),
    ).toThrow('chatgpt.invalid-callback')
  })

  it('names OpenAI’s error code when the authorize request is refused', () => {
    const refused = refusalOf(`${REDIRECT}?error=access_denied&state=${STATE}`, REDIRECT, STATE)
    expect(refused.code).toBe('authorize-refused')
    expect(refused.reason).toBe('access_denied')
    expect(() =>
      parseChatGptCallback(
        `${REDIRECT}?error=access_denied&state=wrong-state-value-1`,
        REDIRECT,
        STATE,
      ),
    ).toThrow('chatgpt.invalid-state')
    expect(() =>
      parseChatGptCallback(`${REDIRECT}?error=<script>&state=${STATE}`, REDIRECT, STATE),
    ).toThrow('chatgpt.invalid-callback')
  })

  it('keeps a granted callback working after the refusal branch', () => {
    const granted = parseChatGptCallback(
      `${REDIRECT}?code=synthetic-code&client_id=oaiapp_synthetic&scope=openid&state=${STATE}`,
      REDIRECT,
      STATE,
    )
    expect(granted).toEqual({
      code: 'synthetic-code',
      clientId: 'oaiapp_synthetic',
      scope: 'openid',
    })
  })

  it('keeps a documented id, migrates an old one, creates the first one', () => {
    const kept = createChatGptHostId()
    expect(resolveChatGptHostId(kept)).toEqual({ hostId: kept, persist: false })
    for (const stored of [undefined, OLD_HOST_ID]) {
      const resolved = resolveChatGptHostId(stored)
      expect(resolved.persist).toBe(true)
      expect(isChatGptHostId(resolved.hostId)).toBe(true)
      expect(resolved.hostId).not.toBe(stored)
    }
    for (const stored of ['', 'email@example.test']) {
      expect(() => resolveChatGptHostId(stored)).toThrow('chatgpt.invalid-token')
    }
  })

  it('migrates an old host-id file in place and keeps the new one stable', async () => {
    const directory = await mkdtemp(path.join(scratch.folder, 'migrate-'))
    const file = path.join(directory, 'chatgpt.host-id')
    await writeFile(file, OLD_HOST_ID)
    const migrated = await loadChatGptHostId(directory)
    expect(isChatGptHostId(migrated)).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(migrated)
    await expect(loadChatGptHostId(directory)).resolves.toBe(migrated)
    expect(await readFile(file, 'utf8')).toBe(migrated)
  })

  it('creates the first host-id file and rejects a garbage one', async () => {
    const fresh = await mkdtemp(path.join(scratch.folder, 'fresh-'))
    const created = await loadChatGptHostId(fresh)
    expect(isChatGptHostId(created)).toBe(true)
    expect(await readFile(path.join(fresh, 'chatgpt.host-id'), 'utf8')).toBe(created)
    const broken = await mkdtemp(path.join(scratch.folder, 'broken-'))
    await writeFile(path.join(broken, 'chatgpt.host-id'), 'email@example.test')
    await expect(loadChatGptHostId(broken)).rejects.toThrow('chatgpt.invalid-token')
  })

  it('tells the person what OpenAI answered, not “temporarily unavailable”', () => {
    const sentence = chatGptCommandText().failure('authorize-refused', 'invalid_authorize_request')
    expect(sentence).toContain('invalid_authorize_request')
    expect(sentence).toContain('OpenAI')
    expect(sentence).not.toContain('temporarily unavailable')
  })
})
