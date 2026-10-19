import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import {
  clearGoneImport,
  parseVaultCommand,
  vaultCommandFailure,
} from '../../../src/runtime/vault/vaultCommand'

// The terminal command surface: parsing never echoes its input (arguments
// can carry an accidental value), and every refusal keeps its own sentence.
describe('vault command failures', () => {
  it('parses the read commands and refuses everything else without echoing', () => {
    expect(parseVaultCommand(['status'])).toEqual({ command: 'status' })
    expect(parseVaultCommand(['audit', '--kind', 'sudo'])).toEqual({
      command: 'audit',
      filters: { item: undefined, requester: undefined, kind: 'sudo', outcome: undefined },
    })
    expect(parseVaultCommand(['frobnicate'])).toBeUndefined()
    expect(parseVaultCommand(['add', '{not-json'])).toBeUndefined()
    expect(parseVaultCommand(['add', '{"admin":true}'])).toBeUndefined()
  })

  it('keeps each named refusal and maps the rest to no access', () => {
    expect(vaultCommandFailure(new Error(UI_TEXT.vault.sourceGone))).toBe(UI_TEXT.vault.sourceGone)
    expect(vaultCommandFailure(new Error(UI_TEXT.vault.locked))).toBe(UI_TEXT.vault.locked)
    expect(vaultCommandFailure(new Error('something native went wrong'))).toBe(
      UI_TEXT.vault.noAccess,
    )
    expect(vaultCommandFailure(null)).toBe(UI_TEXT.vault.noAccess)
  })

  it('a cleared or stuck record leaves the delete refusal standing', async () => {
    // The record is already gone: clearing still resolves, the caller rethrows.
    await expect(clearGoneImport(() => Promise.resolve(), 'receipt')).resolves.toBeUndefined()
    let attempts = 0
    await expect(
      clearGoneImport(() => {
        attempts += 1
        return Promise.reject(new Error('already cleared'))
      }, 'receipt'),
    ).resolves.toBeUndefined()
    expect(attempts).toBe(1)
  })
})
