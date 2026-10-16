// Panel-focus drop rule (the review's F3): the host delivers a focus
// request only while its panel is the active one; a request whose panel is
// not active at delivery is dropped, never held. Pure decisions through the
// real module, with values passed in as data: no mocks, no fake timers.

import { describe, expect, it } from 'vitest'
import { FOCUS_REQUEST_WINDOW_MS } from '../../src/shared/constants'
import { mintFocusRequest, shouldDeliverFocusInput } from '../../src/host/views/focusGate'

describe('shouldDeliverFocusInput', () => {
  it('delivers while the panel is the active one', () => {
    expect(shouldDeliverFocusInput(true, undefined, 1000)).toBe(true)
  })

  it('delivers just after the person revealed it, while its focus still arrives', () => {
    expect(shouldDeliverFocusInput(false, 1000, 1000 + FOCUS_REQUEST_WINDOW_MS)).toBe(true)
  })

  it('drops when the panel is not active and no reveal armed it', () => {
    expect(shouldDeliverFocusInput(false, undefined, 1000)).toBe(false)
  })

  it('drops when the reveal is older than the delivery window', () => {
    expect(shouldDeliverFocusInput(false, 1000, 1000 + FOCUS_REQUEST_WINDOW_MS + 1)).toBe(false)
  })
})

describe('mintFocusRequest', () => {
  it('carries the host-owned token and its issue time', () => {
    expect(mintFocusRequest(1000, () => 'token-1')).toEqual({
      token: 'token-1',
      issuedAt: 1000,
    })
  })
})
