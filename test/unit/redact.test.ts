import { describe, expect, it } from 'vitest'
import { redactSecrets } from '../../src/core/redact'
import { isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { CURRENT_SHAPE_KEYS, OLDER_SHAPE_KEYS } from './helpers/modelApiKeys'

// A linear scan of 100,000 characters takes milliseconds; the quadratic one took seconds.
const LINEAR_SCAN_MS = 1000

// The JWT pattern before 0.10.1, the reference the redactor must cover:
// quadratic on a long word of `eyJ…-eyJ…-`, and blind to a token glued after
// `_` or a letter.
const OLD_JSON_WEB_TOKEN = /\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g
// Every substring shaped like a token, wherever it starts.
const TOKEN_SHAPE = /^eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+$/
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl'
const DIFFERENTIAL_CASES = 5000
const DIFFERENTIAL_SEED = 20_261_001
const DIFFERENTIAL_MAX_LENGTH = 40
// How many cases of each kind the generator must reach.
const DIFFERENTIAL_FLOOR = 50
// The differential's pieces: its alphabet, and `eyJ` whole so tokens are common.
const PIECES = ['eyJ', 'eyJ', 'eyJ', 'eyJ', 'e', 'y', 'J', 'a', '-', '.', '.', '.', '_', 'x', ' ']

/** A seeded generator (a 32-bit LCG), so a failure names a reproducible case. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 2 ** 32
  }
}

/** Where the longest token-shaped substring from `start` ends, if there is one. */
function tokenEnd(text: string, start: number): number | undefined {
  for (let end = text.length; end > start; end -= 1) {
    if (TOKEN_SHAPE.test(text.slice(start, end))) {
      return end
    }
  }
  return undefined
}

/** Every [start, end) of `text` that some token-shaped substring covers, merged. */
function tokenSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  for (let start = 0; start < text.length; start += 1) {
    const end = text.startsWith('eyJ', start) ? tokenEnd(text, start) : undefined
    if (end === undefined) {
      continue
    }
    const last = spans.at(-1)
    if (last !== undefined && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      spans.push([start, end])
    }
  }
  return spans
}

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

  it.each([
    ['a plain token', `token ${JWT} end`, 'token [redacted] end'],
    ['a token glued after a dash', `token=x-${JWT}`, 'token=x-[redacted]'],
    ['a token glued after an underscore', `x_${JWT}`, 'x_[redacted]'],
    ['a token glued after letters', `abc${JWT}`, 'abc[redacted]'],
    ['a token between dotted words', `v1.${JWT}.tail`, 'v1.[redacted].tail'],
    [
      'a token in a URL query',
      `GET https://auth.example/cb?jwt=${JWT}&state=s1`,
      'GET https://auth.example/cb?jwt=[redacted]&state=s1',
    ],
    ['a token in JSON', `{"jwt":"${JWT}","n":1}`, '{"jwt":"[redacted]","n":1}'],
  ])('redacts %s from its first eyJ on', (_case, text, redacted) => {
    expect(redactSecrets(text)).toBe(redacted)
  })

  it('redacts every span the old JWT pattern did, and every token-shaped one', () => {
    const random = seeded(DIFFERENTIAL_SEED)
    const mismatches: string[] = []
    let oldMatches = 0
    let newlyRedacted = 0
    for (let index = 0; index < DIFFERENTIAL_CASES; index += 1) {
      const length = 1 + Math.floor(random() * DIFFERENTIAL_MAX_LENGTH)
      let text = ''
      while (text.length < length) {
        text += PIECES[Math.floor(random() * PIECES.length)] ?? ''
      }
      text = text.slice(0, length)
      const spans = tokenSpans(text)
      for (const match of text.matchAll(OLD_JSON_WEB_TOKEN)) {
        oldMatches += 1
        const end = match.index + match[0].length
        if (spans.every(([from, to]) => match.index < from || to < end)) {
          mismatches.push(
            `${JSON.stringify(text)}: the old match at ${String(match.index)} uncovered`,
          )
        }
      }
      let expected = ''
      let kept = 0
      for (const [from, to] of spans) {
        expected += `${text.slice(kept, from)}[redacted]`
        kept = to
      }
      expected += text.slice(kept)
      const actual = redactSecrets(text)
      if (actual !== expected) {
        mismatches.push(`${JSON.stringify(text)}: ${JSON.stringify(actual)}`)
      }
      if (expected !== text.replaceAll(OLD_JSON_WEB_TOKEN, '[redacted]')) {
        newlyRedacted += 1
      }
    }
    expect(mismatches).toEqual([])
    // The cases reached tokens the old pattern found, and text it redacted less of.
    expect(oldMatches).toBeGreaterThan(DIFFERENTIAL_FLOOR)
    expect(newlyRedacted).toBeGreaterThan(DIFFERENTIAL_FLOOR)
  })

  it.each([
    ['a word of dashed eyJ parts', 'eyJa-'.repeat(25_600), 'eyJa-'.repeat(25_600)],
    [
      'two such words joined by a dot',
      `${'eyJa-'.repeat(12_800)}.${'eyJa-'.repeat(12_800)}`,
      `${'eyJa-'.repeat(12_800)}.${'eyJa-'.repeat(12_800)}`,
    ],
    ['dotted eyJ words', 'eyJa.'.repeat(25_600), '[redacted].'],
  ])('reads a 128,000-character line of %s in linear time', (_case, line, redacted) => {
    // Quadratic with the old pattern: seconds for the two dashed lines even
    // at half this length, so the bound holds a wide margin on fast machines.
    const started = performance.now()
    expect(redactSecrets(line)).toBe(redacted)
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
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
})
