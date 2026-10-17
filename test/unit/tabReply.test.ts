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
  cursorLineBefore: '  return ',
  lineAbove: 'export function add(a: number, b: number) {',
  linesBelow: ['', '  return total;', '}'],
  secretLiterals: [],
}

/** The cursor at the end of a TypeScript block opener, the body still empty. */
const AT_BLOCK: TabFilterContext = {
  mode: 'multiline',
  suffix: '\n}\n',
  cursorLineBefore: 'function answer() {',
  lineAbove: '',
  linesBelow: ['}'],
  secretLiterals: [],
}

/** The cursor at column zero on the line below a Python block opener. */
const PYTHON_BODY: TabFilterContext = {
  mode: 'multiline',
  suffix: '\n',
  cursorLineBefore: '',
  lineAbove: 'def answer():',
  linesBelow: [],
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
    expect(suggestFromReply(' '.repeat(3), CONTEXT)).toEqual({ drop: 'empty' })
    expect(suggestFromReply(tagged(' '.repeat(3)), CONTEXT)).toEqual({ drop: 'empty' })
    expect(suggestFromReply(tagged('\n  \n'), AT_BLOCK)).toEqual({ drop: 'empty' })
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

  it('keeps a line break and indentation the model supplied after a block opener', () => {
    expect(completionOf(tagged('\n  return 42;'), AT_BLOCK)).toBe('\n  return 42;')
  })

  it('keeps a Python body’s indentation with the cursor at column zero', () => {
    expect(completionOf(tagged('    return 42'), PYTHON_BODY)).toBe('    return 42')
  })

  it('keeps the space that separates the completion from the suffix', () => {
    const beforeCall: TabFilterContext = {
      ...CONTEXT,
      cursorLineBefore: '  ',
      suffix: 'foobar()\n}\n',
      linesBelow: ['}'],
    }
    expect(completionOf(tagged('return foo'), beforeCall)).toBe('return ')
  })

  it('adds the line break a body left out after a block opener', () => {
    expect(completionOf(tagged('  return 42;'), AT_BLOCK)).toBe('\n  return 42;')
    const python = { ...PYTHON_BODY, cursorLineBefore: 'def answer():' }
    expect(completionOf(tagged('    return 42'), python)).toBe('\n    return 42')
    const call = { ...AT_BLOCK, cursorLineBefore: 'configure(' }
    expect(completionOf(tagged('\tverbose: true,'), call)).toBe('\n\tverbose: true,')
    const list = { ...AT_BLOCK, cursorLineBefore: 'const sizes = [  ' }
    expect(completionOf(tagged('  1,\n  2,'), list)).toBe('\n  1,\n  2,')
  })

  it('adds no line break where the reply continues the cursor’s line', () => {
    const annotation = { ...AT_BLOCK, cursorLineBefore: 'let total:', suffix: '\n' }
    expect(completionOf(tagged(' number = 0'), annotation)).toBe(' number = 0')
    const call = { ...AT_BLOCK, cursorLineBefore: 'configure(', suffix: '\n' }
    expect(completionOf(tagged('options)'), call)).toBe('options)')
    const closed = { ...AT_BLOCK, cursorLineBefore: 'configure(', suffix: ')\n' }
    expect(completionOf(tagged('  options'), closed)).toBe('  options')
  })

  it('drops indentation the user already typed on a blank line', () => {
    const indented = { ...PYTHON_BODY, cursorLineBefore: ' '.repeat(4) }
    expect(completionOf(tagged('    return total\n    print(total)'), indented)).toBe(
      'return total\n    print(total)',
    )
    expect(completionOf(tagged('        return total'), indented)).toBe('    return total')
  })

  it('drops a stray trailing line break and a whitespace-only last line', () => {
    // At the end of the file, so no suffix overlap can take the break away.
    const atEnd = { ...CONTEXT, suffix: '' }
    expect(completionOf(tagged('a + b;\n'), atEnd)).toBe('a + b;')
    expect(completionOf(tagged('a + b;\n  '), atEnd)).toBe('a + b;')
    const blockAtEnd = { ...AT_BLOCK, suffix: '' }
    expect(completionOf(tagged('\n  return 42;\n'), blockAtEnd)).toBe('\n  return 42;')
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
