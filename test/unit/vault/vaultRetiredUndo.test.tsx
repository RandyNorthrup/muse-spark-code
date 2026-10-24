// @vitest-environment jsdom
// D217: every retired migration slot the host lists gets its own Undo in the
// vault section, and a press posts exactly that slot's key in the shape the
// host's own message schema accepts. Rendered for real; the entries below
// are shaped like the ones the host lists.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../../src/shared/constants'
import { vaultClientMessageSchema } from '../../../src/shared/hostApi/vaultMessages'
import {
  VaultSection,
  type VaultPanelPost,
} from '../../../src/webview/models/sections/vault/VaultSection'
import { recordCalls } from '../helpers/recordCalls'
import { panel } from '../helpers/vault/fixtures'

const OPENROUTER = 'museSpark.provider.openrouter'
const CHATGPT = 'museSpark.provider.chatgpt'

describe('retired entries in the vault section', () => {
  it('gives each retired entry its own Undo, posting that entry key', () => {
    const state = {
      ...panel(),
      retired: [
        { key: OPENROUTER, label: UI_TEXT.vault.secret },
        { key: CHATGPT, label: UI_TEXT.vault.secret },
      ],
    }
    const { calls, fn: post } = recordCalls<Parameters<VaultPanelPost>>()
    const { unmount } = render(<VaultSection state={state} post={post} />)
    try {
      expect(screen.getByText(UI_TEXT.vault.retiredEntries)).toBeDefined()
      expect(screen.getByText(`${UI_TEXT.vault.secret} (${OPENROUTER})`)).toBeDefined()
      const undos = screen.getAllByText(UI_TEXT.undoAction)
      expect(undos).toHaveLength(2)
      const [, second] = undos
      if (second === undefined) throw new Error('the second Undo never rendered')
      fireEvent.click(second)
      expect(calls).toEqual([[{ type: 'vaultUndoRetired', key: CHATGPT }]])
      for (const [message] of calls)
        expect(vaultClientMessageSchema.safeParse(message).success).toBe(true)
    } finally {
      unmount()
    }
  })

  it('lists no retired heading and no Undo while nothing is retired', () => {
    const { unmount } = render(<VaultSection state={panel()} post={() => undefined} />)
    try {
      expect(screen.queryByText(UI_TEXT.vault.retiredEntries)).toBeNull()
      expect(screen.queryByText(UI_TEXT.undoAction)).toBeNull()
    } finally {
      unmount()
    }
  })

  it('the host refuses an undo message that names no key or carries extra fields', () => {
    expect(vaultClientMessageSchema.safeParse({ type: 'vaultUndoRetired', key: '' }).success).toBe(
      false,
    )
    expect(
      vaultClientMessageSchema.safeParse({ type: 'vaultUndoRetired', key: OPENROUTER, force: true })
        .success,
    ).toBe(false)
  })
})
