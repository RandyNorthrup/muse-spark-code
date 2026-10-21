import { describe, expect, it } from 'vitest'
import { vaultCommandFailure } from '../../../src/runtime/vault/vaultCommand'
import { UI_TEXT } from '../../../src/shared/constants'

// The terminal keeps a named vault failure's own sentence: a broker that
// cannot start names its repair, and a switched-off build says so, instead
// of the bare "No access" a person cannot act on (real use 2026-10-18:
// `vault status` with no bindable socket base printed "No access").
describe('vault terminal failure sentences', () => {
  it('keeps the broker repair sentence when the broker cannot start', () => {
    expect(vaultCommandFailure(new Error(UI_TEXT.vault.brokerBlocked))).toBe(
      UI_TEXT.vault.brokerBlocked,
    )
  })
  it('keeps the switched-off sentence when the build has the vault off', () => {
    expect(vaultCommandFailure(new Error(UI_TEXT.vault.brokerDisabled))).toBe(
      UI_TEXT.vault.brokerDisabled,
    )
  })
  it('keeps a named broker refusal sentence', () => {
    expect(vaultCommandFailure(new Error(UI_TEXT.vault.storeUnavailable))).toBe(
      UI_TEXT.vault.storeUnavailable,
    )
  })
  it('stays "No access" for an unnamed failure', () => {
    expect(vaultCommandFailure(new Error('socket hang up'))).toBe(UI_TEXT.vault.noAccess)
    expect(vaultCommandFailure(null)).toBe(UI_TEXT.vault.noAccess)
  })
})
