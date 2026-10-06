// The chat column, the approval choices and the composer toolbar (M87, the
// owner's requests of 2026-10-04). Their geometry is measured in a browser:
// `columnGeometry` in test/harness/index.html runs in the column scenarios,
// which the accessibility gate opens at 690, 320 and 1400 px, and a miss
// fails the gate. This file checks that the stylesheet still carries the
// rules and that the gate still opens those pages at those widths.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SCENARIOS, SIZED_SCENARIOS } from '../../scripts/lib/harnessServer.mjs'

/** The first rule naming `selector`; with `isOwn`, the first that names it alone. */
function declarationsOf(css, selector, { isOwn = false } = {}) {
  const rules = css.matchAll(/([^{}]+)\{([^{}]*)\}/g).map((rule) => ({
    selectors: (rule[1] ?? '').split(',').map((candidate) => candidate.trim()),
    body: rule[2] ?? '',
  }))
  return rules.find(
    ({ selectors }) => selectors.includes(selector) && (!isOwn || selectors.length === 1),
  )?.body
}

// D94 moves the layout definitions into the stylesheet's generated import;
// the same geometry assertions still apply to the actual combined stylesheet.
const css = ['tokens.css', 'styles.css']
  .map((name) => readFileSync(new URL(`../../src/webview/${name}`, import.meta.url), 'utf8'))
  .join('\n')
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')

const harness = readFileSync(new URL('../harness/index.html', import.meta.url), 'utf8')

describe('the chat column (the owner’s requests of 2026-10-04)', () => {
  it('names its width, and takes its inset from the panel rather than the scroller', () => {
    const root = declarationsOf(css, ':root')
    expect(root).toMatch(/--ms-column-max-width\s*:\s*760px\s*;/)
    expect(root).toMatch(
      /--ms-column-inset\s*:\s*max\(0px,\s*\(100vw - var\(--ms-column-max-width\)\) \/ 2\)\s*;/,
    )
    expect(root).toMatch(
      /--ms-column-gutter\s*:\s*calc\(var\(--ms-column-inset\) \+ var\(--ms-gap\)\)/,
    )
  })

  it('holds the transcript, the panes above the composer, the dock and the composer', () => {
    const transcript = declarationsOf(css, '.transcript')
    expect(transcript).toMatch(
      /max-width\s*:\s*calc\(var\(--ms-column-max-width\) - 2 \* var\(--ms-gap\)\)\s*;/,
    )
    // The start inset is fixed; the scrollbar takes its room from the end.
    expect(transcript).toMatch(/margin-inline\s*:\s*var\(--ms-column-inset\) 0\s*;/)
    for (const selector of ['.composer-area', '.approval-dock']) {
      expect(declarationsOf(css, selector)).toMatch(
        /margin-inline\s*:\s*var\(--ms-column-inset\)\s*;/,
      )
    }
    expect(declarationsOf(css, '.todo')).toMatch(/margin\s*:\s*0 var\(--ms-column-gutter\)\s*;/)
    expect(declarationsOf(css, '.local-schedules')).toMatch(
      /margin\s*:\s*0 var\(--ms-column-gutter\) 4px\s*;/,
    )
    expect(declarationsOf(css, '.diff-tally')).toMatch(/padding\s*:[^;]*var\(--ms-column-inset\)/)
  })
})

describe('the approval choices and the composer toolbar', () => {
  it('gives every approval choice one height and one line', () => {
    const choice = declarationsOf(css, '.approval-choices > button')
    expect(choice).toMatch(/height\s*:\s*var\(--ms-button-height\)\s*;/)
    expect(choice).toMatch(/white-space\s*:\s*nowrap\s*;/)
    expect(choice).toMatch(/text-overflow\s*:\s*ellipsis\s*;/)
  })

  it('paints the model pill at the chips’ height inside a whole control', () => {
    const pill = declarationsOf(css, '.pill', { isOwn: true })
    expect(pill).toMatch(
      /border-block-width\s*:\s*calc\(\(var\(--ms-control-size\) - var\(--ms-chip-height\)\) \/ 2\)\s*;/,
    )
    expect(pill).toMatch(/background-clip\s*:\s*padding-box\s*;/)
    expect(declarationsOf(css, '.editor-chip')).toMatch(/height\s*:\s*var\(--ms-chip-height\)\s*;/)
  })
})

describe('the browser checks', () => {
  it('opens the column at the default width, 320 px and 1400 px (with a scrollbar)', () => {
    expect(SCENARIOS).toEqual(expect.arrayContaining(['column', 'column-narrow', 'column-wide']))
    expect(SIZED_SCENARIOS['column-narrow']).toMatchObject({ width: 320 })
    expect(SIZED_SCENARIOS['column-wide']).toMatchObject({ width: 1400, hasScrollbars: true })
  })

  it('measures the column in each of those scenarios', () => {
    expect(harness).toContain('const columnGeometry = () => {')
    for (const call of [
      'columnScenario()',
      'columnScenario(COLUMN_NARROW_PX)',
      'columnScenario(COLUMN_WIDE_PX)',
    ]) {
      expect(harness).toContain(call)
    }
  })
})
