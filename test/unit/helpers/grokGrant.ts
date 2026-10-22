// A Grok grant record for tests that drive the real sign-in layer.
// Field provenance, one by one: `v`, `auth`, `origin` and `issuer` repeat
// the product's own constants (`grok.ts` ISSUER/ORIGIN,
// `CREDENTIAL_RECORD_VERSION`); `clientId` is a documented-shaped
// placeholder (xAI has issued this app none, so no real one can be
// recorded); `nonce` comes from the product's own generator (`pkceRandom`,
// the same call sign-in makes); `accountIdHash` is the product's own
// derivation (`grokAccountIdHash`) over a fixed subject. Only the two
// grant tokens stay synthetic opaque placeholders: real tokens can never
// be recorded (AGENTS.md: credentials are never seen or stored), so they
// are placeholders that never leave the test process — the grant is
// unexpired, so `accessToken` returns without refresh, and every fetch in
// these tests answers with the recorded discovery capture or refuses.
import { pkceRandom } from '../../../src/core/providers/pkce'
import { grokAccountIdHash, type GrokRecord } from '../../../src/core/providers/subscriptions/grok'
import { CREDENTIAL_RECORD_VERSION, PKCE_STATE_BYTES } from '../../../src/shared/constants'

/** An unexpired Grok grant; the tokens are opaque placeholders, never recorded. */
export function grokGrantRecord(overrides: Partial<GrokRecord> = {}): GrokRecord {
  return {
    v: CREDENTIAL_RECORD_VERSION,
    auth: 'subscription',
    origin: 'https://api.x.ai',
    issuer: 'https://auth.x.ai',
    clientId: 'muse-spark-code.test-client',
    accountIdHash: grokAccountIdHash('https://auth.x.ai', 'test-subject'),
    accessToken: 'test-access-token-placeholder',
    refreshToken: 'test-refresh-token-placeholder',
    expiresAt: Date.now() + 3_600_000,
    scope: 'openid offline_access',
    nonce: pkceRandom(PKCE_STATE_BYTES),
    ...overrides,
  }
}
