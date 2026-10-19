// @vitest-environment jsdom
// The vault section never lists migrated credentials: journal rows and
// copied keys are hidden first-party rows, and the list offers no Edit or
// Remove for them. Rendered for real; the hidden row below is shaped like
// the migration's own rows.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VaultSection } from '../../../src/webview/models/sections/vault/VaultSection'
import { UI_TEXT } from '../../../src/shared/constants'
import { metadata, panel } from '../helpers/vault/fixtures'

function hiddenRow() {
  return {
    ...metadata(),
    id: 'e'.repeat(32),
    name: 'migration-0123456789abcdef01234567',
    handle: 'secret://migration-0123456789abcdef01234567',
    label: 'Migration journal',
    kind: 'apiKey' as const,
    hidden: true,
    firstParty: true,
  }
}

describe('vault section with migrated rows', () => {
  it('lists only the person\u{2019}s items, with no Edit or Remove for migrated rows', () => {
    const hidden = hiddenRow()
    const state = {
      ...panel(),
      status: { ...panel().status, itemCount: 2 },
      items: [metadata(), hidden],
    }
    const { unmount } = render(<VaultSection state={state} post={() => undefined} />)
    try {
      expect(screen.getAllByText(metadata().handle).length).toBeGreaterThan(0)
      expect(screen.queryByText(hidden.handle)).toBeNull()
      expect(screen.queryByText(hidden.label)).toBeNull()
      expect(screen.getAllByText(UI_TEXT.vault.edit)).toHaveLength(1)
      expect(screen.getAllByText(UI_TEXT.vault.remove)).toHaveLength(1)
    } finally {
      unmount()
    }
  })

  it('counts only the listed items', () => {
    const state = {
      ...panel(),
      status: { ...panel().status, itemCount: 2 },
      items: [metadata(), hiddenRow()],
    }
    const { unmount } = render(<VaultSection state={state} post={() => undefined} />)
    try {
      expect(screen.getByText('1 item')).toBeDefined()
      expect(screen.queryByText('2 items')).toBeNull()
    } finally {
      unmount()
    }
  })
})
