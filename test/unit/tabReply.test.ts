import { describe, expect, it } from 'vitest'

import {
  TAB_MAX_COMPLETION_CHARS,
  TAB_REPLY_CLOSE_TAG,
  TAB_REPLY_OPEN_TAG,
} from '../../src/shared/constants'
import {
  cutCompletion,
  extractCompletion,
  stripReplyWrapper,
  suggestFromReply,
  trimTrailingOverlap,
  type TabFilterContext,
} from '../../src/core/tab/tabReply'

const CONTEXT: TabFilterContext = {
  mode: 'fast',
  suffix: '\n}\n',
  lineAbove: 'export function add(a: number, b: number) {',
  linesBelow: ['', '  return total;', '}'],
  secretLiterals: [],
}

function tagged(inner: string): string {
  return `${TAB_REPLY_OPEN_TAG}${inner}${TAB_REPLY_CLOSE_TAG}`
}

/** The suggestion's completion, or the test fails on a drop. */
function completionOf(reply: string, context: TabFilterContext = CONTEXT): string {
  const suggestion = suggestFromReply(reply, context)
  if (!('completion' in suggestion)) {
    throw new Error(`expected a suggestion, dropped as ${suggestion.drop}`)
  }
  return suggestion.completion
}

describe('stripReplyWrapper', () => {
  it('strips a fence around the whole reply', () => {
    expect(stripReplyWrapper(`\`\`\`typescript\n${tagged('x')}\n\`\`\``)).toBe(tagged('x'))
  })

  it('leaves an unfenced reply alone', () => {
    expect(stripReplyWrapper(`  ${tagged('x')}  `)).toBe(tagged('x'))
  })
})

describe('extractCompletion', () => {
  it('reads the text between the tags, ignoring a lead-in and a tail', () => {
    expect(extractCompletion(`Here is it:\n${tagged('foo()')}\nHope that helps`)).toBe('foo()')
  })

  it('means no suggestion without an open tag', () => {
    expect(extractCompletion('just prose, no tags')).toBeUndefined()
  })

  it('means no suggestion for an unterminated tag', () => {
    expect(extractCompletion(`${TAB_REPLY_OPEN_TAG}foo()`)).toBeUndefined()
  })

  it('ignores a stray close before the open tag', () => {
    expect(extractCompletion(`oops ${TAB_REPLY_CLOSE_TAG}\n${tagged('foo()')}`)).toBe('foo()')
  })

  it('takes the first of duplicate pairs', () => {
    expect(extractCompletion(`${tagged('first')}\n${tagged('second')}`)).toBe('first')
  })
})

describe('cutCompletion', () => {
  it('ends a reply at its first blank line after the first line', () => {
    expect(cutCompletion('one\ntwo\n\nfour', 'multiline')).toBe('one\ntwo')
  })

  it('caps fast replies at three lines and multi-line ones at sixteen', () => {
    const lines = Array.from({ length: 20 }, (_line, index) => `kept ${String(index)}`).join('\n')
    expect(cutCompletion(lines, 'fast').split('\n')).toHaveLength(3)
    expect(cutCompletion(lines, 'multiline').split('\n')).toHaveLength(16)
  })

  it('cuts a long reply at a line boundary, then hard at the character cap', () => {
    const lines = Array.from({ length: 30 }, () => 'x'.repeat(100)).join('\n')
    const cut = cutCompletion(lines, 'multiline')
    expect(cut.length).toBeLessThanOrEqual(TAB_MAX_COMPLETION_CHARS)
    const oneLine = `y`.repeat(TAB_MAX_COMPLETION_CHARS + 50)
    expect(cutCompletion(oneLine, 'multiline')).toBe('y'.repeat(TAB_MAX_COMPLETION_CHARS))
  })
})

describe('trimTrailingOverlap', () => {
  it('trims the overlap with the suffix start', () => {
    expect(trimTrailingOverlap('return foo', 'foobar()')).toBe('return ')
    expect(trimTrailingOverlap('no overlap', 'other()')).toBe('no overlap')
  })
})

describe('suggestFromReply', () => {
  it('keeps a clean completion', () => {
    expect(completionOf(tagged('a + b;'))).toBe('a + b;')
  })

  it('drops an empty reply and an empty completion', () => {
    expect(suggestFromReply('   ', CONTEXT)).toEqual({ drop: 'empty' })
    expect(suggestFromReply(tagged('   '), CONTEXT)).toEqual({ drop: 'empty' })
  })

  it('drops a reply outside the tags', () => {
    expect(suggestFromReply('no tags here', CONTEXT)).toEqual({ drop: 'untagged' })
  })

  it('drops a completion that only repeats the suffix, after trimming overlap', () => {
    const suffix = { ...CONTEXT, suffix: 'foobar()' }
    expect(suggestFromReply(tagged('foo'), suffix)).toEqual({ drop: 'suffixRepeat' })
    expect(suggestFromReply(tagged('foobar'), suffix)).toEqual({ drop: 'suffixRepeat' })
    expect(completionOf(tagged('foobarbaz'), suffix)).toBe('foobarbaz')
  })

  it('drops a completion repeating the line above or the next line below', () => {
    expect(
      suggestFromReply(tagged('export function add(a: number, b: number) {'), CONTEXT),
    ).toEqual({ drop: 'lineAboveRepeat' })
    expect(suggestFromReply(tagged('  return total;'), CONTEXT)).toEqual({
      drop: 'lineBelowRepeat',
    })
    expect(completionOf(tagged('return total;'), { ...CONTEXT, linesBelow: [] })).toBe(
      'return total;',
    )
  })

  it('drops three identical lines but keeps two', () => {
    expect(suggestFromReply(tagged('x = 1;\nx = 1;\nx = 1;'), CONTEXT)).toEqual({
      drop: 'repeatedLines',
    })
    expect(completionOf(tagged('x = 1;\nx = 1;'))).toBe('x = 1;\nx = 1;')
  })

  it('drops an unbalanced close in fast mode but allows it multi-line', () => {
    expect(suggestFromReply(tagged('));'), CONTEXT)).toEqual({ drop: 'unbalancedClose' })
    expect(completionOf(tagged('));'), { ...CONTEXT, mode: 'multiline' })).toBe('));')
    expect(completionOf(tagged('foo(bar);'))).toBe('foo(bar);')
  })

  it('drops a secret, a known literal and the redactor’s mark', () => {
    expect(suggestFromReply(tagged(`key = sk-${'a'.repeat(24)}`), CONTEXT)).toEqual({
      drop: 'secret',
    })
    const literal = { ...CONTEXT, secretLiterals: ['tab-test-sentinel-literal'] }
    expect(suggestFromReply(tagged('holds tab-test-sentinel-literal inside'), literal)).toEqual({
      drop: 'secret',
    })
    expect(suggestFromReply(tagged('holds [redacted] inside'), CONTEXT)).toEqual({
      drop: 'secret',
    })
  })
})
