// M95 lane K (PLAN.md D74): the key goes in through VS Code's password box
// and never enters the webview. Lane PROVKEYS: any non-blank key is
// accepted — the provider judges it through the free key test, never its
// looks — so the box carries no shape check.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { window } from 'vscode'
import { promptForProviderKey, type ProviderKeyPrompt } from '../../src/host/providers/keyPrompt'

const PROMPT: ProviderKeyPrompt = {
  providerName: 'OpenRouter',
  origin: 'https://openrouter.ai',
  keyHint: 'sk-or-…',
}

beforeEach(() => {
  vi.mocked(window.showInputBox).mockReset()
})

describe('promptForProviderKey', () => {
  it('opens a password box naming the provider, origin and key source', async () => {
    vi.mocked(window.showInputBox).mockResolvedValue('sk-or-abc')
    await promptForProviderKey(window.showInputBox, PROMPT)
    const options = vi.mocked(window.showInputBox).mock.calls[0]?.[0]
    expect(options).toMatchObject({ password: true, ignoreFocusOut: true, placeHolder: 'sk-or-…' })
    expect(options?.title).toContain('OpenRouter')
    expect(options?.prompt).toContain('https://openrouter.ai')
  })

  it('asks nothing about the shape and trims the accepted key', async () => {
    // The released defect's shape: a working key with no frozen prefix is
    // accepted as typed; the provider judges it.
    vi.mocked(window.showInputBox).mockImplementation((options) => {
      expect(options?.validateInput).toBeUndefined()
      return Promise.resolve('  AQ.synthetic-fixture-00001-no-frozen-prefix  ')
    })
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBe(
      'AQ.synthetic-fixture-00001-no-frozen-prefix',
    )
  })

  it('answers undefined when the box is dismissed or accepted empty', async () => {
    vi.mocked(window.showInputBox).mockResolvedValue(undefined)
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBeUndefined()
    vi.mocked(window.showInputBox).mockResolvedValue(' '.repeat(3))
    await expect(promptForProviderKey(window.showInputBox, PROMPT)).resolves.toBeUndefined()
  })
})
