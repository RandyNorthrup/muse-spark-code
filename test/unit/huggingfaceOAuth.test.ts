// M95b step 5: Hugging Face "Sign in with HF" (OAuth PKCE, S256) with
// the `inference-api` scope. Shapes follow the provider's own docs
// (https://huggingface.co/docs/hub/oauth, read 2026-10-22); only the
// owner's app registration (the client id) is outstanding, so the
// connect refuses closed until it lands. The live exchange proves when
// the owner signs in; no seam is stood in for here.
import { describe, expect, it } from 'vitest'
import {
  HF_AUTH_URL,
  HF_OAUTH_CLIENT_ID,
  HF_OAUTH_SCOPES,
  huggingfaceAuthorizeUrl,
  huggingfaceConnectRefusal,
  huggingfaceTokenSchema,
} from '../../src/host/providers/huggingface'
import { UI_TEXT } from '../../src/shared/constants'

describe('Hugging Face OAuth sign-in', () => {
  it('builds the documented authorize URL with PKCE', () => {
    const url = new URL(
      huggingfaceAuthorizeUrl({
        clientId: 'test-client-id',
        challenge: 'test-challenge',
        state: 'test-state',
        redirectUri: 'http://127.0.0.1:9876/callback',
      }),
    )
    expect(`${url.origin}${url.pathname}`).toBe(HF_AUTH_URL)
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:9876/callback')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(HF_OAUTH_SCOPES)
    expect(url.searchParams.get('state')).toBe('test-state')
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('asks only for inference on the user behalf', () => {
    expect(HF_OAUTH_SCOPES).toBe('inference-api')
  })

  it('parses the documented token answer and rejects a missing token', () => {
    expect(
      huggingfaceTokenSchema.safeParse({
        access_token: 'hf_test',
        token_type: 'Bearer',
        expires_in: 3600,
      }).success,
    ).toBe(true)
    expect(huggingfaceTokenSchema.safeParse({ token_type: 'Bearer' }).success).toBe(false)
    expect(huggingfaceTokenSchema.safeParse({ access_token: '' }).success).toBe(false)
    expect(huggingfaceTokenSchema.safeParse('not-an-object').success).toBe(false)
  })

  it('refuses closed until the owner registers the app, naming that step', () => {
    // The product's own gate with the product's own (absent) id.
    expect(huggingfaceConnectRefusal(HF_OAUTH_CLIENT_ID, false)).toBe(
      UI_TEXT.huggingfaceOAuthNotRegistered,
    )
    expect(UI_TEXT.huggingfaceOAuthNotRegistered).toContain('huggingface.co')
    expect(huggingfaceConnectRefusal('', false)).toBe(UI_TEXT.huggingfaceOAuthNotRegistered)
    expect(huggingfaceConnectRefusal('an-id', false)).toBeUndefined()
  })

  it('refuses a remote window, where HF documents no pasted-code flow', () => {
    expect(huggingfaceConnectRefusal('an-id', true)).toBe(UI_TEXT.huggingfaceRemoteWindow)
  })
})
