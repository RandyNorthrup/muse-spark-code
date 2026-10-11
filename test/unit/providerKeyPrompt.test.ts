// M95 lane K (PLAN.md D74): the key goes in through VS Code's password box
// with the preset's shape checked as it is typed, and never enters the webview.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { promptForProviderKey, type ProviderKeyPrompt } from '../../src/host/providers/keyPrompt'

const PROMPT: ProviderKeyPrompt = {
  providerName: 'OpenRouter',
  origin: 'https://openrouter.ai',
  keyHint: 'sk-or-…',
  isKeyShape: (value) => value.startsWith('sk-or-'),
}

beforeEach(() => {
  vi.mocked(window.showInputBox).mockReset()
})

describe('promptForProviderKey', () => {
  it('opens a password box naming the provider, origin and shape', async () => {
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-abc')
    await promptForProviderKey(window.showInputBox, PROMPT)
    const options = vi.mocked(window.showInputBox).mock.calls[0]?.[0]
    expect(options).toMatchObject({ password: true, ignoreFocusOut: true, placeHolder: 'sk-or-…' })
    expect(options?.title).toContain('OpenRouter')
    expect(options?.prompt).toContain('https://openrouter.ai')
  })

  it('checks the shape live and trims the accepted key', async () => {
    vi.mocked(window.showInputBox).mockImplementation(async (options) => {
      expect(await options?.validateInput?.('nope')).toContain('OpenRouter')
      expect(await options?.validateInput?.('  sk-or-abc  ')).toBeUndefined()
      return '  sk-or-abc  '
    })
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBe('sk-or-abc')
  })

  it('answers undefined when the box is dismissed or accepted empty', async () => {
    vi.mocked(window.showInputBox).mockResolvedValue(undefined)
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBeUndefined()
    vi.mocked(window.showInputBox).mockResolvedValue(' '.repeat(3))
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBeUndefined()
  })
})
