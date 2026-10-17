// The MCP OAuth denial boundary (D119): a denied request throws the fixed
// no-access sentence, and the failure that caused it rides along as the
// cause; anything that is not an error keeps its kind past the boundary.
import { describe, expect, it } from 'vitest'
import { oauthDenied, oauthJson } from '../../src/core/mcp/oauth/discovery'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'

describe('mcp oauth denial', () => {
  it('denies with the fixed sentence and the failure as its cause', () => {
    setUiText(EN, BASE_LOCALE)
    const cause = new Error('the token endpoint refused')
    let failure: unknown
    try {
      oauthDenied({ cause })
    } catch (error: unknown) {
      failure = error
    }
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBe(cause)
  })

  it('maps a dispatch failure onto the denial with its cause', async () => {
    setUiText(EN, BASE_LOCALE)
    const failure = new Error('the network is down')
    let denial: unknown
    try {
      await oauthJson(
        {
          allowEndpoint: () => Promise.resolve(true),
          fetch: () => Promise.reject(failure),
        },
        'https://example.com/.well-known/oauth-authorization-server',
        {},
      )
      throw new Error('a failed dispatch must not read as a document')
    } catch (error: unknown) {
      denial = error
    }
    expect(denial).toBeInstanceOf(Error)
    expect((denial as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((denial as Error).cause).toBe(failure)
  })

  it('keeps a foreign dispatch failure past the boundary', async () => {
    await expect(
      oauthJson(
        {
          allowEndpoint: () => Promise.resolve(true),
          // The foreign probe deliberately rejects with a non-Error: the
          // boundary must preserve it with its kind (PLAN.md §8, PR161FIN).
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate foreign rejection; the probe asserts it by identity.
          fetch: () => Promise.reject('oauth-broken'),
        },
        'https://example.com/.well-known/oauth-authorization-server',
        {},
      ),
    ).rejects.toBe('oauth-broken')
  })
})
