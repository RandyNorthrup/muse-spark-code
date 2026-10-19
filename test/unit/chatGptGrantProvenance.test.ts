// The shared grant builder's provenance: every product-generated field comes
// from the product's own code, so the authentication and catalogue tests feed
// the sign-in layers values shaped the way the product itself writes them.
// Only the provider-issued secrets stay synthetic (a real issued client and
// real tokens can never be recorded: credentials are never seen or stored),
// and they never leave the test process.
import { describe, expect, it } from 'vitest'
import {
  chatGptAccountIdHash,
  chatGptRecordSchema,
} from '../../src/core/providers/subscriptions/chatgpt'
import { isChatGptHostId } from '../../src/core/providers/subscriptions/chatgptHostId'
import { isPkceState } from '../../src/core/providers/pkce'
import { testGrantRecord } from './helpers/chatGptGrant'

describe('chatgpt test grant provenance', () => {
  it('builds each product-generated field the way the product writes it', () => {
    const record = testGrantRecord('provenance-account')
    expect(chatGptRecordSchema.safeParse(record).success).toBe(true)
    expect(isChatGptHostId(record.hostId)).toBe(true)
    expect(isPkceState(record.nonce)).toBe(true)
    expect(record.accountIdHash).toBe(
      chatGptAccountIdHash('https://auth.openai.com', 'provenance-account'),
    )
  })

  it('hashes different accounts differently', () => {
    expect(testGrantRecord('account-a').accountIdHash).not.toBe(
      testGrantRecord('account-b').accountIdHash,
    )
  })
})
