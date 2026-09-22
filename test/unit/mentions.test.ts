import { describe, expect, it } from 'vitest'
import {
  applyMention,
  mentionQueryAt,
  parseSkillInvocation,
  slashFilterOf,
} from '../../src/shared/mentions'

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
