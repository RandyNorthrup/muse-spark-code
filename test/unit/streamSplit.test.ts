import { describe, expect, it } from 'vitest'
import { splitForStreaming, splitOpenFence } from '../../src/webview/streamSplit'

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

describe('fences (M25)', () => {
  it('reads tilde fences and longer runs as CommonMark does', () => {
    // A tilde fence holds a blank line and a backtick line; the cut stays out of it.
    const text =
      paragraph.repeat(30) + '~~~~\nkeep\n\n```\nstill inside\n~~~~\n\n' + 'x'.repeat(1600)
    const { head, tail } = splitForStreaming(text)
    expect(head + tail).toBe(text)
    expect(head.endsWith('~~~~')).toBe(true)
    expect(splitOpenFence(head).open).toBeUndefined()
  })

  it('splits a fence left open at the end off the text, with its language', () => {
    expect(splitOpenFence('Intro\n\n```ts title=a.ts\nconst a = 1\nconst b')).toEqual({
      closed: 'Intro\n\n',
      open: { language: 'ts', code: 'const a = 1\nconst b' },
    })
    expect(splitOpenFence('```')).toEqual({ closed: '', open: { language: undefined, code: '' } })
    expect(splitOpenFence('done\n```js\nx\n```')).toEqual({
      closed: 'done\n```js\nx\n```',
      open: undefined,
    })
    // A backtick "fence" whose info holds a backtick is inline code, not a fence.
    expect(splitOpenFence('``` a`b\nrest').open).toBeUndefined()
    // A shorter or different run does not close a fence.
    expect(splitOpenFence('````\ncode\n```\n~~~~').open).toMatchObject({ code: 'code\n```\n~~~~' })
  })
})
