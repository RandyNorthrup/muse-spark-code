// @vitest-environment jsdom
// RVCM1091D P3 (grant hints): every hint beside a grant-form label is read
// from the UI tables at use time, never an English literal in the component.
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultGrantEditor } from '../../../src/webview/models/sections/vault/VaultGrantEditor'
import { UI_TEXT } from '../../../src/shared/constants'
import { setUiText } from '../../../src/shared/l10n/text'
import { EN } from '../../../src/shared/l10n/en'
import { metadata } from '../helpers/vault/fixtures'

afterEach(() => {
  setUiText(EN, 'en')
})

function renderEditor(): { readonly labels: readonly string[] } {
  const { container } = render(
    <VaultGrantEditor
      items={[metadata()]}
      onSave={() => undefined}
      onClose={() => undefined}
      now={() => 1000}
      newId={() => 'e'.repeat(32)}
    />,
  )
  return {
    labels: [...container.querySelectorAll('label')].map((element) => element.textContent),
  }
}

describe('RVCM1091D grant-form hints come from the UI tables', () => {
  it('reads every hint from the installed table at use time', () => {
    const markers = {
      rolesHint: 'ROLES-MARKER',
      workspacesHint: 'WORKSPACES-MARKER',
      daysHint: 'DAYS-MARKER',
      startHourHint: 'START-MARKER',
      endHourHint: 'END-MARKER',
      ceilingHint: 'CEILING-MARKER',
    }
    setUiText({ ...EN, vault: { ...EN.vault, ...markers } }, 'en')
    renderEditor()
    for (const marker of Object.values(markers)) {
      expect(screen.getByText(new RegExp(marker, 'u'))).toBeInTheDocument()
    }
  })

  it('keeps the code vocabularies beside their translated labels', () => {
    const { labels } = renderEditor()
    for (const hint of [
      UI_TEXT.vault.rolesHint,
      UI_TEXT.vault.workspacesHint,
      UI_TEXT.vault.daysHint,
      UI_TEXT.vault.startHourHint,
      UI_TEXT.vault.endHourHint,
      UI_TEXT.vault.ceilingHint,
    ]) {
      expect(labels.some((text) => text.includes(hint))).toBe(true)
    }
    // The label words beside the hints stay translated, not repeated literals.
    expect(labels.some((text) => text.includes(UI_TEXT.vault.roles))).toBe(true)
  })
})
