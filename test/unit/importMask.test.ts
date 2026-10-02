// The import's masking (M83): nothing secret-looking reaches the preview,
// the clipboard or the log, whatever field it hides in. Free text fails
// closed: a line is masked from its first credential to its end.

import { describe, expect, it } from 'vitest'
import { maskArgs, maskText, maskUrl, maskValues } from '../../src/core/import/importMask'
import { CREDENTIAL_LEAKS, leakSecret, ORDINARY_LINES } from './helpers/credentialLeaks'
import { SYNTHETIC } from './helpers/syntheticTokens'

const MASK = '[masked]'
// A linear scan of these lines takes milliseconds; the quadratic ones took seconds.
const LINEAR_SCAN_MS = 1000
// About the longest line a 64 KiB imported file holds.
const LONG_LINE = 64_000
// An argument eight times that, as `.claude.json` allows.
const LONG_ARGUMENT = 8 * LONG_LINE

const LEAKS = CREDENTIAL_LEAKS.map(
  (leak, index) => [leak.name, leak.text(leakSecret(index)), leakSecret(index)] as const,
)

describe('maskText', () => {
  it.each(LEAKS)(
    'masks %s in text, as an argument and inside a shell argument',
    (_name, text, secret) => {
      const inShell = maskArgs(['sh', '-c', text], MASK).at(-1) ?? ''
      const shown = [maskText(text, MASK), ...maskArgs([text], MASK), inShell]
      for (const masked of shown) {
        expect(masked).not.toContain(secret)
        expect(masked).toContain(MASK)
        // The preview masks text the scan already masked; nothing changes.
        expect(maskText(masked, MASK)).toBe(masked)
      }
    },
  )

  it('masks from the first credential to the end of its line, and only that line', () => {
    expect(
      maskText('First line.\nGITHUB_TOKEN=abc node x.js --port 9\nThird line.\r\nLast', MASK),
    ).toBe(`First line.\nGITHUB_TOKEN=${MASK}\nThird line.\r\nLast`)
  })

  it.each([
    [
      'a query, from just after its mark',
      'curl "https://example.test/mcp?q=1" -o out.json',
      `curl "https://example.test/mcp?${MASK}`,
    ],
    [
      'user-info, from just after `://`',
      'git clone https://me:pw@example.test/repo then',
      `git clone https://${MASK}`,
    ],
    ['an assignment, from its value', 'TOKEN = "abc" ok', `TOKEN = ${MASK}`],
    ['a flag, from its value', './server --api-key abc --port 9', `./server --api-key ${MASK}`],
    ['a quoted name', '{"client_secret": "abc", "n": 1}', `{"client_secret": ${MASK}`],
    ['the earliest of two cues', 'TOKEN=abc https://example.test/?q=1', `TOKEN=${MASK}`],
    ['user-info before a query', 'https://u:p@example.test/?token=x', `https://${MASK}`],
    [
      'a token shape, from its start',
      `gh auth ${SYNTHETIC.githubToken} --verbose`,
      `gh auth ${MASK}`,
    ],
    ['a JSON Web Token, from its start', 'jwt eyJdemo.eyJdemo.sig done', `jwt ${MASK}`],
    [
      'a harmless word too, which errs safe',
      'Use the keyboard shortcuts.',
      `Use the keyboard ${MASK}`,
    ],
  ])('masks %s', (_name, text, expected) => {
    expect(maskText(text, MASK)).toBe(expected)
  })

  it.each([
    ['Bearer', `curl -H "X: Bearer ${SYNTHETIC.bearerValue}"`, SYNTHETIC.bearerValue],
    ['a GitHub token', `gh auth ${SYNTHETIC.githubToken}`, SYNTHETIC.githubToken],
    ['an OpenAI-style key', `run ${SYNTHETIC.openAiKey}`, SYNTHETIC.openAiKey],
    ['a Slack token', `post ${SYNTHETIC.slackToken}`, SYNTHETIC.slackToken],
    ['an AWS access key', `aws ${SYNTHETIC.awsAccessKey}`, SYNTHETIC.awsAccessKey],
  ])('masks %s', (_name, text, secret) => {
    const masked = maskText(text, MASK)
    expect(masked).not.toContain(secret)
    expect(masked).toContain(MASK)
  })

  it('leaves ordinary prose, code and URLs without a query or user-info alone', () => {
    for (const line of ORDINARY_LINES) {
      expect(maskText(line, MASK)).toBe(line)
      expect(maskArgs([line], MASK)).toEqual([line])
    }
    const file = `${ORDINARY_LINES.join('\n')}\n`
    expect(maskText(file, MASK)).toBe(file)
  })

  it('shows the log redactor’s own mark as the mask word', () => {
    expect(maskText('Basic ZGVtbzpkZW1vZGVtbw== then', MASK)).toBe(`Basic ${MASK} then`)
  })
})

describe('maskArgs', () => {
  it('masks the value after a credential-like flag and a flag=value', () => {
    expect(
      maskArgs(['-y', 'server', '--api-key', 'abc', '--token=def', '--port', '9'], MASK),
    ).toEqual(['-y', 'server', '--api-key', MASK, `--token=${MASK}`, '--port', '9'])
  })

  it('masks an argument from its credential to its end, across its lines', () => {
    expect(
      maskArgs(
        ['mcp-remote', 'https://example.test/mcp?signature=abc', 'sh', 'echo a\nTOKEN=b\necho c'],
        MASK,
      ),
    ).toEqual(['mcp-remote', `https://example.test/mcp?${MASK}`, 'sh', `echo a\nTOKEN=${MASK}`])
  })
})

describe('maskText and maskArgs on long lines', () => {
  it.each([
    // RV83c: the old URL's trailing punctuation scan, and the log redactor's
    // JSON Web Token pattern, both quadratic.
    ['a URL path of dots', `https://example.test/${'.'.repeat(LONG_LINE)}x`, undefined],
    ['JSON Web Token near-misses', 'eyJa-'.repeat(LONG_LINE / 5), MASK],
    // Earlier rounds: the URL scheme, a flag's name either side of its
    // credential word, an assignment's name.
    ['dotted words', 'a.'.repeat(LONG_LINE / 2), undefined],
    ['dashed words', 'a-'.repeat(LONG_LINE / 2), undefined],
    ['dashed credential words', '-key'.repeat(LONG_LINE / 4), undefined],
    // This design's own scans: one name of many credential words, many URLs
    // in one word, a long scheme, long gaps after a credential word.
    ['credential words with no value', 'token'.repeat(LONG_LINE / 5), undefined],
    ['URL marks with no query', `${'a://'.repeat(LONG_LINE / 4)} done`, undefined],
    ['a long scheme', `${'x'.repeat(LONG_LINE)}://example.test/`, undefined],
    ['spaces after a credential word', `token${' '.repeat(LONG_LINE)}`, undefined],
    ['quote marks after a credential word', `token${'"'.repeat(LONG_LINE)}`, undefined],
  ])('reads a long line of %s in linear time', (_name, line, masked) => {
    const started = performance.now()
    const shown = [maskText(line, MASK), ...maskArgs([line], MASK)]
    // The time first: a slow scan fails here, whatever it returned.
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
    expect(shown).toEqual([masked ?? line, masked ?? line])
  })

  // Claude Code's `.claude.json` is read up to 16 MiB, so an MCP argument can
  // run far past a rules file's 64 KiB. A quadratic scan that is cheap per
  // step (each `://` reading on to the same whitespace) shows only there.
  it('reads a long MCP argument of URL marks in linear time', () => {
    const arg = `${'://'.repeat(LONG_ARGUMENT / 3)} done`
    const started = performance.now()
    const shown = maskArgs([arg], MASK)
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
    expect(shown).toEqual([arg])
  })

  it('reads one long credential flag, and masks the argument after it, in linear time', () => {
    const flag = `--${'key'.repeat(LONG_LINE / 4)}`
    const started = performance.now()
    const shown = [maskText(flag, MASK), ...maskArgs([flag, 'value'], MASK)]
    expect(performance.now() - started).toBeLessThan(LINEAR_SCAN_MS)
    expect(shown).toEqual([flag, flag, MASK])
  })
})

describe('maskUrl', () => {
  it('keeps the scheme, host and path and masks user-info and every query value', () => {
    expect(maskUrl('https://me:pw@mcp.example.com/v1/sse?key=abc&tenant=acme', MASK)).toBe(
      `https://${MASK}@mcp.example.com/v1/sse?key=${MASK}&tenant=${MASK}`,
    )
  })

  it('sweeps the host, path and query names as text', () => {
    expect(maskUrl(`https://example.test/token=abc/x?${SYNTHETIC.githubToken}=1&q=2`, MASK)).toBe(
      `https://example.test/token=${MASK}?${MASK}=${MASK}&q=${MASK}`,
    )
  })

  it('masks a URL it cannot parse whole', () => {
    expect(maskUrl('not a url with s3cr3t', MASK)).toBe(MASK)
  })
})

describe('maskValues', () => {
  it('keeps the names and masks every value', () => {
    expect(maskValues({ NODE_ENV: 'production', API_TOKEN: 'abc' }, MASK)).toEqual({
      NODE_ENV: MASK,
      API_TOKEN: MASK,
    })
  })
})
