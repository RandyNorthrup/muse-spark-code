// The import's masking (M83): nothing secret-looking reaches the preview,
// the clipboard or the log, whatever field it hides in.

import { describe, expect, it } from 'vitest'
import { maskArgs, maskText, maskUrl, maskValues } from '../../src/core/import/importMask'
import { SYNTHETIC } from './helpers/syntheticTokens'

const MASK = '[masked]'

describe('maskText', () => {
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
