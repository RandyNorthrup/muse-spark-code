// The prompt boundary's failure words (src/host/prompts/promptFailure.ts):
// a message from the known fixed list passes through, while anything else
// — private paths, prompt text, a foreign error, a non-error — reads as
// the fixed invalid words, with the original cause discarded.
import { expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { isPromptStoreDamaged, safePromptFailure } from '../../src/host/prompts/promptFailure'

it('passes a known fixed message through, and only those', () => {
  for (const message of [UI_TEXT.promptStoreDamaged, UI_TEXT.shareConfidential]) {
    expect(safePromptFailure(new Error(message)).message).toBe(message)
  }
})

it('names only the store damage report as damage', () => {
  expect(isPromptStoreDamaged(new Error(UI_TEXT.promptStoreDamaged))).toBe(true)
  expect(isPromptStoreDamaged(new Error(UI_TEXT.promptStoreBusy))).toBe(false)
  expect(isPromptStoreDamaged(new Error('workspace prompt text'))).toBe(false)
  expect(isPromptStoreDamaged('a bare string')).toBe(false)
  expect(isPromptStoreDamaged(undefined)).toBe(false)
})

it('reads anything else as the fixed invalid words, cause discarded', () => {
  const personal = new Error('workspace prompt text /home/someone/secret')
  const failure = safePromptFailure(personal)
  expect(failure.message).toBe(UI_TEXT.promptFileInvalid)
  expect(failure.message).not.toContain('secret')
  expect(failure.cause).toBeUndefined()
  expect(safePromptFailure('a bare string').message).toBe(UI_TEXT.promptFileInvalid)
  expect(safePromptFailure(undefined).message).toBe(UI_TEXT.promptFileInvalid)
})
