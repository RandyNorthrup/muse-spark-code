import { describe, expect, it } from 'vitest'
import { MAY_HOLD_SECRET, redactSecrets, SECRET_RULES } from '../../src/core/redact'
import { isValidModelApiKey } from '../../src/host/auth/credentialStore'
import { CURRENT_SHAPE_KEYS, OLDER_SHAPE_KEYS } from './helpers/modelApiKeys'

/** A PEM key's BEGIN or END line, split so the secret scanner never sees one whole. */
function pemEdge(edge: string): string {
  return ['-----', edge, ' RSA PRIVATE', ' KEY-----'].join('')
}

// Synthetic values, built here so the secret scanner never sees a whole
// token; a PEM edge is split for the same reason (`pemEdge`). Each text
// holds only its own shape's literal, so each also proves that literal is
// in the prefilter (MAY_HOLD_SECRET): another one would let it through.
const SHAPES: readonly (readonly [shape: string, text: string, redacted: string])[] = [
  ['a Google API key', `maps key AIza${'B'.repeat(35)} end`, 'maps key [redacted] end'],
  [
    'an npm token in .npmrc',
    `//registry.npmjs.org/:_authToken=npm_${'a1'.repeat(18)}`,
    '//registry.npmjs.org/:_authToken=[redacted]',
  ],
  ['an npm token on its own', `publish npm_${'a1'.repeat(18)} end`, 'publish [redacted] end'],
  ['a legacy .npmrc token', '_authToken=0f1e2d3c', '_authToken=[redacted]'],
  ['an .npmrc basic credential', '_auth=dXNlcjpwYXNz', '_auth=[redacted]'],
  ['a bearer credential', 'Authorization: Bearer abc.def-123', 'Authorization: Bearer [redacted]'],
  [
    'a bare JSON Web Token',
    'id eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end',
    'id [redacted] end',
  ],
  ['an apiKey field', 'apiKey=k4', 'apiKey=[redacted]'],
  ['a credentials variable', 'DB_CREDENTIALS=abc123', 'DB_CREDENTIALS=[redacted]'],
  ['an access key variable', 'MINIO_ACCESS_KEY=abc123', 'MINIO_ACCESS_KEY=[redacted]'],
  [
    'an Azure shared access key',
    'SharedAccessKeyName=root;SharedAccessKey=abc123=',
    'SharedAccessKeyName=root;SharedAccessKey=[redacted]',
  ],
  ['a fine-grained GitHub token', `github_pat_${'a'.repeat(22)}`, '[redacted]'],
  ['an AWS temporary key id', `ASIA${'B'.repeat(16)}`, '[redacted]'],
  ['an sk- key', `sk-${'a'.repeat(24)}`, '[redacted]'],
  ['a test-mode key', `pk_test_${'a'.repeat(20)}`, '[redacted]'],
  ['a key parameter', 'GET /maps?key=abc123', 'GET /maps?key=[redacted]'],
  ['an auth parameter', 'GET /feed?auth=abc123', 'GET /feed?auth=[redacted]'],
  ['a signature parameter', 'GET /f?v=1&signature=abc123', 'GET /f?v=1&signature=[redacted]'],
  [
    'an Azure storage connection string',
    `DefaultEndpointsProtocol=https;AccountName=box;AccountKey=${'q1w2'.repeat(22)}==;EndpointSuffix=core.windows.net`,
    'DefaultEndpointsProtocol=https;AccountName=box;AccountKey=[redacted];EndpointSuffix=core.windows.net',
  ],
  [
    'the AWS credentials file, in lower case',
    `[default]\naws_secret_access_key = ${'wJalr'.repeat(8)}\naws_session_token=${'T'.repeat(40)}`,
    '[default]\naws_secret_access_key = [redacted]\naws_session_token=[redacted]',
  ],
  ['a GitLab token', `push with glpat-${'x'.repeat(20)}`, 'push with [redacted]'],
  [
    'a PEM private key',
    `${pemEdge('BEGIN')}\n${'A'.repeat(64)}\n${pemEdge('END')}\nafter`,
    '[redacted]\nafter',
  ],
  ['a GitHub token', `ghp_${'a'.repeat(36)}`, '[redacted]'],
  ['an AWS access key id', `id AKIA${'A'.repeat(16)} end`, 'id [redacted] end'],
  ['a Slack token', `xoxb-${'1'.repeat(12)}`, '[redacted]'],
  ['a Stripe-style key', `sk_live_${'a'.repeat(24)}`, '[redacted]'],
  ['an upper-case secret variable', 'GITHUB_TOKEN=abc123 next', 'GITHUB_TOKEN=[redacted] next'],
  ['an api-key header', 'x-api-key: abc123', 'x-api-key: [redacted]'],
  ['a token authorization', 'Authorization: token abc123', 'Authorization: token [redacted]'],
  ['a quoted JSON secret', '{"clientSecret": "abc123"}', '{"clientSecret": "[redacted]"}'],
  ['a signed URL', 'x.example/f?sig=abc123&v=1', 'x.example/f?sig=[redacted]&v=1'],
]

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
  })

  it('scans a long dotted run in linear time (M84 exports whole conversations)', () => {
    // Quadratic, 200 000 characters took about 20 s; linear, a few milliseconds.
    const run = 'a.'.repeat(100_000)
    const started = performance.now()
    expect(redactSecrets(`${run} https://user:pw@example.com`)).toBe(
      `${run} https://[redacted]@example.com`,
    )
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Activating Muse Spark 0.0.0 (VS Code 1.138.0, Node 24.20.0)'
    expect(redactSecrets(text)).toBe(text)
  })

  it.each(SHAPES)('redacts %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected)
  })

  it('leaves ordinary words, counts, prefixes and code with those names alone', () => {
    const text = [
      'Turn usage: inputTokens: 1200, max_output_tokens: 4096',
      'npm_config_cache is set; AIza is a prefix; glpat- alone; sk-short',
      'the AccountKey setting and aws_secret_access_key are named in the docs',
      'self._auth = None; the token count; Basic plan',
    ].join('\n')
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

/** The earlier shapes' texts, as the tests above use them. */
const EARLIER_SAMPLES: readonly string[] = [
  'key=LLM|1234567890|abcDEF-123_xyz done',
  ...[...CURRENT_SHAPE_KEYS, ...OLDER_SHAPE_KEYS].map((key) => `(${key})`),
  'Authorization: Bearer eyJhbGciOi.payload.sig',
  'env META_API_KEY=secret1 MODEL_API_KEY = secret2',
  'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl end',
  'Authorization: Basic dXNlcjpwYXNzd29yZA==',
  '{"access_token":"abc.def","expires_in":3600}',
  '?refresh_token=r1&x=2 client_secret: s3 apiKey=k4 password=p5',
  'fetch https://user:hunter2@proxy.local:8080/x',
  'password="two words"',
]

/** `text` with each of `literals` (lower case) blanked wherever it appears, in any case. */
function withoutLiterals(text: string, literals: readonly string[]): string {
  let result = text
  for (const literal of literals) {
    for (
      let at = result.toLowerCase().indexOf(literal);
      at !== -1;
      at = result.toLowerCase().indexOf(literal)
    ) {
      result = `${result.slice(0, at)}${'Q'.repeat(literal.length)}${result.slice(at + literal.length)}`
    }
  }
  return result
}

// The prefilter gates the log redactor and the export alike: a rule whose
// literal it missed would silently never run (RV84 #9). These prove it is a
// superset of every rule, on the rule's own declaration and on real matches.
describe('MAY_HOLD_SECRET, the prefilter in front of every rule', () => {
  const samples = [...SHAPES.map(([, text]) => text), ...EARLIER_SAMPLES]

  it('finds every literal each rule says its matches hold', () => {
    for (const rule of SECRET_RULES) {
      expect(rule.literals, rule.pattern.source).not.toHaveLength(0)
      for (const literal of rule.literals) {
        expect(literal, rule.pattern.source).toBe(literal.toLowerCase())
        expect(MAY_HOLD_SECRET.test(literal), `${literal} (${rule.pattern.source})`).toBe(true)
      }
    }
  })

  it.each(SECRET_RULES.map((rule) => [rule.literals.join(', '), rule] as const))(
    'lets every real-shaped match of the rule needing %s through, and the redactor removes it',
    (_literals, rule) => {
      const matches = samples.flatMap((text) =>
        (text.match(rule.pattern) ?? []).map((match) => ({ text, match })),
      )
      expect(matches).not.toHaveLength(0)
      for (const { text, match } of matches) {
        // The match alone, not its neighbours, is what the prefilter must find.
        expect(MAY_HOLD_SECRET.test(match), match).toBe(true)
        expect(
          rule.literals.some((literal) => match.toLowerCase().includes(literal)),
          match,
        ).toBe(true)
        // The declared literals are what the match needs: blanked, it is gone.
        expect(withoutLiterals(text, rule.literals).match(rule.pattern), text).toBeNull()
        expect(redactSecrets(text), text).not.toContain(match)
      }
    },
  )
})
