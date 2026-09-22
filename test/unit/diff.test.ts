import { describe, expect, it } from 'vitest'
import { parsePatchDocument, parseUnifiedText } from '../../src/webview/diff'

// The stored tool_patch document exactly as `item/readOutput` served it on
// 2026-09-22 (path shortened).
const patchDocument = JSON.stringify({
  files: [
    {
      path: 'notes.md',
      hunks: [
        {
          oldStart: 1,
          oldLines: 3,
          newStart: 1,
          newLines: 4,
          lines: [' # Notes', ' ', '-first line', '+second line', '+third line'],
        },
        { oldStart: 10, oldLines: 1, newStart: 11, newLines: 1, lines: [' tail'] },
      ],
    },
  ],
})

describe('parsePatchDocument', () => {
  it('numbers both sides and separates hunks', () => {
    const files = parsePatchDocument(patchDocument)
    expect(files).toHaveLength(1)
    expect(files?.[0]?.path).toBe('notes.md')
    expect(files?.[0]?.rows).toEqual([
      { kind: 'context', oldLine: 1, newLine: 1, text: '# Notes' },
      { kind: 'context', oldLine: 2, newLine: 2, text: '' },
      { kind: 'remove', oldLine: 3, newLine: undefined, text: 'first line' },
      { kind: 'add', oldLine: undefined, newLine: 3, text: 'second line' },
      { kind: 'add', oldLine: undefined, newLine: 4, text: 'third line' },
      { kind: 'hunk', oldLine: undefined, newLine: undefined, text: '' },
      { kind: 'context', oldLine: 10, newLine: 11, text: 'tail' },
    ])
  })

  it('refuses text that is not a patch document', () => {
    expect(parsePatchDocument('not json')).toBeUndefined()
    expect(parsePatchDocument('{"files":[{"path":"a"}]}')).toBeUndefined()
  })
})

describe('parseUnifiedText', () => {
  it('reads the edit tool visible output from the first hunk on', () => {
    const rows = parseUnifiedText(
      'edited\nchanged lines: line 3\n--- original\n+++ updated\n@@\n-first line\n+second line\n+third line\n',
    )
    expect(rows).toEqual([
      { kind: 'remove', oldLine: undefined, newLine: undefined, text: 'first line' },
      { kind: 'add', oldLine: undefined, newLine: undefined, text: 'second line' },
      { kind: 'add', oldLine: undefined, newLine: undefined, text: 'third line' },
    ])
  })

  it('separates several hunks and keeps context lines', () => {
    const rows = parseUnifiedText('@@\n a\n-b\n@@\n+c\n')
    expect(rows?.map((row) => `${row.kind}:${row.text}`)).toEqual([
      'context:a',
      'remove:b',
      'hunk:',
      'add:c',
    ])
  })

  it('returns undefined when there is no hunk', () => {
    expect(parseUnifiedText('wrote 3 bytes')).toBeUndefined()
  })
})
