import { describe, expect, it } from 'vitest'
import {
  applyMention,
  formatMention,
  mentionQueryAt,
  parseSkillInvocation,
  slashFilterOf,
} from '../../src/shared/mentions'

describe('formatMention (D27)', () => {
  it('writes a plain path as it is and quotes one with whitespace, # or a quote', () => {
    expect(formatMention('src/app.ts')).toBe('@src/app.ts')
    expect(formatMention('src/app.ts', { startLine: 5, endLine: 10 })).toBe('@src/app.ts#5-10')
    expect(formatMention('app.ts', { startLine: 7, endLine: 7 })).toBe('@app.ts#7')
    expect(formatMention('my notes/todo list.md')).toBe('@"my notes/todo list.md"')
    expect(formatMention('docs/C# guide.md', { startLine: 3, endLine: 3 })).toBe(
      '@"docs/C# guide.md"#3',
    )
    expect(formatMention('a#1.md')).toBe('@"a#1.md"')
    expect(formatMention(String.raw`say "hi"\now.md`)).toBe(String.raw`@"say \"hi\"\\now.md"`)
    expect(formatMention('日本語/ファイル.md')).toBe('@日本語/ファイル.md')
    expect(formatMention(String.raw`C:\no space.ts`)).toBe(String.raw`@"C:\\no space.ts"`)
  })
})

describe('mentions round-trip (D27)', () => {
  const paths = [
    'src/app.ts',
    'my notes/todo list.md',
    'docs/C# guide.md',
    'hash#.md',
    'tab\there.md',
    String.raw`say "hi"\now.md`,
    String.raw`back\slash dir/x.ts`,
    'Straße 1/日本語 ファイル.md',
    '🚀 launch/😀.ts',
    'src/',
  ]

  it('reads every path back from its mention, alone and inside a sentence', () => {
    for (const path of paths) {
      const mention = formatMention(path)
      expect(mentionQueryAt(mention, mention.length)).toEqual({
        start: 0,
        end: mention.length,
        query: path,
      })
      const text = `look at ${mention}`
      expect(mentionQueryAt(`${text} please`, text.length)).toEqual({
        start: 8,
        end: text.length,
        query: path,
      })
    }
  })

  it('reads the path back from a mention with a line range', () => {
    for (const path of paths) {
      const mention = formatMention(path, { startLine: 5, endLine: 10 })
      expect(mentionQueryAt(mention, mention.length)).toEqual({
        start: 0,
        end: mention.length,
        query: path,
      })
    }
  })

  it('writes what the menu picked in the same syntax', () => {
    const query = mentionQueryAt('see @my', 7)
    expect(query).toBeDefined()
    if (query !== undefined) {
      expect(applyMention('see @my', query, 'my notes/a#1.md')).toEqual({
        text: 'see @"my notes/a#1.md" ',
        caret: 23,
      })
    }
  })
})

describe('mentionQueryAt: quoted mentions being typed (D27)', () => {
  it('searches for the name typed inside an open quote, spaces included', () => {
    expect(mentionQueryAt('see @"my no', 11)).toEqual({ start: 4, end: 11, query: 'my no' })
    expect(mentionQueryAt('@"', 2)).toEqual({ start: 0, end: 2, query: '' })
    expect(mentionQueryAt('@"a b" and @"c d', 16)).toEqual({ start: 11, end: 16, query: 'c d' })
  })

  it('ends an open quote at a line break and a closed one at its quote', () => {
    expect(mentionQueryAt('@"my no\nnext', 12)).toBeUndefined()
    expect(mentionQueryAt('@"my no\nnext', 7)).toEqual({ start: 0, end: 7, query: 'my no' })
    expect(mentionQueryAt('@"a b"xyz', 9)).toBeUndefined()
    expect(mentionQueryAt('@"a b" done', 11)).toBeUndefined()
  })

  it('keeps an @ inside quotes, or inside a path, from starting a mention', () => {
    expect(mentionQueryAt('@"mail me@x.com"', 16)).toEqual({
      start: 0,
      end: 16,
      query: 'mail me@x.com',
    })
    expect(mentionQueryAt('@"a @b', 6)).toEqual({ start: 0, end: 6, query: 'a @b' })
  })
})

describe('mentionQueryAt', () => {
  it('finds the token at the start, after whitespace, and with an empty query', () => {
    expect(mentionQueryAt('@src', 4)).toEqual({ start: 0, end: 4, query: 'src' })
    expect(mentionQueryAt('look at @sr', 11)).toEqual({ start: 8, end: 11, query: 'sr' })
    expect(mentionQueryAt('hi @', 4)).toEqual({ start: 3, end: 4, query: '' })
    expect(mentionQueryAt('a\n@b', 4)).toEqual({ start: 2, end: 4, query: 'b' })
  })

  it('ignores e-mail-like and mid-word @, and a caret outside the token', () => {
    expect(mentionQueryAt('mail me@example.com', 19)).toBeUndefined()
    expect(mentionQueryAt('@src done', 9)).toBeUndefined()
    expect(mentionQueryAt('@src', 2)).toBeUndefined()
    expect(mentionQueryAt('no mention', 10)).toBeUndefined()
  })
})

describe('applyMention', () => {
  it('replaces the token with the path and a trailing space', () => {
    const query = mentionQueryAt('see @sr now', 7)
    expect(query).toBeDefined()
    if (query !== undefined) {
      expect(applyMention('see @sr now', query, 'src/app.ts')).toEqual({
        text: 'see @src/app.ts  now',
        caret: 16,
      })
    }
  })
})

describe('slashFilterOf', () => {
  it('returns the filter for a lone slash token and nothing otherwise', () => {
    expect(slashFilterOf('/')).toBe('')
    expect(slashFilterOf('/mod')).toBe('mod')
    expect(slashFilterOf('/compact now')).toBeUndefined()
    expect(slashFilterOf('hello')).toBeUndefined()
  })
})

describe('parseSkillInvocation', () => {
  const known = new Set(['fix-bug', 'acme:deploy'])

  it('splits a known selector from its arguments', () => {
    expect(parseSkillInvocation('/fix-bug', known)).toEqual({
      selector: 'fix-bug',
      arguments: undefined,
    })
    expect(parseSkillInvocation('  /acme:deploy to prod\nnow ', known)).toEqual({
      selector: 'acme:deploy',
      arguments: 'to prod\nnow',
    })
  })

  it('treats unknown selectors and plain text as prompt text', () => {
    expect(parseSkillInvocation('/unknown', known)).toBeUndefined()
    expect(parseSkillInvocation('fix-bug', known)).toBeUndefined()
    expect(parseSkillInvocation('', known)).toBeUndefined()
  })
})
