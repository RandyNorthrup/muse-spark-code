// The MCP OAuth denial (D119): a denied request throws the fixed no-access
// sentence, and the failure that caused it rides along as the cause. The
// dispatch and foreign-failure halves left with the stand-in dispatch port
// on lane PR161FIX; their claims wait in docs/real-life/unproven.md.
import { describe, expect, it } from 'vitest'
import { oauthDenied } from '../../src/core/mcp/oauth/discovery'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { captureFailure } from './helpers/captureFailure'

describe('mcp oauth denial', () => {
  it('denies with the fixed sentence and the failure as its cause', async () => {
    setUiText(EN, BASE_LOCALE)
    const cause = new Error('the token endpoint refused')
    const failure = await captureFailure(() => oauthDenied({ cause }))
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(UI_TEXT.vault.noAccess)
    expect((failure as Error).cause).toBe(cause)
  })
})
