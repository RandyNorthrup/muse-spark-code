import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_POLICIES,
  accountPolicyFor,
  shouldRecheckAccountPolicy,
} from '../../src/core/providers/accountPolicy'
import { ACCOUNT_DAY_MS, ACCOUNT_POLICY_RECHECK_DAYS } from '../../src/shared/constants'

// Expected product decisions from D88/research, independent of the record.
const expected = [
  ['meta', 'model-api', 'confirm'],
  ['meta', 'muse-code', 'confirm'],
  ['openai', 'api', 'confirm'],
  ['openai', 'chatgpt-plan', 'confirm'],
  ['anthropic', 'api', 'on'],
  ['anthropic', 'claude-plan', 'notOffered'],
  ['google', 'gemini-api', 'confirm'],
  ['google', 'vertex', 'confirm'],
  ['google', 'consumer', 'notOffered'],
  ['github', 'copilot', 'confirm'],
  ['github', 'free', 'confirm'],
  ['xai', 'api', 'confirm'],
  ['groq', 'api', 'confirm'],
  ['mistral', 'api', 'on'],
  ['mistral', 'consumer-plan', 'confirm'],
  ['openrouter', 'api', 'confirm'],
  ['deepseek', 'api', 'on'],
  ['together', 'api', 'confirm'],
  ['fireworks', 'api', 'confirm'],
  ['huggingface', 'api', 'confirm'],
  ['zai', 'api', 'on'],
  ['zai', 'coding-plan', 'notOffered'],
  ['azure', 'same-tenant', 'on'],
  ['azure', 'cross-tenant', 'confirm'],
]

describe('M108 bundled vendor account policy', () => {
  it.each(expected)(
    '%s/%s has the researched pooling decision %s',
    (provider, product, pooling) => {
      expect(accountPolicyFor(provider, product)?.pooling).toBe(pooling)
    },
  )

  it('has a unique complete row and versioned source evidence for every product', () => {
    expect(ACCOUNT_POLICIES).toHaveLength(expected.length)
    const identities = new Set(ACCOUNT_POLICIES.map((row) => `${row.provider}/${row.product}`))
    expect(identities.size).toBe(expected.length)
    for (const row of ACCOUNT_POLICIES) {
      expect(row.recordVersion).not.toBe('')
      expect(row.checkedAt).toBe('2026-10-05')
      expect(row.limitScopes.length).toBeGreaterThan(0)
      for (const source of row.sources) {
        expect(source.quote.length).toBeGreaterThan(0)
        expect(source.url.startsWith('https://')).toBe(true)
      }
      if (row.pooling === 'notOffered') expect(row.isCredentialHeld).toBe(false)
    }
  })

  it('has no permissive fallback for custom providers or unknown products', () => {
    expect(accountPolicyFor('custom', 'api')).toBeUndefined()
    expect(accountPolicyFor('openai', 'unknown-plan')).toBeUndefined()
  })

  it('requires the one-person decision even at a user cap', () => {
    expect(
      ACCOUNT_POLICIES.filter((row) => row.multipleAccounts === 'onePerPerson')
        .map((row) => `${row.provider}/${row.product}`)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(['github/free', 'mistral/consumer-plan', 'openrouter/api'])
    expect(
      ACCOUNT_POLICIES.filter((row) => row.multipleAccounts === 'onePerPerson').every(
        (row) => row.pooling === 'confirm',
      ),
    ).toBe(true)
  })

  it('keeps editor-owned Copilot outside the credential store', () => {
    expect(accountPolicyFor('github', 'copilot')?.isCredentialHeld).toBe(false)
  })

  it('names vendor recovery before subscription pooling', () => {
    expect(accountPolicyFor('openai', 'chatgpt-plan')?.recovery).toBe('chatgptPlan')
    expect(accountPolicyFor('meta', 'muse-code')?.recovery).toBe('museCodeSubscription')
  })

  it('requires review after ninety days, and rejects invalid clocks or future check dates', () => {
    const row = ACCOUNT_POLICIES[0]
    if (row === undefined) throw new Error('Missing Meta policy fixture')
    const checked = Date.parse(row.checkedAt)
    const boundary = checked + ACCOUNT_POLICY_RECHECK_DAYS * ACCOUNT_DAY_MS
    expect(ACCOUNT_POLICY_RECHECK_DAYS).toBe(90)
    expect(shouldRecheckAccountPolicy(row, new Date(boundary))).toBe(false)
    expect(shouldRecheckAccountPolicy(row, new Date(boundary + 1))).toBe(true)
    expect(shouldRecheckAccountPolicy(row, new Date(checked - 1))).toBe(true)
    expect(shouldRecheckAccountPolicy(row, new Date(NaN))).toBe(true)
  })
})
