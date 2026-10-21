// @vitest-environment jsdom
// The grant form's Expires reads like the vault editor's
// (src/shared/vaultExpiry.ts): the picker's local date and time is stored as
// that local moment, and a moment that has already passed is refused with
// its own sentence instead of saving a grant that can never be used.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VaultGrantEditor } from '../../../src/webview/models/sections/vault/VaultGrantEditor'
import { UI_TEXT } from '../../../src/shared/constants'
import type { VaultGrant } from '../../../src/shared/vault'
import { metadata } from '../helpers/vault/fixtures'

const NOW = new Date(2026, 9, 20, 12, 0).getTime()

/** Fills the workspaces and Expires, submits, and returns what was saved. */
function submitGrant(expiresAt: string): VaultGrant[] {
  const saved: VaultGrant[] = []
  const { container } = render(
    <VaultGrantEditor
      items={[{ ...metadata(), bindings: [{ kind: 'origin', origin: 'https://app.example.com' }] }]}
      onSave={(grant) => {
        saved.push(grant)
      }}
      onClose={() => undefined}
      now={() => NOW}
      newId={() => 'e'.repeat(32)}
    />,
  )
  const workspaces = container.querySelector('textarea[name="workspaces"]')
  const expires = container.querySelector('input[name="expiresAt"]')
  const form = container.querySelector('form')
  if (workspaces === null || expires === null || form === null) throw new Error('no grant form')
  fireEvent.change(workspaces, { target: { value: 'workspace' } })
  fireEvent.change(expires, { target: { value: expiresAt } })
  fireEvent.submit(form)
  return saved
}

describe('the grant form’s Expires', () => {
  it('stores the picked local date and time', () => {
    const [grant] = submitGrant('2027-01-15T09:30')
    expect(grant?.expiresAt).toBe(new Date(2027, 0, 15, 9, 30).getTime())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps no expiry when the box is empty', () => {
    const [grant] = submitGrant('')
    expect(grant?.expiresAt).toBeNull()
  })

  it('refuses a moment that has already passed with its own sentence', () => {
    expect(submitGrant('2026-10-20T11:59')).toEqual([])
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.vault.expiresPassed)
  })
})
