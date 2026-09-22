import { describe, expect, it } from 'vitest'
import { formatMentionReference } from '../../src/core/mention'

describe('formatMentionReference', () => {
  it('formats a multi-line selection as a range', () => {
    expect(
      formatMentionReference({
        relativePath: 'src/app.ts',
        startLine: 5,
        endLine: 10,
        isEmpty: false,
      }),
    ).toBe('@src/app.ts#5-10')
  })

  it('formats a single-line selection as one line number', () => {
    expect(
      formatMentionReference({ relativePath: 'app.ts', startLine: 7, endLine: 7, isEmpty: false }),
    ).toBe('@app.ts#7')
  })

  it('formats an empty selection as the whole file', () => {
    expect(
      formatMentionReference({ relativePath: 'app.ts', startLine: 7, endLine: 7, isEmpty: true }),
    ).toBe('@app.ts')
  })

  it('normalises Windows separators', () => {
    expect(
      formatMentionReference({
        relativePath: String.raw`src\host\html.ts`,
        startLine: 1,
        endLine: 2,
        isEmpty: false,
      }),
    ).toBe('@src/host/html.ts#1-2')
  })
})
