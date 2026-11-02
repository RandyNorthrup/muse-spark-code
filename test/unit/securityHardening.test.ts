// RSCH-SECURITY (2026-11-02): the deterministic gaps the agent-security
// research proved against this tree, each with a harmless local value
// (docs/research/agent-security-2026-11-02.md). Unquoted secret fields in
// any case reached logs, exports and the staged-patch scanner unchanged;
// a Google key longer than the one captured shape kept its tail; three
// common vendor shapes were unrecognised; credential environment names
// spelled without an underscore (or as a connection string) passed every
// child-environment filter; and CI and hook files that run code on push
// or commit were ordinary edits in Auto.

import { describe, expect, it } from 'vitest'
import {
  countSecretMatches,
  isSecretFieldName,
  MAY_HOLD_SECRET,
  redactSecrets,
  SECRET_RULES,
} from '../../src/shared/redact'
import { isCredentialVariable } from '../../src/shared/credentialEnvironment'
import { isProtectedPath } from '../../src/core/protectedPaths'

const OPAQUE = 'opaque-value-12345'
// Assembled into the key-compound lines below, so no line of this file
// is itself a credential-shaped assignment.
const HEX16 = 'a1b2c3d4e5f6a7b8'

describe('redactSecrets: secret fields named in any case, quoted or not', () => {
  it('redacts the value and keeps the name', () => {
    for (const line of [
      `token: ${OPAQUE}`,
      `my_token=${OPAQUE}`,
      `github_token: ${OPAQUE}`,
      `auth_token = ${OPAQUE}`,
      `secret: ${OPAQUE}`,
      `apiToken: ${OPAQUE}`,
      `clientSecret: ${OPAQUE}`,
      `secret_key = ${OPAQUE}`,
      `apiKey: ${OPAQUE}`,
      `password: hunter22x`,
      'passphrase: correct-horse-42',
      `signing_key = ${HEX16}`,
      `masterKey: ${HEX16}`,
      `session_key = ${HEX16}`,
      `"encryptionKey": "${HEX16}"`,
    ]) {
      expect(redactSecrets(line), line).not.toContain(OPAQUE)
      expect(redactSecrets(line), line).not.toContain('hunter22x')
      expect(redactSecrets(line), line).not.toContain(HEX16)
      expect(redactSecrets(line), line).not.toContain('correct-horse-42')
      expect(countSecretMatches(line, []), line).toBeGreaterThan(0)
    }
    expect(redactSecrets(`token: ${OPAQUE}`)).toBe('token: [redacted]')
    expect(redactSecrets(`my_token=${OPAQUE}`)).toBe('my_token=[redacted]')
  })

  it('keeps counts, types and prose that merely contain the words', () => {
    for (const line of [
      'key: cache-2026-11',
      'monkey: banana-1234-split',
      'inputTokens: 12',
      'tokenCount: 12345678',
      'maxTokens: 4096',
      'token: string',
      'secret: true',
      'secret: required',
    ]) {
      expect(redactSecrets(line), line).toBe(line)
      expect(countSecretMatches(line, []), line).toBe(0)
    }
  })

  it('keeps the MAY_HOLD_SECRET gate able to reach every rule', () => {
    // A rule whose literals the gate cannot see never runs (the
    // passphrase shape this lane added first shipped exactly so).
    for (const rule of SECRET_RULES) {
      for (const literal of rule.literals) {
        expect(MAY_HOLD_SECRET.test(literal), literal).toBe(true)
      }
    }
  })

  it('recognises the field names themselves', () => {
    for (const name of ['token', 'my_token', 'apiToken', 'clientSecret', 'secret_key']) {
      expect(isSecretFieldName(name), name).toBe(true)
    }
    for (const name of ['tokenCount', 'tokens', 'monkey']) {
      expect(isSecretFieldName(name), name).toBe(false)
    }
  })
})

describe('redactSecrets: vendor shapes are replaced whole', () => {
  it('leaves no tail of a Google key longer than the captured shape', () => {
    const key = `AIza${'A1'.repeat(23)}`
    expect(redactSecrets(`key ${key} end`)).toBe('key [redacted] end')
  })

  it('redacts DigitalOcean, PyPI and age secret keys', () => {
    const digitalOcean = `dop_v1_${'a1b2c3d4'.repeat(8)}`
    const pypi = 'pypi-AgEIcHlwaS5vcmcCJDU3ZjE2YjM0LTk5YzktNGU2YS1iZGYtY2NmY2Y'
    const age = `AGE-SECRET-KEY-1${'Q'.repeat(58)}`
    for (const value of [digitalOcean, pypi, age]) {
      expect(redactSecrets(`saw ${value} here`), value.slice(0, 12)).not.toContain(value)
      expect(countSecretMatches(`saw ${value} here`, []), value.slice(0, 12)).toBeGreaterThan(0)
    }
  })
})

describe('isCredentialVariable: spellings and connection strings', () => {
  it('strips credential names however they are spelled', () => {
    for (const name of [
      'APIKEY',
      'PRIVATEKEY',
      'SECRETKEY',
      'API_KEY',
      'SSH_KEY',
      'ENCRYPTION_KEY',
      'SIGNING_KEY',
      'KEY',
      'SENTRY_DSN',
      'DSN',
      'SESSION_COOKIE',
      'DATABASE_URL',
      'REDIS_URL',
      'MONGODB_URI',
      'AMQP_URL',
      'SLACK_WEBHOOK_URL',
      'GITHUB_TOKEN',
      'APPSECRET',
      'AUTHTOKEN',
      'MYPASSWORD',
    ]) {
      expect(isCredentialVariable(name), name).toBe(true)
    }
  })

  it('keeps names that only look similar', () => {
    for (const name of ['MONKEY', 'TURKEY', 'HOTKEY', 'KEYSTONE', 'KEY_PATH', 'BASE_URL', 'HOME']) {
      expect(isCredentialVariable(name), name).toBe(false)
    }
  })
})

describe('isProtectedPath: files that run code on push, commit or open', () => {
  it('protects every CI system, commit-hook config and editor task file', () => {
    for (const path of [
      '.github/actions/setup/action.yml',
      '.gitlab-ci.yml',
      'sub/.gitlab-ci.yml',
      '.GITLAB-CI.YML',
      '.circleci/config.yml',
      'bitbucket-pipelines.yml',
      'azure-pipelines.yml',
      'Jenkinsfile',
      '.travis.yml',
      '.pre-commit-config.yaml',
      '.pre-commit-config.yml',
      'lefthook.yml',
      'lefthook.yaml',
      '.buildkite/pipeline.yml',
      '.zed/settings.json',
      '.zed/tasks.json',
      'team.code-workspace',
      'sub/team.code-workspace',
      '.npmrc',
      '.yarnrc.yml',
      'pnpm-workspace.yaml',
    ]) {
      expect(isProtectedPath(path), path).toBe(true)
    }
  })

  it('leaves ordinary files alone', () => {
    for (const path of ['src/index.ts', 'docs/.gitlab-ci.yml.md', 'notes/code-workspace.md']) {
      expect(isProtectedPath(path), path).toBe(false)
    }
  })
})
