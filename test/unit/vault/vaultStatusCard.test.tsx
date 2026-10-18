// @vitest-environment jsdom
// RVCM1091D P3 (status card) + P3 (Title Case): the protection summary shows
// plain localized words, never raw protocol tokens, and every vault action
// label is Title Case.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultSection } from '../../../src/webview/models/sections/vault/VaultSection'
import { VaultDetails } from '../../../src/webview/models/sections/vault/vaultPresentation'
import { UI_TEXT } from '../../../src/shared/constants'
import { setUiText } from '../../../src/shared/l10n/text'
import { EN } from '../../../src/shared/l10n/en'
import { panel } from '../helpers/vault/fixtures'

afterEach(() => {
  setUiText(EN, 'en')
})

function renderUnlocked(): { container: HTMLElement } {
  const state = panel()
  state.status = {
    state: 'unlocked',
    lockEpoch: 0,
    tier: 'osStore',
    provider: 'loginKeychain',
    silentUnlock: true,
    itemCount: 1,
    reason: null,
  }
  const { container } = render(<VaultSection state={state} post={() => undefined} />)
  return { container }
}

describe('RVCM1091D vault status card', () => {
  it('labels the protection rows in plain localized words', () => {
    const { container } = renderUnlocked()
    // The tier card div: the retry live region is a separate persistent
    // paragraph with the same role (RVAPP-CM1091D5 P3-4).
    const card = container.querySelector('div[role="status"]')
    expect(card).toHaveTextContent(UI_TEXT.vault.tier)
    expect(card).toHaveTextContent(UI_TEXT.vault.provider)
    expect(card).toHaveTextContent(UI_TEXT.vault.silentUnlock)
    expect(card).toHaveTextContent(UI_TEXT.vault.osStore)
    expect(card).toHaveTextContent(UI_TEXT.vault.loginKeychain)
    expect(card).toHaveTextContent(UI_TEXT.toggleOn)
  })

  it('shows no raw protocol token anywhere on the card', () => {
    const { container } = renderUnlocked()
    const text = container.textContent
    for (const token of ['tier:', 'osStore', 'loginKeychain', 'silentUnlock']) {
      expect(text).not.toContain(token)
    }
  })

  it('maps every closed tier and provider token to a localized word', () => {
    // The tier warnings keep their own sentences (which name the
    // protection in prose), so the sweep renders the rows alone.
    const tiers = [
      ['hardware', UI_TEXT.vault.hardware],
      ['presence', UI_TEXT.vault.presence],
      ['osStore', UI_TEXT.vault.osStore],
      ['secretStorage', UI_TEXT.vault.secretStorage],
      ['passphrase', UI_TEXT.vault.passphrase],
      ['recovery', UI_TEXT.vault.recovery],
    ] as const
    for (const [tier, words] of tiers) {
      const { container, unmount } = render(
        <VaultDetails value={{ tier, provider: 'windowsDpapi', silentUnlock: false }} />,
      )
      const rows = [...container.querySelectorAll(':scope .vault-details > div')]
      const cell = (label: string): string | null => {
        const row = rows.find((entry) => entry.querySelector('dt')?.textContent === label)
        return row?.querySelector('dd')?.textContent ?? null
      }
      expect(cell(UI_TEXT.vault.tier)).toBe(words)
      expect(cell(UI_TEXT.vault.provider)).toBe(UI_TEXT.vault.windowsDpapi)
      expect(cell(UI_TEXT.vault.silentUnlock)).toBe(UI_TEXT.toggleOff)
      unmount()
    }
  })
})

describe('RVCM1091D vault action labels are Title Case', () => {
  it('renders the mounted actions in Title Case', () => {
    renderUnlocked()
    expect(screen.getByRole('button', { name: UI_TEXT.vault.lock })).toHaveTextContent(
      'Lock Vault Now',
    )
    expect(screen.getByRole('button', { name: UI_TEXT.vault.add })).toHaveTextContent(
      'Add to Vault',
    )
    expect(screen.getByRole('button', { name: UI_TEXT.vault.grant })).toHaveTextContent(
      'Create Grant',
    )
  })

  it('keeps every action label in Title Case in the English table', () => {
    expect(UI_TEXT.vault).toMatchObject({
      add: 'Add to Vault',
      edit: 'Edit Item',
      remove: 'Remove Item',
      grant: 'Create Grant',
      revoke: 'Revoke Grant',
      lock: 'Lock Vault Now',
      unlock: 'Unlock Vault',
      allowSession: 'Allow for This Session',
      manage: 'Manage in Vault',
      moveToVault: 'Move to Vault',
      undoMigration: 'Undo Migration',
      importFile: 'Import File',
      keepFile: 'Keep File',
      deleteFile: 'Delete the File',
      rotate: 'Rotate Credential',
      replaceValue: 'Replace Credential',
      metadataOnly: 'Edit Settings Only',
      publicKey: 'Public Key',
    })
  })
})
