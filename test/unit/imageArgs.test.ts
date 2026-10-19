// D121 (NOLIMITS1 A24, lane NOLIMITSINPUT): an image prompt of any length
// parses — the removed 4000-character ceiling was invented (Meta documents
// no prompt length). The edit-item range is Meta's own 1–10
// (dev.meta.ai/docs/image-generation, read 2026-10-19), so the capability
// record enforces it in `prepareImageCall` before any source is read or
// asked — the schema keeps only what is malformed whatever the provider
// says. Pure schemas through the real module: no mocks, no stand-ins.
import { describe, expect, it } from 'vitest'
import { editImageArgs, generateImageArgs } from '../../src/core/backends/modelapi/imageGeneration'

describe('image args (D121 A24, PR229FIX T1)', () => {
  it('accepts a 5000-character prompt — what the removed ceiling refused', () => {
    const prompt = 'x'.repeat(5000)
    expect(generateImageArgs.safeParse({ prompt, path: 'a.png' }).success).toBe(true)
    expect(editImageArgs.safeParse({ prompt, images: ['a.png'], path: 'b.png' }).success).toBe(true)
  })
  it('accepts 5 edit sources — what the removed 4-source ceiling refused', () => {
    const images = ['a.png', 'b.png', 'c.png', 'd.png', 'e.png']
    expect(editImageArgs.safeParse({ prompt: 'mix', images, path: 'o.png' }).success).toBe(true)
  })
  it('parses ten and eleven sources alike: the record, not the schema, enforces Meta’s 1–10', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `s${String(index)}.png`)
    const eleven = [...ten, 'extra.png']
    expect(editImageArgs.safeParse({ prompt: 'mix', images: ten, path: 'o.png' }).success).toBe(
      true,
    )
    // D121: the schema no longer carries Meta's documented maximum — eleven
    // parses, and `prepareImageCall` refuses it from the record before any
    // source is read or billed (proved in noLimitsInput.test.ts).
    expect(editImageArgs.safeParse({ prompt: 'mix', images: eleven, path: 'o.png' }).success).toBe(
      true,
    )
  })
  it('still refuses a blank prompt and zero sources, as Meta rejects those', () => {
    expect(generateImageArgs.safeParse({ prompt: '', path: 'a.png' }).success).toBe(false)
    expect(editImageArgs.safeParse({ prompt: 'mix', images: [], path: 'o.png' }).success).toBe(
      false,
    )
  })
})
