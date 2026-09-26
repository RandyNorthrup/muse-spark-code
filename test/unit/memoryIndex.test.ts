import { describe, expect, it } from 'vitest'
import {
  indexLineFor,
  hasIndexLine,
  isIndexPath,
  limitMemoryIndex,
  noteSummary,
  withIndexLine,
  withoutIndexLines,
} from '../../src/core/memory/memoryIndex'
import { MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_MAX_LINES } from '../../src/shared/constants'

describe('limitMemoryIndex', () => {
  it('returns an index within the limits trimmed, with no warning', () => {
    expect(limitMemoryIndex('- [Build](build.md) | npm run build\n', 'project MEMORY.md')).toEqual({
      text: '- [Build](build.md) | npm run build',
      warning: undefined,
    })
  })

  it("cuts an index over the line limit with Muse Code's marker and a warning", () => {
    const lines = Array.from(
      { length: MEMORY_INDEX_MAX_LINES + 5 },
      (_, i) => `- [n${String(i)}](n.md) | h`,
    )
    const index = limitMemoryIndex(lines.join('\n'), 'project MEMORY.md')
    expect(index.text.split('\n')).toHaveLength(MEMORY_INDEX_MAX_LINES + 1)
    expect(index.text.endsWith('\n[MEMORY.md truncated]')).toBe(true)
    expect(index.warning).toBe(
      `project MEMORY.md: ${String(MEMORY_INDEX_MAX_LINES + 5)} lines exceeds the ${String(MEMORY_INDEX_MAX_LINES)} line index limit; it is truncated for this session`,
    )
  })

  it('cuts an index over the byte limit', () => {
    const index = limitMemoryIndex(
      `- ${'x'.repeat(MEMORY_INDEX_MAX_BYTES)}\n`,
      'personal MEMORY.md',
    )
    expect(Buffer.byteLength(index.text)).toBeLessThanOrEqual(
      MEMORY_INDEX_MAX_BYTES + '\n[MEMORY.md truncated]'.length,
    )
    expect(index.warning).toMatch(
      /^personal MEMORY\.md: \d+ bytes exceeds the \d+ byte index limit/,
    )
  })
})

describe('index lines', () => {
  const INDEX = '- [Deploy](deploy.md) | Fridays\n- [Build](./notes/build.md) | npm\nfree text\n'

  it('finds the lines that link to a note, `./` or not', () => {
    expect(hasIndexLine(INDEX, 'deploy.md')).toBe(true)
    expect(hasIndexLine(INDEX, 'notes/build.md')).toBe(true)
    expect(hasIndexLine(INDEX, 'build.md')).toBe(false)
  })

  it('removes only the lines that link to the note, and says when there were none', () => {
    expect(withoutIndexLines(INDEX, 'deploy.md')).toBe(
      '- [Build](./notes/build.md) | npm\nfree text\n',
    )
    expect(withoutIndexLines(INDEX, 'missing.md')).toBeUndefined()
  })

  it('adds a line at the end, the index made from nothing when there is none', () => {
    expect(withIndexLine(undefined, '- [a](a.md)')).toBe('- [a](a.md)\n')
    expect(withIndexLine('\n\n', '- [a](a.md)')).toBe('- [a](a.md)\n')
    expect(withIndexLine('- [x](x.md)\r\n\r\n', '- [a](a.md)')).toBe('- [x](x.md)\n- [a](a.md)\n')
  })

  it('names a note by its file and hooks it with one line, cut at the limit', () => {
    expect(indexLineFor('notes/build.md', 'npm run build')).toBe(
      '- [build](notes/build.md) | npm run build',
    )
    expect(indexLineFor('deploy.md', '  ')).toBe('- [deploy](deploy.md)')
    const long = indexLineFor('a.md', `# ${'word '.repeat(60)}`)
    expect(long.length).toBeLessThan(140)
    expect(long.endsWith('…')).toBe(true)
    expect(long).toContain('| word word')
  })

  it('round-trips Markdown-unsafe note names through the index', () => {
    const note = 'notes/build (phase 2)%].md'
    const line = indexLineFor(note, 'A plan')
    expect(line).toBe(
      String.raw`- [build (phase 2)%\]](notes/build%20%28phase%202%29%25%5D.md) | A plan`,
    )
    expect(hasIndexLine(line, note)).toBe(true)
    expect(withoutIndexLines(`${line}\n- [other](other.md)\n`, note)).toBe('- [other](other.md)\n')

    const nested = 'notes/a](b).md'
    expect(hasIndexLine(indexLineFor(nested, ''), nested)).toBe(true)
    expect(hasIndexLine('- [old](notes/a(b).md)', 'notes/a(b).md')).toBe(true)
  })

  it('knows the index itself', () => {
    expect(isIndexPath('MEMORY.md')).toBe(true)
    expect(isIndexPath('notes/MEMORY.md')).toBe(false)
  })
})

describe('noteSummary', () => {
  it('takes the front matter description, else the first line of text', () => {
    expect(noteSummary('---\ntype: reference\ndescription: Deploy day\n---\n\nDeploys run.')).toBe(
      'Deploy day',
    )
    expect(noteSummary('---\ntype: user\n---\n\n# Tabs\n\nPrefers tabs.')).toBe('Tabs')
    expect(noteSummary('\n\nBuild with npm.\nMore.')).toBe('Build with npm.')
    expect(noteSummary('')).toBe('')
    expect(noteSummary('---\nunclosed front matter')).toBe('---')
  })
})
