// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import { initialUiState } from '../../src/webview/state/uiState'
import { modelLabelFor } from '../../src/webview/App'

beforeEach(() => {
  setUiText(EN, 'en')
})

describe('startup pill', () => {
  it('says what it waits for while the sign-in facts are read', () => {
    expect(
      modelLabelFor({ ...initialUiState, auth: { ...initialUiState.auth, status: 'checking' } }),
    ).toBe('Checking sign-in…')
  })

  it('keeps the later stages’ words', () => {
    expect(
      modelLabelFor({ ...initialUiState, auth: { ...initialUiState.auth, status: 'signedOut' } }),
    ).toBe('Not signed in')
    expect(
      modelLabelFor({
        ...initialUiState,
        auth: { ...initialUiState.auth, status: 'signedIn', backend: 'museCode' },
      }),
    ).toBe('Starting Muse Code…')
  })
})
