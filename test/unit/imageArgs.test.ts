// D121 (NOLIMITS1 A24): an image prompt of any length and any number of edit
// sources parse — the removed 4000-character and 4-source ceilings were
// invented. Meta documents no prompt length and 1–10 edit items
// (dev.meta.ai/docs/image-generation, read 2026-10-16); the capability
// record carries neither, so nothing is enforced locally and Meta's own
// refusal reaches the person in words. Pure schemas through the real
// module: no mocks, no stand-ins.
import { describe, expect, it } from 'vitest'
import { editImageArgs, generateImageArgs } from '../../src/core/backends/modelapi/imageGeneration'

describe('image args (D121 A24)', () => {
  it('accepts a 5000-character prompt — what the removed ceiling refused', () => {
    const prompt = 'x'.repeat(5000)
    expect(generateImageArgs.safeParse({ prompt, path: 'a.png' }).success).toBe(true)
    expect(editImageArgs.safeParse({ prompt, images: ['a.png'], path: 'b.png' }).success).toBe(true)
  })
  it('accepts 5 edit sources — what the removed 4-source ceiling refused', () => {
    const images = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']
    expect(editImageArgs.safeParse({ prompt: 'mix', images, path: 'o.png' }).success).toBe(true)
  })
  it('still refuses a blank prompt and zero sources, as Meta rejects those', () => {
    expect(generateImageArgs.safeParse({ prompt: '', path: 'a.png' }).success).toBe(false)
    expect(editImageArgs.safeParse({ prompt: 'mix', images: [], path: 'o.png' }).success).toBe(
      false,
    )
  })
})
