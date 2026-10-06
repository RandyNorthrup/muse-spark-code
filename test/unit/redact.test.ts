import { describe, expect, it } from 'vitest'
import {
  countSecretMatches,
  MAY_HOLD_SECRET,
  redactableSlices,
  redactDiagnosticEvent,
  redactSecrets,
  SECRET_RULES,
  type SecretRule,
} from '../../src/core/redact'
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
  ['a Muse Gadgets SDK token', `mgst_${'A'.repeat(42)}A`, '[redacted]'],
  [
    'a Muse Gadgets SDK token in a sentence',
    `pasted mgst_${'A'.repeat(42)}A here`,
    'pasted [redacted] here',
  ],
  ['an AWS access key id', `id AKIA${'A'.repeat(16)} end`, 'id [redacted] end'],
  ['a Slack token', `xoxb-${'1'.repeat(12)}`, '[redacted]'],
  ['a Stripe-style key', `sk_live_${'a'.repeat(24)}`, '[redacted]'],
  // M95-S (PLAN.md D74): the BYO providers' key shapes and account ids.
  // Each text holds only its own shape's literal, proving the literal is in
  // the prefilter; `bedrock-api-key-` also holds `api-key` by construction.
  ['a Groq key', `log gsk_${'a'.repeat(24)} end`, 'log [redacted] end'],
  ['an xAI key', `log xai-${'b'.repeat(24)} end`, 'log [redacted] end'],
  ['a Fireworks key', `log fw_${'c'.repeat(24)} end`, 'log [redacted] end'],
  ['a Hugging Face token', `log hf_${'d'.repeat(34)} end`, 'log [redacted] end'],
  ['a Together key', `log tgp_v1_${'e'.repeat(20)} end`, 'log [redacted] end'],
  ['a Bedrock key', `log ABSK${'F'.repeat(16)} end`, 'log [redacted] end'],
  ['a Bedrock gateway key', `log bedrock-api-key-${'g'.repeat(16)} end`, 'log [redacted] end'],
  ['an OpenRouter user id', '{"user_id":"u_123"}', '{"user_id":"[redacted]"}'],
  [
    'a creator and workspace id',
    'creator_user_id=c_1 workspace_id=w_2',
    'creator_user_id=[redacted] workspace_id=[redacted]',
  ],
  ['an organization header', 'openai-organization: org_abc', 'openai-organization: [redacted]'],
  ['a workspace header', 'anthropic-workspace-id: ws_1', 'anthropic-workspace-id: [redacted]'],
  [
    'a team id in prose',
    'failed for team 123e4567-e89b-12d3-a456-426614174000 end',
    'failed for team [redacted] end',
  ],
  ['an upper-case secret variable', 'GITHUB_TOKEN=abc123 next', 'GITHUB_TOKEN=[redacted] next'],
  ['an api-key header', 'x-api-key: abc123', 'x-api-key: [redacted]'],
  ['a token authorization', 'Authorization: token abc123', 'Authorization: token [redacted]'],
  ['a quoted JSON secret', '{"clientSecret": "abc123"}', '{"clientSecret": "[redacted]"}'],
  ['a signed URL', 'x.example/f?sig=abc123&v=1', 'x.example/f?sig=[redacted]&v=1'],
]

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

  it('scans a long dotted run in linear time (M84 exports whole conversations)', () => {
    // Quadratic, 200 000 characters took about 20 s; linear, a few milliseconds.
    const run = 'a.'.repeat(100_000)
    const started = performance.now()
    expect(redactSecrets(`${run} https://user:pw@example.com`)).toBe(
      `${run} https://[redacted]@example.com`,
    )
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Activating Muse Spark 0.0.0 (VS Code 1.138.0, Node 24.20.0)'
    expect(redactSecrets(text)).toBe(text)
  })

  it.each(SHAPES)('redacts %s', (_shape, text, expected) => {
    expect(redactSecrets(text)).toBe(expected)
  })

  // Muse Gadgets SDK tokens (M92): `mgst_` and 43 base64url characters
  // holding 32 bytes, the last one constrained. Fixtures are built at
  // runtime, so no secret-shaped literal sits in the repository.
  describe('Muse Gadgets SDK tokens (M92)', () => {
    // A valid token: the prefix, 42 body characters and a valid last one.
    const token = `mgst_${'A'.repeat(42)}A`

    it('redacts a valid token on its own and inside a sentence', () => {
      expect(redactSecrets(token)).toBe('[redacted]')
      expect(redactSecrets(`install with ${token} done`)).toBe('install with [redacted] done')
      expect(countSecretMatches(token, [])).toBe(1)
    })

    it('leaves a token with a bad final character alone', () => {
      // No other rule recognises this shape either, so it stays as it was.
      const bad = `mgst_${'A'.repeat(42)}B`
      expect(redactSecrets(bad)).toBe(bad)
      expect(countSecretMatches(bad, [])).toBe(0)
    })

    it.each([41, 43])('leaves a %i-character body alone', (body) => {
      const wrongLength = `mgst_${'A'.repeat(body)}A`
      expect(redactSecrets(wrongLength)).toBe(wrongLength)
      expect(countSecretMatches(wrongLength, [])).toBe(0)
    })

    it('leaves mgst_ inside a longer word alone', () => {
      for (const glued of [`x${token}`, `${token}x`]) {
        expect(redactSecrets(glued)).toBe(glued)
        expect(countSecretMatches(glued, [])).toBe(0)
      }
    })

    it('leaves a valid token glued to a hyphen run alone', () => {
      // `-` is in the token alphabet, so a hyphen continues the run: the
      // whole is an overlength near-miss, not a token with punctuation.
      for (const glued of [`${token}-`, `${token}-extra`, `-${token}`]) {
        expect(redactSecrets(glued)).toBe(glued)
        expect(countSecretMatches(glued, [])).toBe(0)
      }
    })

    it('redacts every valid final character', () => {
      for (const last of 'AEIMQUYcgkosw048') {
        const candidate = `mgst_${'A'.repeat(42)}${last}`
        expect(redactSecrets(candidate)).toBe('[redacted]')
        expect(countSecretMatches(candidate, [])).toBe(1)
      }
    })
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

/**
 * The matches of `rule` in `text` that its `replace` changes. The JWT rule
 * matches every run of dotted words and changes only those holding a token.
 */
function changedMatches(text: string, rule: SecretRule): string[] {
  return Array.from(text.matchAll(rule.pattern), (found) => {
    const [match, lead = '', quote = ''] = found
    return rule.replace(match, lead, quote) === match ? undefined : match
  }).filter((match) => match !== undefined)
}

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
        changedMatches(text, rule).map((match) => ({ text, match })),
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
        expect(changedMatches(withoutLiterals(text, rule.literals), rule), text).toEqual([])
        expect(redactSecrets(text), text).not.toContain(match)
      }
    },
  )
})

// The slicing differential (RV84 #9): every rule's name, the separators and
// white space a match may run through over a line break, values, and a PEM
// key's edges and body, so generated texts often hold a match across a line.
const SLICE_PIECES = [
  '\n',
  '\n',
  '\n',
  ' ',
  ' ',
  '\t',
  '=',
  ':',
  '"',
  "'",
  ',',
  'Bearer',
  'Basic',
  'MODEL_API_KEY',
  'password',
  'access_token',
  'GITHUB_TOKEN',
  'aws_secret_access_key',
  'AccountKey',
  '_auth',
  'x-api-key',
  'Authorization',
  'token',
  '{"apiKey"',
  'https://u:p@h',
  pemEdge('BEGIN'),
  pemEdge('END'),
  'QUJDRA',
  '+/=',
  'abc',
  'note',
  'eyJa',
  '.',
  `LLM_${'k'.repeat(16)}`,
  `AKIA${'B'.repeat(16)}`,
]
const SLICE_CASES = 4000
const SLICE_SEED = 20_261_002
const SLICE_MAX_PIECES = 40
const SLICE_MAX_CHARS = 24
// How many cases must hold a match that a cut at every line break would split.
const SLICE_FLOOR = 200

describe('M80 countSecretMatches (A19/A21)', () => {
  it('uses literal-first coverage and counts overlapping patterns only once', () => {
    const key = 'LLM|123|before%after+/.=$&'
    expect(countSecretMatches(`${key} Bearer abc.def`, ['', key, key])).toBe(2)
    expect(countSecretMatches('api_key="secret words"', [])).toBe(1)
    expect(countSecretMatches('token count 123 0123456789abcdef c29tZQ== [redacted]', [])).toBe(0)
    expect(countSecretMatches(`key=${key}`, [key])).toBe(1)
  })
  it.each(['ghp_', 'gho_', 'ghu_', 'ghs_', 'ghr_', 'github_pat_', 'xoxb-'])(
    'removes the entire long %s token',
    (prefix) => {
      const secret = prefix + 'a'.repeat(1000)
      expect(redactSecrets(secret)).toBe('[redacted]')
      expect(countSecretMatches(secret, [])).toBe(1)
    },
  )
  it('removes what an earlier pattern-only pass left of an exact literal (M80 E6)', () => {
    const key = 'LLM|123456|fabricated%legacy.key-for-m80d'
    // A network error's description is redacted by pattern alone before it is
    // logged; the legacy key pattern stops at `%` and leaves the tail.
    const described = redactSecrets(`request failed (startup ${key}); retrying`)
    expect(described).toContain('%legacy.key-for-m80d')
    expect(redactSecrets(described, [key])).toBe('request failed (startup [redacted]); retrying')
    expect(countSecretMatches(described, [key])).toBe(1)
  })
  it('removes an exact literal in its percent-encoded form (RVM80A P3-3)', () => {
    const key = 'LLM|123|abc%tail'
    expect(redactSecrets(`x ${encodeURIComponent(key)} y`, [key])).toBe('x [redacted] y')
    expect(countSecretMatches(`x ${encodeURIComponent(key)} y`, [key])).toBe(1)
    expect(redactSecrets('lone \u{D800} kept', ['\u{D800}'])).toBe('lone [redacted] kept')
  })
  it.each([
    ['ghp_', 20],
    ['ghs_', 20],
    ['github_pat_', 20],
    ['xoxb-', 10],
  ])('redacts %s from %i characters, shorter than SPEC §4.2 asks (RVM80A P3-5)', (prefix, min) => {
    expect(redactSecrets(`${prefix}${'a'.repeat(min)}`)).toBe('[redacted]')
    expect(redactSecrets(`${prefix}${'a'.repeat(min - 1)}`)).toBe(`${prefix}${'a'.repeat(min - 1)}`)
  })
  it.each(['AKIA', 'ASIA'])('redacts a %s access key id of exactly 16 more', (prefix) => {
    expect(redactSecrets(`id ${prefix}${'A'.repeat(16)} end`)).toBe('id [redacted] end')
    expect(redactSecrets(`id ${prefix}${'A'.repeat(15)} end`)).toBe(
      `id ${prefix}${'A'.repeat(15)} end`,
    )
  })
})

describe('redactableSlices', () => {
  it('cuts only where the pieces redact as the whole text does', () => {
    const random = seeded(SLICE_SEED)
    const mismatches: string[] = []
    let crossings = 0
    let cuts = 0
    for (let index = 0; index < SLICE_CASES; index += 1) {
      let text = ''
      const pieces = 1 + Math.floor(random() * SLICE_MAX_PIECES)
      for (let piece = 0; piece < pieces; piece += 1) {
        text += SLICE_PIECES[Math.floor(random() * SLICE_PIECES.length)] ?? ''
      }
      const sliceChars = 1 + Math.floor(random() * SLICE_MAX_CHARS)
      const slices = redactableSlices(text, sliceChars)
      const whole = redactSecrets(text)
      const sliced = slices.map((slice) => redactSecrets(slice)).join('')
      if (sliced !== whole || slices.join('') !== text) {
        mismatches.push(JSON.stringify([text, sliceChars, sliced, whole]))
      }
      cuts += slices.length - 1
      // Cut after every line break instead: a match running over one would split.
      const naive = text.split(/(?<=\n)/).map((line) => redactSecrets(line))
      if (naive.join('') !== whole) {
        crossings += 1
      }
    }
    expect(mismatches).toEqual([])
    expect(crossings).toBeGreaterThan(SLICE_FLOOR)
    expect(cuts).toBeGreaterThan(SLICE_FLOOR)
  })

  it('keeps a PEM key longer than a slice in one piece, so none of its body is left', () => {
    const body = `${'QUJDRA'.repeat(12)}\n`.repeat(400)
    const text = `before\n${pemEdge('BEGIN')}\n${body}${pemEdge('END')}\nafter\n${'line\n'.repeat(50)}`
    const slices = redactableSlices(text, 64)
    expect(slices.length).toBeGreaterThan(1)
    expect(slices.find((slice) => slice.includes('QUJD'))).toContain(pemEdge('END'))
    expect(slices.map((slice) => redactSecrets(slice)).join('')).toBe(redactSecrets(text))
    expect(slices.map((slice) => redactSecrets(slice)).join('')).not.toContain('QUJD')
  })

  it('cuts a long text of ordinary lines near the slice size, and leaves one long line whole', () => {
    const lines = 'an ordinary line of output\n'.repeat(20_000)
    const slices = redactableSlices(lines, 4096)
    expect(slices.join('')).toBe(lines)
    expect(Math.max(...slices.map((slice) => slice.length))).toBeLessThan(4096 + 64)
    const line = 'x'.repeat(100_000)
    expect(redactableSlices(`${line}\n${line}`, 4096)).toEqual([`${line}\n`, line])
  })

  it('finds its cuts in linear time where every line could start a match', () => {
    const text = 'Bearer\n'.repeat(50_000)
    const started = performance.now()
    // `Bearer` then a line break then `Bearer` is a credential: never cut.
    expect(redactableSlices(text, 64)).toEqual([text])
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
  })
})

// Diagnostics are distinct from user/model/tool content, even with token-shaped text.
describe('diagnostic event boundary', () => {
  it('redacts retry, withdrawal, completion and notice diagnostics', () => {
    const secret = `ghp_${'a'.repeat(36)}`
    expect(
      redactDiagnosticEvent({
        type: 'turnRetry',
        turnId: 't',
        attempt: 1,
        maxAttempts: 2,
        retryDelayMs: 100,
        reason: secret,
      }),
    ).toMatchObject({ reason: '[redacted]' })
    expect(
      redactDiagnosticEvent({ type: 'turnWithdrawn', turnId: 't', reason: secret }),
    ).toMatchObject({ reason: '[redacted]' })
    expect(
      redactDiagnosticEvent({
        type: 'turnCompleted',
        turnId: 't',
        terminal: 'failed',
        reason: secret,
        errorKind: secret,
      }),
    ).toMatchObject({ reason: '[redacted]', errorKind: '[redacted]' })
    expect(
      redactDiagnosticEvent({ type: 'backendNotice', level: 'warning', text: secret }),
    ).toMatchObject({ text: '[redacted]' })
  })
  it('preserves ordinary streamed conversation text', () => {
    const event = {
      type: 'textDelta',
      itemId: 'i',
      field: 'text',
      delta: `ghp_${'a'.repeat(36)}`,
    } as const
    expect(redactDiagnosticEvent(event)).toBe(event)
  })
})
