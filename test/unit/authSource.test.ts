import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ApiKeyAuthSource, NoAuthSource } from '../../src/core/backends/modelapi/authSource'
import { CREDENTIAL_RECORD_VERSION } from '../../src/shared/constants'

const HTTP_SCHEME = 'http:'
const ORIGIN = 'https://api.example.test'
const KEY = 'plain'
function stored(origin = ORIGIN, key = KEY) {
  return { record: { v: CREDENTIAL_RECORD_VERSION, auth: 'apiKey', origin }, key }
}

describe('AuthSource', () => {
  it.each([
    ['bearer', 'Authorization', `Bearer ${KEY}`],
    ['x-api-key', 'x-api-key', KEY],
    ['x-goog-api-key', 'x-goog-api-key', KEY],
    ['api-key', 'api-key', KEY],
  ] as const)('sends only the preset %s header', async (header, name, value) => {
    const source = new ApiKeyAuthSource(() => Promise.resolve(stored()), header)
    const auth = await source.headers(`${ORIGIN}/v1/responses`)
    expect(auth.values).toEqual({ [name]: value })
    expect(auth.keyDigest).toBe(createHash('sha256').update(KEY).digest('hex'))
    expect(auth.redact(`echo ${KEY}`)).toBe('echo [redacted]')
  })
  it.each([
    'https://api.example.test:444',
    `${HTTP_SCHEME}//api.example.test`,
    'https://other.test',
  ])('refuses a changed full origin %s', async (address) => {
    const source = new ApiKeyAuthSource(() => Promise.resolve(stored()), 'bearer')
    await expect(source.headers(address)).rejects.toMatchObject({
      name: 'CredentialOriginError',
      storedOrigin: ORIGIN,
      requestOrigin: new URL(address).origin,
    })
  })
  it('rereads the secret instead of keeping the previous key', async () => {
    let key = KEY
    const source = new ApiKeyAuthSource(() => Promise.resolve(stored(ORIGIN, key)), 'bearer')
    const first = await source.headers(ORIGIN)
    key = 'rotated-canary'
    const second = await source.headers(ORIGIN)
    expect(second.keyDigest).not.toBe(first.keyDigest)
  })
  it.each([undefined, {}, stored(ORIGIN, ''), stored(ORIGIN, 'bad\r\nheader')])(
    'refuses a missing or invalid stored credential',
    async (value) => {
      await expect(
        new ApiKeyAuthSource(() => Promise.resolve(value), 'bearer').headers(ORIGIN),
      ).rejects.toMatchObject({ kind: 'credential_required' })
    },
  )
  it('normalizes default ports and permits only the bound local origin without auth', async () => {
    const source = new NoAuthSource('http://localhost:80')
    const headers = await source.headers('http://localhost/api/chat')
    expect(headers.values).toEqual({})
    expect(() => source.headers('http://localhost:11434/api/chat')).toThrow('origin_mismatch')
  })
})
