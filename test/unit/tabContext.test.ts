import { describe, expect, it } from 'vitest'

import {
  TAB_FAST_PREFIX_CHARS,
  TAB_FAST_SUFFIX_CHARS,
  TAB_PREFIX_ANCHOR_LINES,
} from '../../src/shared/constants'
import {
  contextWindow,
  cursorLine,
  orderSnippets,
  selectMode,
} from '../../src/core/tab/tabContext'

/**
 * Numbered lines of exactly 200 characters, so anchors land deterministically:
 * line N starts at offset N * 201.
 */
function numbered(count: number): string {
  return Array.from({ length: count }, (_line, index) => {
    const head = `line ${String(index)} `
    return `${head}${'x'.repeat(200 - head.length)}`
  }).join('\n')
}

describe('cursorLine', () => {
  it('splits the cursor line at the offset', () => {
    const line = cursorLine('ab\ncd ef\ngh', 5)
    expect(line.before).toBe('cd')
    expect(line.after).toBe(' ef')
    expect(line.isBlank).toBe(false)
  })

  it('sees a whitespace-only line as blank', () => {
    expect(cursorLine('x\n   \ny', 4).isBlank).toBe(true)
  })

  it('clamps an offset outside the document', () => {
    expect(cursorLine('ab', 99).before).toBe('ab')
    expect(cursorLine('ab', -5).before).toBe('')
  })
})

describe('selectMode', () => {
  it('is always multi-line on Invoke', () => {
    expect(
      selectMode({ trigger: 'onInvoke', multiline: 'never', blankLine: false, blockOpener: false }),
    ).toBe('multiline')
  })

  it('stays fast on Automatic when multi-line is off or invoke-only', () => {
    for (const multiline of ['never', 'onInvoke'] as const) {
      expect(
        selectMode({ trigger: 'automatic', multiline, blankLine: true, blockOpener: true }),
      ).toBe('fast')
    }
  })

  it('goes multi-line on Automatic for a blank line or a block opener', () => {
    expect(
      selectMode({ trigger: 'automatic', multiline: 'auto', blankLine: true, blockOpener: false }),
    ).toBe('multiline')
    expect(
      selectMode({ trigger: 'automatic', multiline: 'auto', blankLine: false, blockOpener: true }),
    ).toBe('multiline')
    expect(
      selectMode({
        trigger: 'automatic',
        multiline: 'auto',
        blankLine: false,
        blockOpener: false,
      }),
    ).toBe('fast')
  })
})

describe('contextWindow', () => {
  it('takes the suffix forward from the cursor', () => {
    const text = `abc${'x'.repeat(TAB_FAST_SUFFIX_CHARS + 10)}`
    const window = contextWindow(text, 3, 'fast')
    expect(window.suffix).toBe('x'.repeat(TAB_FAST_SUFFIX_CHARS))
    expect(window.prefix).toBe('abc')
    expect(window.startLine).toBe(0)
  })

  it('runs the anchored prefix from its line start, past the allowance', () => {
    const text = `${'a'.repeat(TAB_FAST_PREFIX_CHARS + 500)}cursor${'b'.repeat(10)}`
    const at = TAB_FAST_PREFIX_CHARS + 500
    const window = contextWindow(text, at, 'fast')
    expect(window.prefix).toBe('a'.repeat(TAB_FAST_PREFIX_CHARS + 500))
    expect(window.suffix).toBe(`cursor${'b'.repeat(10)}`)
    expect(window.startLine).toBe(0)
  })

  it('keeps the prefix start on a 32-line multiple while typing forward', () => {
    const text = numbered(140)
    const first = text.indexOf('line 90')
    const second = text.indexOf('line 91')
    const before = contextWindow(text, first + 2, 'fast')
    const after = contextWindow(text, second + 2, 'fast')
    expect(before.startLine).toBe(TAB_PREFIX_ANCHOR_LINES)
    expect(after.startLine).toBe(TAB_PREFIX_ANCHOR_LINES)
    expect(after.prefix.startsWith(before.prefix)).toBe(true)
  })

  it('moves the anchor only across a block boundary', () => {
    const text = numbered(140)
    const inFirstBlock = contextWindow(text, text.indexOf('line 70'), 'fast')
    const inSecondBlock = contextWindow(text, text.indexOf('line 110'), 'fast')
    expect(inFirstBlock.startLine).toBe(TAB_PREFIX_ANCHOR_LINES)
    expect(inSecondBlock.startLine).toBe(TAB_PREFIX_ANCHOR_LINES * 2)
  })

  it('looks further back in multi-line mode', () => {
    const text = Array.from({ length: 200 }, () => 'x'.repeat(100)).join('\n')
    const fast = contextWindow(text, text.length, 'fast')
    const multiline = contextWindow(text, text.length, 'multiline')
    expect(multiline.prefix.length).toBeGreaterThan(fast.prefix.length)
    expect(multiline.startLine % TAB_PREFIX_ANCHOR_LINES).toBe(0)
  })
})

describe('orderSnippets', () => {
  it('sorts by path so the order is stable', () => {
    const rendered = orderSnippets([
      { path: 'b.ts', text: 'two' },
      { path: 'a.ts', text: 'one' },
    ])
    expect(rendered.indexOf('a.ts')).toBeLessThan(rendered.indexOf('b.ts'))
    expect(rendered).toContain('one')
    expect(rendered).toContain('two')
  })

  it('bounds the whole at the context budget', () => {
    const big = 'z'.repeat(9000)
    expect(orderSnippets([{ path: 'big.ts', text: big }])).toBe('')
    const rendered = orderSnippets([
      { path: 'big.ts', text: big },
      { path: 'small.ts', text: 'kept' },
    ])
    expect(rendered).toContain('kept')
    expect(rendered).not.toContain(big)
  })

  it('renders nothing for no snippets', () => {
    expect(orderSnippets([])).toBe('')
  })
})
