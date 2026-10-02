import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/core/redact'
import { isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { CURRENT_SHAPE_KEYS, OLDER_SHAPE_KEYS } from './helpers/modelApiKeys'

// A linear scan of 100,000 characters takes milliseconds; the quadratic one took seconds.
const LINEAR_SCAN_MS = 1000

describe('redactSecrets', () => {
  it('redacts Meta Model API keys wherever they appear', () => {
    expect(redactSecrets('key=LLM|1234567890|abcDEF-123_xyz done')).toBe('key=[redacted] done')
    expect(redactSecrets(`pasted ${CURRENT_SHAPE_KEYS[0]} done`)).toBe('pasted [redacted] done')
    expect(redactSecrets(`{"k":"${CURRENT_SHAPE_KEYS[1]}"}`)).toBe('{"k":"[redacted]"}')
  })

  it.each([...CURRENT_SHAPE_KEYS, ...OLDER_SHAPE_KEYS])(
    'redacts all of %j, a shape the key store accepts',
    (key) => {
      expect(isValidModelApiKey(key)).toBe(true)
      expect(redactSecrets(`(${key})`)).toBe('([redacted])')
    },
  )

  it('leaves short LLM_ names alone', () => {
    expect(redactSecrets('LLM_MODEL and LLM_TIMEOUT_MS')).toBe('LLM_MODEL and LLM_TIMEOUT_MS')
  })

  it('redacts bearer tokens but keeps the scheme', () => {
    expect(redactSecrets('Authorization: Bearer eyJhbGciOi.payload.sig')).toBe(
      'Authorization: Bearer [redacted]',
    )
  })

  it('redacts META_API_KEY and MODEL_API_KEY assignments', () => {
    expect(redactSecrets('env META_API_KEY=secret1 MODEL_API_KEY = secret2')).toBe(
      'env META_API_KEY=[redacted] MODEL_API_KEY = [redacted]',
    )
  })

  it('redacts JWTs, basic credentials, token fields and URL user-info (D24)', () => {
    expect(redactSecrets('token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end')).toBe(
      'token [redacted] end',
    )
    expect(redactSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(
      'Authorization: Basic [redacted]',
    )
    expect(redactSecrets('{"access_token":"abc.def","expires_in":3600}')).toBe(
      '{"access_token":"[redacted]","expires_in":3600}',
    )
    expect(redactSecrets('?refresh_token=r1&x=2 client_secret: s3 apiKey=k4 password=p5')).toBe(
      '?refresh_token=[redacted]&x=2 client_secret: [redacted] apiKey=[redacted] password=[redacted]',
    )
    expect(redactSecrets('fetch https://user:hunter2@proxy.local:8080/x')).toBe(
      'fetch https://[redacted]@proxy.local:8080/x',
    )
    expect(redactSecrets(`${'x'.repeat(31)}://user:hunter2@host`)).toBe(
      `${'x'.repeat(31)}://[redacted]@host`,
    )
  })

  it('reads a long line of dotted words with no URL in linear time', () => {
    // Quadratic before the scheme was bounded: about 22 s at this length.
    const line = 'a.'.repeat(50_000)
    const started = performance.now()
    expect(redactSecrets(line)).toBe(line)
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Activating Muse Spark 0.0.0 (VS Code 1.138.0, Node 24.20.0)'
    expect(redactSecrets(text)).toBe(text)
  })

  it('does not treat a lone LLM prefix as a key', () => {
    expect(redactSecrets('model LLM|notakey')).toBe('model LLM|notakey')
  })

  it('redacts a whole quoted field, including whitespace and escaped quotes', () => {
    expect(redactSecrets('password="two words"')).toBe('password="[redacted]"')
    expect(redactSecrets(String.raw`{"access_token":"two \" words"}`)).toBe(
      '{"access_token":"[redacted]"}',
    )
  })

  // Built at run time so the repository's secret scan sees no token shape.
  const githubTokens = [
    `ghp_${'0'.repeat(36)}`,
    `gho_${'1'.repeat(36)}`,
    `ghu_${'A'.repeat(40)}`,
    `ghs_${'b'.repeat(36)}`,
    `ghr_${'2'.repeat(76)}`,
    `github_pat_${'3'.repeat(22)}_${'c'.repeat(59)}`,
  ]

  it.each(githubTokens)('redacts the GitHub token %j (M71)', (token) => {
    expect(redactSecrets(`see ${token} here`)).toBe('see [redacted] here')
  })

  it('redacts private key blocks, AWS key ids and Slack tokens (M71)', () => {
    const header = ['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' ')
    const footer = ['-----END', 'OPENSSH PRIVATE KEY-----'].join(' ')
    expect(redactSecrets(`a\n${header}\nb3BlbnNzaA\nAAAA\n${footer}\nz`)).toBe('a\n[redacted]\nz')
    // A block cut short is redacted to the end.
    expect(redactSecrets(`a ${header}\nb3BlbnNzaA`)).toBe('a [redacted]')
    expect(redactSecrets(`id ${['AKIA', 'Z'.repeat(16)].join('')} end`)).toBe('id [redacted] end')
    expect(redactSecrets(`slack ${['xoxb', '1'.repeat(12)].join('-')} end`)).toBe(
      'slack [redacted] end',
    )
  })

  it('leaves near misses alone', () => {
    const text = 'ghp_short, github_pat_x, AKIA123 and xoxb-1 stay'
    expect(redactSecrets(text)).toBe(text)
  })
})
