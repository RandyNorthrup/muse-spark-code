import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { gitCredentialAnswer } from '../../../src/core/vault/exec/gitHelper'
import { type VaultUse } from '../../../src/shared/vault'
import { UI_TEXT, VAULT_LIMITS } from '../../../src/shared/constants'
import { envelope } from './execFixture'

describe('M109 X scoped git helper', () => {
  const use: Extract<VaultUse, { kind: 'git' }> = {
    kind: 'git',
    command: envelope().run.command,
    protocol: 'https',
    host: 'example.test',
    path: 'owner/repo',
  }
  const password = Buffer.from(randomBytes(32).toString('base64url'))
  const username = Buffer.from('generated-user')
  const input = 'protocol=https\nhost=example.test\npath=owner/repo\n\n'
  it('answers only get for the exact protocol host and path, with ephemeral and expiry fields', () => {
    const result = gitCredentialAnswer(use, 'get', input, username, password, 120_000, 0)
    try {
      expect(result.toString()).toBe(
        `username=generated-user\npassword=${password.toString()}\npassword_expiry_utc=120\nephemeral=true\n\n`,
      )
    } finally {
      result.fill(0)
    }
    for (const changed of [
      input.replace('https', 'http'),
      input.replace('example.test', 'other.test'),
      input.replace('owner/repo', 'other/repo'),
      input.replace('path=owner/repo\n', ''),
    ])
      expect(() =>
        gitCredentialAnswer(use, 'get', changed, username, password, 120_000, 0),
      ).toThrow(UI_TEXT.vault.noAccess)
  })
  it('supports token-only entries without inventing a username', () => {
    const answer = gitCredentialAnswer(use, 'get', input, null, password, 120_000, 0)
    try {
      expect(answer.toString()).toBe(
        `password=${password.toString()}\npassword_expiry_utc=120\nephemeral=true\n\n`,
      )
    } finally {
      answer.fill(0)
    }
  })
  it('never answers store erase capability or unknown operations', () => {
    for (const operation of ['store', 'erase', 'capability', 'unknown'])
      expect(
        gitCredentialAnswer(use, operation, input, username, password, 120_000, 0).length,
      ).toBe(0)
  })
  it('rejects expired answers, duplicate targets, malformed fields and newline or NUL material', () => {
    expect(() =>
      gitCredentialAnswer(use, 'get', input, username, password, 120_000, 120_000),
    ).toThrow(UI_TEXT.vault.noAccess)
    expect(() =>
      gitCredentialAnswer(
        use,
        'get',
        input.replace('\n\n', () => `\npadding=${'x'.repeat(VAULT_LIMITS.text)}\n\n`),
        username,
        password,
        120_000,
        0,
      ),
    ).toThrow(UI_TEXT.vault.noAccess)
    for (const bad of [
      input.replace('host=example.test', 'host=example.test\nhost=other.test'),
      input.replace('host=example.test', 'host=example.test\nhost=example.test'),
      input.replace('\n\n', '\ninvalid\n\n'),
      'invalid\n\n',
    ])
      expect(() => gitCredentialAnswer(use, 'get', bad, username, password, 120_000, 0)).toThrow(
        UI_TEXT.vault.noAccess,
      )
    for (const bad of [Buffer.from('line\nbreak'), Buffer.from('nul\0byte')])
      expect(() => gitCredentialAnswer(use, 'get', input, bad, password, 120_000, 0)).toThrow(
        UI_TEXT.vault.noAccess,
      )
  })
})
