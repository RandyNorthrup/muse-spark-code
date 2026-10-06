import { describe, expect, it, vi } from 'vitest'
import { conversationLoader } from '../../src/host/conversation/conversationBundle'
import { createConversation } from '../../src/host/conversation/conversationEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'

describe('the first-surface conversation loader', () => {
  it('loads nothing until asked, and shares the loaded factory', () => {
    const bundle = { createConversation }
    const loadBundle = vi.fn(() => bundle)
    const load = conversationLoader({
      bundlePath: '/dist/conversation.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(loadBundle).not.toHaveBeenCalled()
    expect(load()).toBe(bundle)
    expect(load()).toBe(bundle)
    expect(loadBundle).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, {}, { createConversation: true }])(
    'refuses an invalid bundle and retries (%s)',
    (invalid) => {
      let result: unknown = invalid
      const load = conversationLoader({
        bundlePath: '/dist/conversation.js',
        log: new FakeLogOutputChannel(),
        loadBundle: () => result,
      })
      expect(load).toThrow(UI_TEXT.actionFailed)
      result = { createConversation }
      expect(load()).toEqual({ createConversation })
    },
  )

  it('retries after a failed file load', () => {
    const loadBundle = vi
      .fn(() => ({ createConversation }))
      .mockImplementationOnce(() => {
        throw new Error('missing')
      })
    const load = conversationLoader({
      bundlePath: '/dist/conversation.js',
      log: new FakeLogOutputChannel(),
      loadBundle,
    })
    expect(load).toThrow(UI_TEXT.actionFailed)
    expect(load()).toEqual({ createConversation })
  })
})
