import { describe, expect, it } from 'vitest'
import { parseCommandLine, parseChatGptProviderAction } from '../../src/runtime/cliArgs'
import { chatGptCommandText } from '../../src/runtime/chatGptProviderCommands'
import { UI_TEXT } from '../../src/shared/constants'

// Pure command/text boundaries only. Authenticated lifecycle behavior requires
// the real OS store and dated captured OpenAI exchanges, not an invented issuer.
describe('terminal ChatGPT command boundary', () => {
  it.each(['add', 'remove', 'status'])('parses the local %s action', (action) => {
    const argv = ['providers', action, 'chatgpt']
    expect(parseChatGptProviderAction(argv)).toBe(action)
    expect(parseCommandLine(argv)).toEqual({ command: 'chatGptProvider', action })
  })

  it.each([
    ['providers', 'add', 'chatgpt', 'private-value'],
    ['providers', 'add', 'chatgpt', '--key-stdin'],
    ['providers', 'status', 'chatgpt', '--backend', 'modelApi'],
    ['providers', 'other', 'chatgpt'],
  ])('rejects unexpected inputs without echoing them: %j', (...argv) => {
    expect(parseChatGptProviderAction(argv)).toBeUndefined()
    expect(parseCommandLine(argv)).toEqual({
      command: 'invalid',
      reason: UI_TEXT.acpChatGpt.usage,
    })
  })

  it('uses the same credential-store refusal as the other terminal surfaces', () => {
    const failure = chatGptCommandText().failure('store-unavailable')
    expect(failure).toBe(UI_TEXT.acpStoreDown)
    expect(failure).toContain('stored keys cannot be checked')
    expect(chatGptCommandText().status('signed-out')).toBe(UI_TEXT.acpChatGpt.states['signed-out'])
    expect(chatGptCommandText().failure('expired')).toBe(UI_TEXT.planUi.expired)
  })
})
