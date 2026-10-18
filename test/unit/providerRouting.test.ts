// The context-window edit's stored output cap (M95 local models): a
// window-sized derived cap rises with the window, an explicitly lower cap
// stays bounded by it, and a first window starts window-sized.
import { describe, expect, it } from 'vitest'
import { editedOutputTokens } from '../../src/shared/providerRouting'

describe('editedOutputTokens', () => {
  it('raises a derived window-sized cap with the window', () => {
    expect(editedOutputTokens({ contextTokens: 4096, outputTokens: 4096 }, 8192)).toBe(8192)
  })
  it('lowers a derived cap with the window', () => {
    expect(editedOutputTokens({ contextTokens: 8192, outputTokens: 8192 }, 4096)).toBe(4096)
  })
  it('keeps an explicitly lower cap, still bounded by the window', () => {
    expect(editedOutputTokens({ contextTokens: 4096, outputTokens: 1024 }, 8192)).toBe(1024)
    expect(editedOutputTokens({ contextTokens: 8192, outputTokens: 1024 }, 4096)).toBe(1024)
  })
  it('starts window-sized without a previous cap', () => {
    expect(editedOutputTokens(undefined, 4096)).toBe(4096)
  })
})
