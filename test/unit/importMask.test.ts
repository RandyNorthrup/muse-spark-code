// The import's masking (M83): nothing secret-looking reaches the preview,
// the clipboard or the log, whatever field it hides in.

import { describe, expect, it } from 'vitest'
import { maskArgs, maskText, maskUrl, maskValues } from '../../src/core/import/importMask'
import { SYNTHETIC } from './helpers/syntheticTokens'

const MASK = '[masked]'

describe('maskText', () => {
  it('uses the URL field masker for URLs inside commands and Markdown, idempotently', () => {
    const url =
      'https://demo:opaque-user-value@example.test/mcp?signature=opaque-demo-value&tenant=demo'
    const expected = `curl "${maskUrl(url, MASK)}"; [service](${maskUrl(url, MASK)}).`
    const masked = maskText(`curl "${url}"; [service](${url}).`, MASK)
    expect(masked).toBe(expected)
    expect(maskText(masked, MASK)).toBe(expected)
  })

  it.each(["'", '"', '`'])(
    'masks a query value in %s marks whole, in arguments, links and shell snippets',
    (mark) => {
      const secret = 'opaque-demo-value'
      const url = `https://example.test/mcp?signature=${mark}${secret}${mark}&tenant=demo`
      // A shell argument wrapped in the other kind of mark.
      const wrap = mark === '"' ? "'" : '"'
      const shown = maskUrl(url, MASK)
      expect(shown).toBe(`https://example.test/mcp?signature=${MASK}&tenant=${MASK}`)
      expect(maskArgs(['mcp-remote', url], MASK)).toEqual(['mcp-remote', shown])
      expect(maskText(`Read [service](${url}).`, MASK)).toBe(`Read [service](${shown}).`)
      expect(maskText(`curl -s ${wrap}${url}${wrap} -o out.json`, MASK)).toBe(
        `curl -s ${wrap}${shown}${wrap} -o out.json`,
      )
      expect(maskText(`curl -s ${url} | jq .`, MASK)).toBe(`curl -s ${shown} | jq .`)
    },
  )

  it('masks a value the shell joins from quoted parts, or one whose quote never closes', () => {
    const secret = 'opaque-demo-value'
    const url = 'https://example.test/mcp?signature='
    expect(
      [
        `curl '${url}'${secret}''`,
        `curl "${url}"${secret}"" -o out.json`,
        `curl ${url}''${secret}''`,
        `curl ${url}demo'${secret}'`,
        `curl ${url}'demo'"${secret}"`,
        `[service](${url}'${secret})`,
      ].map((text) => maskText(text, MASK)),
    ).toEqual([
      `curl '${url}${MASK}'`,
      `curl "${url}${MASK}" -o out.json`,
      `curl ${url}${MASK}`,
      `curl ${url}${MASK}`,
      `curl ${url}${MASK}`,
      `[service](${url}${MASK})`,
    ])
  })

  it('keeps the text around a URL: closing marks, link parentheses and the rest of the sentence', () => {
    const kept = [
      `curl "https://example.test/mcp?q=" -o out.json`,
      `fetch("https://example.test/mcp?q=") and then 'done'`,
      `{"url":"https://example.test/mcp?q=1","next":"page"}`,
      'See `https://example.test/mcp?q=` and "notes".',
      `"See https://example.test/mcp?q=1", he said; it's at https://example.test/it's/here.`,
      `Set https://example.test/mcp?q=' and 'x' later.`,
      `[docs](https://example.test/mcp?q='x'), then "more" text.`,
      `curl 'https://example.test/docs' -H 'Accept: text/plain'`,
    ]
    expect(kept.map((text) => maskText(text, MASK))).toEqual([
      `curl "https://example.test/mcp?q=${MASK}" -o out.json`,
      `fetch("https://example.test/mcp?q=${MASK}") and then 'done'`,
      `{"url":"https://example.test/mcp?q=${MASK}","next":"page"}`,
      `See \`https://example.test/mcp?q=${MASK}\` and "notes".`,
      `"See https://example.test/mcp?q=${MASK}", he said; it's at https://example.test/it's/here.`,
      `Set https://example.test/mcp?q=${MASK}' and 'x' later.`,
      `[docs](https://example.test/mcp?q=${MASK}), then "more" text.`,
      `curl 'https://example.test/docs' -H 'Accept: text/plain'`,
    ])
  })

  it.each([
    [
      'Bearer',
      `curl -H "Authorization: Bearer ${SYNTHETIC.bearerValue}" https://x`,
      SYNTHETIC.bearerValue,
    ],
    ['a GitHub token', `gh auth ${SYNTHETIC.githubToken}`, SYNTHETIC.githubToken],
    ['an OpenAI-style key', `run ${SYNTHETIC.openAiKey}`, SYNTHETIC.openAiKey],
    ['a Slack token', `post ${SYNTHETIC.slackToken}`, SYNTHETIC.slackToken],
    ['an AWS access key', `aws ${SYNTHETIC.awsAccessKey}`, SYNTHETIC.awsAccessKey],
    ['a flag value', './server --api-key s3cr3t-value --port 9', 's3cr3t-value'],
    ['a flag with =', './server --token=s3cr3t-value', 's3cr3t-value'],
    ['an assignment', 'GITHUB_TOKEN=s3cr3t-value node x.js', 's3cr3t-value'],
    ['a quoted assignment', "MY_SECRET='s3cr3t value' node x.js", 's3cr3t value'],
    ['URL user-info', 'git clone https://me:s3cr3t-value@host/repo', 's3cr3t-value'],
  ])('masks %s', (_name, text, secret) => {
    const masked = maskText(text, MASK)
    expect(masked).not.toContain(secret)
    expect(masked).toContain(MASK)
  })

  it('leaves ordinary commands and a commit author alone', () => {
    expect(maskText('npx prettier --write "$FILE"', MASK)).toBe('npx prettier --write "$FILE"')
    expect(maskText('git commit --author Randy', MASK)).toBe('git commit --author Randy')
  })

  it('shows the log redactor’s own mark as the mask word', () => {
    expect(maskText('password=hunter2', MASK)).toBe(`password=${MASK}`)
  })
})

describe('maskArgs', () => {
  it('masks the value after a credential-like flag and a flag=value', () => {
    expect(
      maskArgs(['-y', 'server', '--api-key', 'abc', '--token=def', '--port', '9'], MASK),
    ).toEqual(['-y', 'server', '--api-key', MASK, `--token=${MASK}`, '--port', '9'])
  })
})

describe('maskUrl', () => {
  it('keeps the scheme, host and path and masks user-info and every query value', () => {
    expect(maskUrl('https://me:pw@mcp.example.com/v1/sse?key=abc&tenant=acme', MASK)).toBe(
      `https://${MASK}@mcp.example.com/v1/sse?key=${MASK}&tenant=${MASK}`,
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
