import { describe, expect, it } from 'vitest'
import { splitForStreaming } from '../../src/webview/streamSplit'

const paragraph = 'A paragraph of prose that is long enough to matter for the split.\n\n'
const fence = '```ts\nconst a = 1\n\nconst b = 2\n```\n\n'

describe('splitForStreaming', () => {
  it('keeps a short reply whole', () => {
    expect(splitForStreaming(paragraph.repeat(3))).toEqual({ head: '', tail: paragraph.repeat(3) })
  })

  it('splits a long reply at a blank line, leaving a tail of at least 1500 chars', () => {
    const text = paragraph.repeat(60)
    const { head, tail } = splitForStreaming(text)
    expect(head + tail).toBe(text)
    expect(head.length).toBeGreaterThan(0)
    expect(tail.length).toBeGreaterThanOrEqual(1500)
    expect(tail.startsWith('\n\n')).toBe(true)
  })

  it('never cuts inside a code fence', () => {
    // Fences hold blank lines; a naive split at the last blank line would land
    // inside the final fence, so the cut moves back before it.
    const text = paragraph.repeat(30) + fence + paragraph.repeat(2) + '```ts\nlet x\n\nlet y\n'
    const { head, tail } = splitForStreaming(text)
    expect(head + tail).toBe(text)
    expect((head.match(/```/g) ?? []).length % 2).toBe(0)
    expect(tail).toContain('let y')
  })

  it('gives up and returns all tail when every blank line is inside a fence', () => {
    const text = '```\n' + 'line\n\n'.repeat(400)
    expect(splitForStreaming(text)).toEqual({ head: '', tail: text })
  })
})
